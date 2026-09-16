import { PluginLogger } from './logger';
/**
 * 消息推送设置（手机 App / 第三方客户端的通知规则）。
 *
 * 控制台里的「消息免打扰」原本只存在浏览器 localStorage 里，手机 App 看不到，
 * 于是免打扰的群在手机上照样弹通知。这里把免打扰列表落到服务端，
 * 供手机 App 判断：**免打扰的频道不推送，除非有人 @ 机器人或被引用了消息**。
 */
export interface NotifyRules {
    /** 免打扰的频道（`<selfId>:<channelId>`） */
    muted: string[];
    updatedAt: number;
}
export declare class NotifyRuleStore {
    private logger;
    private filePath;
    private state;
    private writeTimer;
    constructor(baseDir: string, logger: PluginLogger);
    private ensureLoaded;
    private scheduleWrite;
    flush(): Promise<void>;
    get(): Promise<NotifyRules>;
    /** 覆盖免打扰列表（控制台与手机端都往这里同步） */
    setMuted(muted: string[]): Promise<NotifyRules>;
    /** 单个频道的免打扰开关 */
    setChannelMuted(key: string, muted: boolean): Promise<NotifyRules>;
    /** 判断某条消息要不要推送：免打扰频道里只有「@机器人」和「引用机器人」才推 */
    shouldNotify(muted: string[], selfId: string, channelId: string, options?: {
        atBot?: boolean;
        replyToBot?: boolean;
    }): boolean;
    dispose(): Promise<void>;
}
