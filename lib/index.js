"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.usage = exports.inject = exports.filter = exports.reusable = exports.name = void 0;
exports.apply = apply;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const message_handler_1 = require("./message-handler");
const file_manager_1 = require("./file-manager");
const api_handlers_1 = require("./api-handlers");
const logger_1 = require("./logger");
const utils_1 = require("./utils");
exports.name = 'qq-chat';
exports.reusable = false;
exports.filter = true;
exports.inject = {
    required: ['console'],
    optional: ['silk', 'ffmpeg', 'assets', 'server']
};
exports.usage = `

---

开启后，即可在koishi控制台操作机器人收发消息啦

---
`;
var config_1 = require("./config");
Object.defineProperty(exports, "Config", { enumerable: true, get: function () { return config_1.Config; } });
async function apply(ctx, config) {
    const pluginLogger = (0, logger_1.createPluginLogger)(ctx.logger('qq-chat'), config);
    const fileManager = new file_manager_1.FileManager(ctx, config, pluginLogger);
    await fileManager.initialize();
    const messageHandler = new message_handler_1.MessageHandler(ctx, config, fileManager, pluginLogger);
    const apiHandlers = new api_handlers_1.ApiHandlers(ctx, config, fileManager, messageHandler, pluginLogger);
    const utils = new utils_1.Utils(config, ctx);
    const metadata = await fileManager.readMetadataOnly();
    pluginLogger.logInfo('插件加载完成，元数据统计:', {
        机器人数量: Object.keys(metadata.bots).length,
        频道数量: Object.keys(metadata.channels).reduce((total, botId) => total + Object.keys(metadata.channels[botId] || {}).length, 0),
        置顶机器人数量: metadata.pinnedBots.length,
        置顶频道数量: metadata.pinnedChannels.length
    });
    ctx.on('message', (session) => {
        // 只记录 QQ 平台消息（recordUserMessage 内部已做平台过滤）
        messageHandler.recordUserMessage(session, Date.now());
    });
    ctx.on('before-send', (session) => {
        // 只记录 QQ 平台消息（recordBotMessage 内部已做平台过滤）
        messageHandler.recordBotMessage(session, Date.now());
    });
    // 群成员加入 / 退出：在消息列表中间显示系统提示
    ctx.on('guild-member-added', (session) => {
        messageHandler.recordGroupMemberEvent(session, 'added');
    });
    ctx.on('guild-member-removed', (session) => {
        messageHandler.recordGroupMemberEvent(session, 'removed');
    });
    // 用户申请加群：系统提示 + 去处理按钮（仅机器人是群管理员时收到）
    ctx.on('guild-member-request', (session) => {
        messageHandler.recordJoinRequestEvent(session);
    });
    // 消息按钮互动事件（适配器已自动 ack，这里记录日志便于查看）
    ctx.on('interaction/button', (session) => {
        pluginLogger.logInfo('收到按钮互动:', {
            buttonId: session.event?.button?.id,
            data: session.event?.button?.data,
            userId: session.userId,
            channelId: session.channelId
        });
    });
    let cleanupDelayTimer;
    let cleanupInterval;
    ctx.on('ready', async () => {
        pluginLogger.logInfo('插件启动完成，开始监听消息');
        // 延后清理，避免和 Koishi 刚 ready 时的资源竞争。
        cleanupDelayTimer = ctx.setTimeout(() => {
            void fileManager.cleanupExcessMessagesInStorage();
        }, 15000);
        cleanupInterval = ctx.setInterval(() => {
            void fileManager.cleanupExcessMessagesInStorage();
        }, 300000);
    });
    apiHandlers.registerApiHandlers();
    // 生产模式兼容：Koishi 生产环境没有 Vite 开发服务器。
    // 注册静态路由来加载本地缓存的媒体文件（图片 / 视频 / 音频 / 头像）。
    if (ctx.server) {
        const mediaRoot = node_path_1.default.join(ctx.baseDir, 'data', 'qq-chat');
        // 插件自带 QQ 表情素材目录（发布后位于 node_modules/koishi-plugin-qq-chat/qq_emoji）
        const emojiRoot = node_path_1.default.join(__dirname, '..', 'qq_emoji');
        // 统一中间件：1) 插件入口文件禁用缓存  2) 提供本地媒体文件服务  3) 提供 QQ 表情静态资源。
        // 用 use() + 手动解析路径，兼容 koa-router 各版本（不依赖 (.*) 参数捕获）。
        ctx.server.use(async (routerCtx, next) => {
            const p = routerCtx.path;
            if (p.includes('/@plugin-')) {
                routerCtx.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
                routerCtx.set('Pragma', 'no-cache');
            }
            // 远程图片下载代理：/qq-chat/fetch-image?u=<远程URL>
            // QQ 的图片（如 multimedia.nt.qq.com.cn）直接引用显示不了，
            // 先由本服务下载缓存到 data/qq-chat/persist-media，再重定向到本地 /qq-chat/media
            if (p === '/qq-chat/fetch-image' || p.startsWith('/qq-chat/fetch-image?')) {
                try {
                    const target = String(routerCtx.query?.u || routerCtx.query?.url || '');
                    if (!/^https?:\/\//i.test(target)) {
                        routerCtx.status = 403;
                        return;
                    }
                    const hash = (0, node_crypto_1.createHash)('md5').update(target).digest('hex');
                    const extMatch = /\.(png|jpe?g|gif|webp|bmp|apng)(?:$|\?)/i.exec(target);
                    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
                    const dir = node_path_1.default.join(mediaRoot, 'persist-media', 'images');
                    await node_fs_1.promises.mkdir(dir, { recursive: true });
                    const filename = `${hash}.${ext}`;
                    const filePath = node_path_1.default.join(dir, filename);
                    const exists = await node_fs_1.promises.stat(filePath).then(() => true).catch(() => false);
                    if (!exists) {
                        const response = await fetch(target, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                                'Referer': ''
                            }
                        });
                        if (!response.ok) {
                            routerCtx.status = 502;
                            return;
                        }
                        const buffer = Buffer.from(await response.arrayBuffer());
                        if (buffer.length)
                            await node_fs_1.promises.writeFile(filePath, buffer);
                    }
                    const relative = node_path_1.default.relative(mediaRoot, filePath).replace(/\\/g, '/');
                    routerCtx.redirect(`/qq-chat/media/${relative}`);
                }
                catch {
                    routerCtx.status = 404;
                }
                return;
            }
            let raw = null;
            let asDownload = false;
            let root = mediaRoot;
            if (p.startsWith('/vite/@fs/')) {
                raw = p.slice('/vite/@fs/'.length);
            }
            else if (p.startsWith('/qq-chat/emoji/')) {
                raw = p.slice('/qq-chat/emoji/'.length);
                root = emojiRoot;
            }
            else if (p.startsWith('/qq-chat/media/')) {
                raw = p.slice('/qq-chat/media/'.length);
            }
            else if (p.startsWith('/qq-chat/download/')) {
                raw = p.slice('/qq-chat/download/'.length);
                asDownload = true;
            }
            if (raw == null)
                return await next();
            try {
                let filePath;
                try {
                    filePath = decodeURIComponent(raw);
                }
                catch {
                    filePath = raw;
                }
                let normalized;
                if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
                    // /vite/@fs/<绝对路径>（历史数据兼容）
                    normalized = node_path_1.default.normalize(node_path_1.default.resolve(filePath));
                }
                else {
                    // /qq-chat/<media|emoji>/<相对根目录的路径>
                    normalized = node_path_1.default.normalize(node_path_1.default.join(root, filePath));
                }
                // 只允许访问对应根目录（data/qq-chat 或 qq_emoji）下的文件，防止任意文件读取
                if (normalized !== root && !normalized.startsWith(root + node_path_1.default.sep)) {
                    routerCtx.status = 403;
                    return;
                }
                const stats = await node_fs_1.promises.stat(normalized);
                if (!stats.isFile()) {
                    routerCtx.status = 404;
                    return;
                }
                // 表情素材可被浏览器长期缓存
                if (p.startsWith('/qq-chat/emoji/')) {
                    routerCtx.set('Cache-Control', 'public, max-age=86400');
                }
                routerCtx.type = node_path_1.default.extname(normalized);
                if (asDownload) {
                    const fname = node_path_1.default.basename(normalized);
                    routerCtx.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
                }
                routerCtx.body = (0, node_fs_1.createReadStream)(normalized);
            }
            catch {
                routerCtx.status = 404;
            }
        });
    }
    ctx.console.addEntry({
        dev: node_path_1.default.resolve(__dirname, '../client/index.ts'),
        prod: node_path_1.default.resolve(__dirname, '../dist'),
    });
    ctx.on('dispose', () => {
        cleanupDelayTimer?.();
        cleanupInterval?.();
        messageHandler.dispose();
        void fileManager.dispose();
        pluginLogger.logInfo('插件已卸载，所有待处理的消息已写入');
    });
}
