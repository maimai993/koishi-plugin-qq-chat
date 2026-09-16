"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MobileApi = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const TOKEN_COOKIE = 'qq-chat-mobile';
class MobileApi {
    constructor(baseDir, logger, deps, mobilePassword = '', notifyRules) {
        this.baseDir = baseDir;
        this.logger = logger;
        this.deps = deps;
        this.mobilePassword = mobilePassword;
        this.notifyRules = notifyRules;
        this.tokens = null;
        /** SSE 客户端：直接持有响应对象，广播时往里写 */
        this.clients = new Set();
        /** 登录失败次数（防爆破，按 IP 记） */
        this.failures = new Map();
        this.tokensFile = node_path_1.default.join(baseDir, 'data', 'qq-chat', 'v2', 'mobile-tokens.json');
    }
    // ===== 令牌 =====
    async loadTokens() {
        if (this.tokens)
            return this.tokens;
        try {
            const raw = await node_fs_1.promises.readFile(this.tokensFile, 'utf8');
            const data = JSON.parse(raw);
            this.tokens = Array.isArray(data?.tokens) ? data.tokens.filter((t) => t?.token) : [];
        }
        catch {
            this.tokens = [];
        }
        return this.tokens;
    }
    async saveTokens() {
        try {
            await node_fs_1.promises.mkdir(node_path_1.default.dirname(this.tokensFile), { recursive: true });
            await node_fs_1.promises.writeFile(this.tokensFile, JSON.stringify({ version: 1, tokens: this.tokens || [] }, null, 2), 'utf8');
        }
        catch (error) {
            this.logger.warn('保存手机端令牌失败:', error?.message || error);
        }
    }
    async issueToken(name, days = 180) {
        const list = await this.loadTokens();
        const token = (0, node_crypto_1.randomBytes)(24).toString('base64url');
        const entry = {
            token,
            name: String(name || 'mobile').slice(0, 40),
            createdAt: Date.now(),
            lastSeenAt: Date.now()
        };
        list.push(entry);
        // 只保留最近 20 个令牌，避免文件无限增长
        if (list.length > 20)
            list.splice(0, list.length - 20);
        await this.saveTokens();
        this.logger.info(`手机端已登录：${entry.name}（令牌有效期 ${days} 天）`);
        return entry;
    }
    async revokeAll() {
        this.tokens = [];
        await this.saveTokens();
    }
    async listTokens() {
        return (await this.loadTokens()).map((t) => ({ name: t.name, createdAt: t.createdAt, lastSeenAt: t.lastSeenAt }));
    }
    async tokenValid(token) {
        if (!token)
            return false;
        const list = await this.loadTokens();
        const hit = list.find((t) => t.token === token);
        if (!hit)
            return false;
        hit.lastSeenAt = Date.now();
        return true;
    }
    /** 解析请求里的访问令牌（Authorization 头 / cookie / query） */
    extractToken(routerCtx) {
        const header = String(routerCtx.headers?.authorization || '');
        const bearer = /^Bearer\s+(.+)$/i.exec(header);
        if (bearer)
            return bearer[1].trim();
        const raw = String(routerCtx.headers?.cookie || '');
        for (const part of raw.split(';')) {
            const idx = part.indexOf('=');
            if (idx < 0)
                continue;
            if (part.slice(0, idx).trim() !== TOKEN_COOKIE)
                continue;
            try {
                return decodeURIComponent(part.slice(idx + 1).trim());
            }
            catch {
                return part.slice(idx + 1).trim();
            }
        }
        return String(routerCtx.query?.token || '');
    }
    /** 供 index.ts 判断普通 HTTP 请求（聊天媒体等）是否带着有效的手机端令牌 */
    async isRequestAuthed(routerCtx) {
        const token = this.extractToken(routerCtx);
        return !!(token && await this.tokenValid(token));
    }
    /**
     * 是否允许访问：
     *  - 没设手机密码 → 沿用原来的访问控制（启用 auth 时要求控制台登录，否则公开）
     *  - 设了手机密码 → 必须带有效手机令牌或控制台登录 cookie（否则密码形同虚设）
     */
    async authorize(routerCtx) {
        if (!this.passwordRequired()) {
            if (await this.deps.isConsoleAuthed(routerCtx))
                return { ok: true, kind: 'console' };
            return { ok: true, kind: 'open' };
        }
        if (await this.deps.hasConsoleSession(routerCtx))
            return { ok: true, kind: 'console' };
        const token = this.extractToken(routerCtx);
        if (token && await this.tokenValid(token))
            return { ok: true, kind: 'mobile' };
        return { ok: false, kind: 'none' };
    }
    /** 是否需要密码：配置了访问密码就一定要（不看 auth 插件） */
    passwordRequired() {
        return !!this.mobilePassword;
    }
    // ===== 广播 =====
    /** 把控制台的广播同步给所有手机端 SSE 连接 */
    broadcast(name, body) {
        if (!this.clients.size)
            return;
        const payload = `event: message\ndata: ${JSON.stringify({ type: name, body })}\n\n`;
        for (const client of [...this.clients]) {
            try {
                client.res.write(payload);
            }
            catch {
                this.clients.delete(client);
            }
        }
    }
    addClient(routerCtx) {
        const client = { res: routerCtx.res, ip: routerCtx.ip };
        this.clients.add(client);
        const ping = setInterval(() => {
            try {
                routerCtx.res.write(': ping\n\n');
            }
            catch { /* 连接已断 */ }
        }, 25000);
        routerCtx.req.on('close', () => {
            clearInterval(ping);
            this.clients.delete(client);
        });
    }
    // ===== 工具 =====
    json(routerCtx, status, body) {
        routerCtx.status = status;
        routerCtx.type = 'application/json; charset=utf-8';
        routerCtx.set('Cache-Control', 'no-store');
        routerCtx.body = JSON.stringify(body);
    }
    readBody(routerCtx) {
        // 很多环境里上层中间件（koa bodyparser 之类）已经把 body 解析好了，
        // 这时流已经被读完，再去监听 req 的 data/end 会永远等不到 —— 优先用解析结果
        const parsed = routerCtx.request?.body ?? routerCtx.body;
        if (parsed && typeof parsed === 'object' && !Buffer.isBuffer(parsed))
            return Promise.resolve(parsed);
        if (typeof parsed === 'string' && parsed) {
            try {
                return Promise.resolve(JSON.parse(parsed));
            }
            catch {
                return Promise.resolve({});
            }
        }
        return new Promise((resolve) => {
            const chunks = [];
            let size = 0;
            const finish = (value) => {
                clearTimeout(timer);
                resolve(value);
            };
            // 兜底：万一流读不到（已被上游消费），别把请求挂死
            const timer = setTimeout(() => finish({}), 8000);
            routerCtx.req.on('data', (chunk) => {
                size += chunk.length;
                if (size > 8 * 1024 * 1024) {
                    finish(null);
                    return;
                }
                chunks.push(chunk);
            });
            routerCtx.req.on('end', () => {
                if (!chunks.length)
                    return finish({});
                try {
                    finish(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                }
                catch {
                    finish(null);
                }
            });
            routerCtx.req.on('error', () => finish(null));
        });
    }
    /** 调用控制台监听器（手机端与网页端共用同一套后端逻辑） */
    async callListener(name, args) {
        const registry = this.deps.getRegistry();
        const fn = registry?.[name];
        if (typeof fn !== 'function')
            throw new Error(`接口不存在：${name}`);
        return await fn.apply(null, Array.isArray(args) ? args : [args]);
    }
    lastLoginFailure(ip) {
        const hit = this.failures.get(ip);
        if (!hit)
            return false;
        if (Date.now() - hit.at > 10 * 60 * 1000) {
            this.failures.delete(ip);
            return false;
        }
        return hit.count >= 10;
    }
    noteLoginFailure(ip) {
        const hit = this.failures.get(ip);
        if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
            hit.count += 1;
            hit.at = Date.now();
        }
        else {
            this.failures.set(ip, { count: 1, at: Date.now() });
        }
    }
    // ===== 路由 =====
    /** 处理 /qq-chat/api/*：返回 true 表示已处理，'stream' 表示连接已交给 SSE */
    async handle(routerCtx) {
        const p = String(routerCtx.path || '');
        if (!p.startsWith('/qq-chat/api/'))
            return false;
        // 跨域：手机 App / 第三方客户端可以直接调
        routerCtx.set('Access-Control-Allow-Origin', '*');
        routerCtx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        routerCtx.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (routerCtx.method === 'OPTIONS') {
            routerCtx.status = 204;
            return true;
        }
        const route = p.slice('/qq-chat/api/'.length).replace(/\/+$/, '') || 'info';
        try {
            // 公开：登录 / 能力说明
            if (route === 'login' && routerCtx.method === 'POST') {
                const ip = String(routerCtx.ip || '');
                if (this.lastLoginFailure(ip)) {
                    this.json(routerCtx, 429, { ok: false, error: '尝试次数过多，请 10 分钟后再试' });
                    return true;
                }
                const body = await this.readBody(routerCtx);
                const password = String(body?.password || '');
                const required = String(this.mobilePassword || '');
                if (required && password !== required) {
                    this.noteLoginFailure(ip);
                    this.json(routerCtx, 401, { ok: false, error: '访问密码不正确' });
                    return true;
                }
                const entry = await this.issueToken(body?.name || '手机端');
                routerCtx.set('Set-Cookie', `${TOKEN_COOKIE}=${encodeURIComponent(entry.token)}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax`);
                this.json(routerCtx, 200, { ok: true, token: entry.token, name: entry.name });
                return true;
            }
            if (route === 'logout' && routerCtx.method === 'POST') {
                const token = this.extractToken(routerCtx);
                const list = await this.loadTokens();
                this.tokens = list.filter((t) => t.token !== token);
                await this.saveTokens();
                this.json(routerCtx, 200, { ok: true });
                return true;
            }
            if (route === 'info') {
                const auth = await this.authorize(routerCtx);
                this.json(routerCtx, 200, {
                    ok: true,
                    name: 'koishi-plugin-qq-chat',
                    version: require('../package.json').version,
                    passwordRequired: this.passwordRequired(),
                    authed: auth.ok,
                    endpoints: ['login', 'me', 'channels', 'messages', 'send', 'read', 'rpc', 'events']
                });
                return true;
            }
            // 以下都需要鉴权
            const auth = await this.authorize(routerCtx);
            if (!auth.ok) {
                this.json(routerCtx, 401, { ok: false, error: '未登录：请先在手机 App 里输入访问密码' });
                return true;
            }
            if (route === 'me' && routerCtx.method === 'GET') {
                const data = await this.callListener('get-chat-data', []);
                const counts = await this.callListener('get-all-channel-message-counts', []).catch(() => ({ counts: {} }));
                const channels = [];
                for (const [selfId, map] of Object.entries((data?.data?.channels || {}))) {
                    for (const [channelId, info] of Object.entries(map)) {
                        channels.push({ selfId, channelId, ...info });
                    }
                }
                const previews = await this.callListener('get-channel-previews', [{ channels }]).catch(() => ({ previews: {} }));
                const read = await this.callListener('get-read-state', []).catch(() => ({ state: {} }));
                const rules = await this.notifyRules?.get().catch(() => undefined);
                this.json(routerCtx, 200, {
                    ok: true,
                    bots: data?.data?.bots || {},
                    channels,
                    counts: counts?.counts || {},
                    previews: previews?.previews || {},
                    readState: read?.state || {},
                    // 免打扰的频道：手机端推送要遵守（免打扰里只有 @机器人 / 被引用才推）
                    muted: rules?.muted || [],
                    pinnedBots: data?.data?.pinnedBots || [],
                    pinnedChannels: data?.data?.pinnedChannels || []
                });
                return true;
            }
            if (route === 'channels' && routerCtx.method === 'GET') {
                const data = await this.callListener('get-chat-data', []);
                const channels = [];
                for (const [selfId, map] of Object.entries((data?.data?.channels || {}))) {
                    for (const [channelId, info] of Object.entries(map)) {
                        channels.push({ selfId, channelId, ...info });
                    }
                }
                const previews = await this.callListener('get-channel-previews', [{ channels }]).catch(() => ({ previews: {} }));
                this.json(routerCtx, 200, { ok: true, channels, previews: previews?.previews || {} });
                return true;
            }
            if (route === 'messages' && routerCtx.method === 'GET') {
                const { selfId, channelId } = routerCtx.query || {};
                const limit = Math.min(200, Math.max(1, Number(routerCtx.query?.limit) || 50));
                const offset = Math.max(0, Number(routerCtx.query?.offset) || 0);
                if (!selfId || !channelId) {
                    this.json(routerCtx, 400, { ok: false, error: '缺少 selfId / channelId' });
                    return true;
                }
                const result = await this.callListener('get-history-messages', [{ selfId, channelId, limit, offset }]);
                this.json(routerCtx, 200, { ok: true, messages: result?.messages || [], total: result?.total || 0 });
                return true;
            }
            if (route === 'send' && routerCtx.method === 'POST') {
                const body = await this.readBody(routerCtx);
                if (!body?.selfId || !body?.channelId) {
                    this.json(routerCtx, 400, { ok: false, error: '缺少 selfId / channelId' });
                    return true;
                }
                const result = await this.callListener('send-message', [{
                        selfId: String(body.selfId),
                        channelId: String(body.channelId),
                        content: String(body.content || body.text || ''),
                        images: body.images || [],
                        files: body.files || []
                    }]);
                this.json(routerCtx, result?.success === false ? 502 : 200, { ok: result?.success !== false, ...(result || {}) });
                return true;
            }
            if (route === 'read' && routerCtx.method === 'POST') {
                const body = await this.readBody(routerCtx);
                const result = await this.callListener('mark-channel-read', [{
                        selfId: String(body?.selfId || ''),
                        channelId: String(body?.channelId || ''),
                        timestamp: Number(body?.timestamp) || undefined
                    }]);
                this.json(routerCtx, 200, { ok: result?.success !== false, ...(result || {}) });
                return true;
            }
            if (route === 'rpc' && routerCtx.method === 'POST') {
                const body = await this.readBody(routerCtx);
                const name = String(body?.name || '');
                if (!name) {
                    this.json(routerCtx, 400, { ok: false, error: '缺少接口名' });
                    return true;
                }
                const args = Array.isArray(body?.args) ? body.args : (body?.args === undefined ? [] : [body.args]);
                try {
                    const value = await this.callListener(name, args);
                    this.json(routerCtx, 200, { ok: true, value });
                }
                catch (error) {
                    this.json(routerCtx, 200, { ok: false, error: String(error?.message || error) });
                }
                return true;
            }
            if (route === 'notify-rules') {
                if (!this.notifyRules) {
                    this.json(routerCtx, 200, { ok: true, muted: [] });
                    return true;
                }
                if (routerCtx.method === 'GET') {
                    const rules = await this.notifyRules.get();
                    this.json(routerCtx, 200, { ok: true, muted: rules.muted, updatedAt: rules.updatedAt });
                    return true;
                }
                if (routerCtx.method === 'POST') {
                    const body = await this.readBody(routerCtx);
                    const muted = Array.isArray(body?.muted) ? body.muted : [];
                    const rules = await this.notifyRules.setMuted(muted);
                    this.json(routerCtx, 200, { ok: true, muted: rules.muted, updatedAt: rules.updatedAt });
                    return true;
                }
            }
            if (route === 'events' && routerCtx.method === 'GET') {
                // 接管原始响应：SSE 需要长连接，不能走 koa 的收尾逻辑
                routerCtx.respond = false;
                routerCtx.res.writeHead(200, {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-store',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no',
                    'Access-Control-Allow-Origin': '*'
                });
                routerCtx.res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, time: Date.now() })}\n\n`);
                this.addClient(routerCtx);
                return 'stream';
            }
            this.json(routerCtx, 404, { ok: false, error: `未知接口：${route}` });
            return true;
        }
        catch (error) {
            this.logger.warn('手机端接口异常:', error?.message || error);
            this.json(routerCtx, 500, { ok: false, error: String(error?.message || error) });
            return true;
        }
    }
}
exports.MobileApi = MobileApi;
