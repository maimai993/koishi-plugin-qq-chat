import { BotInfo, ChannelInfo, ChatData, MessageInfo } from './types';
import { Context } from 'koishi';
import { Config } from './config';
import { PluginLogger } from './logger';
export declare class FileManager {
    private ctx;
    private config;
    private logger;
    private storageBaseDir;
    private chatHistoryDir;
    private metadataFilePath;
    private utils;
    private memoryCache;
    private channelMessagesCache;
    private recentMessageIdsCache;
    private pendingBotMessageIds;
    private messageChunkLocationCache;
    private dirtyChannelKeys;
    private pendingMessages;
    private writeTimers;
    private metadataLoadPromise;
    private channelLoadPromises;
    private writeQueue;
    private disposed;
    private readonly WRITE_DEBOUNCE_MS;
    private readonly RECENT_MESSAGE_ID_CACHE_SIZE;
    constructor(ctx: Context, config: Config, logger: PluginLogger);
    initialize(): Promise<void>;
    readChatDataFromFile(): ChatData;
    getCachedChannelInfo(selfId: string, channelId: string): ChannelInfo | undefined;
    getCachedBotInfo(selfId: string): BotInfo | undefined;
    readMetadataOnly(): Promise<Omit<ChatData, 'messages'>>;
    upsertBotInfo(botInfo: BotInfo): Promise<void>;
    upsertChannelInfo(selfId: string, channelId: string, channelInfo: ChannelInfo): Promise<void>;
    setPinnedBots(pinnedBots: string[]): Promise<void>;
    setPinnedChannels(pinnedChannels: string[]): Promise<void>;
    private cleanupLegacyStorage;
    private ensureDir;
    readChannelMessages(selfId: string, channelId: string): Promise<MessageInfo[]>;
    readChannelMessagesPage(selfId: string, channelId: string, limit: number, offset?: number): Promise<{
        messages: MessageInfo[];
        total: number;
    }>;
    findChannelMessageById(selfId: string, channelId: string, messageId: string): Promise<MessageInfo | null>;
    private readMetadata;
    private writeMetadata;
    private scheduleWrite;
    /**
     * 拆频道的内部 key `${selfId}:${channelId}`。
     * 注意只能按「第一个」冒号切：私聊的 channelId 本身就带冒号（`private:<openid>`），
     * 用 split(':') 会切出 channelId='private'，把消息写进幽灵目录 chat-history/<selfId>/private/，
     * 而读取走的是完整 key → 刷新后消息就"消失"了。
     */
    private static splitChannelKey;
    private flushPendingMessages;
    cleanExcessMessages(data: ChatData): ChatData;
    addMessageToFile(messageInfo: MessageInfo): Promise<void>;
    cleanupExcessMessagesInStorage(): Promise<void>;
    getAllChannelMessageCounts(): Promise<Record<string, number>>;
    /**
     * 批量取「每个频道最后一条消息」：频道列表默认就要显示最后一条消息预览，
     * 但打开控制台时内存里一条消息都没有（get-chat-data 只返回元数据），
     * 所以由一个接口统一按需读取，避免前端为每个频道各发一次请求。
     * 读取量很小：每个频道只读索引 + 最后一个分片。
     */
    getChannelPreviews(channels: Array<{
        selfId: string;
        channelId: string;
    }>, concurrency?: number): Promise<Record<string, MessageInfo | null>>;
    deleteChannelData(selfId: string, channelId: string): Promise<{
        deletedMessages: number;
    }>;
    deleteBotData(selfId: string): Promise<{
        deletedChannels: number;
        deletedMessages: number;
    }>;
    updateUserProfileInBotData(selfId: string, userId: string, userName?: string, avatar?: string): Promise<boolean>;
    markLatestBotMessageAsSent(selfId: string, channelId: string, realId: string): Promise<MessageInfo | undefined>;
    dispose(): Promise<void>;
    private createEmptyChatData;
    private ensureMetadataLoaded;
    private loadMetadataIntoCache;
    private loadChannelMessages;
    private loadChannelMessagesNoCache;
    private scheduleMetadataWrite;
    private enqueueWrite;
    private listStoredChannels;
    private listBotChannels;
    private scanStoredChannels;
    private createStoredChannelEntry;
    private resolveStoredChannelId;
    private getBotDirPath;
    private getEncodedChannelId;
    private decodeChannelId;
    private normalizeDirentName;
    private getChannelDirPath;
    private getChannelIndexPath;
    private getChunkFilePath;
    private createEmptyChannelIndex;
    private createChunkFileName;
    private loadOrCreateChannelIndex;
    private normalizeChannelIndex;
    private writeChannelIndex;
    private readChunkMessages;
    private writeChunkMessages;
    private writeMessagesToChunks;
    private appendMessagesToChannel;
    private trimChannelToLimit;
    private countChannelMessages;
    private removeChannelStorage;
    private updateUserProfileInChannel;
    /**
     * 把最近一条「正在发送」的机器人消息标记为发送失败。
     * before-send 会先把消息写进历史，真实投递失败时用它把状态改回来，
     * 免得 webui 里出现「群里其实没发出去」的消息。
     */
    markLatestBotMessageFailed(selfId: string, channelId: string, error?: string): Promise<MessageInfo | undefined>;
    private findAndUpdateLatestBotMessage;
    private findAndUpdateBotMessageByTempId;
    private deduplicateMessages;
    private getCachedChannelMessages;
    private peekCachedChannelMessages;
    private setCachedChannelMessages;
    private deleteCachedChannelMessages;
    private getChannelMessagesCacheSnapshot;
    private mergeChannelMessages;
    private limitChannelMessages;
    private channelMessageExists;
    private syncDirtyChannelState;
    private registerPendingBotMessage;
    private peekLatestPendingBotMessageId;
    private consumePendingBotMessageId;
    private deletePendingBotMessages;
    private getRecentMessageIdCacheLimit;
    private rememberRecentMessageIds;
    private forgetRecentMessageIds;
    private hasRecentMessageId;
    private deleteRecentMessageIds;
    private rememberMessageChunkLocation;
    private forgetMessageChunkLocation;
    private getMessageChunkLocation;
    private deleteMessageChunkLocations;
    private isSameBotInfo;
    private isSameChannelInfo;
    private isFileMissingError;
    private atomicWriteTextFile;
    private isAtomicRenameReplaceError;
}
