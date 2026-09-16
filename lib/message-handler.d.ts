import { Context, Session } from 'koishi';
import { FileManager } from './file-manager';
import { ReadStateStore } from './read-state';
import { Config } from './config';
import { PluginLogger } from './logger';
export declare class MessageHandler {
    private ctx;
    private config;
    private fileManager;
    private logger;
    private readState?;
    private utils;
    private correctChannelIds;
    private scheduledTasks;
    private channelRefreshInFlight;
    private lastChannelRefreshAt;
    private readonly CHANNEL_REFRESH_TTL_MS;
    constructor(ctx: Context, config: Config, fileManager: FileManager, logger: PluginLogger, readState?: ReadStateStore);
    /**
     * 给真实机器人的发送方法包一层：before-send 已经先把消息写进历史了，
     * 这里等真实投递结束再回写状态 ——
     *  - 成功：从「发送中」变成已发送，并补上真实消息 id
     *  - 失败：标记成「发送失败」（QQ 拒收、无主动推送权限、网络错误…），
     *    否则 webui 里会把没发出去的消息当成正常消息显示
     */
    /** 从适配器抛出的错误里抠出人能看懂的失败原因 */
    private describeSendError;
    /** 从 QQ 接口地址里推出本地频道号（/v2/groups/{id}/... 或 /v2/users/{openid}/...） */
    private channelIdFromApiUrl;
    /** 从发送返回值里抠出消息 id */
    private extractMessageId;
    /**
     * 统一的「发送出口」包装：成功回写真实消息 id，失败（含返回空数组）标记「发送失败」。
     *
     * 以前只包了 sendMessage / sendPrivateMessage / sendGroupMessage，可插件里还有两条
     * 出口会真的把消息发到 QQ：
     *   - bot.internal.*：原生 markdown、QQ 表情、上传文件、流式消息
     *   - bot.http.post：直接打 /v2/.../messages、/files、/stream_messages、/panels
     * 这两条路失败时不会被标记，界面上就留下一条「看起来发成功了」的消息。
     */
    private wrapOutgoingSender;
    wrapBotSenders(): void;
    /** 手机端 SSE 推送中心（由 index.ts 注入）：网页端与手机端收到同一份广播 */
    private mobileHub?;
    setMobileHub(hub: {
        broadcast: (name: string, body: any) => void;
    }): void;
    /** 广播带 authority：启用 auth 插件后未登录的客户端收不到聊天内容 */
    private broadcast;
    private isAtBotMessage;
    private stripLeadingAtSelf;
    recordUserMessage(session: Session, timestamp: number): void;
    recordBotMessage(session: Session, timestamp: number): void;
    recordGroupMemberEvent(session: Session, kind: 'added' | 'removed'): void;
    private processGroupMemberEvent;
    recordJoinRequestEvent(session: Session): void;
    private processJoinRequestEvent;
    setCorrectChannelId(selfId: string, channelId: string): void;
    getCorrectChannelId(selfId: string): string | undefined;
    private isRawIdName;
    private resolveBotName;
    private resolveBotAvatar;
    updateBotInfoToFile(session: Session): void;
    updateChannelInfoToFile(session: Session): string;
    downloadAndCacheMedia(url: string, type: 'image' | 'media' | 'avatar' | 'audio', prefetchedBuffer?: Buffer): Promise<string>;
    private toMediaUrl;
    getCachedMediaUrl(url: string, type: 'image' | 'media' | 'avatar' | 'audio'): Promise<string | null>;
    private findCachedFile;
    private detectAudioFormat;
    private guessMediaTypeByUrl;
    private getPreferredMediaExtension;
    private isPlayableAudioBuffer;
    private transcodeAudioToMp3;
    private transcodeRawBufferToMp3;
    private processMediaElementsAsync;
    private processUserMessage;
    private processBotMessage;
    stripFaceElements(elements: any[]): any[];
    dispose(): void;
    private scheduleTask;
    private shouldRefreshChannelInfo;
    private resolveBotGroupState;
    /** 根据查询群禁言状态的结果，判断群级（全员）禁言当前是否生效 */
    computeGlobalMuted(setting: any): boolean;
    isNotGroupMemberError(error: any): boolean;
    private refreshChannelInfo;
    private resolveGuildName;
    private buildChannelName;
    private processMediaElements;
    private guessMediaTypeForElement;
    private fileExists;
}
