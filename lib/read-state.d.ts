import { PluginLogger } from './logger';
/** 单个频道的已读状态 */
export interface ReadStateEntry {
    /** 已读水位：最后一条被读过的消息时间戳 */
    lastReadTimestamp: number;
    /** 已读水位对应的消息 id（可选，便于精确判定「未读区域」起点） */
    lastReadId?: string;
    /** 未读消息数 */
    unread: number;
    /** 其中「有人@机器人」的条数 */
    atMe: number;
    /** 其中「引用了机器人消息」的条数 */
    reply: number;
    updatedAt: number;
}
export type ReadStateMap = Record<string, ReadStateEntry>;
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
export declare class ReadStateStore {
    private logger;
    private filePath;
    private entries;
    private loadPromise;
    private writeTimer;
    private writePromise;
    private disposed;
    constructor(baseDir: string, logger: PluginLogger);
    private key;
    private splitKey;
    private ensureLoaded;
    private scheduleWrite;
    /** 立即落盘（dispose / 关键操作后调用） */
    flush(): Promise<void>;
    getAll(): Promise<ReadStateMap>;
    get(selfId: string, channelId: string): Promise<ReadStateEntry | null>;
    /** 新消息到达：晚于已读水位就计入未读 */
    noteIncoming(selfId: string, channelId: string, info: {
        timestamp: number;
        messageId?: string;
        atBot?: boolean;
        replyToBot?: boolean;
    }): Promise<ReadStateEntry>;
    /** 打开频道 / 手动标记已读：水位推到最新，未读清零 */
    markRead(selfId: string, channelId: string, info?: {
        timestamp?: number;
        messageId?: string;
    }): Promise<ReadStateEntry>;
    /** 标记未读（右键菜单）：至少 1 条，且把水位压回上一条消息之前 */
    markUnread(selfId: string, channelId: string, timestamp?: number, count?: number): Promise<ReadStateEntry>;
    /** 频道数据被清空 / 删除时同步清理未读状态 */
    forget(selfId: string, channelId?: string): Promise<void>;
    dispose(): Promise<void>;
}
