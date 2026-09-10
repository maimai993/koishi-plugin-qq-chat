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
  /** 该消息是否 @ 了机器人（群聊） */
  atBot?: boolean
  /** 沙盒窗口：只在本机出现过（尚未真的发到 QQ）的消息 */
  sandbox?: boolean
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
  /** 控制台指令桥接：/指令 是否本地执行并拦截输出 */
  commandBridge?: boolean
  /** 本地指令前缀 */
  commandPrefix?: string
  /** 主题：koishi=跟随控制台 / system=跟随系统 / dark=黑色 / light=白色 */
  theme?: 'koishi' | 'system' | 'dark' | 'light'
  /** 聊天区背景图（插件设置）：本地图片路径或 http(s) 链接 */
  chatBackground?: string
  /** 服务端解析后的可访问地址（本地文件会走 /qq-chat/background） */
  chatBackgroundUrl?: string
  /** 背景模糊 px */
  chatBackgroundBlur?: number
  /** 背景遮罩浓度 % */
  chatBackgroundDim?: number
}
