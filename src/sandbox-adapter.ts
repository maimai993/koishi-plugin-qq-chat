/**
 * 假适配器：一个独立平台（qq-chat-sandbox）的虚拟机器人。
 * 消息走 Koishi 完整中间件（指令、插件都会响应），但 sendMessage 不发到任何真实平台，
 * 而是把内容交给回调（推给控制台沙盒对话框），由用户编辑后再发到真实频道。
 * 参考：@koishijs/plugin-sandbox
 */
import { Bot, Context, h } from 'koishi'

const PLATFORM = 'qq-chat-sandbox'
const SELF_ID = 'sandbox'

export interface SandboxBotOptions {
  platform?: string
  selfId?: string
  /** 拦截到的发送内容：channelId + 规范化后的元素 */
  onSend?: (channelId: string, elements: h[]) => void
}

export class SandboxBot extends Bot<Context, any> {
  hidden = true

  onSend: (channelId: string, elements: h[]) => void

  constructor(ctx: Context, options?: SandboxBotOptions) {
    super(ctx, { platform: options?.platform || PLATFORM, selfId: options?.selfId || SELF_ID } as any, undefined as any)
    // status 在基类里是访问器，这里直接挂载实例属性
    ;(this as any).status = 1
    // 显式挂上平台/自身 ID，避免个别版本里只存在 config 上
    this.platform = (this.config as any)?.platform || PLATFORM
    this.selfId = (this.config as any)?.selfId || SELF_ID
    this.user = { id: this.selfId, name: '沙盒' } as any
    this.onSend = options?.onSend || (() => {})
  }

  async sendMessage(channelId: string, content: any, options?: any): Promise<any[]> {
    try {
      this.onSend(channelId, h.normalize(content))
    } catch { /* 忽略 */ }
    return []
  }

  async sendPrivateMessage(channelId: string, content: any, options?: any): Promise<any[]> {
    return this.sendMessage(channelId, content, options)
  }
}

// 取（或创建）虚拟机器人；每次调用替换回调
export function ensureSandboxBot(ctx: Context, onSend: (channelId: string, elements: h[]) => void): SandboxBot {
  let bot: any = (ctx?.bots || []).find((item: any) => item && item.platform === PLATFORM && item.selfId === SELF_ID)
  if (!bot) {
    bot = new SandboxBot(ctx, { platform: PLATFORM, selfId: SELF_ID, onSend })
    try {
      ctx.bots.push(bot)
    } catch (error) {
      ;(ctx as any).logger?.warn?.('注册沙盒虚拟机器人失败:', error)
    }
  } else {
    bot.onSend = onSend
  }
  return bot
}
