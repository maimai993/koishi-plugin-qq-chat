import { h } from 'koishi'

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
  inGroup?: boolean
  globalMuted?: boolean
  isNonAdmin?: boolean 
}
export interface QuoteInfo {
  messageId: string
  id: string
  content: string
  elements?: h[]
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
  elements?: h[]
  type: 'user' | 'bot' | 'system'
  /** 系统消息子类型：member=入群/退群，join-request=入群申请 */
  systemType?: 'member' | 'join-request'
  guildId?: string
  guildName?: string
  platform: string
  quote?: QuoteInfo
  isDirect?: boolean
  /** 群消息里是否 @ 了机器人（用于频道列表的「有人@你」提醒） */
  atBot?: boolean
  sending?: boolean
  realId?: string
}

export interface ChatData {
  bots: Record<string, BotInfo>
  channels: Record<string, Record<string, ChannelInfo>>
  messages: Record<string, MessageInfo[]>
  pinnedBots: string[]
  pinnedChannels: string[]
  lastSaveTime?: number
}
