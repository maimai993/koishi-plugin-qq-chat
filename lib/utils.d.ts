import { Config } from './config';
import { Context } from 'koishi';
export declare class Utils {
    private config;
    private ctx?;
    private persistImageWriteCount;
    private pendingTasks;
    constructor(config: Config, ctx?: Context);
    extractTextContent(elements: any[]): string;
    private isBase64;
    persistBase64ImageAsync(base64Data: string): Promise<string>;
    private cleanupPersistImagesAsync;
    cleanBase64ContentAsync<T>(obj: T, isBotMessage?: boolean): Promise<T>;
    dispose(): Promise<void>;
    private trackTask;
    private fileExists;
}
