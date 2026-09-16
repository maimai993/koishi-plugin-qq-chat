import { promises as fs } from 'node:fs'
import path from 'node:path'

import { PluginLogger } from './logger'

/**
 * 消息推送设置（手机 App / 第三方客户端的通知规则）。
 *
 * 控制台里的「消息免打扰」原本只存在浏览器 localStorage 里，手机 App 看不到，
 * 于是免打扰的群在手机上照样弹通知。这里把免打扰列表落到服务端，
 * 供手机 App 判断：**免打扰的频道不推送，除非有人 @ 机器人或被引用了消息**。
 */
export interface NotifyRules {
  /** 免打扰的频道（`<selfId>:<channelId>`） */
  muted: string[]
  updatedAt: number
}

export class NotifyRuleStore {
  private filePath: string

  private state: NotifyRules | null = null

  private writeTimer: NodeJS.Timeout | null = null

  constructor(baseDir: string, private logger: PluginLogger) {
    this.filePath = path.join(baseDir, 'data', 'qq-chat', 'v2', 'notify-settings.json')
  }

  private async ensureLoaded(): Promise<NotifyRules> {
    if (this.state) return this.state
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const data = JSON.parse(raw)
      this.state = {
        muted: Array.isArray(data?.muted) ? data.muted.map((x: any) => String(x)).filter(Boolean) : [],
        updatedAt: Number(data?.updatedAt) || 0
      }
    } catch {
      this.state = { muted: [], updatedAt: 0 }
    }
    return this.state
  }

  private scheduleWrite() {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.flush()
    }, 400)
    ;(this.writeTimer as any)?.unref?.()
  }

  async flush() {
    if (!this.state) return
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.writeFile(this.filePath, JSON.stringify({ version: 1, ...this.state }, null, 2), 'utf8')
    } catch (error: any) {
      this.logger.warn('保存推送设置失败:', error?.message || error)
    }
  }

  async get(): Promise<NotifyRules> {
    const state = await this.ensureLoaded()
    return { muted: [...state.muted], updatedAt: state.updatedAt }
  }

  /** 覆盖免打扰列表（控制台与手机端都往这里同步） */
  async setMuted(muted: string[]): Promise<NotifyRules> {
    const state = await this.ensureLoaded()
    state.muted = [...new Set((muted || []).map((x) => String(x)).filter(Boolean))]
    state.updatedAt = Date.now()
    this.scheduleWrite()
    return { muted: [...state.muted], updatedAt: state.updatedAt }
  }

  /** 单个频道的免打扰开关 */
  async setChannelMuted(key: string, muted: boolean): Promise<NotifyRules> {
    const state = await this.ensureLoaded()
    const set = new Set(state.muted)
    if (muted) set.add(key)
    else set.delete(key)
    return await this.setMuted([...set])
  }

  /** 判断某条消息要不要推送：免打扰频道里只有「@机器人」和「引用机器人」才推 */
  shouldNotify(muted: string[], selfId: string, channelId: string, options: { atBot?: boolean, replyToBot?: boolean } = {}) {
    const key = `${selfId}:${channelId}`
    if (!muted.includes(key)) return true
    return !!(options.atBot || options.replyToBot)
  }

  async dispose() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    await this.flush()
  }
}
