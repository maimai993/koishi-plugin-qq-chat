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
        // Markdown 面板的图片上传需要 assets 服务（推荐 koishi-plugin-assets-qqbot-part-file）
        if (ctx.assets?.upload) {
            pluginLogger.logInfo('assets 服务已就绪：Markdown 面板可直接拖入 / 粘贴图片');
        }
        else {
            pluginLogger.logInfo('未检测到 assets 服务：Markdown 面板图片会退回本地地址（QQ 可能无法加载），建议启用 koishi-plugin-assets-qqbot-part-file');
        }
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
        // ===== 访问控制 =====
        // 启用 @koishijs/plugin-auth 后：
        //  - 控制台监听 / 广播由 authority 交给 auth 插件统一拦截（见 api-handlers / message-handler）
        //  - 独立窗口 / 沙盒窗口、聊天媒体、背景图、图片代理走的是普通 HTTP，没有 websocket 会话，
        //    因此由客户端把登录令牌同步到 cookie（client/auth.ts），这里校验该 cookie
        // 没启用 auth 插件时（或用户关掉 loginRequired）不做任何拦截，行为与以前一致。
        const authCookieName = 'qq-chat-auth';
        const parseCookies = (header) => {
            const out = {};
            for (const part of String(header || '').split(';')) {
                const idx = part.indexOf('=');
                if (idx < 0)
                    continue;
                const key = part.slice(0, idx).trim();
                if (!key)
                    continue;
                try {
                    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
                }
                catch {
                    out[key] = part.slice(idx + 1).trim();
                }
            }
            return out;
        };
        // 是否处于「需要登录」的状态：只有启用了 auth 插件 + 用户没关掉 loginRequired 才需要
        // 注意：只能用 ctx.get('auth') 查询，直接读 ctx.auth 会在没装 auth 插件时报警告
        const authRequired = () => {
            if (config.loginRequired === false)
                return false;
            return !!ctx.get?.('auth');
        };
        const isConsoleAuthed = async (routerCtx) => {
            if (!authRequired())
                return true;
            const raw = parseCookies(routerCtx.headers?.cookie)[authCookieName];
            if (!raw)
                return false;
            const idx = raw.indexOf(':');
            if (idx <= 0)
                return false;
            const id = Number(raw.slice(0, idx));
            const token = raw.slice(idx + 1);
            if (!Number.isFinite(id) || !token)
                return false;
            const database = ctx.get?.('database');
            if (!database?.get)
                return false;
            try {
                const rows = await database.get('token', { id, token }, ['expiredAt']);
                return !!rows?.[0] && Number(rows[0].expiredAt) > Date.now();
            }
            catch {
                return false;
            }
        };
        const unauthorizedHtml = [
            '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8" />',
            '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
            '<title>需要登录</title></head>',
            '<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1b1f;color:#e6e7ee;font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif">',
            '<div style="max-width:520px;padding:0 24px;line-height:1.8">',
            '<h2 style="margin:0 0 12px">需要登录 Koishi 控制台</h2>',
            '<p style="opacity:.8">当前实例启用了 auth 插件，本插件的独立窗口 / 沙盒窗口以及聊天媒体都需要登录后才能访问。</p>',
            '<p><a href="/" style="color:#5b8cff">打开 Koishi 控制台登录</a>，登录后回到本页刷新即可。</p>',
            '<p style="opacity:.5;font-size:13px">（如果希望这些地址保持公开，可在插件配置里关闭「访问控制 → loginRequired」）</p>',
            '</div></body></html>'
        ].join('');
        // 需要登录才能访问的路径：窗口、聊天媒体、下载、图片代理、背景图、历史 /vite/@fs 兼容路径
        const needsAuth = (p) => p === '/qq-chat/background'
            || p.startsWith('/qq-chat/fetch-image')
            || p.startsWith('/qq-chat/window')
            || p.startsWith('/qq-chat/sandbox')
            || p.startsWith('/qq-chat/download/')
            || p.startsWith('/vite/@fs/')
            || p.startsWith('/qq-chat/media/persist-media/')
            || p.startsWith('/qq-chat/media/persist-images/');
        // 统一中间件：1) 插件入口文件禁用缓存  2) 提供本地媒体文件服务  3) 提供 QQ 表情静态资源。
        // 用 use() + 手动解析路径，兼容 koa-router 各版本（不依赖 (.*) 参数捕获）。
        ctx.server.use(async (routerCtx, next) => {
            const p = routerCtx.path;
            if (p.includes('/@plugin-')) {
                routerCtx.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
                routerCtx.set('Pragma', 'no-cache');
            }
            // 启用 auth 插件时：窗口 / 私有媒体等必须先登录（详见上面的访问控制说明）
            if (needsAuth(p) && !(await isConsoleAuthed(routerCtx))) {
                const isWindow = p === '/qq-chat/window' || p.startsWith('/qq-chat/window/')
                    || p === '/qq-chat/sandbox' || p.startsWith('/qq-chat/sandbox/');
                if (isWindow) {
                    routerCtx.type = 'html';
                    routerCtx.status = 401;
                    routerCtx.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
                    routerCtx.body = unauthorizedHtml;
                }
                else {
                    routerCtx.status = 401;
                    routerCtx.type = 'text/plain';
                    routerCtx.body = 'unauthorized';
                }
                return;
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
                    // 本机 /qq-chat 地址（历史消息里的绝对地址）：直接让浏览器自己去取，
                    // 否则服务端自取会变成「没有登录态的请求」，被上面的鉴权挡掉
                    try {
                        const parsed = new URL(target);
                        if (/^\/qq-chat\//.test(parsed.pathname)) {
                            routerCtx.redirect(parsed.pathname + parsed.search);
                            return;
                        }
                    }
                    catch { /* 忽略 */ }
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
            // 独立聊天窗口 / 沙盒窗口：/qq-chat/window、/qq-chat/sandbox
            // （都只渲染单个频道的聊天界面，可单独开窗口；沙盒窗口发的消息只在本机执行，点「发送到当前频道」才真的发到 QQ）
            const staticWindows = [
                { prefix: '/qq-chat/window', html: 'standalone.html' },
                { prefix: '/qq-chat/sandbox', html: 'sandbox.html' }
            ];
            const matchedWindow = staticWindows.find((item) => p === item.prefix || p === `${item.prefix}/` || p.startsWith(`${item.prefix}/`));
            if (matchedWindow) {
                try {
                    const distDir = node_path_1.default.join(__dirname, '..', 'dist');
                    const rel = p.replace(new RegExp(`^${matchedWindow.prefix}/?`), '');
                    if (!rel) {
                        const html = await node_fs_1.promises.readFile(node_path_1.default.join(distDir, matchedWindow.html), 'utf8').catch(() => null);
                        if (!html) {
                            routerCtx.type = 'html';
                            routerCtx.status = 500;
                            routerCtx.body = '<meta charset="utf-8"><h3>窗口尚未构建</h3><p>请在插件目录执行 <code>npm run build:client</code>（先构建控制台页面，再构建独立窗口 / 沙盒窗口）。</p>';
                            return;
                        }
                        let globalConfig = {};
                        try {
                            globalConfig = ctx.console?.createGlobal?.() || {};
                        }
                        catch {
                            globalConfig = {};
                        }
                        if (!globalConfig.endpoint) {
                            const consoleConfig = ctx.console?.config || {};
                            globalConfig = {
                                devMode: false,
                                uiPath: consoleConfig.uiPath || '',
                                endpoint: (consoleConfig.selfUrl || '') + (consoleConfig.apiPath || '/status'),
                                heartbeat: consoleConfig.heartbeat
                            };
                        }
                        routerCtx.type = 'html';
                        routerCtx.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
                        routerCtx.body = html.replace('{/*KOISHI_CONFIG*/}', JSON.stringify(globalConfig));
                        return;
                    }
                    const filePath = node_path_1.default.normalize(node_path_1.default.join(distDir, rel));
                    if (!filePath.startsWith(distDir)) {
                        routerCtx.status = 403;
                        return;
                    }
                    const stats = await node_fs_1.promises.stat(filePath).catch(() => null);
                    if (!stats || !stats.isFile()) {
                        routerCtx.status = 404;
                        return;
                    }
                    routerCtx.type = node_path_1.default.extname(filePath);
                    routerCtx.body = (0, node_fs_1.createReadStream)(filePath);
                }
                catch {
                    routerCtx.status = 404;
                }
                return;
            }
            // 聊天区自定义背景图：/qq-chat/background（本地文件路径或远程链接）
            if (p === '/qq-chat/background') {
                try {
                    const source = String(config.chatBackground || '').trim();
                    if (!source) {
                        routerCtx.status = 404;
                        return;
                    }
                    if (/^https?:\/\//i.test(source)) {
                        routerCtx.redirect(source);
                        return;
                    }
                    const filePath = node_path_1.default.isAbsolute(source) ? source : node_path_1.default.join(ctx.baseDir, source);
                    const stats = await node_fs_1.promises.stat(filePath).catch(() => null);
                    if (!stats || !stats.isFile()) {
                        routerCtx.status = 404;
                        return;
                    }
                    routerCtx.type = node_path_1.default.extname(filePath) || '.jpg';
                    routerCtx.set('Cache-Control', 'no-cache');
                    routerCtx.body = (0, node_fs_1.createReadStream)(filePath);
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
