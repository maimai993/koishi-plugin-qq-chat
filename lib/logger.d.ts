import { Logger } from 'koishi';
import { Config } from './config';
export interface PluginLogger {
    logInfo(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}
export declare function createPluginLogger(logger: Logger, config: Pick<Config, 'loggerinfo'>): PluginLogger;
