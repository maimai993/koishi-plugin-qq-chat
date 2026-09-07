import { FileManager } from './file-manager';
import { MessageHandler } from './message-handler';
import { Context } from 'koishi';
import { Config } from './config';
import { PluginLogger } from './logger';
export declare class ApiHandlers {
    private ctx;
    private config;
    private fileManager;
    private messageHandler;
    private logger;
    private currentTempVideo;
    constructor(ctx: Context, config: Config, fileManager: FileManager, messageHandler: MessageHandler, logger: PluginLogger);
    private safeDecode;
    private convertCmdInputTags;
    registerApiHandlers(): void;
    private static readonly mixinKeyEncTab;
    private getBiliMixinKey;
    private stripHtml;
    private getBiliWbiKeys;
    private encWbi;
    private isFileUrl;
    private createFileUrl;
    private serverOrigin;
    private uploadEmojiToAssets;
    private createMediaUrl;
    private handleLocalFileRequest;
    private setupTempFileCleanup;
    private cleanupMediaCache;
    private logInfo;
    private fileExists;
    private readFileHead;
    private isAudioBuffer;
    private safeReadDir;
    private cleanupMediaCacheDir;
    /**
     * 统一从各种错误结构中提取用户可读的报错信息。
     * 优先取 QQ API 返回的 response.data.message / err_msg（如"目标成员为机器人/群主/管理员，不允许被禁言"），
     * 其次取 data.message / 普通 message，最后兜底 String(error)。
     */
    private getClientErrorMessage;
    /** 判断错误是否为"机器人无主动消息权限"（QQ 错误码 40034105，主动推送被拒时触发） */
    private isNoProactivePermissionError;
    /** 判断错误是否为"机器人被禁言"（QQ 错误码 40054002，全体禁言时发送会触发） */
    private isBotMutedError;
    /** 毫秒时间戳 -> RFC3339（本地时区偏移），如 2026-08-05T11:23:05+08:00 */
    private toRfc3339;
}
