// 定义通用的聊天相关类型

export interface BotInfo {
  selfId: string
  platform: string
  username: string
  avatar?: string
  status: 'online' | 'offline'
}

export interface ChannelInfo {
  id: string
  name: string
  type: number | string
  channelId?: string
  guildName?: string
  isDirect?: boolean
  botState?: BotGroupState
}

export interface BotGroupState {
  memberRole?: 'member' | 'owner' | 'admin'
  allowProactiveMsg?: boolean
  recvMsgSetting?: 'all' | 'only_mention' | 'mention_and_context'
  joinedAt?: string
  memberOpenid?: string
  /** false 表示机器人已不在该群（如被移出） */
  inGroup?: boolean
  /** 群级禁言（全员禁言）是否生效中 */
  globalMuted?: boolean
}

export interface MessageElement {
  type: string
  attrs: Record<string, any>
  children: MessageElement[]
}

export interface QuoteInfo {
  messageId: string
  id: string
  content: string
  elements?: MessageElement[]
  user: {
    id: string
    name: string
    userId: string
    avatar?: string
    username: string
  }
  timestamp: number
}

export interface MessageInfo {
  id: string
  content: string
  userId: string
  username: string
  avatar?: string
  role?: string
  timestamp: number
  channelId: string
  selfId: string
  elements?: MessageElement[]
  isBot?: boolean
  type?: 'user' | 'bot' | 'system'
  /** 系统消息子类型：member=入群/退群，join-request=入群申请 */
  systemType?: 'member' | 'join-request'
  quote?: QuoteInfo
  sending?: boolean
  realId?: string
}

export interface ChatData {
  bots: Record<string, BotInfo>
  channels: Record<string, Record<string, ChannelInfo>>
  messages: Record<string, MessageInfo[]>
}

export interface PluginConfig {
  maxMessagesPerChannel: number
  loggerinfo: boolean
  chatContainerHeight: number
  clearIndexedDBOnStart: boolean
}
