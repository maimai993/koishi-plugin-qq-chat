"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPluginLogger = createPluginLogger;
function createPluginLogger(logger, config) {
    return {
        logInfo(...args) {
            if (config.loggerinfo) {
                Reflect.apply(logger.info, logger, args);
            }
        },
        info(...args) {
            Reflect.apply(logger.info, logger, args);
        },
        warn(...args) {
            Reflect.apply(logger.warn, logger, args);
        },
        error(...args) {
            Reflect.apply(logger.error, logger, args);
        }
    };
}
