import { Context } from 'koishi';
import { FileManager } from './file-manager';
import { MessageHandler } from './message-handler';
import { Config } from './config';
import { PluginLogger } from './logger';
export declare class ApiHandlers {
    private ctx;
    private config;
    private fileManager;
    private messageHandler;
    private logger;
    /** 最近一次临时视频（真流式转发的视频消息用） */
    private currentTempVideo;
    /** B 站卡片封面 OCR 结果缓存（懒加载，最多 200 条） */
    private ocrCache?;
    private privateStreams;
    constructor(ctx: Context, config: Config, fileManager: FileManager, messageHandler: MessageHandler, logger: PluginLogger);
    /**
     * 统一注册控制台监听：带上 authority。
     * 启用 @koishijs/plugin-auth 后，未登录或权限不足的客户端调用这些接口会被拒绝；
     * 没启用 auth 插件时 Koishi 不做拦截，行为与以前一致。
     */
    private addListener;
    /** 广播也要带 authority，否则未登录的客户端能收到聊天内容 */
    private broadcast;
    safeDecode(value: any): any;
    reviveElements(source: any): any[];
    buildMediaMarkup(content: any, images: any, files: any): Promise<string>;
    toWireElements(source: any): any[];
    sendElementsToChannel(data: any): Promise<{
        success: boolean;
        messageId: any;
        error?: undefined;
    } | {
        success: boolean;
        error: any;
        messageId?: undefined;
    }>;
    convertCmdInputTags(text: any): any;
    convertAtUserTags(text: any): any;
    isDirectChannel(channelId: any): boolean;
    toUserOpenId(channelId: any): string;
    sendMarkdownRequest(bot: any, channelId: any, request: any): Promise<any>;
    recordStreamedBotMessage(selfId: any, bot: any, channelId: any, finalContent: any, streamMsgId: any): Promise<void>;
    finalizePrivateStream(bot: any, openid: any, session: any): Promise<void>;
    registerApiHandlers(): void;
    ocrImageText(imageUrl: any): Promise<any>;
    extractBiliUpName(text: any): string;
    normalizeBiliText(text: any): string;
    biliSearchVideos(keyword: any, title: any, author: any, limit?: number): Promise<{
        results: any[];
        best: any;
        error: any;
    } | {
        results: any;
        best: any;
        error: string;
    }>;
    resolveBiliCanonicalUrl(input: any): Promise<any>;
    biliTitleSimilarity(left: any, right: any): number;
    private static mixinKeyEncTab;
    getBiliMixinKey(orig: any): string;
    stripHtml(text: any): string;
    getBiliWbiKeys(): Promise<{
        buvid3: string;
        imgKey: string;
        subKey: string;
    }>;
    encWbi(params: any, imgKey: any, subKey: any): string;
    isFileUrl(url: any): boolean;
    createFileUrl(filePath: any): string;
    serverOrigin(): string;
    uploadEmojiToAssets(sourceUrl: any, faceId: any): Promise<string>;
    findGroupBot(selfId: any): import("koishi").Bot<Context, any>;
    qqApiRequest(bot: any, method: string, path: string, data?: any): Promise<any>;
    resolveChatBackgroundUrl(): Promise<string>;
    createMediaUrl(filePath: any): string;
    handleLocalFileRequest(fileUrl: any): Promise<{
        success: boolean;
        base64: string;
        contentType: any;
        dataUrl: string;
        error?: undefined;
    } | {
        success: boolean;
        error: string;
        base64?: undefined;
        contentType?: undefined;
        dataUrl?: undefined;
    }>;
    setupTempFileCleanup(): void;
    cleanupMediaCache(): Promise<void>;
    logInfo(...args: any[]): void;
    fileExists(filePath: any): Promise<boolean>;
    readFileHead(filePath: any, length: any): Promise<Buffer<ArrayBuffer>>;
    isAudioBuffer(buffer: any): any;
    safeReadDir(dirPath: any): Promise<string[]>;
    cleanupMediaCacheDir(dirPath: any, limit: any): Promise<void>;
    /**
     * 统一从各种错误结构中提取用户可读的报错信息。
     * 优先取 QQ API 返回的 response.data.message / err_msg（如"目标成员为机器人/群主/管理员，不允许被禁言"），
     * 其次取 data.message / 普通 message，最后兜底 String(error)。
     */
    getClientErrorMessage(error: any): any;
    /** 判断错误是否为"机器人无主动消息权限"（QQ 错误码 40034105，主动推送被拒时触发） */
    isNoProactivePermissionError(error: any): any;
    /** 判断错误是否为"机器人被禁言"（QQ 错误码 40054002，全体禁言时发送会触发） */
    isBotMutedError(error: any): any;
    /** 毫秒时间戳 -> RFC3339（本地时区偏移），如 2026-08-05T11:23:05+08:00 */
    toRfc3339(ms: any): string;
}
