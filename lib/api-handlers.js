"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiHandlers = void 0;
const koishi_1 = require("koishi");
const node_url_1 = require("node:url");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const mime = __importStar(require("mime-types"));
class ApiHandlers {
    constructor(ctx, config, fileManager, messageHandler, logger) {
        this.ctx = ctx;
        this.config = config;
        this.fileManager = fileManager;
        this.messageHandler = messageHandler;
        this.logger = logger;
        this.currentTempVideo = null;
    }
    // URL 解码（含 HTML 实体转义），解码失败原样返回
    safeDecode(value) {
        try {
            return decodeURIComponent(value).replace(/&quot;/g, '"');
        }
        catch {
            return value;
        }
    }
    // 把文本消息里的 <qqbot-cmd-input text="..." show="..." reference="..." /> 转换为可见文本 /show，
    // 否则 QQ 适配器会丢弃未知元素导致消息发不出去。
    convertCmdInputTags(text) {
        if (!/<qqbot-cmd-input\b/i.test(text))
            return text;
        return String(text).replace(/<qqbot-cmd-input\b([^>]*?)\/>/gi, (raw, attrs) => {
            const get = (k) => {
                const m = new RegExp(`${k}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
                return m ? this.safeDecode(m[1]) : '';
            };
            const textValue = get('text');
            const show = get('show') || textValue;
            if (!textValue)
                return raw;
            return `/${show}`;
        });
    }
    registerApiHandlers() {
        this.ctx.console.addListener('clear-all-indexeddb-data', async () => {
            try {
                this.logInfo('收到清空 IndexedDB 数据请求');
                return { success: true, message: '可以清空 IndexedDB' };
            }
            catch (error) {
                this.logger.error('清空 IndexedDB 数据失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('get-chat-data', async () => {
            try {
                // 只读取元数据，不加载消息到内存
                const data = await this.fileManager.readMetadataOnly();
                this.logInfo('获取基础聊天数据（仅元数据）');
                return {
                    success: true,
                    data: {
                        bots: data.bots || {},
                        channels: data.channels || {},
                        pinnedBots: data.pinnedBots || [],
                        pinnedChannels: data.pinnedChannels || [],
                        // 不返回消息数据，由前端按需加载
                        messages: {}
                    }
                };
            }
            catch (error) {
                this.logger.error('获取聊天数据失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('get-history-messages', async (requestData) => {
            try {
                const limit = Math.max(1, requestData.limit ?? this.config.messageChunkSize);
                const result = await this.fileManager.readChannelMessagesPage(requestData.selfId, requestData.channelId, limit, requestData.offset || 0);
                this.logInfo('获取历史消息:', `${requestData.selfId}:${requestData.channelId}`, '共', result.messages.length, '条消息');
                return {
                    success: true,
                    messages: result.messages,
                    total: result.total
                };
            }
            catch (error) {
                this.logger.error('获取历史消息失败:', error);
                return { success: false, error: this.getClientErrorMessage(error), messages: [], total: 0 };
            }
        });
        this.ctx.console.addListener('get-all-channel-message-counts', async () => {
            try {
                const counts = await this.fileManager.getAllChannelMessageCounts();
                this.logInfo('获取所有频道消息数量:', {
                    频道数: Object.keys(counts).length,
                    总消息数: Object.values(counts).reduce((total, count) => total + count, 0)
                });
                return {
                    success: true,
                    counts: counts
                };
            }
            catch (error) {
                this.logger.error('获取频道消息数量失败:', error);
                return { success: false, error: this.getClientErrorMessage(error), counts: {} };
            }
        });
        this.ctx.console.addListener('fetch-image', async (data) => {
            try {
                // 如果已经是本地媒体路径，直接返回
                if (data.url.includes('/vite/@fs/') || data.url.includes('/qq-chat/media/')) {
                    return {
                        success: true,
                        viteUrl: data.url
                    };
                }
                // 如果是本地文件 URL，转换为网络地址
                if (this.isFileUrl(data.url)) {
                    this.logInfo('处理本地文件请求:', data.url);
                    const filePath = require('node:url').fileURLToPath(data.url);
                    const mediaRoot = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat');
                    const relative = node_path_1.default.relative(mediaRoot, filePath).replace(/\\/g, '/');
                    return {
                        success: true,
                        viteUrl: `/qq-chat/media/${relative}`
                    };
                }
                // 网络图片：下载并缓存到本地，返回网络地址
                const dir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'persist-media', 'images');
                await node_fs_1.promises.mkdir(dir, { recursive: true });
                const hash = (0, node_crypto_1.createHash)('md5').update(data.url).digest('hex');
                const ext = node_path_1.default.extname(new node_url_1.URL(data.url).pathname) || '.jpg';
                const filename = `${hash}${ext}`;
                const filePath = node_path_1.default.join(dir, filename);
                const mediaRoot = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat');
                const toViteUrl = (targetPath) => {
                    const relative = node_path_1.default.relative(mediaRoot, targetPath).replace(/\\/g, '/');
                    return `/qq-chat/media/${relative}`;
                };
                // 语音优先：若该 URL 已按音频缓存过，直接复用，避免重复下载 / 被误存为图片
                const audioCached = await this.messageHandler.getCachedMediaUrl(data.url, 'audio');
                if (audioCached)
                    return { success: true, viteUrl: audioCached };
                // 已缓存文件：读取文件头校验真实内容，防止语音被误缓存为 .jpg
                if (await this.fileExists(filePath)) {
                    const head = await this.readFileHead(filePath, 64);
                    if (head && this.isAudioBuffer(head)) {
                        const existing = await node_fs_1.promises.readFile(filePath);
                        const viteUrl = await this.messageHandler.downloadAndCacheMedia(data.url, 'audio', existing);
                        return { success: true, viteUrl };
                    }
                    return { success: true, viteUrl: toViteUrl(filePath) };
                }
                // 下载
                const response = await fetch(data.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Referer': ''
                    }
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const buffer = Buffer.from(await response.arrayBuffer());
                // 按内容识别：QQ 语音消息的 URL 可能以 .jpg 结尾，实际内容却是音频
                if (this.isAudioBuffer(buffer)) {
                    const viteUrl = await this.messageHandler.downloadAndCacheMedia(data.url, 'audio', buffer);
                    return { success: true, viteUrl };
                }
                await node_fs_1.promises.writeFile(filePath, buffer);
                return { success: true, viteUrl: toViteUrl(filePath) };
            }
            catch (error) {
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 获取机器人在群内的状态（是否接收主动推送 / 群成员角色），并持久化到频道信息
        this.ctx.console.addListener('get-bot-state', async (data) => {
            try {
                const bots = this.ctx.bots;
                const bot = (Array.isArray(bots) && bots.find((b) => b.selfId === data.selfId))
                    || bots?.get?.(data.selfId)
                    || bots?.[data.selfId];
                if (!bot)
                    return { success: false, error: '机器人不存在' };
                const fetchState = bot?.internal?.getBotGroupState
                    ? () => bot.internal.getBotGroupState(data.channelId)
                    : typeof bot?.refreshBotGroupState === 'function'
                        ? () => bot.refreshBotGroupState(data.channelId)
                        : null;
                if (!fetchState)
                    return { success: false, error: '当前适配器不支持获取群内状态' };
                const state = await fetchState();
                // 查询群禁言状态（全员禁言），机器人需管理员身份，失败不影响主结果
                let globalMuted;
                try {
                    if (bot?.internal?.getRestrictChatSetting) {
                        const setting = await bot.internal.getRestrictChatSetting(data.channelId);
                        globalMuted = this.messageHandler.computeGlobalMuted(setting);
                    }
                }
                catch (error) {
                    this.logInfo('查询群禁言状态失败:', error);
                }
                const botState = {
                    memberRole: state.member_role,
                    allowProactiveMsg: state.allow_proactive_msg,
                    recvMsgSetting: state.recv_msg_setting,
                    joinedAt: state.joined_at,
                    memberOpenid: state.member_openid,
                    inGroup: true,
                    globalMuted
                };
                const existing = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                const channelInfo = {
                    ...(existing || { id: data.channelId, name: data.channelId, type: 0, channelId: data.channelId }),
                    botState
                };
                await this.fileManager.upsertChannelInfo(data.selfId, data.channelId, channelInfo);
                this.ctx.console.broadcast('chat-data-updated', {
                    channel: { selfId: data.selfId, channelId: data.channelId, channelInfo }
                });
                return { success: true, botState };
            }
            catch (error) {
                // 鉴权失败、机器人非群成员 => 机器人已被移出该群，前端显示“已退群”
                if (this.messageHandler.isNotGroupMemberError(error)) {
                    const botState = { inGroup: false };
                    const existing = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                    const channelInfo = {
                        ...(existing || { id: data.channelId, name: data.channelId, type: 0, channelId: data.channelId }),
                        botState
                    };
                    await this.fileManager.upsertChannelInfo(data.selfId, data.channelId, channelInfo);
                    this.ctx.console.broadcast('chat-data-updated', {
                        channel: { selfId: data.selfId, channelId: data.channelId, channelInfo }
                    });
                    return { success: true, botState };
                }
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 清理历史记录 API 已废弃，现在直接通过右键删除频道数据
        this.ctx.console.addListener('clear-channel-history', async (data) => {
            try {
                this.logInfo('收到清理历史记录请求（已废弃，建议使用删除频道数据）:', data);
                const channelKey = `${data.selfId}:${data.channelId}`;
                const { deletedMessages } = await this.fileManager.deleteChannelData(data.selfId, data.channelId);
                if (!deletedMessages) {
                    return { success: true, message: '频道没有历史消息' };
                }
                this.logInfo(`频道 ${channelKey} 历史记录已清空:`, {
                    清理消息数: deletedMessages
                });
                return {
                    success: true,
                    message: `成功清理 ${deletedMessages} 条历史消息`,
                    clearedCount: deletedMessages,
                    keptCount: 0
                };
            }
            catch (error) {
                this.logger.error('清理频道历史记录失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('send-message', async (data) => {
            try {
                this.logInfo('收到发送消息请求:', data);
                const bot = this.ctx.bots.find((bot) => bot.selfId === data.selfId || bot.user?.id === data.selfId);
                if (!bot) {
                    this.logger.error('未找到机器人:', data.selfId, '当前可用机器人:', this.ctx.bots.map((b) => b.selfId));
                    return { success: false, error: `未找到机器人 ${data.selfId}，请检查机器人是否在线` };
                }
                if (bot.status !== 1 /* Universal.Status.ONLINE */) {
                    this.logger.error('机器人离线:', data.selfId, '状态:', bot.status);
                    return { success: false, error: `机器人 ${data.selfId} 当前离线` };
                }
                // 检查机器人在该群的状态：已被移出或未开启主动推送权限时给出明确提示
                const cachedChannel = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                const botState = cachedChannel?.botState;
                if (botState?.inGroup === false) {
                    return { success: false, error: '机器人已不在该群（可能被移出），无法发送消息' };
                }
                let warning;
                if (botState?.allowProactiveMsg === false) {
                    warning = '该群未开启机器人主动推送权限，消息可能无法发送';
                    this.logger.warn(warning, { selfId: data.selfId, channelId: data.channelId });
                }
                // 剔除 face 表情文本（<faceType=...> 与 [face:n]）
                let messageContent = String(data.content || '').replace(/<face[^>]*>/gi, '').replace(/\[face:\d+\]/gi, '');
                if (data.images && data.images.length > 0) {
                    const tempDir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'temp');
                    const tempFiles = await this.safeReadDir(tempDir);
                    for (const image of data.images) {
                        const files = tempFiles.filter((file) => file.includes(`temp_${image.tempId}`));
                        if (files.length > 0) {
                            const imagePath = node_path_1.default.join(tempDir, files[0]);
                            const fileUrl = this.createMediaUrl(imagePath);
                            messageContent += koishi_1.h.image(fileUrl).toString();
                            this.logInfo('添加图片到消息:', { imagePath, fileUrl });
                        }
                    }
                }
                // 音频 / 视频 / 文件：从临时目录读取并构建对应元素
                if (data.files && data.files.length > 0) {
                    const tempDir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'temp');
                    const tempFiles = await this.safeReadDir(tempDir);
                    for (const file of data.files) {
                        const matched = tempFiles.filter((f) => f.includes(`temp_${file.tempId}`));
                        if (matched.length > 0) {
                            const filePath = node_path_1.default.join(tempDir, matched[0]);
                            const fileUrl = this.createMediaUrl(filePath);
                            const type = file.type || 'file';
                            const attrs = { src: fileUrl, filename: String(file.filename || 'file').replace(/"/g, '&quot;') };
                            if (type === 'audio') {
                                messageContent += (0, koishi_1.h)('audio', attrs).toString();
                            }
                            else if (type === 'video') {
                                messageContent += (0, koishi_1.h)('video', attrs).toString();
                            }
                            else {
                                messageContent += (0, koishi_1.h)('file', attrs).toString();
                            }
                            this.logInfo(`添加${type}到消息:`, { filePath, fileUrl });
                        }
                    }
                }
                const parsedContent = koishi_1.h.parse(this.convertCmdInputTags(messageContent));
                this.messageHandler.setCorrectChannelId(data.selfId, data.channelId);
                const result = await bot.sendMessage(data.channelId, parsedContent);
                this.logInfo('消息发送成功:', result);
                const messageId = Array.isArray(result) ? result[0] : result;
                if (messageId) {
                    const channelKey = `${data.selfId}:${data.channelId}`;
                    const msg = await this.fileManager.markLatestBotMessageAsSent(data.selfId, data.channelId, messageId);
                    if (msg) {
                        this.ctx.console.broadcast('bot-message-updated', {
                            channelKey,
                            tempId: msg.id,
                            realId: messageId
                        });
                    }
                }
                return {
                    success: !!messageId,
                    messageId: messageId,
                    tempImageIds: data.images?.map(img => img.tempId) || [],
                    warning
                };
            }
            catch (error) {
                this.logger.error('发送消息失败:', error);
                // 机器人被禁言（全体禁言）：更新群状态并给出友好提示
                if (this.isBotMutedError(error)) {
                    const cached = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                    const channelInfo = {
                        ...(cached || { id: data.channelId, name: data.channelId, type: 0, channelId: data.channelId }),
                        botState: {
                            ...(cached?.botState || {}),
                            globalMuted: true
                        }
                    };
                    await this.fileManager.upsertChannelInfo(data.selfId, data.channelId, channelInfo);
                    this.ctx.console.broadcast('chat-data-updated', {
                        channel: { selfId: data.selfId, channelId: data.channelId, channelInfo }
                    });
                    return { success: false, error: '消息发送失败：机器人被禁言（全体禁言中）' };
                }
                // 无主动消息权限（40034105）：更新群状态并给出友好提示
                if (this.isNoProactivePermissionError(error)) {
                    const cached = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                    const channelInfo = {
                        ...(cached || { id: data.channelId, name: data.channelId, type: 0, channelId: data.channelId }),
                        botState: {
                            ...(cached?.botState || {}),
                            allowProactiveMsg: false
                        }
                    };
                    await this.fileManager.upsertChannelInfo(data.selfId, data.channelId, channelInfo);
                    this.ctx.console.broadcast('chat-data-updated', {
                        channel: { selfId: data.selfId, channelId: data.channelId, channelInfo }
                    });
                    return { success: false, error: '消息发送失败：机器人无主动消息权限（需群内开启主动推送权限）' };
                }
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 发送 QQ 原生经典表情：直接把本地 qq_emoji/{faceId}/png/{faceId}.png 当图片发送
        this.ctx.console.addListener('send-qq-emoji', async (data) => {
            try {
                this.logInfo('收到发送 QQ 表情请求:', data);
                const faceId = String(data.faceId || '').replace(/\D+/g, '');
                if (!faceId)
                    return { success: false, error: '无效的表情 ID' };
                const faceType = String(data.faceType || '1');
                const bot = this.ctx.bots.find((bot) => bot.selfId === data.selfId || bot.user?.id === data.selfId);
                if (!bot) {
                    this.logger.error('未找到机器人:', data.selfId);
                    return { success: false, error: `未找到机器人 ${data.selfId}，请检查机器人是否在线` };
                }
                if (bot.status !== 1 /* Universal.Status.ONLINE */) {
                    this.logger.error('机器人离线:', data.selfId, '状态:', bot.status);
                    return { success: false, error: `机器人 ${data.selfId} 当前离线` };
                }
                const cachedChannel = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                const botState = cachedChannel?.botState;
                if (botState?.inGroup === false) {
                    return { success: false, error: '机器人已不在该群（可能被移出），无法发送消息' };
                }
                let warning;
                if (botState?.allowProactiveMsg === false) {
                    warning = '该群未开启机器人主动推送权限，消息可能无法发送';
                    this.logger.warn(warning, { selfId: data.selfId, channelId: data.channelId });
                }
                // 表情图片直接使用公网资源（无需本地 qq_emoji 目录）：优先动图 apng
                const sourceUrl = `https://koishi.js.org/QFace/assets/qq_emoji/${faceId}/apng/${faceId}.png`;
                // 用 assets 服务把网络 apng 转存为 QQ 可访问的公网 URL
                const emojiUrl = await this.uploadEmojiToAssets(sourceUrl, faceId);
                this.logInfo('QQ 表情 assets 上传成功:', { faceId, sourceUrl, emojiUrl });
                // 以 markdown 图片消息发送（QQ 端显示 apng 动图）
                const mdContent = `![QQ表情](${emojiUrl})`;
                const mdRequest = {
                    msg_type: 2,
                    markdown: { content: mdContent }
                };
                this.messageHandler.setCorrectChannelId(data.selfId, data.channelId);
                const result = await bot.internal.sendMessage(data.channelId, mdRequest);
                this.logInfo('QQ 表情(markdown)发送成功:', { faceId, emojiUrl, result });
                const messageId = Array.isArray(result) ? result[0] : result?.id || result;
                if (messageId) {
                    // 记录并广播，使消息显示在聊天列表（前端按 markdown 渲染图片）
                    const cached = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                    const timestamp = Date.now();
                    const messageInfo = {
                        id: `bot-${timestamp}`,
                        content: mdContent,
                        userId: data.selfId,
                        username: bot.user?.name || `Bot-${data.selfId}`,
                        avatar: bot.user?.avatar,
                        timestamp,
                        channelId: data.channelId,
                        selfId: data.selfId,
                        elements: [{ type: 'markdown', attrs: { content: mdContent }, children: [] }],
                        type: 'bot',
                        guildName: cached?.guildName,
                        platform: 'qq',
                        isDirect: false,
                        realId: messageId
                    };
                    await this.fileManager.addMessageToFile(messageInfo);
                    this.ctx.console.broadcast('chat-bot-message-event', {
                        type: 'bot',
                        selfId: data.selfId,
                        platform: 'qq',
                        channelId: data.channelId,
                        messageId,
                        content: mdContent,
                        userId: data.selfId,
                        username: bot.user?.name || `Bot-${data.selfId}`,
                        avatar: bot.user?.avatar,
                        timestamp,
                        guildName: cached?.guildName,
                        channelType: 0,
                        elements: messageInfo.elements,
                        isDirect: false,
                        bot: { avatar: bot.user?.avatar, name: bot.user?.name }
                    });
                }
                return {
                    success: !!messageId,
                    messageId: messageId,
                    warning
                };
            }
            catch (error) {
                this.logger.error('发送 QQ 表情失败:', error);
                if (this.isBotMutedError(error)) {
                    const cached = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                    const channelInfo = {
                        ...(cached || { id: data.channelId, name: data.channelId, type: 0, channelId: data.channelId }),
                        botState: {
                            ...(cached?.botState || {}),
                            globalMuted: true
                        }
                    };
                    await this.fileManager.upsertChannelInfo(data.selfId, data.channelId, channelInfo);
                    this.ctx.console.broadcast('chat-data-updated', {
                        channel: { selfId: data.selfId, channelId: data.channelId, channelInfo }
                    });
                    return { success: false, error: '表情发送失败：机器人被禁言（全体禁言中）' };
                }
                if (this.isNoProactivePermissionError(error)) {
                    const cached = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                    const channelInfo = {
                        ...(cached || { id: data.channelId, name: data.channelId, type: 0, channelId: data.channelId }),
                        botState: {
                            ...(cached?.botState || {}),
                            allowProactiveMsg: false
                        }
                    };
                    await this.fileManager.upsertChannelInfo(data.selfId, data.channelId, channelInfo);
                    this.ctx.console.broadcast('chat-data-updated', {
                        channel: { selfId: data.selfId, channelId: data.channelId, channelInfo }
                    });
                    return { success: false, error: '表情发送失败：机器人无主动消息权限（需群内开启主动推送权限）' };
                }
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 撤回消息（调用 QQ 官方 DELETE /v2/groups/{group_openid}/messages/{message_id}）
        this.ctx.console.addListener('recall-message', async (data) => {
            try {
                this.logInfo('收到撤回消息请求:', data);
                const bot = this.ctx.bots.find((bot) => bot.selfId === data.selfId || bot.user?.id === data.selfId);
                if (!bot) {
                    return { success: false, error: `未找到机器人 ${data.selfId}` };
                }
                if (typeof bot.deleteMessage !== 'function') {
                    return { success: false, error: '当前平台不支持撤回消息' };
                }
                await bot.deleteMessage(data.channelId, data.messageId);
                this.logInfo('撤回消息成功:', { channelId: data.channelId, messageId: data.messageId });
                return { success: true };
            }
            catch (error) {
                this.logger.error('撤回消息失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 设置群成员禁言（调用 QQ 官方 POST /v2/groups/{group_openid}/restrict_chat_setting）
        // muteExpireAt: 禁言到期时间（毫秒时间戳 / RFC3339 字符串）；传 null/空 表示立即解除禁言
        this.ctx.console.addListener('mute-user', async (data) => {
            try {
                const bot = this.ctx.bots.find((bot) => bot.selfId === data.selfId || bot.user?.id === data.selfId);
                if (!bot)
                    return { success: false, error: `未找到机器人 ${data.selfId}` };
                if (!bot.internal?.setRestrictChatSetting) {
                    return { success: false, error: '当前适配器不支持设置群成员禁言' };
                }
                const expire = data.muteExpireAt;
                const isUnmute = expire == null || expire === '';
                const mute_expire_at = isUnmute ? '' : typeof expire === 'number' ? this.toRfc3339(expire) : String(expire);
                await bot.internal.setRestrictChatSetting(data.channelId, {
                    members: [{
                            op: isUnmute ? 'del' : 'add',
                            member_openid: data.memberOpenid,
                            mute_expire_at
                        }]
                });
                this.logInfo(isUnmute ? '解除群成员禁言成功:' : '设置群成员禁言成功:', { channelId: data.channelId, memberOpenid: data.memberOpenid, mute_expire_at });
                return { success: true };
            }
            catch (error) {
                this.logger.error('设置群成员禁言失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 查询群成员身份（群主/管理员/成员），用于右键菜单控制撤回/禁言等操作的显示
        this.ctx.console.addListener('get-member-role', async (data) => {
            try {
                const bot = this.ctx.bots.find((b) => b.selfId === data.selfId || b.user?.id === data.selfId);
                if (!bot)
                    return { success: false, error: `未找到机器人 ${data.selfId}` };
                // 成员身份查询依赖 QQ 适配器 Bot 上的 http 客户端与鉴权方法（基础 Bot 类型未包含）
                const qqBot = bot;
                if (!qqBot.http?.get)
                    return { success: false, error: '当前适配器不支持查询成员身份' };
                await qqBot.prepareRequestAuthorization?.();
                const result = await qqBot.http.get(`/v2/groups/${data.channelId}/members/${data.memberOpenid}`);
                const body = result?.data ?? result ?? {};
                const role = ['owner', 'admin', 'member'].includes(body?.member_role) ? body.member_role : '';
                return role ? { success: true, role } : { success: false, error: '未获取到成员身份' };
            }
            catch (error) {
                this.logger.error('查询成员身份失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 拉取入群申请列表（机器人需群管理员）
        this.ctx.console.addListener('get-join-requests', async (data) => {
            try {
                const bot = this.ctx.bots.find((bot) => bot.selfId === data.selfId || bot.user?.id === data.selfId);
                if (!bot)
                    return { success: false, error: `未找到机器人 ${data.selfId}` };
                if (!bot.internal?.getJoinRequestList)
                    return { success: false, error: '当前适配器不支持拉取入群申请' };
                const result = await bot.internal.getJoinRequestList(data.channelId, { cursor: data.cursor || '', limit: data.limit || 20 });
                return { success: true, list: result?.list || [], nextCursor: result?.next_cursor || '' };
            }
            catch (error) {
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 审批入群申请（op=approve 通过 / decline 拒绝）
        this.ctx.console.addListener('handle-join-request', async (data) => {
            try {
                const bot = this.ctx.bots.find((bot) => bot.selfId === data.selfId || bot.user?.id === data.selfId);
                if (!bot)
                    return { success: false, error: `未找到机器人 ${data.selfId}` };
                if (!bot.internal?.approveJoinRequest)
                    return { success: false, error: '当前适配器不支持审批入群申请' };
                await bot.internal.approveJoinRequest(data.channelId, data.memberOpenid, {
                    op: data.op,
                    join_request_id: data.joinRequestId,
                    reject_reason: data.rejectReason,
                    add_to_member_blacklist: data.addToBlacklist
                });
                this.logInfo('审批入群申请成功:', { channelId: data.channelId, memberOpenid: data.memberOpenid, op: data.op });
                return { success: true };
            }
            catch (error) {
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 拉取群内被禁言成员列表（可在管理面板解除）
        this.ctx.console.addListener('get-muted-members', async (data) => {
            try {
                const bot = this.ctx.bots.find((bot) => bot.selfId === data.selfId || bot.user?.id === data.selfId);
                if (!bot)
                    return { success: false, error: `未找到机器人 ${data.selfId}` };
                if (!bot.internal?.getRestrictChatSetting)
                    return { success: false, error: '当前适配器不支持查询禁言状态' };
                const setting = await bot.internal.getRestrictChatSetting(data.channelId);
                return {
                    success: true,
                    members: setting?.members || [],
                    globalMuted: this.messageHandler.computeGlobalMuted(setting)
                };
            }
            catch (error) {
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 发送 Markdown 消息（原生 / 扩展：内容 + 参数指令 + 按钮交互）
        // msg_type=2 为 Message.Type.MARKDOWN
        this.ctx.console.addListener('send-md', async (data) => {
            try {
                const bot = this.ctx.bots.find((b) => b.selfId === data.selfId || b.user?.id === data.selfId);
                if (!bot)
                    return { success: false, error: `未找到机器人 ${data.selfId}` };
                if (!bot.internal?.sendMessage)
                    return { success: false, error: '当前适配器不支持发送消息' };
                if (!data.content)
                    return { success: false, error: '缺少 Markdown 内容' };
                // Markdown 内容原样发送给 QQ（含 <qqbot-cmd-input /> 指令标签）；
                // 记录/广播保留原始内容，使客户端可渲染为可点击标签
                const request = {
                    msg_type: 2,
                    markdown: { content: data.content },
                    ...(data.keyboard ? { keyboard: data.keyboard } : {})
                };
                const result = await bot.internal.sendMessage(data.channelId, request);
                const messageId = Array.isArray(result) ? result[0] : result?.id || result;
                this.logInfo('Markdown 消息发送成功:', { channelId: data.channelId, messageId });
                if (messageId) {
                    // 记录并广播，使消息显示在聊天列表
                    const cached = this.fileManager.getCachedChannelInfo(data.selfId, data.channelId);
                    const timestamp = Date.now();
                    // 记录内容保留原始文本（含 <qqbot-cmd-input /> 标签），客户端据此渲染可点击标签
                    const displayContent = data.content || '';
                    const messageInfo = {
                        id: `bot-${timestamp}`,
                        content: displayContent,
                        userId: data.selfId,
                        username: bot.user?.name || `Bot-${data.selfId}`,
                        avatar: bot.user?.avatar,
                        timestamp,
                        channelId: data.channelId,
                        selfId: data.selfId,
                        elements: data.content ? [{ type: 'markdown', attrs: { content: data.content }, children: [] }] : [],
                        type: 'bot',
                        guildName: cached?.guildName,
                        platform: 'qq',
                        isDirect: false,
                        realId: messageId
                    };
                    await this.fileManager.addMessageToFile(messageInfo);
                    this.ctx.console.broadcast('chat-bot-message-event', {
                        type: 'bot',
                        selfId: data.selfId,
                        platform: 'qq',
                        channelId: data.channelId,
                        messageId,
                        content: displayContent,
                        userId: data.selfId,
                        username: bot.user?.name || `Bot-${data.selfId}`,
                        avatar: bot.user?.avatar,
                        timestamp,
                        guildName: cached?.guildName,
                        channelType: 0,
                        elements: messageInfo.elements,
                        isDirect: false,
                        bot: { avatar: bot.user?.avatar, name: bot.user?.name }
                    });
                }
                return { success: !!messageId, messageId };
            }
            catch (error) {
                this.logger.error('发送 Markdown 消息失败:', error);
                if (this.isBotMutedError(error))
                    return { success: false, error: '消息发送失败：机器人被禁言（全体禁言中）' };
                if (this.isNoProactivePermissionError(error))
                    return { success: false, error: '消息发送失败：机器人无主动消息权限（需群内开启主动推送权限）' };
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 语音“转码播放”：把 QQ silk / 远程音频经 silk 服务 + ffmpeg 服务转为本地 mp3
        // 仅使用服务（ctx.silk / ctx.ffmpeg），不依赖系统命令
        this.ctx.console.addListener('transcode-audio', async (data) => {
            try {
                const url = String(data?.url || '').trim();
                if (!url)
                    return { success: false, error: '缺少音频 URL' };
                if (!/^https?:\/\//i.test(url))
                    return { success: false, error: '仅支持 http(s) 音频地址' };
                const local = await this.messageHandler.downloadAndCacheMedia(url, 'audio');
                // 失败时 downloadAndCacheMedia 会原样返回输入 URL，这里必须校验是否真的转成了本地可播放文件
                if (!local || !local.startsWith('/qq-chat/media/')) {
                    this.logger.warn('音频转码失败:', { url, result: local });
                    return { success: false, error: '音频转码失败，请检查 silk / ffmpeg 服务是否已安装并启用' };
                }
                return { success: true, url: `${this.serverOrigin()}${local}` };
            }
            catch (error) {
                this.logger.error('音频转码失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 响应互动事件（消息按钮回调）——适配器默认自动 ack，此接口供手动/兜底
        this.ctx.console.addListener('ack-interaction', async (data) => {
            try {
                const bot = this.ctx.bots.find((b) => b.selfId === data.selfId || b.user?.id === data.selfId);
                if (!bot)
                    return { success: false, error: `未找到机器人 ${data.selfId}` };
                if (!bot.internal?.acknowledgeInteraction)
                    return { success: false, error: '当前适配器不支持响应互动' };
                await bot.internal.acknowledgeInteraction(data.interactionId, { code: data.code ?? 0 });
                return { success: true };
            }
            catch (error) {
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('cleanup-temp-images', async (data) => {
            try {
                this.logInfo('收到清理临时图片请求:', data.tempImageIds);
                this.logInfo('临时图片将由定时任务清理，保持文件可用性');
                return { success: true, cleanedCount: 0 };
            }
            catch (error) {
                this.logger.error('清理临时图片失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('delete-bot-data', async (data) => {
            try {
                this.logInfo('收到删除机器人数据请求:', data);
                const { deletedChannels, deletedMessages } = await this.fileManager.deleteBotData(data.selfId);
                this.logInfo(`机器人 ${data.selfId} 数据删除完成:`, {
                    删除频道数: deletedChannels,
                    删除消息数: deletedMessages
                });
                return {
                    success: true,
                    message: `成功删除机器人数据：${deletedChannels} 个频道，${deletedMessages} 条消息`,
                    deletedChannels,
                    deletedMessages
                };
            }
            catch (error) {
                this.logger.error('删除机器人数据失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('delete-channel-data', async (data) => {
            try {
                this.logInfo('收到删除频道数据请求:', data);
                const channelKey = `${data.selfId}:${data.channelId}`;
                const { deletedMessages } = await this.fileManager.deleteChannelData(data.selfId, data.channelId);
                this.logInfo(`频道 ${channelKey} 数据删除完成:`, {
                    删除消息数: deletedMessages
                });
                return {
                    success: true,
                    message: `成功删除频道数据：${deletedMessages} 条消息`,
                    deletedMessages
                };
            }
            catch (error) {
                this.logger.error('删除频道数据失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('set-pinned-bots', async (data) => {
            try {
                this.logInfo('收到设置置顶机器人请求:', data.pinnedBots);
                await this.fileManager.setPinnedBots(data.pinnedBots);
                return { success: true };
            }
            catch (error) {
                this.logger.error('设置置顶机器人失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('set-pinned-channels', async (data) => {
            try {
                this.logInfo('收到设置置顶频道请求:', data.pinnedChannels);
                await this.fileManager.setPinnedChannels(data.pinnedChannels);
                return { success: true };
            }
            catch (error) {
                this.logger.error('设置置顶频道失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('upload-image', async (data) => {
            try {
                this.logInfo('收到图片上传请求:', { filename: data.filename, mimeType: data.mimeType, isGif: data.isGif });
                const base64Data = data.file.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                const tempId = Date.now() + '_' + Math.random().toString(36).substring(2, 11);
                const extension = data.filename.split('.').pop()?.toLowerCase() || (data.isGif ? 'gif' : 'jpg');
                const tempFilename = `temp_${tempId}.${extension}`;
                const tempDir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'temp');
                await node_fs_1.promises.mkdir(tempDir, { recursive: true });
                const tempPath = node_path_1.default.join(tempDir, tempFilename);
                await node_fs_1.promises.writeFile(tempPath, buffer);
                this.logInfo('图片上传成功:', { tempPath, size: buffer.length, isGif: data.isGif });
                return {
                    success: true,
                    tempId: tempId,
                    tempPath: tempPath,
                    filename: data.filename,
                    size: buffer.length,
                    isGif: data.isGif
                };
            }
            catch (error) {
                this.logger.error('图片上传失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('delete-temp-image', async (data) => {
            try {
                const tempDir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'temp');
                const files = (await this.safeReadDir(tempDir)).filter((file) => file.includes(`temp_${data.tempId}`));
                for (const file of files) {
                    const filePath = node_path_1.default.join(tempDir, file);
                    if (await this.fileExists(filePath)) {
                        await node_fs_1.promises.unlink(filePath);
                        this.logInfo('删除临时图片:', filePath);
                    }
                }
                return { success: true };
            }
            catch (error) {
                this.logger.error('删除临时图片失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 通用文件上传（音频 / 视频 / 文件），返回 tempId
        this.ctx.console.addListener('upload-file', async (data) => {
            try {
                this.logInfo('收到文件上传请求:', { filename: data.filename, mimeType: data.mimeType, type: data.type });
                const base64Data = String(data.file || '').replace(/^data:[^;]+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                const tempId = Date.now() + '_' + Math.random().toString(36).substring(2, 11);
                const extension = (data.filename || 'file').split('.').pop()?.toLowerCase() || 'bin';
                const tempFilename = `temp_${tempId}.${extension}`;
                const tempDir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'temp');
                await node_fs_1.promises.mkdir(tempDir, { recursive: true });
                const tempPath = node_path_1.default.join(tempDir, tempFilename);
                await node_fs_1.promises.writeFile(tempPath, buffer);
                this.logInfo('文件上传成功:', { tempPath, size: buffer.length, type: data.type });
                return {
                    success: true,
                    tempId,
                    tempPath,
                    filename: data.filename,
                    size: buffer.length,
                    type: data.type || 'file'
                };
            }
            catch (error) {
                this.logger.error('文件上传失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // +1 复读 / 重新发送：按 URL 下载到临时目录，返回 tempId（支持 data:/file:///本地路径/网络地址）
        this.ctx.console.addListener('fetch-and-upload', async (data) => {
            try {
                const url = String(data.url || '');
                if (!url)
                    return { success: false, error: '缺少 URL' };
                let buffer;
                if (url.startsWith('data:')) {
                    buffer = Buffer.from(url.replace(/^data:[^;]+;base64,/, ''), 'base64');
                }
                else if (url.startsWith('file://')) {
                    buffer = await node_fs_1.promises.readFile(require('node:url').fileURLToPath(url));
                }
                else if (url.includes('/qq-chat/media/')) {
                    const relative = url.slice(url.indexOf('/qq-chat/media/') + '/qq-chat/media/'.length);
                    buffer = await node_fs_1.promises.readFile(node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', relative));
                }
                else if (url.includes('/vite/@fs/')) {
                    let abs = decodeURIComponent(url.slice(url.indexOf('/vite/@fs/') + '/vite/@fs/'.length));
                    if (!/^[A-Za-z]:[\\/]/.test(abs))
                        abs = '/' + abs.replace(/^\/+/, '');
                    buffer = await node_fs_1.promises.readFile(node_path_1.default.resolve(abs));
                }
                else {
                    const response = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Referer': ''
                        }
                    });
                    if (!response.ok)
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    buffer = Buffer.from(await response.arrayBuffer());
                }
                if (!buffer?.length)
                    return { success: false, error: '下载内容为空' };
                const tempId = Date.now() + '_' + Math.random().toString(36).substring(2, 11);
                const ext = (data.filename || 'image.jpg').split('.').pop()?.toLowerCase() || 'jpg';
                const tempFilename = `temp_${tempId}.${ext}`;
                const tempDir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'temp');
                await node_fs_1.promises.mkdir(tempDir, { recursive: true });
                const tempPath = node_path_1.default.join(tempDir, tempFilename);
                await node_fs_1.promises.writeFile(tempPath, buffer);
                this.logInfo('fetch-and-upload 成功:', { tempPath, size: buffer.length, url: String(url).slice(0, 80) });
                return {
                    success: true,
                    tempId,
                    tempPath,
                    filename: data.filename || `image.${ext}`,
                    size: buffer.length
                };
            }
            catch (error) {
                this.logger.error('fetch-and-upload 失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 下载文件：服务端下载后返回可下载地址
        this.ctx.console.addListener('download-file', async (data) => {
            try {
                const url = String(data.url || '');
                if (!url)
                    return { success: false, error: '缺少 URL' };
                let buffer;
                if (url.startsWith('data:')) {
                    buffer = Buffer.from(url.replace(/^data:[^;]+;base64,/, ''), 'base64');
                }
                else if (url.startsWith('file://')) {
                    buffer = await node_fs_1.promises.readFile(require('node:url').fileURLToPath(url));
                }
                else if (url.includes('/qq-chat/media/')) {
                    const relative = url.slice(url.indexOf('/qq-chat/media/') + '/qq-chat/media/'.length);
                    buffer = await node_fs_1.promises.readFile(node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', relative));
                }
                else if (url.includes('/vite/@fs/')) {
                    let abs = decodeURIComponent(url.slice(url.indexOf('/vite/@fs/') + '/vite/@fs/'.length));
                    if (!/^[A-Za-z]:[\\/]/.test(abs))
                        abs = '/' + abs.replace(/^\/+/, '');
                    buffer = await node_fs_1.promises.readFile(node_path_1.default.resolve(abs));
                }
                else {
                    const response = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Referer': ''
                        }
                    });
                    if (!response.ok)
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    buffer = Buffer.from(await response.arrayBuffer());
                }
                if (!buffer?.length)
                    return { success: false, error: '下载内容为空' };
                const tempId = Date.now() + '_' + Math.random().toString(36).substring(2, 11);
                const ext = (data.filename || 'file').split('.').pop()?.toLowerCase() || 'bin';
                const tempFilename = `temp_${tempId}.${ext}`;
                const tempDir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'temp');
                await node_fs_1.promises.mkdir(tempDir, { recursive: true });
                const tempPath = node_path_1.default.join(tempDir, tempFilename);
                await node_fs_1.promises.writeFile(tempPath, buffer);
                this.logInfo('download-file 成功:', { tempPath, size: buffer.length, url: String(url).slice(0, 80) });
                return {
                    success: true,
                    downloadUrl: `/qq-chat/download/temp/${tempFilename}`,
                    filename: data.filename || `download.${ext}`,
                    size: buffer.length
                };
            }
            catch (error) {
                this.logger.error('download-file 失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.setupTempFileCleanup();
        this.ctx.console.addListener('get-plugin-config', async () => {
            try {
                return {
                    success: true,
                    config: {
                        maxMessagesPerChannel: this.config.maxMessagesPerChannel,
                        messageChunkSize: this.config.messageChunkSize,
                        channelCacheLimit: this.config.channelCacheLimit,
                        maxPersistImages: this.config.maxPersistImages,
                        loggerinfo: this.config.loggerinfo,
                        clearIndexedDBOnStart: this.config.clearIndexedDBOnStart
                    }
                };
            }
            catch (error) {
                this.logger.error('获取插件配置失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        this.ctx.console.addListener('get-user-info', async (data) => {
            try {
                const bot = this.ctx.bots.find(b => b.selfId === data.selfId);
                if (!bot)
                    return { success: false, error: '机器人不存在' };
                if (!bot.getUser || typeof bot.getUser !== 'function') {
                    return { success: false, error: '此平台不支持查看用户信息' };
                }
                const user = await bot.getUser(data.userId, data.guildId);
                if (user) {
                    if (user.avatar) {
                        user.avatar = await this.messageHandler.downloadAndCacheMedia(user.avatar, 'avatar');
                    }
                    const changed = await this.fileManager.updateUserProfileInBotData(data.selfId, data.userId, user.name, user.avatar);
                    if (changed) {
                        this.ctx.console.broadcast('chat-data-updated', {});
                    }
                }
                return { success: true, data: user };
            }
            catch (error) {
                return { success: false, error: this.getClientErrorMessage(error) || '获取用户信息失败' };
            }
        });
        this.ctx.console.addListener('fetch-video-temp', async (data) => {
            try {
                this.logInfo('收到视频临时加载请求:', data.url);
                // 如果已经是本地媒体路径，直接返回
                if (data.url.includes('/vite/@fs/') || data.url.includes('/qq-chat/media/')) {
                    return {
                        success: true,
                        viteUrl: data.url
                    };
                }
                // 如果是本地文件 URL，转换为网络地址
                if (this.isFileUrl(data.url)) {
                    const filePath = require('node:url').fileURLToPath(data.url);
                    const mediaRoot = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat');
                    const relative = node_path_1.default.relative(mediaRoot, filePath).replace(/\\/g, '/');
                    return {
                        success: true,
                        viteUrl: `/qq-chat/media/${relative}`
                    };
                }
                // 网络视频：下载并缓存到本地，返回网络地址
                const dir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'persist-media', 'media');
                await node_fs_1.promises.mkdir(dir, { recursive: true });
                const hash = (0, node_crypto_1.createHash)('md5').update(data.url).digest('hex');
                const ext = node_path_1.default.extname(new node_url_1.URL(data.url).pathname) || '.mp4';
                const filename = `${hash}${ext}`;
                const filePath = node_path_1.default.join(dir, filename);
                // 如果文件不存在，下载并保存
                if (!(await this.fileExists(filePath))) {
                    const response = await fetch(data.url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Referer': ''
                        }
                    });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    const buffer = await response.arrayBuffer();
                    await node_fs_1.promises.writeFile(filePath, Buffer.from(buffer));
                    this.logInfo('视频下载成功:', { size: buffer.byteLength, path: filePath });
                }
                // 返回网络地址
                const mediaRoot = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat');
                const relative = node_path_1.default.relative(mediaRoot, filePath).replace(/\\/g, '/');
                return {
                    success: true,
                    viteUrl: `/qq-chat/media/${relative}`
                };
            }
            catch (error) {
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // B 站视频搜索（带 Wbi 签名 + buvid3 Cookie），用于小程序卡片无链接时按标题搜视频
        this.ctx.console.addListener('bili-search', async (data) => {
            try {
                const keyword = String(data?.keyword || '').trim();
                if (!keyword)
                    return { success: false, error: '缺少搜索关键词' };
                this.logInfo('B 站视频搜索:', keyword);
                const { buvid3, imgKey, subKey } = await this.getBiliWbiKeys();
                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://www.bilibili.com/'
                };
                if (buvid3)
                    headers['Cookie'] = `buvid3=${buvid3}`;
                const signed = this.encWbi({ search_type: 'video', keyword }, imgKey, subKey);
                const url = `https://api.bilibili.com/x/web-interface/wbi/search/type?${signed}`;
                const response = await fetch(url, { headers });
                const json = await response.json();
                if (json.code !== 0) {
                    return { success: false, error: json.message || `B 站接口返回错误 code=${json.code}` };
                }
                const raw = Array.isArray(json?.data?.result) ? json.data.result : [];
                const results = raw
                    .filter((item) => item && item.bvid)
                    .slice(0, data?.limit || 8)
                    .map((item) => ({
                    bvid: item.bvid,
                    title: this.stripHtml(item.title || ''),
                    author: item.author || '',
                    pic: item.pic ? (item.pic.startsWith('http') ? item.pic : `https:${item.pic}`) : '',
                    play: item.play,
                    duration: item.duration
                }));
                return { success: true, results };
            }
            catch (error) {
                this.logger.error('B 站视频搜索失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // B 站视频解析（米人API bzjiexi），用于卡片渲染封面 / 点击封面直接播放
        this.ctx.console.addListener('bili-parse', async (data) => {
            try {
                const input = String(data?.url || '').trim();
                if (!input)
                    return { success: false, error: '缺少视频链接' };
                const url = /^https?:/i.test(input) ? input : `https://www.bilibili.com/video/${input}`;
                this.logInfo('B 站视频解析:', url);
                const apiUrl = `https://api.mir6.com/api/bzjiexi?url=${encodeURIComponent(url)}&type=json`;
                const response = await fetch(apiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': 'https://www.bilibili.com/'
                    }
                });
                const json = await response.json();
                if (json?.code !== 200 || !Array.isArray(json?.data) || !json.data[0]?.video_url) {
                    return { success: false, error: json?.msg || '解析失败（仅支持普通 B 站视频，番剧/电影/电视剧不支持）' };
                }
                const item = json.data[0];
                // 直接使用镜像接口返回的直链给浏览器播放（不下载）；封面转 https 避免混合内容拦截
                return {
                    success: true,
                    title: json.title || item.title || '',
                    desc: json.desc || '',
                    durationFormat: item.durationFormat || '',
                    author: json.user?.name || '',
                    coverUrl: json.imgurl ? String(json.imgurl).replace(/^http:\/\//i, 'https://') : '',
                    videoUrl: item.video_url,
                    sourceUrl: url
                };
            }
            catch (error) {
                this.logger.error('B 站视频解析失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
        // 网易云音乐解析（paugram API），用于卡片封面 / 直接播放
        this.ctx.console.addListener('netease-resolve', async (data) => {
            try {
                const id = String(data?.id || '').trim();
                if (!id)
                    return { success: false, error: '缺少音乐 ID' };
                this.logInfo('网易云音乐解析:', id);
                const url = `https://api.paugram.com/netease/?id=${encodeURIComponent(id)}`;
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                const json = await response.json();
                if (!json || (!json.title && !json.id)) {
                    return { success: false, error: json?.error || '网易云解析失败' };
                }
                return { success: true, data: json };
            }
            catch (error) {
                this.logger.error('网易云音乐解析失败:', error);
                return { success: false, error: this.getClientErrorMessage(error) };
            }
        });
    }
    getBiliMixinKey(orig) {
        return ApiHandlers.mixinKeyEncTab.map((n) => orig[n]).join('').slice(0, 32);
    }
    stripHtml(text) {
        return String(text || '')
            .replace(/<[^>]*>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
    }
    async getBiliWbiKeys() {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.bilibili.com/'
        };
        let buvid3 = '';
        try {
            const spi = await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers });
            const spiJson = await spi.json();
            buvid3 = spiJson?.data?.b_3 || '';
        }
        catch { }
        let imgKey = '';
        let subKey = '';
        try {
            const nav = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers });
            const navJson = await nav.json();
            const imgUrl = navJson?.data?.wbi_img?.img_url || '';
            const subUrl = navJson?.data?.wbi_img?.sub_url || '';
            imgKey = imgUrl.slice(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.'));
            subKey = subUrl.slice(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.'));
        }
        catch { }
        if (!imgKey || !subKey) {
            imgKey = '7cd084941338484aae1ad9425b84077c';
            subKey = '4932caff0ff746eab6f01bf08b70ac45';
        }
        return { buvid3, imgKey, subKey };
    }
    encWbi(params, imgKey, subKey) {
        const mixinKey = this.getBiliMixinKey(imgKey + subKey);
        const wts = Math.round(Date.now() / 1000);
        const signedParams = { ...params, wts: String(wts) };
        const query = Object.keys(signedParams).sort().map((key) => {
            const value = String(signedParams[key]).replace(/[!'()*]/g, '');
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        }).join('&');
        const wRid = (0, node_crypto_1.createHash)('md5').update(query + mixinKey).digest('hex');
        return `${query}&w_rid=${wRid}`;
    }
    isFileUrl(url) {
        try {
            const parsedUrl = new node_url_1.URL(url);
            return parsedUrl.protocol === 'file:';
        }
        catch {
            return false;
        }
    }
    createFileUrl(filePath) {
        try {
            return (0, node_url_1.pathToFileURL)(filePath).href;
        }
        catch (error) {
            this.logger.error('创建文件URL失败:', { filePath, error });
            return `file://${filePath}`;
        }
    }
    // 本服务监听地址（同源 127 / localhost）
    serverOrigin() {
        const server = this.ctx.server;
        let host = server?.host || '127.0.0.1';
        if (host === '0.0.0.0' || host === '::' || host === '[::]')
            host = '127.0.0.1';
        const port = server?.port || 5140;
        return `http://${host}:${port}`;
    }
    // 用 Koishi assets 服务把网络表情 apng 转存为 QQ 可访问的公网 URL
    async uploadEmojiToAssets(sourceUrl, faceId) {
        const assets = this.ctx.assets;
        if (!assets) {
            throw new Error('未检测到 assets 服务，请安装并启用 koishi-plugin-assets-qqbot-part-file 等插件');
        }
        if (typeof assets.upload !== 'function') {
            throw new Error('assets 服务未提供 upload 方法');
        }
        const filename = `qq_emoji_${faceId}.png`;
        // qqbot-part-file 等 assets 实现会用 http fetch 拉取源，直接传入公网表情 URL
        const attempts = [
            () => assets.upload(sourceUrl),
            () => assets.upload(sourceUrl, filename)
        ];
        let lastError = null;
        for (const attempt of attempts) {
            try {
                const result = await attempt();
                const url = typeof result === 'string' ? result : result?.url;
                if (url && /^https?:\/\//i.test(String(url)))
                    return String(url);
                lastError = new Error(`assets 上传返回的 URL 无效: ${String(url || result)}`);
            }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('assets 上传失败');
    }
    createMediaUrl(filePath) {
        try {
            const mediaRoot = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat');
            const relative = node_path_1.default.relative(mediaRoot, filePath).replace(/\\/g, '/');
            if (relative.startsWith('..')) {
                throw new Error('媒体文件不在 data/qq-chat 目录下');
            }
            return `${this.serverOrigin()}/qq-chat/media/${relative}`;
        }
        catch (error) {
            this.logger.error('创建媒体URL失败:', { filePath, error });
            return this.createFileUrl(filePath);
        }
    }
    async handleLocalFileRequest(fileUrl) {
        try {
            const filePath = (0, node_url_1.fileURLToPath)(fileUrl);
            const buffer = await node_fs_1.promises.readFile(filePath);
            const base64 = buffer.toString('base64');
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            this.logInfo('成功读取本地文件:', { fileUrl, filePath, contentType });
            return {
                success: true,
                base64: base64,
                contentType: contentType,
                dataUrl: `data:${contentType};base64,${base64}`
            };
        }
        catch (error) {
            return {
                success: false,
                error: `读取本地文件失败: ${error.message}`
            };
        }
    }
    setupTempFileCleanup() {
        this.ctx.setInterval(() => {
            this.cleanupMediaCache();
        }, 5 * 60 * 1000);
    }
    async cleanupMediaCache() {
        const baseDir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'persist-media');
        await this.cleanupMediaCacheDir(node_path_1.default.join(baseDir, 'images'), 100);
        await this.cleanupMediaCacheDir(node_path_1.default.join(baseDir, 'audio'), 100);
        await this.cleanupMediaCacheDir(node_path_1.default.join(baseDir, 'media'), 20);
    }
    logInfo(...args) {
        if (this.config.loggerinfo) {
            Reflect.apply(this.logger.info, this.logger, args);
        }
    }
    async fileExists(filePath) {
        try {
            await node_fs_1.promises.access(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    async readFileHead(filePath, length) {
        try {
            const handle = await node_fs_1.promises.open(filePath, 'r');
            try {
                const buffer = Buffer.alloc(length);
                const { bytesRead } = await handle.read(buffer, 0, length, 0);
                return buffer.subarray(0, bytesRead);
            }
            finally {
                await handle.close();
            }
        }
        catch {
            return null;
        }
    }
    isAudioBuffer(buffer) {
        const head = buffer.subarray(0, 16).toString('ascii');
        const signature = buffer.subarray(0, 16);
        return signature.includes(Buffer.from([0x49, 0x44, 0x33])) || // ID3（mp3）
            signature.includes(Buffer.from([0xFF, 0xFB])) || // MP3 帧头
            signature.includes(Buffer.from([0xFF, 0xF3])) ||
            signature.includes(Buffer.from([0x52, 0x49, 0x46, 0x46])) || // RIFF/WAV
            head.startsWith('OggS') ||
            head.startsWith('fLaC') ||
            signature.includes(Buffer.from('#!SILK')) || // QQ 语音（可能带 0x02 前缀）
            signature.includes(Buffer.from('#!AMR')) ||
            (buffer.length > 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'); // m4a/mp4
    }
    async safeReadDir(dirPath) {
        try {
            return await node_fs_1.promises.readdir(dirPath);
        }
        catch {
            return [];
        }
    }
    async cleanupMediaCacheDir(dirPath, limit) {
        const files = await this.safeReadDir(dirPath);
        if (!files.length) {
            return;
        }
        const fileStats = await Promise.all(files.map(async (fileName) => {
            const filePath = node_path_1.default.join(dirPath, fileName);
            const stats = await node_fs_1.promises.stat(filePath);
            return { path: filePath, mtime: stats.mtimeMs };
        }));
        fileStats.sort((left, right) => right.mtime - left.mtime);
        for (const file of fileStats.slice(limit)) {
            try {
                await node_fs_1.promises.unlink(file.path);
            }
            catch {
                continue;
            }
        }
    }
    /**
     * 统一从各种错误结构中提取用户可读的报错信息。
     * 优先取 QQ API 返回的 response.data.message / err_msg（如"目标成员为机器人/群主/管理员，不允许被禁言"），
     * 其次取 data.message / 普通 message，最后兜底 String(error)。
     */
    getClientErrorMessage(error) {
        if (typeof error !== 'object' || error === null)
            return String(error);
        const err = error;
        const candidates = [
            err?.response?.data?.message,
            err?.response?.data?.err_msg,
            err?.data?.message,
            err?.data?.err_msg,
            err?.message,
            err?.reason,
        ];
        for (const c of candidates) {
            if (typeof c === 'string' && c.trim())
                return c.trim();
        }
        // AggregateError：合并内部错误信息
        if (Array.isArray(err?.errors) && err.errors.length) {
            return err.errors.map((e) => this.getClientErrorMessage(e)).filter(Boolean).join('；');
        }
        return String(error);
    }
    /** 判断错误是否为"机器人无主动消息权限"（QQ 错误码 40034105，主动推送被拒时触发） */
    isNoProactivePermissionError(error) {
        if (!error)
            return false;
        const message = String(error?.message || error?.data?.message || error?.response?.data?.message || '');
        const code = String(error?.code ?? error?.err_code ?? error?.response?.data?.code ?? '');
        if (message.includes('主动消息') || message.includes('无权限') || message.includes('没有权限') || message.toLowerCase().includes('proactive'))
            return true;
        if (code === '40034105')
            return true;
        // AggregateError：遍历内部错误
        if (Array.isArray(error?.errors)) {
            return error.errors.some((e) => this.isNoProactivePermissionError(e));
        }
        return false;
    }
    /** 判断错误是否为"机器人被禁言"（QQ 错误码 40054002，全体禁言时发送会触发） */
    isBotMutedError(error) {
        if (!error)
            return false;
        const message = String(error?.message || error?.data?.message || error?.response?.data?.message || '');
        const code = String(error?.code ?? error?.err_code ?? error?.response?.data?.code ?? '');
        if (message.includes('被禁言') || message.includes('禁言'))
            return true;
        if (code === '40054002')
            return true;
        // AggregateError：遍历内部错误
        if (Array.isArray(error?.errors)) {
            return error.errors.some((e) => this.isBotMutedError(e));
        }
        return false;
    }
    /** 毫秒时间戳 -> RFC3339（本地时区偏移），如 2026-08-05T11:23:05+08:00 */
    toRfc3339(ms) {
        const d = new Date(ms);
        const p = (n, l = 2) => String(n).padStart(l, '0');
        const offset = -d.getTimezoneOffset();
        const sign = offset >= 0 ? '+' : '-';
        const abs = Math.abs(offset);
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
    }
}
exports.ApiHandlers = ApiHandlers;
// ===== B 站 Wbi 签名 =====
ApiHandlers.mixinKeyEncTab = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
