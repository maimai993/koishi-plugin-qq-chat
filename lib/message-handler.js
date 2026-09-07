"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageHandler = void 0;
const utils_1 = require("./utils");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
class MessageHandler {
    constructor(ctx, config, fileManager, logger) {
        this.ctx = ctx;
        this.config = config;
        this.fileManager = fileManager;
        this.logger = logger;
        this.correctChannelIds = new Map();
        this.scheduledTasks = new Set();
        this.channelRefreshInFlight = new Set();
        this.lastChannelRefreshAt = new Map();
        this.CHANNEL_REFRESH_TTL_MS = 10 * 60 * 1000;
        this.utils = new utils_1.Utils(config);
    }
    recordUserMessage(session, timestamp) {
        // 只记录 QQ 平台的消息
        if (session.platform !== 'qq')
            return;
        this.scheduleTask('记录用户消息', async () => {
            await this.processUserMessage(session, timestamp);
        });
    }
    recordBotMessage(session, timestamp) {
        // 只记录 QQ 平台的消息
        if (session.platform !== 'qq')
            return;
        this.scheduleTask('记录机器人消息', async () => {
            await this.processBotMessage(session, timestamp);
        });
    }
    recordGroupMemberEvent(session, kind) {
        // 只记录 QQ 平台的群成员事件
        if (session.platform !== 'qq')
            return;
        this.scheduleTask(kind === 'added' ? '记录入群事件' : '记录退群事件', async () => {
            await this.processGroupMemberEvent(session, kind);
        });
    }
    async processGroupMemberEvent(session, kind) {
        try {
            const timestamp = Date.now();
            const eventUser = session.event?.user;
            const eventMember = session.event?.member;
            const userId = eventUser?.id || eventMember?.user?.id || 'system';
            const name = eventUser?.name
                || eventMember?.nick
                || eventMember?.user?.name
                || userId;
            const content = kind === 'added' ? `${name} 加入了群聊` : `${name} 退出了群聊`;
            this.updateBotInfoToFile(session);
            const guildName = this.updateChannelInfoToFile(session);
            // 以普通用户消息的形式展示，名字固定为"系统消息"
            const messageInfo = {
                id: `sys-${timestamp}`,
                content,
                userId: 'system',
                username: '系统消息',
                avatar: '',
                timestamp,
                channelId: session.channelId,
                selfId: session.selfId,
                elements: [],
                type: 'user',
                systemType: 'member',
                guildName,
                platform: session.platform || 'unknown',
                isDirect: false
            };
            await this.fileManager.addMessageToFile(messageInfo);
            this.ctx.console.broadcast('chat-message-event', {
                type: 'user',
                systemType: 'member',
                selfId: session.selfId,
                platform: session.platform || 'unknown',
                channelId: session.channelId,
                messageId: messageInfo.id,
                content,
                userId: 'system',
                username: '系统消息',
                avatar: '',
                timestamp,
                guildName,
                channelType: session.type || 0,
                elements: [],
                isDirect: false
            });
        }
        catch (error) {
            this.logger.error('记录群成员事件失败:', error);
        }
    }
    recordJoinRequestEvent(session) {
        // 只记录 QQ 平台的入群申请事件
        if (session.platform !== 'qq')
            return;
        this.scheduleTask('记录入群申请事件', async () => {
            await this.processJoinRequestEvent(session);
        });
    }
    async processJoinRequestEvent(session) {
        try {
            const timestamp = Date.now();
            const name = session.event?.user?.name || session.username || session.userId || '未知用户';
            const content = `📩 ${name} 申请加入群聊`;
            this.updateBotInfoToFile(session);
            const guildName = this.updateChannelInfoToFile(session);
            // 以普通用户消息的形式展示，名字固定为"系统消息"
            const messageInfo = {
                id: `sys-${timestamp}`,
                content,
                userId: 'system',
                username: '系统消息',
                avatar: '',
                timestamp,
                channelId: session.channelId,
                selfId: session.selfId,
                elements: [],
                type: 'user',
                systemType: 'join-request',
                guildName,
                platform: session.platform || 'unknown',
                isDirect: false
            };
            await this.fileManager.addMessageToFile(messageInfo);
            this.ctx.console.broadcast('chat-message-event', {
                type: 'user',
                systemType: 'join-request',
                selfId: session.selfId,
                platform: session.platform || 'unknown',
                channelId: session.channelId,
                messageId: messageInfo.id,
                content,
                userId: 'system',
                username: '系统消息',
                avatar: '',
                timestamp,
                guildName,
                channelType: session.type || 0,
                elements: [],
                isDirect: false
            });
        }
        catch (error) {
            this.logger.error('记录入群申请事件失败:', error);
        }
    }
    setCorrectChannelId(selfId, channelId) {
        this.correctChannelIds.set(selfId, channelId);
        this.logger.logInfo('设置正确的 channelId:', { selfId, channelId });
    }
    getCorrectChannelId(selfId) {
        return this.correctChannelIds.get(selfId);
    }
    updateBotInfoToFile(session) {
        this.scheduleTask('更新机器人信息', async () => {
            const botInfo = {
                selfId: session.selfId,
                platform: session.platform || 'unknown',
                username: session.bot.user?.name || `Bot-${session.selfId}`,
                avatar: session.bot.user?.avatar,
                status: 'online'
            };
            await this.fileManager.upsertBotInfo(botInfo);
            this.logger.logInfo('更新机器人信息到文件:', botInfo.username);
        });
    }
    updateChannelInfoToFile(session) {
        const isDirect = session.isDirect || session.channelId?.includes('private');
        const directUserName = session.username || session.event?.user?.name || session.userId;
        const existingChannel = this.fileManager.getCachedChannelInfo(session.selfId, session.channelId);
        let immediateName = session.channelId;
        if (isDirect) {
            if (directUserName && directUserName !== session.userId) {
                immediateName = `私聊（${directUserName}）`;
            }
            else if (existingChannel?.name && !existingChannel.name.includes('未知')) {
                immediateName = existingChannel.name;
            }
            else if (session.platform && session.platform.toLowerCase().includes('sandbox')) {
                immediateName = `私聊（${session.userId}）`;
            }
            else {
                immediateName = '私聊（未知用户）';
            }
        }
        else if (existingChannel?.guildName) {
            immediateName = existingChannel.guildName;
        }
        const channelKey = `${session.selfId}:${session.channelId}`;
        if (this.shouldRefreshChannelInfo(channelKey, existingChannel, isDirect, session.channelId, directUserName)) {
            this.scheduleTask('更新频道信息', async () => {
                await this.refreshChannelInfo(session, existingChannel, isDirect, directUserName);
            });
        }
        return immediateName;
    }
    async downloadAndCacheMedia(url, type, prefetchedBuffer) {
        try {
            if (!url || url.startsWith('data:'))
                return url;
            // 如果已经是本地媒体路径，直接返回
            if (url.includes('/vite/@fs/') || url.includes('/qq-chat/media/'))
                return url;
            const urlLower = url.toLowerCase();
            const guessedType = this.guessMediaTypeByUrl(urlLower, type);
            const isAudio = guessedType === 'audio' || type === 'audio';
            // 语音必须独立存放，避免 QQ 语音 URL 以 .jpg 结尾时被误判为图片
            let folder = 'media';
            if (isAudio)
                folder = 'audio';
            else if (guessedType === 'image')
                folder = 'images';
            else if (guessedType === 'avatar')
                folder = 'avatars';
            const dir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'persist-media', folder);
            await node_fs_1.promises.mkdir(dir, { recursive: true });
            const hash = (0, node_crypto_1.createHash)('md5').update(url).digest('hex');
            // 语音 URL 可能带 .jpg 等误导性扩展名，且扩展名随内容变化，先按哈希前缀查找已有缓存
            if (isAudio) {
                const cached = await this.findCachedFile(dir, hash);
                if (cached)
                    return this.toMediaUrl(cached);
            }
            else {
                const targetExt = this.getPreferredMediaExtension(url, guessedType);
                const filePath = node_path_1.default.join(dir, `${hash}${targetExt}`);
                if (await this.fileExists(filePath))
                    return this.toMediaUrl(filePath);
            }
            let buffer;
            if (prefetchedBuffer) {
                buffer = prefetchedBuffer;
            }
            else {
                const raw = await this.ctx.http.get(url, { responseType: 'arraybuffer' });
                buffer = Buffer.from(new Uint8Array(raw));
            }
            let targetExt = '.mp3';
            if (isAudio) {
                const format = this.detectAudioFormat(buffer);
                if (format === 'mp3' || format === 'wav' || format === 'm4a' || format === 'ogg' || format === 'flac' || format === 'aac') {
                    targetExt = `.${format}`;
                }
                else {
                    // silk / amr / 未知格式：先尝试 silk 服务解码 + ffmpeg 转码为 mp3
                    const converted = await this.transcodeAudioToMp3(buffer, format);
                    if (converted) {
                        buffer = converted;
                    }
                    else if (format === 'silk' || format === 'amr') {
                        // 转码失败：按真实格式命名，避免继续伪装成 .jpg/.mp3
                        targetExt = `.${format}`;
                    }
                }
            }
            else {
                targetExt = this.getPreferredMediaExtension(url, guessedType);
            }
            const filePath = node_path_1.default.join(dir, `${hash}${targetExt}`);
            await node_fs_1.promises.writeFile(filePath, buffer);
            return this.toMediaUrl(filePath);
        }
        catch (e) {
            this.logger.warn('下载并缓存媒体失败:', e);
            return url;
        }
    }
    toMediaUrl(filePath) {
        // 返回网络地址（生产环境通过静态路由加载）
        const mediaRoot = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat');
        const relative = node_path_1.default.relative(mediaRoot, filePath).replace(/\\/g, '/');
        return `/qq-chat/media/${relative}`;
    }
    async getCachedMediaUrl(url, type) {
        try {
            if (!url || url.startsWith('data:'))
                return null;
            if (url.includes('/vite/@fs/') || url.includes('/qq-chat/media/'))
                return url;
            const guessedType = this.guessMediaTypeByUrl(url.toLowerCase(), type);
            const isAudio = guessedType === 'audio' || type === 'audio';
            let folder = 'media';
            if (isAudio)
                folder = 'audio';
            else if (guessedType === 'image')
                folder = 'images';
            else if (guessedType === 'avatar')
                folder = 'avatars';
            const dir = node_path_1.default.join(this.ctx.baseDir, 'data', 'qq-chat', 'persist-media', folder);
            const hash = (0, node_crypto_1.createHash)('md5').update(url).digest('hex');
            if (isAudio) {
                const cached = await this.findCachedFile(dir, hash);
                return cached ? this.toMediaUrl(cached) : null;
            }
            const targetExt = this.getPreferredMediaExtension(url, guessedType);
            const filePath = node_path_1.default.join(dir, `${hash}${targetExt}`);
            return (await this.fileExists(filePath)) ? this.toMediaUrl(filePath) : null;
        }
        catch {
            return null;
        }
    }
    async findCachedFile(dir, prefix) {
        try {
            const files = await node_fs_1.promises.readdir(dir);
            const matched = files.find((file) => file.startsWith(prefix + '.'));
            return matched ? node_path_1.default.join(dir, matched) : null;
        }
        catch {
            return null;
        }
    }
    detectAudioFormat(buffer) {
        const signature = buffer.subarray(0, 16);
        const head = buffer.subarray(0, 16).toString('ascii');
        if (signature.includes(Buffer.from([0x49, 0x44, 0x33])))
            return 'mp3'; // ID3 标签
        if (signature.includes(Buffer.from([0xFF, 0xFB])) || signature.includes(Buffer.from([0xFF, 0xF3])) || signature.includes(Buffer.from([0xFF, 0xF2])))
            return 'mp3'; // MP3 帧头
        if (signature.includes(Buffer.from([0x52, 0x49, 0x46, 0x46])) && buffer.subarray(8, 12).toString('ascii') === 'WAVE')
            return 'wav';
        if (buffer.length > 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp')
            return 'm4a';
        if (head.startsWith('OggS'))
            return 'ogg';
        if (head.startsWith('fLaC'))
            return 'flac';
        if (signature.includes(Buffer.from('#!SILK')))
            return 'silk';
        if (signature.includes(Buffer.from('#!AMR')))
            return 'amr';
        return null;
    }
    guessMediaTypeByUrl(url, fallbackType) {
        if (/(?:^|\/|\.)(jpg|jpeg|png|gif|bmp|webp|svg)(?:\?|$)/.test(url))
            return 'image';
        if (/(?:^|\/|\.)(mp3|wav|m4a|aac|ogg|amr|silk|flac)(?:\?|$)/.test(url))
            return 'audio';
        if (fallbackType === 'image')
            return 'image';
        if (fallbackType === 'avatar')
            return 'avatar';
        return 'media';
    }
    getPreferredMediaExtension(url, type) {
        const ext = node_path_1.default.extname(new URL(url).pathname).toLowerCase();
        if (ext && type !== 'audio')
            return ext;
        if (type === 'image' || type === 'avatar')
            return '.jpg';
        if (type === 'audio')
            return '.mp3';
        return '.mp3';
    }
    isPlayableAudioBuffer(buffer, url) {
        const lower = url.toLowerCase();
        const headers = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
        const matches = headers.some((ext) => lower.includes(`.${ext}`) || lower.includes(`/${ext}`));
        if (matches)
            return true;
        const signature = buffer.subarray(0, 16);
        return signature.includes(Buffer.from([0x49, 0x44, 0x33])) ||
            signature.includes(Buffer.from([0x52, 0x49, 0x46, 0x46])) ||
            signature.includes(Buffer.from([0xFF, 0xFB])) ||
            signature.includes(Buffer.from([0x25, 0x00, 0x00, 0x00]));
    }
    async transcodeAudioToMp3(buffer, format) {
        // QQ 官方语音为 SILK（头部可能带 0x02 前缀）：先用 silk 服务解码为 PCM，再交给 ffmpeg 转 mp3
        if (format === 'silk' || format === 'amr') {
            const silkService = this.ctx.silk;
            if (silkService && typeof silkService.decode === 'function') {
                try {
                    const decoded = await silkService.decode(buffer, 24000);
                    const pcm = decoded && decoded.data ? Buffer.from(decoded.data) : null;
                    if (pcm && pcm.length) {
                        const mp3 = await this.transcodeRawBufferToMp3(pcm, 24000);
                        if (mp3)
                            return mp3;
                    }
                }
                catch (error) {
                    this.logger.warn('silk 服务解码失败，回退到 ffmpeg:', error);
                }
            }
        }
        // 兜底：直接交给 ffmpeg（amr / 未知格式）
        return this.transcodeRawBufferToMp3(buffer);
    }
    async transcodeRawBufferToMp3(buffer, sampleRate) {
        // 使用 ffmpeg 服务（如 koishi-plugin-ffmpeg），不直接调用系统 ffmpeg
        const ffmpeg = this.ctx.ffmpeg;
        if (!ffmpeg || typeof ffmpeg.builder !== 'function') {
            this.logger.warn('未检测到 ffmpeg 服务（可安装 koishi-plugin-ffmpeg），无法将语音转码为 mp3');
            return null;
        }
        try {
            const builder = ffmpeg.builder();
            builder.input(buffer);
            if (sampleRate) {
                // PCM 输入需要声明原始格式
                builder.inputOption('-f', 's16le', '-ar', String(sampleRate), '-ac', '1');
            }
            builder.outputOption('-vn', '-f', 'mp3', '-ar', '44100', '-ac', '1');
            const result = await builder.run('buffer');
            const out = Buffer.isBuffer(result) ? result : (result ? Buffer.from(result) : null);
            return out && out.length ? out : null;
        }
        catch (error) {
            this.logger.warn('ffmpeg 服务转码语音失败:', error);
            return null;
        }
    }
    processMediaElementsAsync(elements, isUserMessage = true) {
        if (!elements)
            return;
        this.scheduleTask('处理媒体元素', async () => {
            await this.processMediaElements(elements, isUserMessage);
        });
    }
    async processUserMessage(session, timestamp) {
        try {
            if (!timestamp)
                timestamp = Date.now();
            this.updateBotInfoToFile(session);
            const guildName = this.updateChannelInfoToFile(session);
            const isDirect = session.isDirect || session.channelId?.includes('private');
            if (session.elements) {
                this.processMediaElementsAsync(session.elements, true);
            }
            if (session.quote?.elements) {
                this.processMediaElementsAsync(session.quote.elements, true);
            }
            let quoteInfo = undefined;
            if (session.quote) {
                quoteInfo = {
                    messageId: session.quote.messageId || session.quote.id,
                    id: session.quote.id,
                    content: session.quote.content || '',
                    elements: this.stripFaceElements(session.quote.elements),
                    user: {
                        id: session.quote.user?.id || session.quote.user?.userId || 'unknown',
                        name: session.quote.user?.name || session.quote.user?.username || 'unknown',
                        userId: session.quote.user?.userId || session.quote.user?.id || 'unknown',
                        avatar: session.quote.user?.avatar,
                        username: session.quote.user?.username || session.quote.user?.name || 'unknown'
                    },
                    timestamp: session.quote.timestamp || Date.now()
                };
            }
            let content = '';
            let elements = [];
            if (session.content) {
                content = session.content;
            }
            else if (session.stripped?.content) {
                content = session.stripped.content;
            }
            if (session.elements) {
                elements = this.stripFaceElements(session.elements);
                if (!content) {
                    content = elements
                        .filter((element) => element.type === 'text')
                        .map((element) => element.attrs?.content || '')
                        .join('');
                }
            }
            // QQ 表情占位符（<faceType=...> / [face:n]）不再在这里剥离，
            // 保留在 content 中由前端负责渲染成 qq_emoji 图片或“不支持的第三方表情”。
            const messageInfo = {
                id: session.event?.message?.id || `msg-${timestamp}`,
                content: content || session.content || '',
                userId: session.userId || session.event?.user?.id || 'unknown',
                username: session.username || session.event?.user?.name || session.userId || 'unknown',
                avatar: session.event?.user?.avatar,
                role: session.event?.user?.role,
                timestamp: timestamp,
                channelId: session.channelId,
                selfId: session.selfId,
                elements: elements,
                type: 'user',
                guildName: guildName,
                platform: session.platform || 'unknown',
                quote: quoteInfo,
                isDirect: !!isDirect
            };
            messageInfo.elements = await this.utils.cleanBase64ContentAsync(messageInfo.elements, false);
            messageInfo.quote = messageInfo.quote ? await this.utils.cleanBase64ContentAsync(messageInfo.quote, false) : undefined;
            await this.fileManager.addMessageToFile(messageInfo);
            const eventElements = await this.utils.cleanBase64ContentAsync(elements, false);
            const eventQuote = quoteInfo ? await this.utils.cleanBase64ContentAsync(quoteInfo, false) : undefined;
            const messageEvent = {
                type: 'message',
                selfId: session.selfId,
                platform: session.platform || 'unknown',
                channelId: session.channelId,
                messageId: session.event?.message?.id || `msg-${timestamp}`,
                content: content || session.content || '',
                userId: session.userId || session.event?.user?.id || 'unknown',
                username: session.username || session.event?.user?.name || session.userId || 'unknown',
                avatar: session.event?.user?.avatar,
                role: session.event?.user?.role,
                timestamp: timestamp,
                guildName: guildName,
                channelType: session.type || 0,
                elements: eventElements,
                quote: eventQuote,
                isDirect: session.isDirect,
                bot: {
                    avatar: session.bot.user?.avatar,
                    name: session.bot.user?.name,
                }
            };
            this.ctx.console.broadcast('chat-message-event', messageEvent);
        }
        catch (error) {
            this.logger.error('处理用户消息失败:', error);
        }
    }
    async processBotMessage(session, timestamp) {
        try {
            if (!timestamp)
                timestamp = Date.now();
            const correctChannelId = this.getCorrectChannelId(session.selfId);
            const finalChannelId = correctChannelId || session.channelId;
            this.updateBotInfoToFile(session);
            const guildName = this.updateChannelInfoToFile(session);
            const isDirect = session.isDirect || finalChannelId?.includes('private');
            let content = session.content || '';
            if (!content && session.event?.message?.elements) {
                content = this.utils.extractTextContent(session.event.message.elements).trim();
            }
            // 表情占位符保留给前端渲染（同 processUserMessage）
            let quoteInfo = undefined;
            const quoteMatch = content.match(/<quote id="([^"]+)"\/>/);
            if (quoteMatch) {
                const quoteId = quoteMatch[1];
                const quotedMsg = await this.fileManager.findChannelMessageById(session.selfId, finalChannelId, quoteId);
                if (quotedMsg) {
                    const realId = quotedMsg.id.startsWith('bot-msg-') ? quotedMsg.realId : quotedMsg.id;
                    quoteInfo = {
                        messageId: realId || quotedMsg.id,
                        id: realId || quotedMsg.id,
                        content: quotedMsg.content,
                        elements: quotedMsg.elements,
                        user: {
                            id: quotedMsg.userId,
                            name: quotedMsg.username,
                            userId: quotedMsg.userId,
                            avatar: quotedMsg.avatar,
                            username: quotedMsg.username
                        },
                        timestamp: quotedMsg.timestamp
                    };
                    content = content.replace(/<quote id="[^"]+"\/>\s*/, '');
                    if (realId) {
                        session.content = session.content.replace(/id="[^"]+"/, `id="${realId}"`);
                    }
                }
            }
            // 创建机器人消息信息对象
            const messageInfo = {
                id: `bot-msg-${timestamp}`,
                content: content,
                userId: session.selfId,
                username: session.bot.user?.name || `Bot-${session.selfId}`,
                avatar: session.bot.user?.avatar,
                timestamp: timestamp,
                channelId: finalChannelId,
                selfId: session.selfId,
                elements: this.stripFaceElements(await this.utils.cleanBase64ContentAsync(session.event?.message?.elements, true)),
                type: 'bot',
                guildName: guildName,
                platform: session.platform || 'unknown',
                quote: quoteInfo,
                isDirect: !!isDirect,
                sending: true // 标记为正在发送
            };
            // 异步保存消息（不阻塞）
            await this.fileManager.addMessageToFile(messageInfo);
            const eventElements = this.stripFaceElements(await this.utils.cleanBase64ContentAsync(session.event?.message?.elements, true));
            const messageEvent = {
                type: 'bot-message',
                selfId: session.selfId,
                platform: session.platform || 'unknown',
                channelId: finalChannelId,
                messageId: `bot-msg-${timestamp}`,
                content: content,
                userId: session.selfId,
                username: session.bot.user?.name || `Bot-${session.selfId}`,
                avatar: session.bot.user?.avatar,
                timestamp: timestamp,
                guildName: guildName,
                channelType: session.event?.channel?.type || session.type || 0,
                elements: eventElements,
                quote: quoteInfo,
                isDirect: !!isDirect,
                sending: true,
                bot: {
                    avatar: session.bot.user?.avatar,
                    name: session.bot.user?.name,
                }
            };
            this.ctx.console.broadcast('chat-bot-message-event', messageEvent);
        }
        catch (error) {
            this.logger.error('处理机器人消息失败:', error);
        }
    }
    // 屏蔽 QQ 表情（face）元素：类型为 face/faceType，含 faceId/faceType 属性，或内容本身就是 face 序列化的文本
    stripFaceElements(elements) {
        if (!Array.isArray(elements))
            return elements;
        const isFace = (el) => !!el && (el.type === 'face' || el.type === 'faceType'
            || (el.attrs && ('faceId' in el.attrs || 'faceType' in el.attrs))
            || (el.type === 'text' && /^<face[^>]*>\s*$/i.test((el.attrs?.content || '').trim())));
        const result = [];
        for (const el of elements) {
            if (isFace(el))
                continue;
            if (el.children?.length) {
                el.children = this.stripFaceElements(el.children);
            }
            result.push(el);
        }
        return result;
    }
    dispose() {
        void this.utils.dispose();
        for (const dispose of this.scheduledTasks) {
            dispose();
        }
        this.scheduledTasks.clear();
    }
    scheduleTask(label, task) {
        const dispose = this.ctx.setTimeout(() => {
            this.scheduledTasks.delete(dispose);
            void task().catch((error) => {
                this.logger.error(`${label}失败:`, error);
            });
        }, 0);
        this.scheduledTasks.add(dispose);
    }
    shouldRefreshChannelInfo(channelKey, existingChannel, isDirect, channelId, directUserName) {
        if (this.channelRefreshInFlight.has(channelKey)) {
            return false;
        }
        const lastRefresh = this.lastChannelRefreshAt.get(channelKey) || 0;
        if (Date.now() - lastRefresh < this.CHANNEL_REFRESH_TTL_MS) {
            return false;
        }
        if (isDirect) {
            return !directUserName && (!existingChannel || existingChannel.name.includes('未知'));
        }
        return !existingChannel?.guildName || existingChannel.guildName === channelId || !existingChannel?.botState;
    }
    async resolveBotGroupState(session) {
        const groupOpenid = session.guildId || session.channelId;
        // 检查缓存，如果已经确认机器人不是管理员，直接返回
        const cachedState = this.fileManager.getCachedChannelInfo(session.selfId, groupOpenid);
        if (cachedState?.botState?.isNonAdmin === true) {
            this.logger.logInfo('机器人已确认为非管理员，跳过禁言状态查询', { groupOpenid });
            return cachedState.botState;
        }
        try {
            const bot = session.bot;
            const fetchState = bot?.internal?.getBotGroupState
                ? () => bot.internal.getBotGroupState(groupOpenid)
                : typeof bot?.refreshBotGroupState === 'function'
                    ? () => bot.refreshBotGroupState(groupOpenid)
                    : null;
            if (!fetchState)
                return undefined;
            const state = await fetchState();
            if (!state)
                return undefined;
            // 查询群禁言状态（全员禁言），但需要先检查机器人是否为管理员
            let globalMuted;
            let isNonAdmin = false;
            try {
                // 方法1：通过 getGuildMember 检查机器人角色
                let isAdmin = false;
                try {
                    if (session.bot.getGuildMember && typeof session.bot.getGuildMember === 'function') {
                        const memberInfo = await session.bot.getGuildMember(groupOpenid, session.selfId);
                        // 通过 roles 数组判断是否为管理员
                        if (memberInfo?.roles && Array.isArray(memberInfo.roles)) {
                            isAdmin = memberInfo.roles.some((role) => {
                                const roleName = (role.name || '').toLowerCase();
                                const roleId = role.id || '';
                                return roleName === 'admin' ||
                                    roleName === 'owner' ||
                                    roleName === '管理员' ||
                                    roleName === '群主' ||
                                    roleId === 'admin' ||
                                    roleId === 'owner';
                            });
                        }
                        this.logger.logInfo('检查机器人管理员状态:', { groupOpenid, isAdmin });
                    }
                }
                catch (memberErr) {
                    this.logger.logInfo('获取机器人成员信息失败，尝试通过API查询:', memberErr);
                }
                // 方法2：如果确认是管理员，查询禁言状态
                if (isAdmin) {
                    if (bot?.internal?.getRestrictChatSetting) {
                        const setting = await bot.internal.getRestrictChatSetting(groupOpenid);
                        globalMuted = this.computeGlobalMuted(setting);
                        this.logger.logInfo('查询禁言状态成功', { groupOpenid, globalMuted });
                    }
                }
                else {
                    // 不是管理员，标记并跳过
                    isNonAdmin = true;
                    this.logger.logInfo('机器人不是群管理员，跳过禁言状态查询', { groupOpenid });
                }
            }
            catch (error) {
                // 捕获 "机器人不是群管理员" 错误码 11703
                if (error?.response?.data?.code === 11703 ||
                    error?.response?.data?.err_code === 40011030 ||
                    (error?.response?.data?.message || '').includes('机器人不是群管理员')) {
                    isNonAdmin = true;
                    this.logger.logInfo('机器人不是群管理员（API返回），已标记', { groupOpenid });
                    // 不抛出错误，继续执行
                }
                else {
                    // 其他错误记录但不中断
                    this.logger.warn('查询群禁言状态失败:', error);
                }
            }
            const result = {
                memberRole: state.member_role,
                allowProactiveMsg: state.allow_proactive_msg,
                recvMsgSetting: state.recv_msg_setting,
                joinedAt: state.joined_at,
                memberOpenid: state.member_openid,
                inGroup: true,
                globalMuted,
                isNonAdmin
            };
            return result;
        }
        catch (error) {
            // 鉴权失败、机器人非群成员 => 机器人已被移出该群
            if (this.isNotGroupMemberError(error)) {
                this.logger.warn('机器人已不在该群（可能被移出）:', groupOpenid);
                return { inGroup: false };
            }
            this.logger.warn('获取机器人群内状态失败:', error);
            return undefined;
        }
    }
    /** 根据查询群禁言状态的结果，判断群级（全员）禁言当前是否生效 */
    computeGlobalMuted(setting) {
        const mode = setting?.global_rule?.mode;
        if (mode === 'always')
            return true;
        if (mode !== 'schedule')
            return false;
        const now = new Date();
        const nowMs = now.getTime();
        const schedule = setting?.global_rule?.schedule_rules || [];
        for (const rule of schedule) {
            if (rule?.enabled && rule.start_at && rule.end_at) {
                const start = new Date(rule.start_at).getTime();
                const end = new Date(rule.end_at).getTime();
                if (nowMs >= start && nowMs <= end)
                    return true;
            }
        }
        const weekdayMap = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
        const today = weekdayMap[now.getDay()];
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const recurring = setting?.global_rule?.recurring_rules || [];
        for (const rule of recurring) {
            if (!rule?.enabled || !Array.isArray(rule.weekdays) || !rule.weekdays.includes(today))
                continue;
            const start = String(rule.start_time || '').split(':').map(Number);
            const end = String(rule.end_time || '').split(':').map(Number);
            if (start.length < 2 || end.length < 2 || isNaN(start[0]) || isNaN(end[0]))
                continue;
            const startMin = start[0] * 60 + (start[1] || 0);
            const endMin = end[0] * 60 + (end[1] || 0);
            if (endMin <= startMin) {
                // 跨天到次日
                if (nowMin >= startMin || nowMin < endMin)
                    return true;
            }
            else if (nowMin >= startMin && nowMin < endMin) {
                return true;
            }
        }
        return false;
    }
    isNotGroupMemberError(error) {
        if (!error)
            return false;
        const data = error?.response?.data;
        const message = typeof data === 'string'
            ? data
            : String(data?.message || error?.message || error?.statusMessage || '');
        const text = message.toLowerCase();
        return text.includes('非群成员') ||
            text.includes('不在群') ||
            text.includes('已不在群') ||
            text.includes('已退出') ||
            text.includes('not a member') ||
            text.includes('not in group');
    }
    async refreshChannelInfo(session, existingChannel, isDirect, directUserName) {
        const channelKey = `${session.selfId}:${session.channelId}`;
        this.channelRefreshInFlight.add(channelKey);
        try {
            let guildName = existingChannel?.guildName || session.channelId;
            let botState;
            if (!isDirect) {
                guildName = await this.resolveGuildName(session);
                botState = await this.resolveBotGroupState(session);
                // 如果是非管理员，记录日志但不重复查询
                if (botState?.isNonAdmin) {
                    this.logger.logInfo('已缓存非管理员状态，后续不再查询禁言', {
                        channelId: session.channelId,
                        selfId: session.selfId
                    });
                }
            }
            const finalName = this.buildChannelName(session, existingChannel, isDirect, directUserName, guildName);
            const channelInfo = {
                id: session.channelId,
                name: finalName,
                type: session.type || 0,
                channelId: session.channelId,
                guildName,
                isDirect: !!isDirect,
                botState
            };
            await this.fileManager.upsertChannelInfo(session.selfId, session.channelId, channelInfo);
            this.lastChannelRefreshAt.set(channelKey, Date.now());
            this.logger.logInfo('更新频道信息到文件:', channelInfo.name, botState ? `群内状态=${botState.memberRole} 主动推送=${botState.allowProactiveMsg}` : '');
            this.ctx.console.broadcast('chat-data-updated', {
                channel: {
                    selfId: session.selfId,
                    channelId: session.channelId,
                    channelInfo
                }
            });
        }
        finally {
            this.channelRefreshInFlight.delete(channelKey);
        }
    }
    async resolveGuildName(session) {
        try {
            if (session.guildId && session.bot.getGuild && typeof session.bot.getGuild === 'function') {
                const guild = await session.bot.getGuild(session.guildId);
                return guild?.name || session.channelId;
            }
            if (session.guildId && session.bot.getChannel && typeof session.bot.getChannel === 'function') {
                const channel = await session.bot.getChannel(session.guildId);
                return channel?.name || session.channelId;
            }
        }
        catch (error) {
            this.logger.logInfo('获取频道信息失败，使用频道ID作为备用:', error);
        }
        return session.channelId;
    }
    buildChannelName(session, existingChannel, isDirect, directUserName, guildName) {
        if (isDirect) {
            if (directUserName && directUserName !== session.userId) {
                return `私聊（${directUserName}）`;
            }
            if (existingChannel?.name && !existingChannel.name.includes('未知')) {
                return existingChannel.name;
            }
            if (session.platform && session.platform.toLowerCase().includes('sandbox')) {
                return `私聊（${session.userId}）`;
            }
            return '私聊（未知用户）';
        }
        return guildName || session.channelId;
    }
    async processMediaElements(elements, isUserMessage) {
        for (const el of elements) {
            const src = el.attrs?.src || el.attrs?.url || el.attrs?.file;
            if (!src || !isUserMessage) {
                if (el.children?.length) {
                    await this.processMediaElements(el.children, isUserMessage);
                }
                continue;
            }
            const mediaType = this.guessMediaTypeForElement(el, src);
            if (mediaType === 'image') {
                try {
                    await this.downloadAndCacheMedia(src, 'image');
                }
                catch (error) {
                    this.logger.warn('缓存图片失败:', error);
                }
            }
            else if (mediaType === 'audio') {
                try {
                    await this.downloadAndCacheMedia(src, 'audio');
                }
                catch (error) {
                    this.logger.warn('缓存语音失败:', error);
                }
            }
            if (el.children?.length) {
                await this.processMediaElements(el.children, isUserMessage);
            }
        }
    }
    guessMediaTypeForElement(el, src) {
        const type = (el.type || '').toLowerCase();
        if (['image', 'img', 'mface'].includes(type))
            return 'image';
        if (['audio', 'voice', 'record'].includes(type))
            return 'audio';
        if (el.attrs?.type && /audio|voice|record/i.test(String(el.attrs.type)))
            return 'audio';
        const lower = src.toLowerCase();
        if (/(?:^|\/|\.)(jpg|jpeg|png|gif|bmp|webp|svg)(?:\?|$)/.test(lower))
            return 'image';
        if (/(?:^|\/|\.)(mp3|wav|m4a|aac|ogg|amr|silk|flac)(?:\?|$)/.test(lower))
            return 'audio';
        return 'media';
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
}
exports.MessageHandler = MessageHandler;
