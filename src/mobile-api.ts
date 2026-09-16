import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

import { PluginLogger } from './logger'

/**
 * 手机端 API（REST + SSE）。
 *
 * 控制台内部走的是 websocket RPC（@koishijs/client 的 send / receive），手机 App / PWA
 * 没法直接用（要连 websocket、还要控制台登录态），所以这里补一层标准 HTTP 接口：
 *
 *   POST /qq-chat/api/login     用访问密码换一个长期令牌（同时写 cookie，方便媒体请求）
 *   GET  /qq-chat/api/me        机器人 / 频道 / 未读总览（含每个频道最后一条消息预览）
 *   GET  /qq-chat/api/channels  频道列表
 *   GET  /qq-chat/api/messages  拉某个频道的历史消息（分页）
 *   POST /qq-chat/api/send      发消息（文字 / 图片 / 文件 / 引用）
 *   POST /qq-chat/api/read      标记频道已读
 *   POST /qq-chat/api/rpc       通用桥：按名字调用控制台里注册的监听器（手机 App 功能对齐）
 *   GET  /qq-chat/api/events    SSE 实时推送（新消息 / 发送状态 / 未读变化）
 *
 * 鉴权：访问密码（config.mobilePassword）换令牌 → Authorization: Bearer <token>
 *      也接受控制台登录 cookie（同一个浏览器登录过控制台就直接能用）。
 */
export interface MobileApiDeps {
  /** 控制台监听器登记表（由 ApiHandlers 注册），供 /rpc 与 REST 端点复用 */
  getRegistry: () => Record<string, (data: any) => any>
  /** 控制台登录态校验（沿用 index.ts 里的访问控制开关） */
  isConsoleAuthed: (routerCtx: any) => Promise<boolean>
  /** 严格校验控制台登录 cookie（不看 loginRequired，用于「设了手机密码就必须登录」） */
  hasConsoleSession: (routerCtx: any) => Promise<boolean>
}

interface MobileToken {
  token: string
  name: string
  createdAt: number
  lastSeenAt: number
}

const TOKEN_COOKIE = 'qq-chat-mobile'

export class MobileApi {
  private tokens: MobileToken[] | null = null

  private tokensFile: string

  /** SSE 客户端：直接持有响应对象，广播时往里写 */
  private clients = new Set<any>()

  /** 登录失败次数（防爆破，按 IP 记） */
  private failures = new Map<string, { count: number, at: number }>()

  constructor(
    private baseDir: string,
    private logger: PluginLogger,
    private deps: MobileApiDeps,
    private mobilePassword: string = ''
  ) {
    this.tokensFile = path.join(baseDir, 'data', 'qq-chat', 'v2', 'mobile-tokens.json')
  }

  // ===== 令牌 =====

  private async loadTokens(): Promise<MobileToken[]> {
    if (this.tokens) return this.tokens
    try {
      const raw = await fs.readFile(this.tokensFile, 'utf8')
      const data = JSON.parse(raw)
      this.tokens = Array.isArray(data?.tokens) ? data.tokens.filter((t: any) => t?.token) : []
    } catch {
      this.tokens = []
    }
    return this.tokens
  }

  private async saveTokens() {
    try {
      await fs.mkdir(path.dirname(this.tokensFile), { recursive: true })
      await fs.writeFile(this.tokensFile, JSON.stringify({ version: 1, tokens: this.tokens || [] }, null, 2), 'utf8')
    } catch (error: any) {
      this.logger.warn('保存手机端令牌失败:', error?.message || error)
    }
  }

  async issueToken(name: string, days = 180): Promise<MobileToken> {
    const list = await this.loadTokens()
    const token = randomBytes(24).toString('base64url')
    const entry: MobileToken = {
      token,
      name: String(name || 'mobile').slice(0, 40),
      createdAt: Date.now(),
      lastSeenAt: Date.now()
    }
    list.push(entry)
    // 只保留最近 20 个令牌，避免文件无限增长
    if (list.length > 20) list.splice(0, list.length - 20)
    await this.saveTokens()
    this.logger.info(`手机端已登录：${entry.name}（令牌有效期 ${days} 天）`)
    return entry
  }

  async revokeAll() {
    this.tokens = []
    await this.saveTokens()
  }

  async listTokens() {
    return (await this.loadTokens()).map((t) => ({ name: t.name, createdAt: t.createdAt, lastSeenAt: t.lastSeenAt }))
  }

  private async tokenValid(token: string): Promise<boolean> {
    if (!token) return false
    const list = await this.loadTokens()
    const hit = list.find((t) => t.token === token)
    if (!hit) return false
    hit.lastSeenAt = Date.now()
    return true
  }

  /** 解析请求里的访问令牌（Authorization 头 / cookie / query） */
  private extractToken(routerCtx: any): string {
    const header = String(routerCtx.headers?.authorization || '')
    const bearer = /^Bearer\s+(.+)$/i.exec(header)
    if (bearer) return bearer[1].trim()
    const raw = String(routerCtx.headers?.cookie || '')
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=')
      if (idx < 0) continue
      if (part.slice(0, idx).trim() !== TOKEN_COOKIE) continue
      try {
        return decodeURIComponent(part.slice(idx + 1).trim())
      } catch {
        return part.slice(idx + 1).trim()
      }
    }
    return String(routerCtx.query?.token || '')
  }

  /** 供 index.ts 判断普通 HTTP 请求（聊天媒体等）是否带着有效的手机端令牌 */
  async isRequestAuthed(routerCtx: any): Promise<boolean> {
    const token = this.extractToken(routerCtx)
    return !!(token && await this.tokenValid(token))
  }

  /**
   * 是否允许访问：
   *  - 没设手机密码 → 沿用原来的访问控制（启用 auth 时要求控制台登录，否则公开）
   *  - 设了手机密码 → 必须带有效手机令牌或控制台登录 cookie（否则密码形同虚设）
   */
  private async authorize(routerCtx: any): Promise<{ ok: boolean, kind: 'console' | 'mobile' | 'open' | 'none' }> {
    if (!this.passwordRequired()) {
      if (await this.deps.isConsoleAuthed(routerCtx)) return { ok: true, kind: 'console' }
      return { ok: true, kind: 'open' }
    }
    if (await this.deps.hasConsoleSession(routerCtx)) return { ok: true, kind: 'console' }
    const token = this.extractToken(routerCtx)
    if (token && await this.tokenValid(token)) return { ok: true, kind: 'mobile' }
    return { ok: false, kind: 'none' }
  }

  /** 是否需要密码：配置了访问密码就一定要（不看 auth 插件） */
  passwordRequired(): boolean {
    return !!this.mobilePassword
  }

  // ===== 广播 =====

  /** 把控制台的广播同步给所有手机端 SSE 连接 */
  broadcast(name: string, body: any) {
    if (!this.clients.size) return
    const payload = `event: message\ndata: ${JSON.stringify({ type: name, body })}\n\n`
    for (const client of [...this.clients]) {
      try {
        client.res.write(payload)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  private addClient(routerCtx: any) {
    const client = { res: routerCtx.res, ip: routerCtx.ip }
    this.clients.add(client)
    const ping = setInterval(() => {
      try {
        routerCtx.res.write(': ping\n\n')
      } catch { /* 连接已断 */ }
    }, 25000)
    routerCtx.req.on('close', () => {
      clearInterval(ping)
      this.clients.delete(client)
    })
  }

  // ===== 工具 =====

  private json(routerCtx: any, status: number, body: any) {
    routerCtx.status = status
    routerCtx.type = 'application/json; charset=utf-8'
    routerCtx.set('Cache-Control', 'no-store')
    routerCtx.body = JSON.stringify(body)
  }

  private readBody(routerCtx: any): Promise<any> {
    // 很多环境里上层中间件（koa bodyparser 之类）已经把 body 解析好了，
    // 这时流已经被读完，再去监听 req 的 data/end 会永远等不到 —— 优先用解析结果
    const parsed = routerCtx.request?.body ?? routerCtx.body
    if (parsed && typeof parsed === 'object' && !Buffer.isBuffer(parsed)) return Promise.resolve(parsed)
    if (typeof parsed === 'string' && parsed) {
      try {
        return Promise.resolve(JSON.parse(parsed))
      } catch {
        return Promise.resolve({})
      }
    }
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      const finish = (value: any) => {
        clearTimeout(timer)
        resolve(value)
      }
      // 兜底：万一流读不到（已被上游消费），别把请求挂死
      const timer = setTimeout(() => finish({}), 8000)
      routerCtx.req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 8 * 1024 * 1024) {
          finish(null)
          return
        }
        chunks.push(chunk)
      })
      routerCtx.req.on('end', () => {
        if (!chunks.length) return finish({})
        try {
          finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          finish(null)
        }
      })
      routerCtx.req.on('error', () => finish(null))
    })
  }

  /** 调用控制台监听器（手机端与网页端共用同一套后端逻辑） */
  private async callListener(name: string, args: any[]) {
    const registry = this.deps.getRegistry()
    const fn: any = registry?.[name]
    if (typeof fn !== 'function') throw new Error(`接口不存在：${name}`)
    return await fn.apply(null, Array.isArray(args) ? args : [args])
  }

  private lastLoginFailure(ip: string) {
    const hit = this.failures.get(ip)
    if (!hit) return false
    if (Date.now() - hit.at > 10 * 60 * 1000) {
      this.failures.delete(ip)
      return false
    }
    return hit.count >= 10
  }

  private noteLoginFailure(ip: string) {
    const hit = this.failures.get(ip)
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
      hit.count += 1
      hit.at = Date.now()
    } else {
      this.failures.set(ip, { count: 1, at: Date.now() })
    }
  }

  // ===== 路由 =====

  /** 处理 /qq-chat/api/*：返回 true 表示已处理，'stream' 表示连接已交给 SSE */
  async handle(routerCtx: any): Promise<true | false | 'stream'> {
    const p = String(routerCtx.path || '')
    if (!p.startsWith('/qq-chat/api/')) return false

    // 跨域：手机 App / 第三方客户端可以直接调
    routerCtx.set('Access-Control-Allow-Origin', '*')
    routerCtx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    routerCtx.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (routerCtx.method === 'OPTIONS') {
      routerCtx.status = 204
      return true
    }

    const route = p.slice('/qq-chat/api/'.length).replace(/\/+$/, '') || 'info'

    try {
      // 公开：登录 / 能力说明
      if (route === 'login' && routerCtx.method === 'POST') {
        const ip = String(routerCtx.ip || '')
        if (this.lastLoginFailure(ip)) {
          this.json(routerCtx, 429, { ok: false, error: '尝试次数过多，请 10 分钟后再试' })
          return true
        }
        const body = await this.readBody(routerCtx)
        const password = String(body?.password || '')
        const required = String(this.mobilePassword || '')
        if (required && password !== required) {
          this.noteLoginFailure(ip)
          this.json(routerCtx, 401, { ok: false, error: '访问密码不正确' })
          return true
        }
        const entry = await this.issueToken(body?.name || '手机端')
        routerCtx.set('Set-Cookie', `${TOKEN_COOKIE}=${encodeURIComponent(entry.token)}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax`)
        this.json(routerCtx, 200, { ok: true, token: entry.token, name: entry.name })
        return true
      }

      if (route === 'logout' && routerCtx.method === 'POST') {
        const token = this.extractToken(routerCtx)
        const list = await this.loadTokens()
        this.tokens = list.filter((t) => t.token !== token)
        await this.saveTokens()
        this.json(routerCtx, 200, { ok: true })
        return true
      }

      if (route === 'info') {
        const auth = await this.authorize(routerCtx)
        this.json(routerCtx, 200, {
          ok: true,
          name: 'koishi-plugin-qq-chat',
          version: (require('../package.json') as any).version,
          passwordRequired: this.passwordRequired(),
          authed: auth.ok,
          endpoints: ['login', 'me', 'channels', 'messages', 'send', 'read', 'rpc', 'events']
        })
        return true
      }

      // 以下都需要鉴权
      const auth = await this.authorize(routerCtx)
      if (!auth.ok) {
        this.json(routerCtx, 401, { ok: false, error: '未登录：请先在手机 App 里输入访问密码' })
        return true
      }

      if (route === 'me' && routerCtx.method === 'GET') {
        const data = await this.callListener('get-chat-data', [])
        const counts = await this.callListener('get-all-channel-message-counts', []).catch(() => ({ counts: {} }))
        const channels = [] as any[]
        for (const [selfId, map] of Object.entries((data?.data?.channels || {}) as Record<string, any>)) {
          for (const [channelId, info] of Object.entries(map as Record<string, any>)) {
            channels.push({ selfId, channelId, ...(info as any) })
          }
        }
        const previews = await this.callListener('get-channel-previews', [{ channels }]).catch(() => ({ previews: {} }))
        const read = await this.callListener('get-read-state', []).catch(() => ({ state: {} }))
        this.json(routerCtx, 200, {
          ok: true,
          bots: data?.data?.bots || {},
          channels,
          counts: counts?.counts || {},
          previews: previews?.previews || {},
          readState: read?.state || {},
          pinnedBots: data?.data?.pinnedBots || [],
          pinnedChannels: data?.data?.pinnedChannels || []
        })
        return true
      }

      if (route === 'channels' && routerCtx.method === 'GET') {
        const data = await this.callListener('get-chat-data', [])
        const channels = [] as any[]
        for (const [selfId, map] of Object.entries((data?.data?.channels || {}) as Record<string, any>)) {
          for (const [channelId, info] of Object.entries(map as Record<string, any>)) {
            channels.push({ selfId, channelId, ...(info as any) })
          }
        }
        const previews = await this.callListener('get-channel-previews', [{ channels }]).catch(() => ({ previews: {} }))
        this.json(routerCtx, 200, { ok: true, channels, previews: previews?.previews || {} })
        return true
      }

      if (route === 'messages' && routerCtx.method === 'GET') {
        const { selfId, channelId } = routerCtx.query || {}
        const limit = Math.min(200, Math.max(1, Number(routerCtx.query?.limit) || 50))
        const offset = Math.max(0, Number(routerCtx.query?.offset) || 0)
        if (!selfId || !channelId) {
          this.json(routerCtx, 400, { ok: false, error: '缺少 selfId / channelId' })
          return true
        }
        const result = await this.callListener('get-history-messages', [{ selfId, channelId, limit, offset }])
        this.json(routerCtx, 200, { ok: true, messages: result?.messages || [], total: result?.total || 0 })
        return true
      }

      if (route === 'send' && routerCtx.method === 'POST') {
        const body = await this.readBody(routerCtx)
        if (!body?.selfId || !body?.channelId) {
          this.json(routerCtx, 400, { ok: false, error: '缺少 selfId / channelId' })
          return true
        }
        const result = await this.callListener('send-message', [{
          selfId: String(body.selfId),
          channelId: String(body.channelId),
          content: String(body.content || body.text || ''),
          images: body.images || [],
          files: body.files || []
        }])
        this.json(routerCtx, result?.success === false ? 502 : 200, { ok: result?.success !== false, ...(result || {}) })
        return true
      }

      if (route === 'read' && routerCtx.method === 'POST') {
        const body = await this.readBody(routerCtx)
        const result = await this.callListener('mark-channel-read', [{
          selfId: String(body?.selfId || ''),
          channelId: String(body?.channelId || ''),
          timestamp: Number(body?.timestamp) || undefined
        }])
        this.json(routerCtx, 200, { ok: result?.success !== false, ...(result || {}) })
        return true
      }

      if (route === 'rpc' && routerCtx.method === 'POST') {
        const body = await this.readBody(routerCtx)
        const name = String(body?.name || '')
        if (!name) {
          this.json(routerCtx, 400, { ok: false, error: '缺少接口名' })
          return true
        }
        const args = Array.isArray(body?.args) ? body.args : (body?.args === undefined ? [] : [body.args])
        try {
          const value = await this.callListener(name, args)
          this.json(routerCtx, 200, { ok: true, value })
        } catch (error: any) {
          this.json(routerCtx, 200, { ok: false, error: String(error?.message || error) })
        }
        return true
      }

      if (route === 'events' && routerCtx.method === 'GET') {
        // 接管原始响应：SSE 需要长连接，不能走 koa 的收尾逻辑
        routerCtx.respond = false
        routerCtx.res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*'
        })
        routerCtx.res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, time: Date.now() })}\n\n`)
        this.addClient(routerCtx)
        return 'stream'
      }

      this.json(routerCtx, 404, { ok: false, error: `未知接口：${route}` })
      return true
    } catch (error: any) {
      this.logger.warn('手机端接口异常:', error?.message || error)
      this.json(routerCtx, 500, { ok: false, error: String(error?.message || error) })
      return true
    }
  }
}
