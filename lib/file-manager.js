"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileManager = void 0;
const utils_1 = require("./utils");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
class FileManager {
    constructor(ctx, config, logger) {
        this.ctx = ctx;
        this.config = config;
        this.logger = logger;
        this.memoryCache = this.createEmptyChatData();
        this.channelMessagesCache = new Map();
        this.recentMessageIdsCache = new Map();
        this.pendingBotMessageIds = new Map();
        this.messageChunkLocationCache = new Map();
        this.dirtyChannelKeys = new Set();
        this.pendingMessages = new Map(); // 按channelKey分组的待写入消息
        this.writeTimers = new Map(); // 每个频道独立的写入定时器
        this.metadataLoadPromise = null;
        this.channelLoadPromises = new Map();
        this.writeQueue = Promise.resolve();
        this.disposed = false;
        this.WRITE_DEBOUNCE_MS = 1000;
        this.RECENT_MESSAGE_ID_CACHE_SIZE = 200;
        const baseDir = node_path_1.default.resolve(ctx.baseDir, 'data', 'qq-chat');
        this.storageBaseDir = node_path_1.default.join(baseDir, 'v2');
        this.chatHistoryDir = node_path_1.default.join(this.storageBaseDir, 'chat-history');
        this.metadataFilePath = node_path_1.default.join(this.storageBaseDir, 'metadata.json');
        this.utils = new utils_1.Utils(config, ctx);
        // 异步清理旧版本数据，避免阻塞启动。
        this.ctx.setTimeout(() => {
            void this.cleanupLegacyStorage(baseDir);
        }, 0);
    }
    async initialize() {
        await this.ensureMetadataLoaded();
    }
    readChatDataFromFile() {
        this.memoryCache.messages = this.getChannelMessagesCacheSnapshot();
        return this.memoryCache;
    }
    getCachedChannelInfo(selfId, channelId) {
        return this.memoryCache.channels[selfId]?.[channelId];
    }
    async readMetadataOnly() {
        await this.ensureMetadataLoaded();
        const { messages, ...metadata } = this.memoryCache;
        return { ...metadata };
    }
    async upsertBotInfo(botInfo) {
        await this.ensureMetadataLoaded();
        const current = this.memoryCache.bots[botInfo.selfId];
        if (current && this.isSameBotInfo(current, botInfo)) {
            return;
        }
        this.memoryCache.bots[botInfo.selfId] = botInfo;
        this.scheduleMetadataWrite();
    }
    async upsertChannelInfo(selfId, channelId, channelInfo) {
        await this.ensureMetadataLoaded();
        if (!this.memoryCache.channels[selfId]) {
            this.memoryCache.channels[selfId] = {};
        }
        const current = this.memoryCache.channels[selfId][channelId];
        if (current && this.isSameChannelInfo(current, channelInfo)) {
            return;
        }
        this.memoryCache.channels[selfId][channelId] = channelInfo;
        this.scheduleMetadataWrite();
    }
    async setPinnedBots(pinnedBots) {
        await this.ensureMetadataLoaded();
        this.memoryCache.pinnedBots = [...pinnedBots];
        this.scheduleMetadataWrite();
    }
    async setPinnedChannels(pinnedChannels) {
        await this.ensureMetadataLoaded();
        this.memoryCache.pinnedChannels = [...pinnedChannels];
        this.scheduleMetadataWrite();
    }
    // 清理旧版本数据目录
    async cleanupLegacyStorage(baseDir) {
        const oldFiles = ['chat-data.json', 'data.json', 'messages.json'];
        for (const fileName of oldFiles) {
            const filePath = node_path_1.default.join(baseDir, fileName);
            try {
                await node_fs_1.promises.unlink(filePath);
                this.logger.logInfo(`已删除旧版本数据文件: ${fileName}`);
            }
            catch (error) {
                if (!this.isFileMissingError(error)) {
                    this.logger.warn(`删除旧版本数据文件失败: ${fileName}`, error);
                }
            }
        }
        const legacyPaths = [
            node_path_1.default.join(baseDir, 'metadata.json'),
            node_path_1.default.join(baseDir, 'chat-history')
        ];
        for (const legacyPath of legacyPaths) {
            try {
                await node_fs_1.promises.rm(legacyPath, { recursive: true, force: true });
                this.logger.logInfo(`已清理旧版数据路径: ${legacyPath}`);
            }
            catch (error) {
                this.logger.warn(`清理旧版数据路径失败: ${legacyPath}`, error);
            }
        }
    }
    // 确保目录存在
    async ensureDir(dirPath) {
        await node_fs_1.promises.mkdir(dirPath, { recursive: true });
    }
    // 读取单个频道的消息（公共方法）
    async readChannelMessages(selfId, channelId) {
        await this.ensureMetadataLoaded();
        const channelKey = `${selfId}:${channelId}`;
        const cached = this.getCachedChannelMessages(channelKey);
        if (cached) {
            return cached;
        }
        const existingPromise = this.channelLoadPromises.get(channelKey);
        if (existingPromise) {
            return existingPromise;
        }
        const loadPromise = this.loadChannelMessages(selfId, channelId);
        this.channelLoadPromises.set(channelKey, loadPromise);
        try {
            return await loadPromise;
        }
        finally {
            this.channelLoadPromises.delete(channelKey);
        }
    }
    async readChannelMessagesPage(selfId, channelId, limit, offset = 0) {
        await this.ensureMetadataLoaded();
        const indexData = await this.loadOrCreateChannelIndex(selfId, channelId);
        if (limit <= 0 || offset >= indexData.totalMessages) {
            return {
                messages: [],
                total: indexData.totalMessages
            };
        }
        const entry = this.createStoredChannelEntry(selfId, channelId);
        const collected = [];
        let skipped = 0;
        for (let chunkIndex = indexData.chunks.length - 1; chunkIndex >= 0; chunkIndex -= 1) {
            const chunk = indexData.chunks[chunkIndex];
            const chunkMessages = await this.readChunkMessages(entry.channelDirPath, chunk.fileName);
            for (let messageIndex = chunkMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                collected.push(chunkMessages[messageIndex]);
                if (collected.length >= limit) {
                    return {
                        messages: collected.reverse(),
                        total: indexData.totalMessages
                    };
                }
            }
        }
        return {
            messages: collected.reverse(),
            total: indexData.totalMessages
        };
    }
    async findChannelMessageById(selfId, channelId, messageId) {
        await this.ensureMetadataLoaded();
        const channelKey = `${selfId}:${channelId}`;
        const cachedMessages = this.peekCachedChannelMessages(channelKey);
        const cachedMatched = cachedMessages?.find((message) => message.id === messageId);
        if (cachedMatched) {
            return cachedMatched;
        }
        const entry = this.createStoredChannelEntry(selfId, channelId);
        const indexData = await this.loadOrCreateChannelIndex(selfId, channelId);
        for (let chunkIndex = indexData.chunks.length - 1; chunkIndex >= 0; chunkIndex -= 1) {
            const chunk = indexData.chunks[chunkIndex];
            const messages = await this.readChunkMessages(entry.channelDirPath, chunk.fileName);
            const matched = messages.find((message) => message.id === messageId);
            if (matched) {
                return matched;
            }
        }
        return null;
    }
    // 读取元数据（bots、channels、pinned等）
    async readMetadata() {
        try {
            const jsonData = await node_fs_1.promises.readFile(this.metadataFilePath, 'utf8');
            const data = JSON.parse(jsonData);
            return {
                bots: data.bots || {},
                channels: data.channels || {},
                pinnedBots: data.pinnedBots || [],
                pinnedChannels: data.pinnedChannels || [],
                lastSaveTime: data.lastSaveTime
            };
        }
        catch (error) {
            if (this.isFileMissingError(error)) {
                return {
                    bots: {},
                    channels: {},
                    pinnedBots: [],
                    pinnedChannels: []
                };
            }
            this.logger.error('读取元数据失败:', error);
            return {
                bots: {},
                channels: {},
                pinnedBots: [],
                pinnedChannels: []
            };
        }
    }
    // 写入元数据
    async writeMetadata(metadata) {
        try {
            await this.ensureDir(node_path_1.default.dirname(this.metadataFilePath));
            const dataToWrite = {
                ...metadata,
                lastSaveTime: Date.now()
            };
            const jsonData = JSON.stringify(dataToWrite, null, 2);
            await this.atomicWriteTextFile(this.metadataFilePath, jsonData);
        }
        catch (error) {
            this.logger.error('写入元数据失败:', error);
        }
    }
    // 为特定频道安排写入
    scheduleWrite(channelKey) {
        // 取消之前的定时器
        const existingTimer = this.writeTimers.get(channelKey);
        if (existingTimer) {
            existingTimer();
        }
        // 创建新的定时器
        const timer = this.ctx.setTimeout(() => {
            this.writeTimers.delete(channelKey);
            void this.flushPendingMessages(channelKey);
        }, this.WRITE_DEBOUNCE_MS);
        this.writeTimers.set(channelKey, timer);
    }
    // 刷新特定频道的待写入消息
    async flushPendingMessages(channelKey) {
        const messagesToWrite = this.pendingMessages.get(channelKey);
        if (!messagesToWrite || messagesToWrite.length === 0)
            return;
        this.pendingMessages.delete(channelKey);
        const cachedMessages = this.peekCachedChannelMessages(channelKey);
        const [selfId, channelId] = channelKey.split(':');
        if (!selfId || !channelId)
            return;
        const uniqueMessages = this.deduplicateMessages(messagesToWrite);
        if (!uniqueMessages.length) {
            return;
        }
        if (cachedMessages) {
            const nextMessages = this.mergeChannelMessages(cachedMessages, uniqueMessages);
            this.setCachedChannelMessages(channelKey, this.limitChannelMessages(nextMessages));
        }
        this.rememberRecentMessageIds(channelKey, uniqueMessages.map((message) => message.id));
        // 只向最后一个 chunk 追加，避免整频道重写。
        this.enqueueWrite(async () => {
            await this.appendMessagesToChannel(selfId, channelId, uniqueMessages);
            const channelLabel = this.getCachedChannelInfo(selfId, channelId)?.name || channelKey;
            this.logger.logInfo(`批量写入 ${uniqueMessages.length} 条消息到频道 ${channelLabel}`);
        });
    }
    cleanExcessMessages(data) {
        let cleanedCount = 0;
        const cleanedMessages = {};
        for (const [channelKey, messages] of Object.entries(data.messages)) {
            if (messages.length > this.config.maxMessagesPerChannel) {
                const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);
                const keptMessages = sortedMessages.slice(-this.config.maxMessagesPerChannel);
                cleanedCount += messages.length - keptMessages.length;
                cleanedMessages[channelKey] = keptMessages;
                this.logger.logInfo(`频道 ${channelKey} 清理了 ${messages.length - keptMessages.length} 条旧消息，保留最新 ${keptMessages.length} 条`);
            }
            else {
                cleanedMessages[channelKey] = messages;
            }
        }
        if (cleanedCount > 0) {
            this.logger.logInfo('总共清理超量消息:', cleanedCount, '条');
        }
        return {
            ...data,
            messages: cleanedMessages
        };
    }
    async addMessageToFile(messageInfo) {
        await this.ensureMetadataLoaded();
        const channelKey = `${messageInfo.selfId}:${messageInfo.channelId}`;
        if (!messageInfo.timestamp) {
            messageInfo.timestamp = Date.now();
        }
        const cleanedMessageInfo = await this.utils.cleanBase64ContentAsync(messageInfo, false);
        const pendingMessages = this.pendingMessages.get(channelKey) || [];
        if (pendingMessages.some((message) => message.id === cleanedMessageInfo.id)) {
            return;
        }
        const cachedMessages = this.peekCachedChannelMessages(channelKey);
        if (cachedMessages?.some((message) => message.id === cleanedMessageInfo.id)) {
            return;
        }
        if (!cachedMessages) {
            if (this.hasRecentMessageId(channelKey, cleanedMessageInfo.id)) {
                return;
            }
            const existsInStorage = await this.channelMessageExists(messageInfo.selfId, messageInfo.channelId, cleanedMessageInfo.id);
            if (existsInStorage) {
                return;
            }
        }
        pendingMessages.push(cleanedMessageInfo);
        this.pendingMessages.set(channelKey, pendingMessages);
        this.rememberRecentMessageIds(channelKey, [cleanedMessageInfo.id]);
        if (cleanedMessageInfo.type === 'bot' && cleanedMessageInfo.sending) {
            this.registerPendingBotMessage(channelKey, cleanedMessageInfo.id);
        }
        if (cachedMessages) {
            const nextMessages = this.mergeChannelMessages(cachedMessages, [cleanedMessageInfo]);
            this.setCachedChannelMessages(channelKey, this.limitChannelMessages(nextMessages));
        }
        // 安排写入
        this.scheduleWrite(channelKey);
    }
    async cleanupExcessMessagesInStorage() {
        let cleanedCount = 0;
        for (const channelKey of [...this.dirtyChannelKeys]) {
            const [selfId, channelId] = channelKey.split(':');
            if (!selfId || !channelId) {
                this.dirtyChannelKeys.delete(channelKey);
                continue;
            }
            const indexData = await this.loadOrCreateChannelIndex(selfId, channelId);
            if (indexData.totalMessages <= this.config.maxMessagesPerChannel) {
                this.dirtyChannelKeys.delete(channelKey);
                continue;
            }
            const removedCount = await this.trimChannelToLimit(selfId, channelId, indexData, this.config.maxMessagesPerChannel);
            if (!removedCount) {
                continue;
            }
            cleanedCount += removedCount;
            if (this.peekCachedChannelMessages(channelKey)) {
                this.setCachedChannelMessages(channelKey, await this.loadChannelMessagesNoCache(selfId, channelId));
            }
            this.dirtyChannelKeys.delete(channelKey);
            this.logger.logInfo(`频道 ${channelKey} 清理了 ${removedCount} 条旧消息，保留最新 ${indexData.totalMessages} 条`);
        }
        if (cleanedCount > 0) {
            this.logger.logInfo('定期清理完成，清理了', cleanedCount, '条超量消息');
        }
    }
    async getAllChannelMessageCounts() {
        const counts = {};
        await this.scanStoredChannels(async (entry) => {
            counts[entry.channelKey] = await this.countChannelMessages(entry.selfId, entry.channelId);
        });
        return counts;
    }
    async deleteChannelData(selfId, channelId) {
        await this.ensureMetadataLoaded();
        const channelKey = `${selfId}:${channelId}`;
        const deletedMessages = await this.countChannelMessages(selfId, channelId);
        this.deleteCachedChannelMessages(channelKey);
        this.deleteRecentMessageIds(channelKey);
        this.deletePendingBotMessages(channelKey);
        this.deleteMessageChunkLocations(channelKey);
        this.dirtyChannelKeys.delete(channelKey);
        this.pendingMessages.delete(channelKey);
        const timer = this.writeTimers.get(channelKey);
        if (timer) {
            timer();
            this.writeTimers.delete(channelKey);
        }
        if (this.memoryCache.channels[selfId]?.[channelId]) {
            delete this.memoryCache.channels[selfId][channelId];
            if (!Object.keys(this.memoryCache.channels[selfId]).length) {
                delete this.memoryCache.channels[selfId];
            }
        }
        this.memoryCache.pinnedChannels = this.memoryCache.pinnedChannels.filter((item) => item !== channelKey);
        await this.removeChannelStorage(selfId, channelId);
        this.scheduleMetadataWrite();
        return { deletedMessages };
    }
    async deleteBotData(selfId) {
        await this.ensureMetadataLoaded();
        const botDir = node_path_1.default.join(this.chatHistoryDir, selfId);
        const channels = await this.listBotChannels(selfId);
        let deletedMessages = 0;
        for (const entry of channels) {
            deletedMessages += await this.countChannelMessages(entry.selfId, entry.channelId);
            this.deleteCachedChannelMessages(entry.channelKey);
            this.deleteRecentMessageIds(entry.channelKey);
            this.deletePendingBotMessages(entry.channelKey);
            this.deleteMessageChunkLocations(entry.channelKey);
            this.dirtyChannelKeys.delete(entry.channelKey);
            this.pendingMessages.delete(entry.channelKey);
            const timer = this.writeTimers.get(entry.channelKey);
            if (timer) {
                timer();
                this.writeTimers.delete(entry.channelKey);
            }
        }
        const deletedChannels = channels.length;
        delete this.memoryCache.bots[selfId];
        delete this.memoryCache.channels[selfId];
        this.memoryCache.pinnedBots = this.memoryCache.pinnedBots.filter((item) => item !== selfId);
        this.memoryCache.pinnedChannels = this.memoryCache.pinnedChannels.filter((item) => !item.startsWith(`${selfId}:`));
        try {
            await node_fs_1.promises.rm(botDir, { recursive: true, force: true });
        }
        catch (error) {
            this.logger.error(`删除机器人目录失败 [${selfId}]:`, error);
        }
        this.scheduleMetadataWrite();
        return {
            deletedChannels,
            deletedMessages
        };
    }
    async updateUserProfileInBotData(selfId, userId, userName, avatar) {
        await this.ensureMetadataLoaded();
        let changed = false;
        const botChannels = this.memoryCache.channels[selfId] || {};
        const possibleChannelIds = [
            userId,
            `private:${userId}`,
            `direct:${userId}`
        ];
        for (const channelId of possibleChannelIds) {
            const channel = botChannels[channelId];
            if (!channel || !channel.isDirect || !userName) {
                continue;
            }
            const newName = `私聊（${userName}）`;
            if (channel.name !== newName) {
                channel.name = newName;
                changed = true;
            }
        }
        const channels = await this.listBotChannels(selfId);
        for (const entry of channels) {
            const entryChanged = await this.updateUserProfileInChannel(entry.selfId, entry.channelId, userId, userName, avatar);
            if (!entryChanged) {
                continue;
            }
            if (this.peekCachedChannelMessages(entry.channelKey)) {
                this.setCachedChannelMessages(entry.channelKey, await this.loadChannelMessagesNoCache(entry.selfId, entry.channelId));
            }
            changed = true;
        }
        if (changed) {
            this.scheduleMetadataWrite();
        }
        return changed;
    }
    async markLatestBotMessageAsSent(selfId, channelId, realId) {
        const channelKey = `${selfId}:${channelId}`;
        const tempMessageId = this.peekLatestPendingBotMessageId(channelKey);
        let matched;
        if (tempMessageId) {
            matched = await this.findAndUpdateBotMessageByTempId(selfId, channelId, tempMessageId, realId);
            this.consumePendingBotMessageId(channelKey, tempMessageId);
        }
        if (!matched) {
            matched = await this.findAndUpdateLatestBotMessage(selfId, channelId, realId);
        }
        if (!matched) {
            return undefined;
        }
        const cachedMessages = this.peekCachedChannelMessages(channelKey);
        if (cachedMessages) {
            const cachedMatched = cachedMessages.find((message) => message.id === matched?.id);
            if (cachedMatched) {
                cachedMatched.realId = realId;
                cachedMatched.sending = false;
                this.setCachedChannelMessages(channelKey, cachedMessages);
            }
        }
        return matched;
    }
    async dispose() {
        this.disposed = true;
        // 取消所有定时器
        for (const [channelKey, timer] of this.writeTimers.entries()) {
            timer();
            await this.flushPendingMessages(channelKey);
        }
        this.writeTimers.clear();
        await this.writeQueue;
        await this.utils.dispose();
    }
    createEmptyChatData() {
        return {
            bots: {},
            channels: {},
            messages: {},
            pinnedBots: [],
            pinnedChannels: []
        };
    }
    async ensureMetadataLoaded() {
        if (!this.metadataLoadPromise) {
            this.metadataLoadPromise = this.loadMetadataIntoCache();
        }
        await this.metadataLoadPromise;
    }
    async loadMetadataIntoCache() {
        const metadata = await this.readMetadata();
        this.memoryCache = {
            ...metadata,
            messages: this.getChannelMessagesCacheSnapshot()
        };
    }
    async loadChannelMessages(selfId, channelId) {
        const messages = await this.loadChannelMessagesNoCache(selfId, channelId);
        this.setCachedChannelMessages(`${selfId}:${channelId}`, messages);
        return messages;
    }
    async loadChannelMessagesNoCache(selfId, channelId) {
        const indexData = await this.loadOrCreateChannelIndex(selfId, channelId);
        const channelDirPath = this.getChannelDirPath(selfId, channelId);
        const messages = [];
        const channelKey = `${selfId}:${channelId}`;
        for (const chunk of indexData.chunks) {
            const chunkMessages = await this.readChunkMessages(channelDirPath, chunk.fileName);
            messages.push(...chunkMessages);
            this.rememberMessageChunkLocation(channelKey, chunk.fileName, chunkMessages.map((message) => message.id));
        }
        this.rememberRecentMessageIds(channelKey, messages.slice(-this.getRecentMessageIdCacheLimit()).map((message) => message.id));
        return messages;
    }
    scheduleMetadataWrite() {
        this.enqueueWrite(async () => {
            const { messages, ...metadata } = this.readChatDataFromFile();
            await this.writeMetadata(metadata);
        });
    }
    enqueueWrite(task) {
        if (this.disposed) {
            return;
        }
        this.writeQueue = this.writeQueue
            .then(task)
            .catch((error) => {
            this.logger.error('写入任务失败:', error);
        });
    }
    async listStoredChannels() {
        const result = [];
        await this.scanStoredChannels(async (entry) => {
            result.push(entry);
        });
        return result;
    }
    async listBotChannels(selfId) {
        const result = [];
        await this.scanStoredChannels(async (entry) => {
            if (entry.selfId === selfId) {
                result.push(entry);
            }
        }, selfId);
        return result;
    }
    async scanStoredChannels(visitor, botIdFilter) {
        try {
            const botDirs = await node_fs_1.promises.readdir(this.chatHistoryDir, { withFileTypes: true });
            for (const botEntry of botDirs) {
                const botName = this.normalizeDirentName(botEntry.name);
                if (!botEntry.isDirectory())
                    continue;
                if (botIdFilter && botName !== botIdFilter)
                    continue;
                const botDir = node_path_1.default.join(this.chatHistoryDir, botName);
                const channelEntries = await node_fs_1.promises.readdir(botDir, { withFileTypes: true });
                for (const channelEntry of channelEntries) {
                    const channelId = await this.resolveStoredChannelId(botName, channelEntry);
                    if (!channelId) {
                        continue;
                    }
                    await visitor(this.createStoredChannelEntry(botName, channelId));
                }
            }
        }
        catch (error) {
            if (!this.isFileMissingError(error)) {
                this.logger.error('扫描频道文件失败:', error);
            }
        }
    }
    createStoredChannelEntry(selfId, channelId) {
        const channelDirPath = this.getChannelDirPath(selfId, channelId);
        return {
            selfId,
            channelId,
            channelKey: `${selfId}:${channelId}`,
            channelDirPath,
            indexFilePath: this.getChannelIndexPath(selfId, channelId)
        };
    }
    async resolveStoredChannelId(selfId, entry) {
        const entryName = this.normalizeDirentName(entry.name);
        if (!entry.isDirectory()) {
            return undefined;
        }
        const encodedChannelId = entryName;
        const channelDirPath = node_path_1.default.join(this.chatHistoryDir, selfId, encodedChannelId);
        const indexFilePath = node_path_1.default.join(channelDirPath, 'index.json');
        try {
            const jsonData = await node_fs_1.promises.readFile(indexFilePath, 'utf8');
            const indexData = JSON.parse(jsonData);
            if (typeof indexData.channelId === 'string') {
                return indexData.channelId;
            }
        }
        catch (error) {
            if (!this.isFileMissingError(error)) {
                this.logger.error(`读取频道索引失败 [${selfId}:${entryName}]:`, error);
            }
        }
        return this.decodeChannelId(encodedChannelId);
    }
    getBotDirPath(selfId) {
        return node_path_1.default.join(this.chatHistoryDir, selfId);
    }
    getEncodedChannelId(channelId) {
        return encodeURIComponent(channelId);
    }
    decodeChannelId(encodedChannelId) {
        try {
            return decodeURIComponent(encodedChannelId);
        }
        catch {
            return encodedChannelId;
        }
    }
    normalizeDirentName(name) {
        return typeof name === 'string' ? name : name.toString('utf8');
    }
    getChannelDirPath(selfId, channelId) {
        return node_path_1.default.join(this.getBotDirPath(selfId), this.getEncodedChannelId(channelId));
    }
    getChannelIndexPath(selfId, channelId) {
        return node_path_1.default.join(this.getChannelDirPath(selfId, channelId), 'index.json');
    }
    getChunkFilePath(channelDirPath, fileName) {
        return node_path_1.default.join(channelDirPath, fileName);
    }
    createEmptyChannelIndex(channelId) {
        return {
            version: 1,
            channelId,
            totalMessages: 0,
            nextChunkId: 1,
            chunks: []
        };
    }
    createChunkFileName(chunkId) {
        return `chunk-${String(chunkId).padStart(6, '0')}.json`;
    }
    async loadOrCreateChannelIndex(selfId, channelId) {
        const entry = this.createStoredChannelEntry(selfId, channelId);
        try {
            const jsonData = await node_fs_1.promises.readFile(entry.indexFilePath, 'utf8');
            const indexData = JSON.parse(jsonData);
            const normalizedIndexData = this.normalizeChannelIndex(channelId, indexData);
            this.syncDirtyChannelState(entry.channelKey, normalizedIndexData.totalMessages);
            return normalizedIndexData;
        }
        catch (error) {
            if (!this.isFileMissingError(error)) {
                this.logger.error(`读取频道索引失败 [${entry.channelKey}]:`, error);
            }
        }
        const indexData = this.createEmptyChannelIndex(channelId);
        await this.ensureDir(entry.channelDirPath);
        await this.writeChannelIndex(entry.indexFilePath, indexData);
        this.syncDirtyChannelState(entry.channelKey, indexData.totalMessages);
        return indexData;
    }
    normalizeChannelIndex(channelId, indexData) {
        return {
            version: 1,
            channelId,
            totalMessages: indexData.totalMessages || 0,
            nextChunkId: indexData.nextChunkId || (indexData.chunks?.length || 0) + 1,
            chunks: Array.isArray(indexData.chunks) ? indexData.chunks : []
        };
    }
    async writeChannelIndex(indexFilePath, indexData) {
        await this.ensureDir(node_path_1.default.dirname(indexFilePath));
        await this.atomicWriteTextFile(indexFilePath, JSON.stringify(indexData, null, 2));
    }
    async readChunkMessages(channelDirPath, fileName) {
        try {
            const jsonData = await node_fs_1.promises.readFile(this.getChunkFilePath(channelDirPath, fileName), 'utf8');
            const messages = JSON.parse(jsonData);
            return Array.isArray(messages) ? messages : [];
        }
        catch (error) {
            if (!this.isFileMissingError(error)) {
                this.logger.error(`读取消息分块失败 [${channelDirPath}/${fileName}]:`, error);
            }
            return [];
        }
    }
    async writeChunkMessages(channelDirPath, fileName, messages) {
        await this.ensureDir(channelDirPath);
        await this.atomicWriteTextFile(this.getChunkFilePath(channelDirPath, fileName), JSON.stringify(messages, null, 2));
    }
    async writeMessagesToChunks(channelDirPath, indexData, messages) {
        const oldChunks = [...indexData.chunks];
        indexData.chunks = [];
        indexData.totalMessages = 0;
        indexData.nextChunkId = 1;
        for (let offset = 0; offset < messages.length; offset += this.config.messageChunkSize) {
            const chunkMessages = messages.slice(offset, offset + this.config.messageChunkSize);
            const chunkId = indexData.nextChunkId;
            const fileName = this.createChunkFileName(chunkId);
            await this.writeChunkMessages(channelDirPath, fileName, chunkMessages);
            indexData.chunks.push({ id: chunkId, fileName, messageCount: chunkMessages.length });
            indexData.nextChunkId += 1;
            indexData.totalMessages += chunkMessages.length;
        }
        for (const chunk of oldChunks) {
            try {
                await node_fs_1.promises.unlink(this.getChunkFilePath(channelDirPath, chunk.fileName));
            }
            catch (error) {
                if (!this.isFileMissingError(error)) {
                    this.logger.warn(`删除旧消息分块失败 [${channelDirPath}/${chunk.fileName}]:`, error);
                }
            }
        }
        await this.writeChannelIndex(node_path_1.default.join(channelDirPath, 'index.json'), indexData);
    }
    async appendMessagesToChannel(selfId, channelId, messages) {
        if (!messages.length) {
            return;
        }
        const entry = this.createStoredChannelEntry(selfId, channelId);
        const indexData = await this.loadOrCreateChannelIndex(selfId, channelId);
        await this.ensureDir(entry.channelDirPath);
        let remainingMessages = [...messages];
        const lastChunk = indexData.chunks[indexData.chunks.length - 1];
        if (lastChunk && lastChunk.messageCount < this.config.messageChunkSize) {
            const chunkMessages = await this.readChunkMessages(entry.channelDirPath, lastChunk.fileName);
            const writableCount = this.config.messageChunkSize - chunkMessages.length;
            const appendMessages = remainingMessages.slice(0, writableCount);
            if (appendMessages.length) {
                chunkMessages.push(...appendMessages);
                lastChunk.messageCount = chunkMessages.length;
                indexData.totalMessages += appendMessages.length;
                remainingMessages = remainingMessages.slice(appendMessages.length);
                await this.writeChunkMessages(entry.channelDirPath, lastChunk.fileName, chunkMessages);
                this.rememberMessageChunkLocation(entry.channelKey, lastChunk.fileName, appendMessages.map((message) => message.id));
            }
        }
        while (remainingMessages.length) {
            const chunkMessages = remainingMessages.slice(0, this.config.messageChunkSize);
            const chunkId = indexData.nextChunkId;
            const fileName = this.createChunkFileName(chunkId);
            await this.writeChunkMessages(entry.channelDirPath, fileName, chunkMessages);
            indexData.chunks.push({ id: chunkId, fileName, messageCount: chunkMessages.length });
            indexData.nextChunkId += 1;
            indexData.totalMessages += chunkMessages.length;
            this.rememberMessageChunkLocation(entry.channelKey, fileName, chunkMessages.map((message) => message.id));
            remainingMessages = remainingMessages.slice(chunkMessages.length);
        }
        this.syncDirtyChannelState(entry.channelKey, indexData.totalMessages);
        await this.writeChannelIndex(entry.indexFilePath, indexData);
    }
    async trimChannelToLimit(selfId, channelId, indexData, limit) {
        const entry = this.createStoredChannelEntry(selfId, channelId);
        let overflow = indexData.totalMessages - limit;
        if (overflow <= 0) {
            return 0;
        }
        let removedCount = 0;
        while (overflow > 0 && indexData.chunks.length) {
            const chunk = indexData.chunks[0];
            if (chunk.messageCount <= overflow) {
                const removedChunkMessages = await this.readChunkMessages(entry.channelDirPath, chunk.fileName);
                overflow -= chunk.messageCount;
                removedCount += chunk.messageCount;
                indexData.totalMessages -= chunk.messageCount;
                indexData.chunks.shift();
                this.forgetRecentMessageIds(entry.channelKey, removedChunkMessages.map((message) => message.id));
                this.forgetMessageChunkLocation(entry.channelKey, removedChunkMessages.map((message) => message.id));
                try {
                    await node_fs_1.promises.unlink(this.getChunkFilePath(entry.channelDirPath, chunk.fileName));
                }
                catch (error) {
                    if (!this.isFileMissingError(error)) {
                        this.logger.warn(`删除消息分块失败 [${entry.channelKey}:${chunk.fileName}]:`, error);
                    }
                }
                continue;
            }
            const chunkMessages = await this.readChunkMessages(entry.channelDirPath, chunk.fileName);
            const keptMessages = chunkMessages.slice(overflow);
            const removedMessages = chunkMessages.slice(0, overflow);
            removedCount += overflow;
            indexData.totalMessages -= overflow;
            chunk.messageCount = keptMessages.length;
            overflow = 0;
            this.forgetRecentMessageIds(entry.channelKey, removedMessages.map((message) => message.id));
            this.forgetMessageChunkLocation(entry.channelKey, removedMessages.map((message) => message.id));
            await this.writeChunkMessages(entry.channelDirPath, chunk.fileName, keptMessages);
        }
        this.syncDirtyChannelState(entry.channelKey, indexData.totalMessages);
        await this.writeChannelIndex(entry.indexFilePath, indexData);
        return removedCount;
    }
    async countChannelMessages(selfId, channelId) {
        const entry = this.createStoredChannelEntry(selfId, channelId);
        try {
            const jsonData = await node_fs_1.promises.readFile(entry.indexFilePath, 'utf8');
            const indexData = JSON.parse(jsonData);
            if (typeof indexData.totalMessages === 'number') {
                return indexData.totalMessages;
            }
        }
        catch (error) {
            if (!this.isFileMissingError(error)) {
                this.logger.error(`读取频道索引失败 [${entry.channelKey}]:`, error);
            }
        }
        return 0;
    }
    async removeChannelStorage(selfId, channelId) {
        const entry = this.createStoredChannelEntry(selfId, channelId);
        try {
            await node_fs_1.promises.rm(entry.channelDirPath, { recursive: true, force: true });
        }
        catch (error) {
            this.logger.error(`删除频道目录失败 [${entry.channelKey}]:`, error);
        }
    }
    async updateUserProfileInChannel(selfId, channelId, userId, userName, avatar) {
        const entry = this.createStoredChannelEntry(selfId, channelId);
        const indexData = await this.loadOrCreateChannelIndex(selfId, channelId);
        let changed = false;
        for (const chunk of indexData.chunks) {
            const messages = await this.readChunkMessages(entry.channelDirPath, chunk.fileName);
            let chunkChanged = false;
            for (const message of messages) {
                if (message.userId !== userId) {
                    continue;
                }
                if (userName && message.username !== userName) {
                    message.username = userName;
                    chunkChanged = true;
                }
                if (avatar && message.avatar !== avatar) {
                    message.avatar = avatar;
                    chunkChanged = true;
                }
            }
            if (!chunkChanged) {
                continue;
            }
            await this.writeChunkMessages(entry.channelDirPath, chunk.fileName, messages);
            changed = true;
        }
        return changed;
    }
    async findAndUpdateLatestBotMessage(selfId, channelId, realId) {
        const entry = this.createStoredChannelEntry(selfId, channelId);
        const indexData = await this.loadOrCreateChannelIndex(selfId, channelId);
        for (let index = indexData.chunks.length - 1; index >= 0; index -= 1) {
            const chunk = indexData.chunks[index];
            const messages = await this.readChunkMessages(entry.channelDirPath, chunk.fileName);
            const matched = [...messages].reverse().find((message) => message.type === 'bot' && message.sending);
            if (!matched) {
                continue;
            }
            matched.realId = realId;
            matched.sending = false;
            await this.writeChunkMessages(entry.channelDirPath, chunk.fileName, messages);
            return matched;
        }
        return undefined;
    }
    async findAndUpdateBotMessageByTempId(selfId, channelId, tempMessageId, realId) {
        const channelKey = `${selfId}:${channelId}`;
        const pendingMessages = this.pendingMessages.get(channelKey);
        const pendingMatched = pendingMessages?.find((message) => message.id === tempMessageId);
        if (pendingMatched) {
            pendingMatched.realId = realId;
            pendingMatched.sending = false;
            return pendingMatched;
        }
        const cachedMessages = this.peekCachedChannelMessages(channelKey);
        const cachedMatched = cachedMessages?.find((message) => message.id === tempMessageId);
        if (cachedMatched) {
            cachedMatched.realId = realId;
            cachedMatched.sending = false;
            this.setCachedChannelMessages(channelKey, cachedMessages);
        }
        const entry = this.createStoredChannelEntry(selfId, channelId);
        const chunkFileName = this.getMessageChunkLocation(channelKey, tempMessageId);
        if (chunkFileName) {
            const chunkMessages = await this.readChunkMessages(entry.channelDirPath, chunkFileName);
            const matched = chunkMessages.find((message) => message.id === tempMessageId);
            if (matched) {
                matched.realId = realId;
                matched.sending = false;
                await this.writeChunkMessages(entry.channelDirPath, chunkFileName, chunkMessages);
                return matched;
            }
        }
        const indexData = await this.loadOrCreateChannelIndex(selfId, channelId);
        for (let index = indexData.chunks.length - 1; index >= 0; index -= 1) {
            const chunk = indexData.chunks[index];
            const chunkMessages = await this.readChunkMessages(entry.channelDirPath, chunk.fileName);
            const matched = chunkMessages.find((message) => message.id === tempMessageId);
            if (!matched) {
                continue;
            }
            matched.realId = realId;
            matched.sending = false;
            await this.writeChunkMessages(entry.channelDirPath, chunk.fileName, chunkMessages);
            this.rememberMessageChunkLocation(channelKey, chunk.fileName, [matched.id]);
            return matched;
        }
        return cachedMatched;
    }
    deduplicateMessages(messages) {
        const seen = new Set();
        const deduplicated = [];
        for (const message of messages) {
            if (seen.has(message.id)) {
                continue;
            }
            seen.add(message.id);
            deduplicated.push(message);
        }
        return deduplicated;
    }
    getCachedChannelMessages(channelKey) {
        const cached = this.channelMessagesCache.get(channelKey);
        if (!cached) {
            return undefined;
        }
        this.channelMessagesCache.delete(channelKey);
        this.channelMessagesCache.set(channelKey, cached);
        this.memoryCache.messages = this.getChannelMessagesCacheSnapshot();
        return cached;
    }
    peekCachedChannelMessages(channelKey) {
        return this.channelMessagesCache.get(channelKey);
    }
    setCachedChannelMessages(channelKey, messages) {
        this.channelMessagesCache.delete(channelKey);
        this.channelMessagesCache.set(channelKey, messages);
        this.rememberRecentMessageIds(channelKey, messages.slice(-this.getRecentMessageIdCacheLimit()).map((message) => message.id));
        while (this.channelMessagesCache.size > this.config.channelCacheLimit) {
            const oldestKey = this.channelMessagesCache.keys().next().value;
            if (!oldestKey) {
                break;
            }
            this.channelMessagesCache.delete(oldestKey);
            this.deleteRecentMessageIds(oldestKey);
            this.deleteMessageChunkLocations(oldestKey);
        }
        this.memoryCache.messages = this.getChannelMessagesCacheSnapshot();
    }
    deleteCachedChannelMessages(channelKey) {
        this.channelMessagesCache.delete(channelKey);
        delete this.memoryCache.messages[channelKey];
    }
    getChannelMessagesCacheSnapshot() {
        return Object.fromEntries(this.channelMessagesCache.entries());
    }
    mergeChannelMessages(baseMessages, appendedMessages) {
        const merged = [...baseMessages];
        const knownIds = new Set(baseMessages.map((message) => message.id));
        for (const message of appendedMessages) {
            if (knownIds.has(message.id)) {
                continue;
            }
            knownIds.add(message.id);
            merged.push(message);
        }
        return merged;
    }
    limitChannelMessages(messages) {
        if (messages.length <= this.config.maxMessagesPerChannel) {
            return messages;
        }
        return [...messages]
            .sort((left, right) => left.timestamp - right.timestamp)
            .slice(-this.config.maxMessagesPerChannel);
    }
    async channelMessageExists(selfId, channelId, messageId) {
        const entry = this.createStoredChannelEntry(selfId, channelId);
        const channelKey = entry.channelKey;
        if (this.hasRecentMessageId(channelKey, messageId)) {
            return true;
        }
        const indexData = await this.loadOrCreateChannelIndex(selfId, channelId);
        for (let chunkIndex = indexData.chunks.length - 1; chunkIndex >= 0; chunkIndex -= 1) {
            const chunk = indexData.chunks[chunkIndex];
            const messages = await this.readChunkMessages(entry.channelDirPath, chunk.fileName);
            if (messages.some((message) => message.id === messageId)) {
                this.rememberRecentMessageIds(channelKey, [messageId]);
                return true;
            }
        }
        return false;
    }
    syncDirtyChannelState(channelKey, totalMessages) {
        if (totalMessages > this.config.maxMessagesPerChannel) {
            this.dirtyChannelKeys.add(channelKey);
            return;
        }
        this.dirtyChannelKeys.delete(channelKey);
    }
    registerPendingBotMessage(channelKey, messageId) {
        const messageIds = this.pendingBotMessageIds.get(channelKey) || [];
        messageIds.push(messageId);
        this.pendingBotMessageIds.set(channelKey, messageIds);
    }
    peekLatestPendingBotMessageId(channelKey) {
        const messageIds = this.pendingBotMessageIds.get(channelKey);
        return messageIds?.[messageIds.length - 1];
    }
    consumePendingBotMessageId(channelKey, messageId) {
        const messageIds = this.pendingBotMessageIds.get(channelKey);
        if (!messageIds?.length) {
            return;
        }
        const nextMessageIds = messageIds.filter((id) => id !== messageId);
        if (nextMessageIds.length) {
            this.pendingBotMessageIds.set(channelKey, nextMessageIds);
            return;
        }
        this.pendingBotMessageIds.delete(channelKey);
    }
    deletePendingBotMessages(channelKey) {
        this.pendingBotMessageIds.delete(channelKey);
    }
    getRecentMessageIdCacheLimit() {
        return Math.max(this.RECENT_MESSAGE_ID_CACHE_SIZE, this.config.messageChunkSize * 2);
    }
    rememberRecentMessageIds(channelKey, messageIds) {
        if (!messageIds.length) {
            return;
        }
        const nextMessageIds = [...(this.recentMessageIdsCache.get(channelKey) || [])];
        for (const messageId of messageIds) {
            const existingIndex = nextMessageIds.indexOf(messageId);
            if (existingIndex !== -1) {
                nextMessageIds.splice(existingIndex, 1);
            }
            nextMessageIds.push(messageId);
        }
        const maxSize = this.getRecentMessageIdCacheLimit();
        this.recentMessageIdsCache.set(channelKey, nextMessageIds.slice(-maxSize));
    }
    forgetRecentMessageIds(channelKey, messageIds) {
        const currentMessageIds = this.recentMessageIdsCache.get(channelKey);
        if (!currentMessageIds?.length || !messageIds.length) {
            return;
        }
        const nextMessageIds = currentMessageIds.filter((messageId) => !messageIds.includes(messageId));
        if (nextMessageIds.length) {
            this.recentMessageIdsCache.set(channelKey, nextMessageIds);
            return;
        }
        this.recentMessageIdsCache.delete(channelKey);
    }
    hasRecentMessageId(channelKey, messageId) {
        const currentMessageIds = this.recentMessageIdsCache.get(channelKey);
        return !!currentMessageIds?.includes(messageId);
    }
    deleteRecentMessageIds(channelKey) {
        this.recentMessageIdsCache.delete(channelKey);
    }
    rememberMessageChunkLocation(channelKey, chunkFileName, messageIds) {
        if (!messageIds.length) {
            return;
        }
        const currentLocations = this.messageChunkLocationCache.get(channelKey) || new Map();
        for (const messageId of messageIds) {
            currentLocations.set(messageId, chunkFileName);
        }
        this.messageChunkLocationCache.set(channelKey, currentLocations);
    }
    forgetMessageChunkLocation(channelKey, messageIds) {
        const currentLocations = this.messageChunkLocationCache.get(channelKey);
        if (!currentLocations || !messageIds.length) {
            return;
        }
        for (const messageId of messageIds) {
            currentLocations.delete(messageId);
        }
        if (!currentLocations.size) {
            this.messageChunkLocationCache.delete(channelKey);
        }
    }
    getMessageChunkLocation(channelKey, messageId) {
        return this.messageChunkLocationCache.get(channelKey)?.get(messageId);
    }
    deleteMessageChunkLocations(channelKey) {
        this.messageChunkLocationCache.delete(channelKey);
    }
    isSameBotInfo(left, right) {
        return left.selfId === right.selfId
            && left.platform === right.platform
            && left.username === right.username
            && left.avatar === right.avatar
            && left.status === right.status;
    }
    isSameChannelInfo(left, right) {
        return left.id === right.id
            && left.name === right.name
            && left.type === right.type
            && left.channelId === right.channelId
            && left.guildName === right.guildName
            && left.isDirect === right.isDirect
            && JSON.stringify(left.botState || null) === JSON.stringify(right.botState || null);
    }
    isFileMissingError(error) {
        return typeof error === 'object'
            && error !== null
            && 'code' in error
            && error.code === 'ENOENT';
    }
    async atomicWriteTextFile(filePath, content) {
        const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
        await node_fs_1.promises.writeFile(tempFilePath, content, 'utf8');
        try {
            await node_fs_1.promises.rename(tempFilePath, filePath);
        }
        catch (error) {
            if (this.isAtomicRenameReplaceError(error)) {
                await node_fs_1.promises.rm(filePath, { force: true });
                await node_fs_1.promises.rename(tempFilePath, filePath);
                return;
            }
            try {
                await node_fs_1.promises.rm(tempFilePath, { force: true });
            }
            catch {
                // 忽略临时文件清理失败，保留原始错误即可。
            }
            throw error;
        }
    }
    isAtomicRenameReplaceError(error) {
        return typeof error === 'object'
            && error !== null
            && 'code' in error
            && (error.code === 'EEXIST' || error.code === 'EPERM');
    }
}
exports.FileManager = FileManager;
