import { BotGroupState, BotInfo, ChannelInfo, MessageInfo, QuoteInfo } from './types'
import { Context, Session, h } from 'koishi'
import { FileManager } from './file-manager'
import { Config, CONSOLE_AUTHORITY } from './config'
import { Utils } from './utils'
import { PluginLogger } from './logger'
import { } from '@koishijs/plugin-console'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export class MessageHandler {
  private utils: Utils

  private correctChannelIds: Map<string, string> = new Map()

  private scheduledTasks: Set<() => void> = new Set()

  private channelRefreshInFlight: Set<string> = new Set()

  private lastChannelRefreshAt: Map<string, number> = new Map()

  private readonly CHANNEL_REFRESH_TTL_MS = 10 * 60 * 1000

  constructor(
    private ctx: Context,
    private config: Config,
    private fileManager: FileManager,
    private logger: PluginLogger
  ) {
    this.utils = new Utils(config)
  }

  /** 广播带 authority：启用 auth 插件后未登录的客户端收不到聊天内容 */
  private broadcast(name: string, body: any) {
    ;(this.ctx.console as any).broadcast(name, body, { authority: CONSOLE_AUTHORITY })
  }

  // 判断群消息是否 @ 了机器人：
  // QQ 官方 GROUP_AT_MESSAGE_CREATE / 全量消息中的 @bot，会被 qq-crack 适配器
  // 规范化成 elements 顶部的 <at id="{session.selfId}" />，据此判定即可。
  private isAtBotMessage(session: Session): boolean {
    const selfId = session?.selfId
    if (!selfId) return false
    const hasAt = (elements: any): boolean => {
      if (!Array.isArray(elements)) return false
      for (const el of elements) {
        if (!el) continue
        if (el.type === 'at' && el.attrs?.id === selfId) return true
        if (hasAt(el.children)) return true
      }
      return false
    }
    if (hasAt(session.elements)
      || hasAt((session.event as any)?.message?.elements)
      || hasAt((session.event as any)?.message?.children)) return true
    const content = String(session.content || (session.event as any)?.message?.content || '')
    return content.includes(`<at id="${selfId}"`) || content.includes(`<at name="${selfId}"`)
  }

  // 群@消息里适配器会在最前面补一个 <at id="{selfId}"/> 占位（QQ 官方原文已去掉@前缀），
  // 展示/历史记录时移除这个合成的 @自己，避免气泡里出现多余的 @机器人。
  private stripLeadingAtSelf(content: string, selfId: string): string {
    const text = String(content || '')
    if (!selfId || !/<at\b/i.test(text)) return text
    const esc = String(selfId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^(?:\\s*<at\\b[^>]*?\\bid\\s*=\\s*(?:"${esc}"|'${esc}'|${esc})[^>]*?(?:\\/>|>[\\s\\S]*?<\\/at>)\\s*)+`, 'i')
    return text.replace(pattern, '')
  }

  recordUserMessage(session: Session, timestamp: number) {
    // 只记录 QQ 平台的消息
    if (session.platform !== 'qq') return
    // 控制台沙盒（沙盒窗口 / 沙盒对话框 / 指令桥接）派发的消息只在本机执行，
    // 借用的又是真实机器人的平台，所以必须显式跳过，否则会在真实聊天记录里
    // 留下一条永远发不出去的「控制台」假消息
    if ((session as any).qqChatSandbox || (session.event as any)?.qqChatSandbox || /^qq-chat:(?:sandbox|sim):/.test(String(session.messageId || ''))) return
    this.scheduleTask('记录用户消息', async () => {
      await this.processUserMessage(session, timestamp)
    })
  }

  recordBotMessage(session: Session, timestamp: number) {
    // 只记录 QQ 平台的消息
    if (session.platform !== 'qq') return
    this.scheduleTask('记录机器人消息', async () => {
      await this.processBotMessage(session, timestamp)
    })
  }

  recordGroupMemberEvent(session: Session, kind: 'added' | 'removed') {
    // 只记录 QQ 平台的群成员事件
    if (session.platform !== 'qq') return
    this.scheduleTask(kind === 'added' ? '记录入群事件' : '记录退群事件', async () => {
      await this.processGroupMemberEvent(session, kind)
    })
  }

  private async processGroupMemberEvent(session: Session, kind: 'added' | 'removed') {
    try {
      const timestamp = Date.now()
      const eventUser = session.event?.user as any
      const eventMember = session.event?.member as any
      const userId = eventUser?.id || eventMember?.user?.id || 'system'
      const name = eventUser?.name
        || eventMember?.nick
        || eventMember?.user?.name
        || userId
      const content = kind === 'added' ? `${name} 加入了群聊` : `${name} 退出了群聊`

      this.updateBotInfoToFile(session)
      const guildName = this.updateChannelInfoToFile(session)

      // 以普通用户消息的形式展示，名字固定为"系统消息"
      const messageInfo: MessageInfo = {
        id: `sys-${timestamp}`,
        content,
        userId: 'system',
        username: '系统消息',
        avatar: '',
        timestamp,
        channelId: session.channelId,
        selfId: session.selfId,
        elements: [],
        type: 'user',
        systemType: 'member',
        guildName,
        platform: session.platform || 'unknown',
        isDirect: false
      }

      await this.fileManager.addMessageToFile(messageInfo)

      this.broadcast('chat-message-event', {
        type: 'user',
        systemType: 'member',
        selfId: session.selfId,
        platform: session.platform || 'unknown',
        channelId: session.channelId,
        messageId: messageInfo.id,
        content,
        userId: 'system',
        username: '系统消息',
        avatar: '',
        timestamp,
        guildName,
        channelType: session.type || 0,
        elements: [],
        isDirect: false
      })
    } catch (error) {
      this.logger.error('记录群成员事件失败:', error)
    }
  }

  recordJoinRequestEvent(session: Session) {
    // 只记录 QQ 平台的入群申请事件
    if (session.platform !== 'qq') return
    this.scheduleTask('记录入群申请事件', async () => {
      await this.processJoinRequestEvent(session)
    })
  }

  private async processJoinRequestEvent(session: Session) {
    try {
      const timestamp = Date.now()
      const name = session.event?.user?.name || session.username || session.userId || '未知用户'
      const content = `📩 ${name} 申请加入群聊`

      this.updateBotInfoToFile(session)
      const guildName = this.updateChannelInfoToFile(session)

      // 以普通用户消息的形式展示，名字固定为"系统消息"
      const messageInfo: MessageInfo = {
        id: `sys-${timestamp}`,
        content,
        userId: 'system',
        username: '系统消息',
        avatar: '',
        timestamp,
        channelId: session.channelId,
        selfId: session.selfId,
        elements: [],
        type: 'user',
        systemType: 'join-request',
        guildName,
        platform: session.platform || 'unknown',
        isDirect: false
      }

      await this.fileManager.addMessageToFile(messageInfo)

      this.broadcast('chat-message-event', {
        type: 'user',
        systemType: 'join-request',
        selfId: session.selfId,
        platform: session.platform || 'unknown',
        channelId: session.channelId,
        messageId: messageInfo.id,
        content,
        userId: 'system',
        username: '系统消息',
        avatar: '',
        timestamp,
        guildName,
        channelType: session.type || 0,
        elements: [],
        isDirect: false
      })
    } catch (error) {
      this.logger.error('记录入群申请事件失败:', error)
    }
  }

  setCorrectChannelId(selfId: string, channelId: string) {
    this.correctChannelIds.set(selfId, channelId)
    this.logger.logInfo('设置正确的 channelId:', { selfId, channelId })
  }

  getCorrectChannelId(selfId: string): string | undefined {
    return this.correctChannelIds.get(selfId)
  }

  // 适配器给的 bot.user.name 有时是 openid 本身（纯数字/32 位十六进制），不能当昵称用
  private isRawIdName(value: unknown): boolean {
    const text = String(value || '').trim()
    if (!text) return true
    return /^\d{6,}$/.test(text) || /^[0-9a-f]{32}$/i.test(text)
  }

  private resolveBotName(session: Session): string {
    const cached = (this.fileManager as any).getCachedBotInfo?.(session.selfId)
    const candidates = [session.bot?.user?.name, session.username, cached?.username]
    for (const name of candidates) {
      if (name && !this.isRawIdName(name)) return name
    }
    return `Bot-${session.selfId}`
  }

  private resolveBotAvatar(session: Session): string | undefined {
    const cached = (this.fileManager as any).getCachedBotInfo?.(session.selfId)
    return (session.bot?.user as any)?.avatar || (session.bot as any)?.avatar || cached?.avatar || ''
  }

  updateBotInfoToFile(session: Session) {
    this.scheduleTask('更新机器人信息', async () => {
      const botInfo: BotInfo = {
        selfId: session.selfId,
        platform: session.platform || 'unknown',
        username: this.resolveBotName(session),
        avatar: this.resolveBotAvatar(session),
        status: 'online'
      }

      await this.fileManager.upsertBotInfo(botInfo)
      this.logger.logInfo('更新机器人信息到文件:', botInfo.username)
    })
  }

  updateChannelInfoToFile(session: Session): string {
    const isDirect = session.isDirect || session.channelId?.includes('private')
    const directUserName = session.username || session.event?.user?.name || session.userId

    const existingChannel = this.fileManager.getCachedChannelInfo(session.selfId, session.channelId)

    let immediateName = session.channelId
    if (isDirect) {
      if (directUserName && directUserName !== session.userId) {
        immediateName = `私聊（${directUserName}）`
      } else if (existingChannel?.name && !existingChannel.name.includes('未知')) {
        immediateName = existingChannel.name
      } else if (session.platform && session.platform.toLowerCase().includes('sandbox')) {
        immediateName = `私聊（${session.userId}）`
      } else {
        immediateName = '私聊（未知用户）'
      }
    } else if (existingChannel?.guildName) {
      immediateName = existingChannel.guildName
    }

    const channelKey = `${session.selfId}:${session.channelId}`
    if (this.shouldRefreshChannelInfo(channelKey, existingChannel, isDirect, session.channelId, directUserName)) {
      this.scheduleTask('更新频道信息', async () => {
        await this.refreshChannelInfo(session, existingChannel, isDirect, directUserName)
      })
    }

    return immediateName
  }

  public async downloadAndCacheMedia(url: string, type: 'image' | 'media' | 'avatar' | 'audio', prefetchedBuffer?: Buffer) {
    try {
      if (!url || url.startsWith('data:')) return url

      // 如果已经是本地媒体路径，直接返回
      if (url.includes('/vite/@fs/') || url.includes('/qq-chat/media/')) return url

      const urlLower = url.toLowerCase()
      const guessedType = this.guessMediaTypeByUrl(urlLower, type)
      const isAudio = guessedType === 'audio' || type === 'audio'

      // 语音必须独立存放，避免 QQ 语音 URL 以 .jpg 结尾时被误判为图片
      let folder = 'media'
      if (isAudio) folder = 'audio'
      else if (guessedType === 'image') folder = 'images'
      else if (guessedType === 'avatar') folder = 'avatars'

      const dir = path.join(this.ctx.baseDir, 'data', 'qq-chat', 'persist-media', folder)
      await fs.mkdir(dir, { recursive: true })

      const hash = createHash('md5').update(url).digest('hex')

      // 语音 URL 可能带 .jpg 等误导性扩展名，且扩展名随内容变化，先按哈希前缀查找已有缓存
      if (isAudio) {
        const cached = await this.findCachedFile(dir, hash)
        if (cached) return this.toMediaUrl(cached)
      } else {
        const targetExt = this.getPreferredMediaExtension(url, guessedType)
        const filePath = path.join(dir, `${hash}${targetExt}`)
        if (await this.fileExists(filePath)) return this.toMediaUrl(filePath)
      }

      let buffer: Buffer
      if (prefetchedBuffer) {
        buffer = prefetchedBuffer
      } else {
        const raw = await this.ctx.http.get(url, { responseType: 'arraybuffer' })
        buffer = Buffer.from(new Uint8Array(raw as ArrayBufferLike)) as any
      }

      let targetExt = '.mp3'
      if (isAudio) {
        const format = this.detectAudioFormat(buffer)
        if (format === 'mp3' || format === 'wav' || format === 'm4a' || format === 'ogg' || format === 'flac' || format === 'aac') {
          targetExt = `.${format}`
        } else {
          // silk / amr / 未知格式：先尝试 silk 服务解码 + ffmpeg 转码为 mp3
          const converted = await this.transcodeAudioToMp3(buffer, format)
          if (converted) {
            buffer = converted
          } else if (format === 'silk' || format === 'amr') {
            // 转码失败：按真实格式命名，避免继续伪装成 .jpg/.mp3
            targetExt = `.${format}`
          }
        }
      } else {
        targetExt = this.getPreferredMediaExtension(url, guessedType)
      }

      const filePath = path.join(dir, `${hash}${targetExt}`)
      await fs.writeFile(filePath, buffer)

      return this.toMediaUrl(filePath)
    } catch (e) {
      this.logger.warn('下载并缓存媒体失败:', e)
      return url
    }
  }

  private toMediaUrl(filePath: string) {
    // 返回网络地址（生产环境通过静态路由加载）
    const mediaRoot = path.join(this.ctx.baseDir, 'data', 'qq-chat')
    const relative = path.relative(mediaRoot, filePath).replace(/\\/g, '/')
    return `/qq-chat/media/${relative}`
  }

  public async getCachedMediaUrl(url: string, type: 'image' | 'media' | 'avatar' | 'audio'): Promise<string | null> {
    try {
      if (!url || url.startsWith('data:')) return null
      if (url.includes('/vite/@fs/') || url.includes('/qq-chat/media/')) return url

      const guessedType = this.guessMediaTypeByUrl(url.toLowerCase(), type)
      const isAudio = guessedType === 'audio' || type === 'audio'

      let folder = 'media'
      if (isAudio) folder = 'audio'
      else if (guessedType === 'image') folder = 'images'
      else if (guessedType === 'avatar') folder = 'avatars'

      const dir = path.join(this.ctx.baseDir, 'data', 'qq-chat', 'persist-media', folder)
      const hash = createHash('md5').update(url).digest('hex')

      if (isAudio) {
        const cached = await this.findCachedFile(dir, hash)
        return cached ? this.toMediaUrl(cached) : null
      }

      const targetExt = this.getPreferredMediaExtension(url, guessedType)
      const filePath = path.join(dir, `${hash}${targetExt}`)
      return (await this.fileExists(filePath)) ? this.toMediaUrl(filePath) : null
    } catch {
      return null
    }
  }

  private async findCachedFile(dir: string, prefix: string): Promise<string | null> {
    try {
      const files = await fs.readdir(dir)
      const matched = files.find((file) => file.startsWith(prefix + '.'))
      return matched ? path.join(dir, matched) : null
    } catch {
      return null
    }
  }

  private detectAudioFormat(buffer: Buffer): 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac' | 'aac' | 'silk' | 'amr' | null {
    const signature = buffer.subarray(0, 16)
    const head = buffer.subarray(0, 16).toString('ascii')
    if (signature.includes(Buffer.from([0x49, 0x44, 0x33]))) return 'mp3' // ID3 标签
    if (signature.includes(Buffer.from([0xFF, 0xFB])) || signature.includes(Buffer.from([0xFF, 0xF3])) || signature.includes(Buffer.from([0xFF, 0xF2]))) return 'mp3' // MP3 帧头
    if (signature.includes(Buffer.from([0x52, 0x49, 0x46, 0x46])) && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav'
    if (buffer.length > 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a'
    if (head.startsWith('OggS')) return 'ogg'
    if (head.startsWith('fLaC')) return 'flac'
    if (signature.includes(Buffer.from('#!SILK'))) return 'silk'
    if (signature.includes(Buffer.from('#!AMR'))) return 'amr'
    return null
  }

  private guessMediaTypeByUrl(url: string, fallbackType: 'image' | 'media' | 'avatar' | 'audio') {
    if (/(?:^|\/|\.)(jpg|jpeg|png|gif|bmp|webp|svg)(?:\?|$)/.test(url)) return 'image'
    if (/(?:^|\/|\.)(mp3|wav|m4a|aac|ogg|amr|silk|flac)(?:\?|$)/.test(url)) return 'audio'
    if (fallbackType === 'image') return 'image'
    if (fallbackType === 'avatar') return 'avatar'
    return 'media'
  }

  private getPreferredMediaExtension(url: string, type: 'image' | 'media' | 'avatar' | 'audio') {
    const ext = path.extname(new URL(url).pathname).toLowerCase()
    if (ext && type !== 'audio') return ext
    if (type === 'image' || type === 'avatar') return '.jpg'
    if (type === 'audio') return '.mp3'
    return '.mp3'
  }

  private isPlayableAudioBuffer(buffer: Buffer, url: string) {
    const lower = url.toLowerCase()
    const headers = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']
    const matches = headers.some((ext) => lower.includes(`.${ext}`) || lower.includes(`/${ext}`))
    if (matches) return true

    const signature = buffer.subarray(0, 16)
    return signature.includes(Buffer.from([0x49, 0x44, 0x33])) ||
      signature.includes(Buffer.from([0x52, 0x49, 0x46, 0x46])) ||
      signature.includes(Buffer.from([0xFF, 0xFB])) ||
      signature.includes(Buffer.from([0x25, 0x00, 0x00, 0x00]))
  }

  private async transcodeAudioToMp3(buffer: Buffer, format?: string | null): Promise<Buffer | null> {
    // QQ 官方语音为 SILK（头部可能带 0x02 前缀）：先用 silk 服务解码为 PCM，再交给 ffmpeg 转 mp3
    if (format === 'silk' || format === 'amr') {
      const silkService = (this.ctx as any).silk
      if (silkService && typeof silkService.decode === 'function') {
        try {
          const decoded = await silkService.decode(buffer, 24000)
          const pcm = decoded && decoded.data ? Buffer.from(decoded.data) : null
          if (pcm && pcm.length) {
            const mp3 = await this.transcodeRawBufferToMp3(pcm, 24000)
            if (mp3) return mp3
          }
        } catch (error) {
          this.logger.warn('silk 服务解码失败，回退到 ffmpeg:', error)
        }
      }
    }
    // 兜底：直接交给 ffmpeg（amr / 未知格式）
    return this.transcodeRawBufferToMp3(buffer)
  }

  private async transcodeRawBufferToMp3(buffer: Buffer, sampleRate?: number): Promise<Buffer | null> {
    // 使用 ffmpeg 服务（如 koishi-plugin-ffmpeg），不直接调用系统 ffmpeg
    const ffmpeg = (this.ctx as any).ffmpeg
    if (!ffmpeg || typeof ffmpeg.builder !== 'function') {
      this.logger.warn('未检测到 ffmpeg 服务（可安装 koishi-plugin-ffmpeg），无法将语音转码为 mp3')
      return null
    }
    try {
      const builder = ffmpeg.builder()
      builder.input(buffer)
      if (sampleRate) {
        // PCM 输入需要声明原始格式
        builder.inputOption('-f', 's16le', '-ar', String(sampleRate), '-ac', '1')
      }
      builder.outputOption('-vn', '-f', 'mp3', '-ar', '44100', '-ac', '1')
      const result = await builder.run('buffer')
      const out = Buffer.isBuffer(result) ? result : (result ? Buffer.from(result) : null)
      return out && out.length ? out : null
    } catch (error) {
      this.logger.warn('ffmpeg 服务转码语音失败:', error)
      return null
    }
  }

  private processMediaElementsAsync(elements: h[], isUserMessage: boolean = true) {
    if (!elements) return

    this.scheduleTask('处理媒体元素', async () => {
      await this.processMediaElements(elements, isUserMessage)
    })
  }

  private async processUserMessage(session: Session, timestamp?: number) {
    try {
      if (!timestamp) timestamp = Date.now()

      this.updateBotInfoToFile(session)

      const guildName = this.updateChannelInfoToFile(session)
      const isDirect = session.isDirect || session.channelId?.includes('private')
      // 是否有人在群里 @ 了机器人（用于频道列表“有人@你”提醒）；私聊无此概念
      const atBot = !isDirect && this.isAtBotMessage(session)

      if (session.elements) {
        this.processMediaElementsAsync(session.elements, true)
      }
      if (session.quote?.elements) {
        this.processMediaElementsAsync(session.quote.elements, true)
      }

      let quoteInfo: QuoteInfo | undefined = undefined
      if (session.quote) {
        const qUser: any = (session.quote as any).user || {}
        let quoteUserId = qUser.userId || qUser.id || (session.quote as any).userId || ''
        let quoteUserName = qUser.username || qUser.name || (session.quote as any).username || ''
        let quoteAvatar = qUser.avatar
        // 官方接口的引用对象通常只带 openid，没有昵称；
        // 用本地已保存的同 id 消息把发送者补回来，避免前端显示成 "unknown"
        if ((!quoteUserName || quoteUserName === 'unknown') && (session.quote.id || session.quote.messageId)) {
          try {
            const quoted = await this.fileManager.findChannelMessageById(
              session.selfId, session.channelId, session.quote.id || session.quote.messageId)
            if (quoted) {
              quoteUserId = quoteUserId || quoted.userId || ''
              if (quoted.username && quoted.username !== 'unknown') quoteUserName = quoted.username
              quoteAvatar = quoteAvatar || quoted.avatar
            }
          } catch {
            /* 查不到就保持空，交给前端按 @ 元素兜底 */
          }
        }
        quoteInfo = {
          messageId: session.quote.messageId || session.quote.id,
          id: session.quote.id,
          content: session.quote.content || '',
          elements: this.stripFaceElements(session.quote.elements),
          user: {
            id: quoteUserId,
            name: quoteUserName,
            userId: quoteUserId,
            avatar: quoteAvatar,
            username: quoteUserName
          },
          timestamp: session.quote.timestamp || Date.now()
        }
      }

      let content = ''
      let elements: h[] = []

      if (session.content) {
        content = session.content
      } else if (session.stripped?.content) {
        content = session.stripped.content
      }

      if (session.elements) {
        elements = this.stripFaceElements(session.elements)
        if (!content) {
          content = elements
            .filter((element: any) => element.type === 'text')
            .map((element: any) => element.attrs?.content || '')
            .join('')
        }
      }
      // 群@消息中适配器合成的“@自己”前缀占位不进入展示/历史
      if (content && !isDirect && /<at\b/i.test(content)) {
        content = this.stripLeadingAtSelf(content, session.selfId)
      }
      // QQ 表情占位符（<faceType=...> / [face:n]）不再在这里剥离，
      // 保留在 content 中由前端负责渲染成 qq_emoji 图片或“不支持的第三方表情”。
      const messageInfo: MessageInfo = {
        id: session.event?.message?.id || `msg-${timestamp}`,
        content: content || session.content || '',
        userId: session.userId || session.event?.user?.id || 'unknown',
        username: session.username || session.event?.user?.name || session.userId || 'unknown',
        avatar: session.event?.user?.avatar,
        role: (session.event?.user as any)?.role,
        timestamp: timestamp,
        channelId: session.channelId,
        selfId: session.selfId,
        elements: elements,
        type: 'user',
        guildName: guildName,
        platform: session.platform || 'unknown',
        quote: quoteInfo,
        isDirect: !!isDirect,
        atBot: !!atBot
      }

      messageInfo.elements = await this.utils.cleanBase64ContentAsync(messageInfo.elements, false)
      messageInfo.quote = messageInfo.quote ? await this.utils.cleanBase64ContentAsync(messageInfo.quote, false) : undefined

      await this.fileManager.addMessageToFile(messageInfo)

      const eventElements = await this.utils.cleanBase64ContentAsync(elements, false)
      const eventQuote = quoteInfo ? await this.utils.cleanBase64ContentAsync(quoteInfo, false) : undefined

      const messageEvent = {
        type: 'message',
        selfId: session.selfId,
        platform: session.platform || 'unknown',
        channelId: session.channelId,
        messageId: session.event?.message?.id || `msg-${timestamp}`,
        content: content || session.content || '',
        userId: session.userId || session.event?.user?.id || 'unknown',
        username: session.username || session.event?.user?.name || session.userId || 'unknown',
        avatar: session.event?.user?.avatar,
        role: (session.event?.user as any)?.role,
        timestamp: timestamp,
        guildName: guildName,
        channelType: session.type || 0,
        elements: eventElements,
        quote: eventQuote,
        isDirect: session.isDirect,
        atBot: !!atBot,
        bot: {
          avatar: session.bot.user?.avatar,
          name: session.bot.user?.name,
        }
      }

      this.broadcast('chat-message-event', messageEvent)
    } catch (error) {
      this.logger.error('处理用户消息失败:', error)
    }
  }

  private async processBotMessage(session: Session, timestamp?: number) {
    try {
      if (!timestamp) timestamp = Date.now()

      const correctChannelId = this.getCorrectChannelId(session.selfId)
      const finalChannelId = correctChannelId || session.channelId

      this.updateBotInfoToFile(session)

      const guildName = this.updateChannelInfoToFile(session)
      const isDirect = session.isDirect || finalChannelId?.includes('private')

      let content = session.content || ''

      if (!content && session.event?.message?.elements) {
        content = this.utils.extractTextContent(session.event.message.elements).trim()
      }
      // 表情占位符保留给前端渲染（同 processUserMessage）

      let quoteInfo: QuoteInfo | undefined = undefined
      const quoteMatch = content.match(/<quote id="([^"]+)"\/>/)
      if (quoteMatch) {
        const quoteId = quoteMatch[1]
          const quotedMsg = await this.fileManager.findChannelMessageById(session.selfId, finalChannelId, quoteId)

        if (quotedMsg) {
          const realId = quotedMsg.id.startsWith('bot-msg-') ? quotedMsg.realId : quotedMsg.id

          quoteInfo = {
            messageId: realId || quotedMsg.id,
            id: realId || quotedMsg.id,
            content: quotedMsg.content,
            elements: quotedMsg.elements,
            user: {
              id: quotedMsg.userId,
              name: quotedMsg.username,
              userId: quotedMsg.userId,
              avatar: quotedMsg.avatar,
              username: quotedMsg.username
            },
            timestamp: quotedMsg.timestamp
          }
          content = content.replace(/<quote id="[^"]+"\/>\s*/, '')

          if (realId) {
            session.content = session.content.replace(/id="[^"]+"/, `id="${realId}"`)
          }
        }
      }

      // 创建机器人消息信息对象
      const messageInfo: MessageInfo = {
        id: `bot-msg-${timestamp}`,
        content: content,
        userId: session.selfId,
        username: this.resolveBotName(session),
        avatar: this.resolveBotAvatar(session),
        timestamp: timestamp,
        channelId: finalChannelId,
        selfId: session.selfId,
        elements: this.stripFaceElements(await this.utils.cleanBase64ContentAsync(session.event?.message?.elements, true)),
        type: 'bot',
        guildName: guildName,
        platform: session.platform || 'unknown',
        quote: quoteInfo,
        isDirect: !!isDirect,
        sending: true // 标记为正在发送
      }

      // 异步保存消息（不阻塞）
      await this.fileManager.addMessageToFile(messageInfo)

      const eventElements = this.stripFaceElements(await this.utils.cleanBase64ContentAsync(session.event?.message?.elements, true))

      const messageEvent = {
        type: 'bot-message',
        selfId: session.selfId,
        platform: session.platform || 'unknown',
        channelId: finalChannelId,
        messageId: `bot-msg-${timestamp}`,
        content: content,
        userId: session.selfId,
        username: this.resolveBotName(session),
        avatar: this.resolveBotAvatar(session),
        timestamp: timestamp,
        guildName: guildName,
        channelType: session.event?.channel?.type || session.type || 0,
        elements: eventElements,
        quote: quoteInfo,
        isDirect: !!isDirect,
        sending: true,
        bot: {
          avatar: session.bot.user?.avatar,
          name: session.bot.user?.name,
        }
      }

      this.broadcast('chat-bot-message-event', messageEvent)
    } catch (error) {
      this.logger.error('处理机器人消息失败:', error)
    }
  }

  // 屏蔽 QQ 表情（face）元素：类型为 face/faceType，含 faceId/faceType 属性，或内容本身就是 face 序列化的文本
  stripFaceElements(elements: any[]) {
    if (!Array.isArray(elements)) return elements
    const isFace = (el: any) => !!el && (
      el.type === 'face' || el.type === 'faceType'
      || (el.attrs && ('faceId' in el.attrs || 'faceType' in el.attrs))
      || (el.type === 'text' && /^<face[^>]*>\s*$/i.test((el.attrs?.content || '').trim()))
    )
    const result: any[] = []
    for (const el of elements) {
      if (isFace(el)) continue
      if (el.children?.length) {
        el.children = this.stripFaceElements(el.children)
      }
      result.push(el)
    }
    return result
  }

  dispose() {
    void this.utils.dispose()
    for (const dispose of this.scheduledTasks) {
      dispose()
    }
    this.scheduledTasks.clear()
  }

  private scheduleTask(label: string, task: () => Promise<void>) {
    const dispose = this.ctx.setTimeout(() => {
      this.scheduledTasks.delete(dispose)
      void task().catch((error) => {
        this.logger.error(`${label}失败:`, error)
      })
    }, 0)

    this.scheduledTasks.add(dispose)
  }

  private shouldRefreshChannelInfo(
    channelKey: string,
    existingChannel: ChannelInfo | undefined,
    isDirect: boolean,
    channelId: string,
    directUserName?: string
  ) {
    if (this.channelRefreshInFlight.has(channelKey)) {
      return false
    }

    const lastRefresh = this.lastChannelRefreshAt.get(channelKey) || 0
    if (Date.now() - lastRefresh < this.CHANNEL_REFRESH_TTL_MS) {
      return false
    }

    if (isDirect) {
      return !directUserName && (!existingChannel || existingChannel.name.includes('未知'))
    }

    return !existingChannel?.guildName || existingChannel.guildName === channelId || !existingChannel?.botState
  }

  private async resolveBotGroupState(session: Session): Promise<BotGroupState | undefined> {
  const groupOpenid = session.guildId || session.channelId
  
  // 检查缓存，如果已经确认机器人不是管理员，直接返回
  const cachedState = this.fileManager.getCachedChannelInfo(session.selfId, groupOpenid)
  if (cachedState?.botState?.isNonAdmin === true) {
    this.logger.logInfo('机器人已确认为非管理员，跳过禁言状态查询', { groupOpenid })
    return cachedState.botState
  }

  try {
    const bot = session.bot as any
    const fetchState = bot?.internal?.getBotGroupState
      ? () => bot.internal.getBotGroupState(groupOpenid)
      : typeof bot?.refreshBotGroupState === 'function'
        ? () => bot.refreshBotGroupState(groupOpenid)
        : null
    if (!fetchState) return undefined

    const state = await fetchState()
    if (!state) return undefined

    // 查询群禁言状态（全员禁言），但需要先检查机器人是否为管理员
    let globalMuted: boolean | undefined
    let isNonAdmin = false
    
    try {
      // 方法1：通过 getGuildMember 检查机器人角色
      let isAdmin = false
      try {
        if (session.bot.getGuildMember && typeof session.bot.getGuildMember === 'function') {
          const memberInfo = await session.bot.getGuildMember(groupOpenid, session.selfId)
          // 通过 roles 数组判断是否为管理员
          if (memberInfo?.roles && Array.isArray(memberInfo.roles)) {
            isAdmin = memberInfo.roles.some((role: any) => {
              const roleName = (role.name || '').toLowerCase()
              const roleId = role.id || ''
              return roleName === 'admin' || 
                     roleName === 'owner' || 
                     roleName === '管理员' || 
                     roleName === '群主' ||
                     roleId === 'admin' ||
                     roleId === 'owner'
            })
          }
          this.logger.logInfo('检查机器人管理员状态:', { groupOpenid, isAdmin })
        }
      } catch (memberErr) {
        this.logger.logInfo('获取机器人成员信息失败，尝试通过API查询:', memberErr)
      }

      // 方法2：如果确认是管理员，查询禁言状态
      if (isAdmin) {
        if (bot?.internal?.getRestrictChatSetting) {
          const setting = await bot.internal.getRestrictChatSetting(groupOpenid)
          globalMuted = this.computeGlobalMuted(setting)
          this.logger.logInfo('查询禁言状态成功', { groupOpenid, globalMuted })
        }
      } else {
        // 不是管理员，标记并跳过
        isNonAdmin = true
        this.logger.logInfo('机器人不是群管理员，跳过禁言状态查询', { groupOpenid })
      }
    } catch (error) {
      // 捕获 "机器人不是群管理员" 错误码 11703
      if (error?.response?.data?.code === 11703 || 
          error?.response?.data?.err_code === 40011030 ||
          (error?.response?.data?.message || '').includes('机器人不是群管理员')) {
        isNonAdmin = true
        this.logger.logInfo('机器人不是群管理员（API返回），已标记', { groupOpenid })
        // 不抛出错误，继续执行
      } else {
        // 其他错误记录但不中断
        this.logger.warn('查询群禁言状态失败:', error)
      }
    }

    const result: BotGroupState = {
      memberRole: state.member_role,
      allowProactiveMsg: state.allow_proactive_msg,
      recvMsgSetting: state.recv_msg_setting,
      joinedAt: state.joined_at,
      memberOpenid: state.member_openid,
      inGroup: true,
      globalMuted,
      isNonAdmin
    }

    return result
  } catch (error) {
    // 鉴权失败、机器人非群成员 => 机器人已被移出该群
    if (this.isNotGroupMemberError(error)) {
      this.logger.warn('机器人已不在该群（可能被移出）:', groupOpenid)
      return { inGroup: false }
    }
    this.logger.warn('获取机器人群内状态失败:', error)
    return undefined
  }
}

  /** 根据查询群禁言状态的结果，判断群级（全员）禁言当前是否生效 */
  public computeGlobalMuted(setting: any): boolean {
    const mode = setting?.global_rule?.mode
    if (mode === 'always') return true
    if (mode !== 'schedule') return false

    const now = new Date()
    const nowMs = now.getTime()
    const schedule = setting?.global_rule?.schedule_rules || []
    for (const rule of schedule) {
      if (rule?.enabled && rule.start_at && rule.end_at) {
        const start = new Date(rule.start_at).getTime()
        const end = new Date(rule.end_at).getTime()
        if (nowMs >= start && nowMs <= end) return true
      }
    }

    const weekdayMap: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }
    const today = weekdayMap[now.getDay()]
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const recurring = setting?.global_rule?.recurring_rules || []
    for (const rule of recurring) {
      if (!rule?.enabled || !Array.isArray(rule.weekdays) || !rule.weekdays.includes(today)) continue
      const start = String(rule.start_time || '').split(':').map(Number)
      const end = String(rule.end_time || '').split(':').map(Number)
      if (start.length < 2 || end.length < 2 || isNaN(start[0]) || isNaN(end[0])) continue
      const startMin = start[0] * 60 + (start[1] || 0)
      const endMin = end[0] * 60 + (end[1] || 0)
      if (endMin <= startMin) {
        // 跨天到次日
        if (nowMin >= startMin || nowMin < endMin) return true
      } else if (nowMin >= startMin && nowMin < endMin) {
        return true
      }
    }
    return false
  }

  public isNotGroupMemberError(error: any): boolean {
    if (!error) return false
    const data = error?.response?.data
    const message = typeof data === 'string'
      ? data
      : String(data?.message || error?.message || error?.statusMessage || '')
    const text = message.toLowerCase()
    return text.includes('非群成员') ||
      text.includes('不在群') ||
      text.includes('已不在群') ||
      text.includes('已退出') ||
      text.includes('not a member') ||
      text.includes('not in group')
  }

  private async refreshChannelInfo(
  session: Session,
  existingChannel: ChannelInfo | undefined,
  isDirect: boolean,
  directUserName?: string
) {
  const channelKey = `${session.selfId}:${session.channelId}`
  this.channelRefreshInFlight.add(channelKey)

  try {
    let guildName = existingChannel?.guildName || session.channelId
    let botState: BotGroupState | undefined

    if (!isDirect) {
      guildName = await this.resolveGuildName(session)
      botState = await this.resolveBotGroupState(session)
      
      // 如果是非管理员，记录日志但不重复查询
      if (botState?.isNonAdmin) {
        this.logger.logInfo('已缓存非管理员状态，后续不再查询禁言', { 
          channelId: session.channelId,
          selfId: session.selfId 
        })
      }
    }

    const finalName = this.buildChannelName(session, existingChannel, isDirect, directUserName, guildName)
    const channelInfo: ChannelInfo = {
      id: session.channelId,
      name: finalName,
      type: session.type || 0,
      channelId: session.channelId,
      guildName,
      isDirect: !!isDirect,
      botState
    }

    await this.fileManager.upsertChannelInfo(session.selfId, session.channelId, channelInfo)
    this.lastChannelRefreshAt.set(channelKey, Date.now())
    this.logger.logInfo('更新频道信息到文件:', channelInfo.name, 
      botState ? `群内状态=${botState.memberRole} 主动推送=${botState.allowProactiveMsg}` : '')
    this.broadcast('chat-data-updated', {
      channel: {
        selfId: session.selfId,
        channelId: session.channelId,
        channelInfo
      }
    })
  } finally {
    this.channelRefreshInFlight.delete(channelKey)
  }
}

  private async resolveGuildName(session: Session): Promise<string> {
    try {
      if (session.guildId && session.bot.getGuild && typeof session.bot.getGuild === 'function') {
        const guild = await session.bot.getGuild(session.guildId)
        return guild?.name || session.channelId
      }

      if (session.guildId && session.bot.getChannel && typeof session.bot.getChannel === 'function') {
        const channel = await session.bot.getChannel(session.guildId)
        return channel?.name || session.channelId
      }
    } catch (error) {
      this.logger.logInfo('获取频道信息失败，使用频道ID作为备用:', error)
    }

    return session.channelId
  }

  private buildChannelName(
    session: Session,
    existingChannel: ChannelInfo | undefined,
    isDirect: boolean,
    directUserName: string | undefined,
    guildName: string
  ) {
    if (isDirect) {
      if (directUserName && directUserName !== session.userId) {
        return `私聊（${directUserName}）`
      }

      if (existingChannel?.name && !existingChannel.name.includes('未知')) {
        return existingChannel.name
      }

      if (session.platform && session.platform.toLowerCase().includes('sandbox')) {
        return `私聊（${session.userId}）`
      }

      return '私聊（未知用户）'
    }

    return guildName || session.channelId
  }

  private async processMediaElements(elements: h[], isUserMessage: boolean) {
    for (const el of elements) {
      const src = el.attrs?.src || el.attrs?.url || el.attrs?.file
      if (!src || !isUserMessage) {
        if (el.children?.length) {
          await this.processMediaElements(el.children, isUserMessage)
        }
        continue
      }

      const mediaType = this.guessMediaTypeForElement(el, src)
      if (mediaType === 'image') {
        try {
          await this.downloadAndCacheMedia(src, 'image')
        } catch (error) {
          this.logger.warn('缓存图片失败:', error)
        }
      } else if (mediaType === 'audio') {
        try {
          await this.downloadAndCacheMedia(src, 'audio')
        } catch (error) {
          this.logger.warn('缓存语音失败:', error)
        }
      }

      if (el.children?.length) {
        await this.processMediaElements(el.children, isUserMessage)
      }
    }
  }

  private guessMediaTypeForElement(el: any, src: string): 'image' | 'audio' | 'media' {
    const type = (el.type || '').toLowerCase()
    if (['image', 'img', 'mface'].includes(type)) return 'image'
    if (['audio', 'voice', 'record'].includes(type)) return 'audio'
    if (el.attrs?.type && /audio|voice|record/i.test(String(el.attrs.type))) return 'audio'

    const lower = src.toLowerCase()
    if (/(?:^|\/|\.)(jpg|jpeg|png|gif|bmp|webp|svg)(?:\?|$)/.test(lower)) return 'image'
    if (/(?:^|\/|\.)(mp3|wav|m4a|aac|ogg|amr|silk|flac)(?:\?|$)/.test(lower)) return 'audio'
    return 'media'
  }

  private async fileExists(filePath: string) {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
