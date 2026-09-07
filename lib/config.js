"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = void 0;
const koishi_1 = require("koishi");
exports.Config = koishi_1.Schema.intersect([
    koishi_1.Schema.object({
        maxMessagesPerChannel: koishi_1.Schema.number().default(500).description('每个群组最大保存消息数量').min(50).max(1500).step(1),
        messageChunkSize: koishi_1.Schema.number().default(100).description('单个消息分块文件最大消息数量').min(20).max(500).step(1),
        channelCacheLimit: koishi_1.Schema.number().default(50).description('内存中最多缓存的频道消息数量').min(1).max(200).step(1),
        maxPersistImages: koishi_1.Schema.number().default(100).description('持久化存储的图片缓存数量').min(10).max(500).step(1),
    }).description('基础设置'),
    koishi_1.Schema.object({
        clearIndexedDBOnStart: koishi_1.Schema.boolean().default(true).description('启动时强制清空IndexedDB缓存（适用于紧急情况，防止浏览器卡死）'),
        loggerinfo: koishi_1.Schema.boolean().default(false).description('日志调试模式').experimental(),
    }).description('开发者选项'),
]);
