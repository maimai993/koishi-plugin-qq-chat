import { Schema } from 'koishi';
export interface Config {
    loggerinfo: boolean;
    clearIndexedDBOnStart: boolean;
    maxMessagesPerChannel: number;
    messageChunkSize: number;
    channelCacheLimit: number;
    maxPersistImages: number;
    ocrApiKey: string;
    chatBackground: string;
    chatBackgroundBlur: number;
    chatBackgroundDim: number;
    theme: 'koishi' | 'system' | 'dark' | 'light';
    commandBridge: boolean;
    commandPrefix: string;
    commandAuthority: number;
    commandTimeoutMs: number;
    commandMaxLength: number;
    commandEditRules: string;
    loginRequired: boolean;
}
/**
 * 控制台监听 / 广播所需的权限等级（与插件页面一致）。
 * 启用 @koishijs/plugin-auth 后，未登录（或权限不足）的客户端调用这些接口会被拒绝；
 * 没启用 auth 插件时该选项不生效，行为与以前完全一致。
 */
export declare const CONSOLE_AUTHORITY = 4;
export declare const Config: Schema<Config>;
