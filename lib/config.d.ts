import { Schema } from 'koishi';
export interface Config {
    loggerinfo: boolean;
    clearIndexedDBOnStart: boolean;
    maxMessagesPerChannel: number;
    messageChunkSize: number;
    channelCacheLimit: number;
    maxPersistImages: number;
}
export declare const Config: Schema<Config>;
