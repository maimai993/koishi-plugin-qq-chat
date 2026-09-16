import { promises as fs } from 'node:fs'
import path from 'node:path'

import { PluginLogger } from './logger'

/** 单个频道的已读状态 */
export interface ReadStateEntry {
  /** 已读水位：最后一条被读过的消息时间戳 */
  lastReadTimestamp: number
  /** 已读水位对应的消息 id（可选，便于精确判定「未读区域」起点） */
  lastReadId?: string
  /** 未读消息数 */
  unread: number
  /** 其中「有人@机器人」的条数 */
  atMe: number
  /** 其中「引用了机器人消息」的条数 */
  reply: number
  updatedAt: number
}

export type ReadStateMap = Record<string, ReadStateEntry>

const createEntry = (): ReadStateEntry => ({
  lastReadTimestamp: 0,
  unread: 0,
  atMe: 0,
  reply: 0,
  updatedAt: 0
})

/**
 * 未读状态的持久化。
 *
 * 之前未读数只存在浏览器内存里（reactive 对象），刷新页面 / 关掉控制台就全部清零，
 * 别人在你没开页面时发的消息自然也永远不会显示成未读。这里把每个频道的
 * 「已读水位」（最后一条已读消息的时间戳）与未读数落到
 * data/qq-chat/v2/read-state.json：
 *   - 新消息时间戳晚于水位 → 未读 +1（@机器人 / 被引用另计）
 *   - 打开频道 → 水位推到最新、未读清零
 *   - 标记未读 / 标记已读 → 直接改写
 * 于是刷新、重启、关掉浏览器之后未读数还在，打开群聊还能据此算出
 * 「未读区域」的起点（第一条时间戳大于水位的消息）。
 */
export class ReadStateStore {
  private filePath: string

  private entries: ReadStateMap | null = null

  private loadPromise: Promise<void> | null = null

  private writeTimer: NodeJS.Timeout | null = null

  private writePromise: Promise<void> = Promise.resolve()

  private disposed = false

  constructor(baseDir: string, private logger: PluginLogger) {
    this.filePath = path.join(baseDir, 'data', 'qq-chat', 'v2', 'read-state.json')
  }

  private key(selfId: string, channelId: string) {
    return `${selfId}:${channelId}`
  }

  private splitKey(key: string): [string, string] {
    // 私聊频道号本身带冒号（private:<openid>），只能按第一个冒号切
    const index = key.indexOf(':')
    if (index < 0) return [key, '']
    return [key.slice(0, index), key.slice(index + 1)]
  }

  private async ensureLoaded() {
    if (this.entries) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = (async () => {
      try {
        const raw = await fs.readFile(this.filePath, 'utf8')
        const data = JSON.parse(raw)
        const channels = data?.channels && typeof data.channels === 'object' ? data.channels : {}
        const result: ReadStateMap = {}
        for (const [key, value] of Object.entries(channels as ReadStateMap)) {
          if (!value || typeof value !== 'object') continue
          result[key] = {
            lastReadTimestamp: Number((value as any).lastReadTimestamp) || 0,
            lastReadId: (value as any).lastReadId ? String((value as any).lastReadId) : undefined,
            unread: Math.max(0, Number((value as any).unread) || 0),
            atMe: Math.max(0, Number((value as any).atMe) || 0),
            reply: Math.max(0, Number((value as any).reply) || 0),
            updatedAt: Number((value as any).updatedAt) || 0
          }
        }
        this.entries = result
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          this.logger.warn('读取未读状态失败（将从空状态开始）:', error?.message || error)
        }
        this.entries = {}
      }
    })()
    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  private scheduleWrite() {
    if (this.disposed) return
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.flush()
    }, 400)
    // 别让这个定时器拖住进程退出
    ;(this.writeTimer as any)?.unref?.()
  }

  /** 立即落盘（dispose / 关键操作后调用） */
  async flush(): Promise<void> {
    if (!this.entries) return
    const payload = JSON.stringify({ version: 1, updatedAt: Date.now(), channels: this.entries }, null, 2)
    this.writePromise = this.writePromise.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true })
        await fs.writeFile(this.filePath, payload, 'utf8')
      } catch (error: any) {
        this.logger.warn('写入未读状态失败:', error?.message || error)
      }
    })
    await this.writePromise
  }

  async getAll(): Promise<ReadStateMap> {
    await this.ensureLoaded()
    const result: ReadStateMap = {}
    for (const [key, value] of Object.entries(this.entries || {})) result[key] = { ...value }
    return result
  }

  async get(selfId: string, channelId: string): Promise<ReadStateEntry | null> {
    await this.ensureLoaded()
    const entry = this.entries?.[this.key(selfId, channelId)]
    return entry ? { ...entry } : null
  }

  /** 新消息到达：晚于已读水位就计入未读 */
  async noteIncoming(selfId: string, channelId: string, info: {
    timestamp: number
    messageId?: string
    atBot?: boolean
    replyToBot?: boolean
  }): Promise<ReadStateEntry> {
    await this.ensureLoaded()
    if (!this.entries || !selfId || !channelId) return createEntry()
    const key = this.key(selfId, channelId)
    const now = Date.now()
    let entry = this.entries[key]
    if (!entry) {
      // 第一次见到这个频道：把水位定在这条消息之前，于是它自己被算作 1 条未读
      entry = createEntry()
      entry.lastReadTimestamp = Number(info.timestamp || now) - 1
      this.entries[key] = entry
    }
    if (Number(info.timestamp || 0) > entry.lastReadTimestamp) {
      entry.unread += 1
      if (info.atBot) entry.atMe += 1
      if (info.replyToBot) entry.reply += 1
    }
    entry.updatedAt = now
    this.scheduleWrite()
    return { ...entry }
  }

  /** 打开频道 / 手动标记已读：水位推到最新，未读清零 */
  async markRead(selfId: string, channelId: string, info: { timestamp?: number, messageId?: string } = {}): Promise<ReadStateEntry> {
    await this.ensureLoaded()
    if (!this.entries || !selfId || !channelId) return createEntry()
    const key = this.key(selfId, channelId)
    const watermark = Math.max(
      Number(this.entries[key]?.lastReadTimestamp) || 0,
      Number(info.timestamp) || Date.now()
    )
    const entry: ReadStateEntry = {
      lastReadTimestamp: watermark,
      lastReadId: info.messageId ? String(info.messageId) : undefined,
      unread: 0,
      atMe: 0,
      reply: 0,
      updatedAt: Date.now()
    }
    this.entries[key] = entry
    this.scheduleWrite()
    return { ...entry }
  }

  /** 标记未读（右键菜单）：至少 1 条，且把水位压回上一条消息之前 */
  async markUnread(selfId: string, channelId: string, timestamp?: number, count?: number): Promise<ReadStateEntry> {
    await this.ensureLoaded()
    if (!this.entries || !selfId || !channelId) return createEntry()
    const key = this.key(selfId, channelId)
    const current = this.entries[key] || createEntry()
    // 传了时间戳就把水位压到这条消息之前（未读区域从它开始），否则沿用原水位
    const watermark = Number(timestamp) > 0 ? Number(timestamp) - 1 : current.lastReadTimestamp
    const entry: ReadStateEntry = {
      ...current,
      lastReadTimestamp: Math.min(current.lastReadTimestamp || watermark, watermark),
      unread: Math.max(1, Number(count) || current.unread || 1),
      updatedAt: Date.now()
    }
    this.entries[key] = entry
    this.scheduleWrite()
    return { ...entry }
  }

  /** 频道数据被清空 / 删除时同步清理未读状态 */
  async forget(selfId: string, channelId?: string) {
    await this.ensureLoaded()
    if (!this.entries) return
    if (channelId) {
      delete this.entries[this.key(selfId, channelId)]
    } else {
      for (const key of Object.keys(this.entries)) {
        const [owner] = this.splitKey(key)
        if (owner === selfId) delete this.entries[key]
      }
    }
    this.scheduleWrite()
  }

  async dispose() {
    this.disposed = true
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    await this.flush()
  }
}
