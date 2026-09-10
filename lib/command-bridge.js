"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.elementsToText = elementsToText;
exports.applyEditRules = applyEditRules;
exports.runBridgedCommand = runBridgedCommand;
exports.runSandboxCommand = runSandboxCommand;
exports.clearSandboxSession = clearSandboxSession;
exports.runSimulatedMessage = runSimulatedMessage;
exports.pushSandboxStream = pushSandboxStream;
exports.resetSandboxStream = resetSandboxStream;
const koishi_1 = require("koishi");
/**
 * 控制台指令桥接：把控制台发出的 /指令 交给 Koishi 本地执行，
 * 拦截命令产生的全部输出（session.send / sendQueued / bot.sendMessage 与返回值），
 * 按配置做文本编辑后再由调用方发送到 QQ。
 *
 * 参考实现：koishi-plugin-yesimbot-command-bridge
 */
// 单个元素 → 纯文本
function elementToText(element) {
    if (element == null)
        return '';
    if (typeof element === 'string')
        return element;
    const attrs = element.attrs || {};
    switch (element.type) {
        case 'text':
            return attrs.content != null ? String(attrs.content) : (element.children || []).map(elementToText).join('');
        case 'at':
            return `@${attrs.name || attrs.id || ''}`;
        case 'sharp':
            return `#${attrs.name || attrs.id || ''}`;
        case 'image':
        case 'img':
            return attrs.src ? `[图片] ${attrs.src}` : '[图片]';
        case 'audio':
            return '[语音]';
        case 'video':
            return '[视频]';
        case 'file':
            return `[文件 ${attrs.filename || attrs.name || ''}]`;
        case 'face':
            return attrs.name ? `[${attrs.name}]` : '[表情]';
        case 'br':
            return '\n';
        case 'p':
            return (element.children || []).map(elementToText).join('') + '\n';
        case 'quote':
        case 'quote-author':
            return '';
        default:
            return (element.children || []).length ? (element.children || []).map(elementToText).join('') : '';
    }
}
// 元素数组 → 纯文本
function elementsToText(elements, maxLength) {
    const list = Array.isArray(elements) ? elements : (elements == null ? [] : [elements]);
    let text = list.map(elementToText).join('');
    text = text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const limit = Number(maxLength) || 0;
    if (limit > 0 && text.length > limit)
        text = text.slice(0, Math.max(1, limit - 1)) + '…';
    return text;
}
// 从输入里抠出图片地址：这些会作为「引用消息」塞进伪会话，
// 让 image-prompt 这类需要图片的指令直接从引用里取图，不再等待用户补充输入而超时
const IMAGE_URL_RE = /(?:https?:\/\/|\/)[^\s"'<>]+\.(?:png|jpe?g|gif|webp|bmp|avif|apng|svg)(?:\?[^\s"'<>]*)?/gi;
function splitImageUrls(input) {
    const text = String(input || '');
    const urls = text.match(IMAGE_URL_RE) || [];
    let rest = text;
    for (const url of urls)
        rest = rest.split(url).join(' ');
    return { urls, rest: rest.replace(/\s+/g, ' ').trim() };
}
// 编辑规则：每行「查找=>替换」，按顺序应用
function applyEditRules(text, rulesText, maxLength) {
    let out = String(text || '');
    const rules = String(rulesText || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line.includes('=>'));
    for (const rule of rules) {
        const index = rule.indexOf('=>');
        const from = rule.slice(0, index);
        if (!from)
            continue;
        const to = rule.slice(index + 2).replace(/\\n/g, '\n');
        out = out.split(from).join(to);
    }
    out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const limit = Number(maxLength) || 0;
    if (limit > 0 && out.length > limit)
        out = out.slice(0, Math.max(1, limit - 1)) + '…';
    return out;
}
// 执行一条 Koishi 指令并捕获输出
async function runBridgedCommand(options) {
    const { ctx, config, logger, data } = options || {};
    const selfId = String(data?.selfId || '');
    const channelId = String(data?.channelId || '');
    const isDirect = !!data?.isDirect;
    const raw = String(data?.command || '').trim();
    if (!selfId || !channelId)
        return { success: false, error: '缺少机器人或频道信息' };
    if (!raw)
        return { success: false, error: '缺少指令内容' };
    const bot = (ctx?.bots || []).find((item) => item.selfId === selfId || item.user?.id === selfId);
    if (!bot)
        return { success: false, error: `未找到机器人 ${selfId}` };
    if (bot.status !== 1)
        return { success: false, error: `机器人 ${selfId} 当前离线` };
    // 去掉前缀，交给 Koishi 命令系统
    const prefix = String(config?.commandPrefix || '/');
    const withoutPrefix = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : raw;
    // 输入里带的图片地址放进「引用消息」，需要图片的指令（绘图等）就能直接用
    const { urls: imageUrls, rest } = splitImageUrls(withoutPrefix);
    const line = rest || withoutPrefix;
    if (!line)
        return { success: false, error: '缺少指令内容' };
    const transcript = [];
    const push = (fragment) => {
        try {
            transcript.push(...koishi_1.h.normalize(fragment));
        }
        catch (error) {
            logger?.debug?.('指令输出解析失败:', error);
        }
    };
    const session = bot.session({
        type: 'message-created',
        subtype: isDirect ? 'private' : 'group',
        platform: bot.platform,
        selfId: bot.selfId,
        timestamp: Date.now(),
        channel: { id: channelId, type: isDirect ? 1 : 0 },
        user: { id: `qq-chat:console:${bot.selfId}`, name: '控制台' },
        member: { name: '控制台' },
        message: { id: `qq-chat:console:${Date.now()}`, content: '', elements: [] }
    });
    if (imageUrls.length) {
        session.quote = { id: 'qq-chat:quote', content: imageUrls.map((url) => `<img src="${url}"/>`).join('') };
    }
    // 拦截命令的所有输出，不让它直接发到群里
    session.send = async (fragment) => { push(fragment); return []; };
    session.sendQueued = async (fragment) => { push(fragment); return []; };
    session.bot = new Proxy(bot, {
        get(target, property, receiver) {
            if (property === 'sendMessage') {
                return async (_channelId, content) => { push(content); return []; };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
    // 权限：默认给管理员等级，保证绝大多数指令可执行
    try {
        const authority = Number(config?.commandAuthority ?? 4);
        if (Number.isFinite(authority)) {
            const user = await session.observeUser(['id', 'authority', 'permissions']);
            user.authority = authority;
        }
    }
    catch (error) {
        logger?.debug?.('设置指令执行权限失败:', error);
    }
    const timeoutMs = Math.max(1000, Number(config?.commandTimeoutMs) || 50000);
    let timer = null;
    try {
        const result = await Promise.race([
            session.execute(line, true),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`指令执行超时（${timeoutMs}ms）`)), timeoutMs); })
        ]);
        if (result)
            push(result);
    }
    catch (error) {
        if (timer)
            clearTimeout(timer);
        return { success: false, error: String(error && error.message ? error.message : error), command: line };
    }
    if (timer)
        clearTimeout(timer);
    const maxLength = Math.max(100, Number(config?.commandMaxLength) || 1200);
    const output = elementsToText(transcript, Math.max(maxLength, 8000));
    const edited = applyEditRules(output, config?.commandEditRules, maxLength);
    logger?.info?.(`控制台指令执行完成: /${line} -> ${edited.length} 字`);
    // elements：拦截到的原始元素（图片/语音/视频不能只当文本丢掉，控制台要按元素渲染与发送）
    return { success: true, command: line, output, edited, elements: transcript };
}
// ===== 沙盒会话：多轮执行共用同一个 session，关闭时清空 =====
const sandboxSessions = new Map();
function createSandboxEntry(ctx, config, logger, data) {
    const selfId = String(data?.selfId || '');
    const channelId = String(data?.channelId || '');
    const isDirect = !!data?.isDirect;
    const bot = (ctx?.bots || []).find((item) => item.selfId === selfId || item.user?.id === selfId);
    if (!bot)
        return { error: `未找到机器人 ${selfId}` };
    const entry = { transcript: [], bot, session: null };
    const session = bot.session({
        type: 'message-created',
        subtype: isDirect ? 'private' : 'group',
        platform: bot.platform,
        selfId: bot.selfId,
        timestamp: Date.now(),
        channel: { id: channelId, type: isDirect ? 1 : 0 },
        user: { id: `qq-chat:sandbox:${bot.selfId}`, name: '沙盒' },
        member: { name: '沙盒' },
        message: { id: `qq-chat:sandbox:${Date.now()}`, content: '', elements: [] }
    });
    const push = (fragment) => {
        try {
            entry.transcript.push(...koishi_1.h.normalize(fragment));
        }
        catch { /* 忽略 */ }
    };
    session.send = async (fragment) => { push(fragment); return []; };
    session.sendQueued = async (fragment) => { push(fragment); return []; };
    session.bot = new Proxy(bot, {
        get(target, property, receiver) {
            if (property === 'sendMessage') {
                return async (_channelId, content) => { push(content); return []; };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
    entry.session = session;
    return entry;
}
// 沙盒里执行一条指令（同一个频道复用同一个 session，可多轮）
async function runSandboxCommand(options) {
    const { ctx, config, logger, data } = options || {};
    const selfId = String(data?.selfId || '');
    const channelId = String(data?.channelId || '');
    const raw = String(data?.command || '').trim();
    if (!selfId || !channelId)
        return { success: false, error: '缺少机器人或频道信息' };
    if (!raw)
        return { success: false, error: '缺少指令内容' };
    const key = `${selfId}:${channelId}`;
    let entry = sandboxSessions.get(key);
    if (!entry || data?.reset) {
        entry = createSandboxEntry(ctx, config, logger, data);
        if (entry.error)
            return { success: false, error: entry.error };
        sandboxSessions.set(key, entry);
    }
    // 每轮重新收集输出
    entry.transcript.length = 0;
    const prefix = String(config?.commandPrefix || '/');
    const withoutPrefix = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : raw;
    // 媒体标签（img / audio / video / file）先从「指令文本」里剔除，再抠掉裸图片地址：
    // 否则「/指令 + 图片」会被拼成 "指令<img" 这样的命令名，命令找不到、什么都不回
    const { urls: imageUrls, rest } = splitImageUrls(withoutPrefix.replace(/<(?:img|image|mface|audio|video|file)\b[^>]*\/?>/gi, ' '));
    const line = rest.trim();
    // 只有图片、没有指令文字：按真实用户消息派发（走中间件），不当指令执行
    // 图片 / 语音 / 视频 / 文件都算「媒体」，不能当指令文本参与匹配，否则带媒体的消息会被误当成指令执行
    const textOnly = withoutPrefix.replace(/<(?:img|image|mface|audio|video|file)\b[^>]*\/?>/gi, '').replace(IMAGE_URL_RE, '').trim();
    if (!textOnly && imageUrls.length) {
        return runSimulatedMessage({ ctx, config, logger, data: { ...data, content: withoutPrefix } });
    }
    if (!line)
        return { success: false, error: '缺少指令内容' };
    entry.session.quote = imageUrls.length
        ? { id: `qq-chat:sandbox-quote:${Date.now()}`, content: imageUrls.map((url) => `<img src="${url}"/>`).join('') }
        : undefined;
    try {
        const authority = Number(config?.commandAuthority ?? 4);
        if (Number.isFinite(authority)) {
            const user = await entry.session.observeUser(['id', 'authority', 'permissions']);
            user.authority = authority;
        }
    }
    catch { /* 忽略 */ }
    const timeoutMs = Math.max(1000, Number(config?.commandTimeoutMs) || 50000);
    let timer = null;
    try {
        const result = await Promise.race([
            entry.session.execute(line, true),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`指令执行超时（${timeoutMs}ms）`)), timeoutMs); })
        ]);
        if (result)
            entry.transcript.push(...koishi_1.h.normalize(result));
        // 子指令（如 image-prompt/手办化）直接用短名执行可能解析不到：
        // 没有任何输出时改用真实派发，走命令中间件的完整解析
        if (!entry.transcript.length) {
            const viaDispatch = await runSimulatedMessage({ ctx, config, logger, data: { ...data, content: withoutPrefix } });
            if (viaDispatch.success && viaDispatch.output)
                return viaDispatch;
        }
    }
    catch (error) {
        if (timer)
            clearTimeout(timer);
        return { success: false, error: String(error && error.message ? error.message : error), command: line };
    }
    if (timer)
        clearTimeout(timer);
    const maxLength = Math.max(100, Number(config?.commandMaxLength) || 1200);
    const output = elementsToText(entry.transcript, Math.max(maxLength, 8000));
    const edited = applyEditRules(output, config?.commandEditRules, maxLength);
    return { success: true, command: line, output, edited };
}
// 关闭沙盒：丢掉这个频道的会话上下文
function clearSandboxSession(data) {
    const key = `${String(data?.selfId || '')}:${String(data?.channelId || '')}`;
    const entry = sandboxSessions.get(key);
    if (entry) {
        try {
            entry.transcript.length = 0;
        }
        catch { /* 忽略 */ }
        sandboxSessions.delete(key);
    }
    return { success: true };
}
// 执行命令并带超时保护
function entry_execute(session, line, timeoutMs) {
    let timer = null;
    return Promise.race([
        session.execute(line, true),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })
    ]).finally(() => {
        if (timer)
            clearTimeout(timer);
    });
}
// ===== 真实模拟用户消息：用「影子 bot」在当前频道派发，走完整中间件并拦截所有发送 =====
async function runSimulatedMessage(options) {
    const { ctx, config, logger, data } = options || {};
    const selfId = String(data?.selfId || '');
    const channelId = String(data?.channelId || '');
    const isDirect = !!data?.isDirect;
    const content = String(data?.content != null ? data.content : (data?.command || '')).trim();
    if (!selfId || !channelId)
        return { success: false, error: '缺少机器人或频道信息' };
    if (!content)
        return { success: false, error: '缺少消息内容' };
    const bot = (ctx?.bots || []).find((item) => item.selfId === selfId || item.user?.id === selfId);
    if (!bot)
        return { success: false, error: `未找到机器人 ${selfId}` };
    if (bot.status !== 1)
        return { success: false, error: `机器人 ${selfId} 当前离线` };
    const transcript = [];
    let lastAt = 0;
    const push = (fragment) => {
        try {
            const elements = koishi_1.h.normalize(fragment);
            if (!elements.length)
                return;
            transcript.push(...elements);
            lastAt = Date.now();
        }
        catch { /* 忽略 */ }
    };
    // 影子 bot：原型链继承真实 bot（适配器方法都能用），只覆盖发送方法，
    // 这样任何派生出来的 session（命令执行时会换一个 session 实例）发的消息都会被拦截
    const shadow = Object.create(Object.getPrototypeOf(bot));
    Object.assign(shadow, bot);
    const captureSend = async (_channelId, fragment) => { push(fragment); return []; };
    shadow.sendMessage = captureSend;
    shadow.sendPrivateMessage = captureSend;
    shadow.sendGroupMessage = captureSend;
    const userId = String(data?.userId || `qq-chat:console:${bot.selfId}`);
    const userName = String(data?.userName || '控制台');
    const messageId = `qq-chat:sim:${Date.now()}`;
    // 用真实 bot 建会话（它有 execute 等方法），再把 session.bot 换成影子 bot 拦截发送
    const session = bot.session({
        type: 'message-created',
        subtype: isDirect ? 'private' : 'group',
        platform: bot.platform,
        selfId: bot.selfId,
        timestamp: Date.now(),
        channel: { id: channelId, type: isDirect ? 1 : 0 },
        user: { id: userId, name: userName },
        member: { name: userName },
        message: { id: messageId, content, elements: [] }
    });
    session.bot = shadow;
    session.type = 'message';
    session.messageId = messageId;
    session.content = content;
    // 本地模拟会话标记：和沙盒一样，不能写进真实聊天记录
    try {
        session.qqChatSandbox = true;
        if (session.event)
            session.event.qqChatSandbox = true;
    }
    catch { /* 忽略 */ }
    session.send = async (fragment) => { push(fragment); return []; };
    session.sendQueued = async (fragment) => { push(fragment); return []; };
    try {
        const authority = Number(config?.commandAuthority ?? 4);
        if (Number.isFinite(authority)) {
            const user = await session.observeUser(['id', 'authority', 'permissions']);
            user.authority = authority;
        }
    }
    catch { /* 忽略 */ }
    const timeoutMs = Math.max(1000, Number(config?.commandTimeoutMs) || 50000);
    const prefix = String(config?.commandPrefix || '/');
    const isCommand = !!prefix && content.startsWith(prefix);
    const started = Date.now();
    if (isCommand) {
        // 指令：直接走命令执行（已验证可靠），输出通过影子 bot / session.send 拦截
        try {
            const result = await entry_execute(session, content.slice(prefix.length).trim(), timeoutMs);
            if (result)
                push(result);
        }
        catch (error) {
            return { success: false, error: String(error && error.message ? error.message : error) };
        }
    }
    else {
        // 普通消息：真实派发到当前频道，走完整中间件（插件、自动回复等都会响应）
        try {
            shadow.dispatch(session);
        }
        catch (error) {
            return { success: false, error: String(error && error.message ? error.message : error) };
        }
        while (Date.now() - started < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            if (transcript.length && Date.now() - lastAt > 1200)
                break;
        }
    }
    const maxLength = Math.max(100, Number(config?.commandMaxLength) || 1200);
    const output = elementsToText(transcript, Math.max(maxLength, 8000));
    const edited = applyEditRules(output, config?.commandEditRules, maxLength);
    logger?.info?.(`模拟用户消息执行完成: ${content.slice(0, 40)} -> ${edited.length} 字`);
    return { success: true, command: content, output, edited };
}
// ===== 连续会话流沙盒：真实频道 + 拦截发送（不用假平台） =====
const sandboxStreams = new Map();
function getSandboxStream(ctx, selfId, channelId, isDirect) {
    const key = `${selfId}:${channelId}`;
    let entry = sandboxStreams.get(key);
    if (entry)
        return entry;
    const realBot = (ctx?.bots || []).find((item) => item.selfId === selfId || item.user?.id === selfId);
    if (!realBot)
        return null;
    entry = { onMessage: null, pending: null };
    // 影子 bot：原型链继承真实 bot（适配器方法都在），只覆盖发送 → 拦截
    const shadow = Object.create(Object.getPrototypeOf(realBot));
    Object.assign(shadow, realBot);
    const capture = async (_channelId, content) => {
        try {
            const elements = koishi_1.h.normalize(content);
            // 第二个参数：元素对应的原始标记（<img>/<audio>/<video>/<file>）。
            // 聊天列表是按 content 渲染的，只有带上它沙盒里才能把图片 / 语音 / 视频画出来。
            if (elements.length)
                entry.onMessage?.(elements, elements.join(''));
        }
        catch { /* 忽略 */ }
        return [];
    };
    shadow.sendMessage = capture;
    shadow.sendPrivateMessage = capture;
    shadow.sendGroupMessage = capture;
    entry.bot = shadow;
    // 一条连续的会话：真实频道 + 控制台用户，prompt 由下一条消息兑现
    const session = realBot.session({
        type: 'message',
        subtype: isDirect ? 'private' : 'group',
        platform: realBot.platform,
        selfId: realBot.selfId,
        timestamp: Date.now(),
        channel: { id: channelId, type: isDirect ? 1 : 0 },
        user: { id: `qq-chat:console:${selfId}`, name: '控制台' },
        member: { name: '控制台' },
        message: { id: 'qq-chat:sandbox:init', content: '', elements: [] }
    });
    session.bot = shadow;
    session.send = capture;
    session.sendQueued = capture;
    session.prompt = () => new Promise((resolve) => { entry.pending = resolve; });
    // 沙盒会话标记：消息只在本机跑，不能被写进真实聊天记录
    // （message-handler.recordUserMessage 会跳过带这个标记的会话）
    try {
        session.qqChatSandbox = true;
        if (session.event)
            session.event.qqChatSandbox = true;
    }
    catch { /* 忽略 */ }
    entry.session = session;
    sandboxStreams.set(key, entry);
    return entry;
}
// 从控制台推一条消息进这条持续会话（立即返回；回复通过 onMessage 流式推送）
async function pushSandboxStream(options) {
    const { ctx, config, data, onMessage } = options || {};
    const selfId = String(data?.selfId || '');
    const channelId = String(data?.channelId || '');
    if (!selfId || !channelId)
        return { success: false, error: '缺少机器人或频道信息' };
    const content = String(data?.content != null ? data.content : (data?.command || '')).trim();
    if (!content)
        return { success: false, error: '缺少消息内容' };
    const entry = getSandboxStream(ctx, selfId, channelId, !!data?.isDirect);
    if (!entry)
        return { success: false, error: `未找到机器人 ${selfId}` };
    entry.onMessage = onMessage || entry.onMessage;
    // 正在等用户输入：这条消息（文字或图片元素）直接兑现，不做任何指令匹配
    if (entry.pending) {
        const resolve = entry.pending;
        entry.pending = null;
        resolve(content);
        return { success: true, promptAnswered: true };
    }
    const prefix = String(config?.commandPrefix || '/');
    const withoutPrefix = prefix && content.startsWith(prefix) ? content.slice(prefix.length).trim() : content;
    // 媒体标签（img / audio / video / file）先从「指令文本」里剔除，再抠掉裸图片地址：
    // 否则「/指令 + 图片」会被拼成 "指令<img" 这样的命令名，命令找不到，沙盒里什么都不回
    const MEDIA_TAG_RE = /<(?:img|image|mface|audio|video|file)\b[^>]*\/?>/gi;
    const { urls: imageUrls, rest } = splitImageUrls(withoutPrefix.replace(MEDIA_TAG_RE, ' '));
    const commandLine = rest.trim();
    entry.session.content = content;
    entry.session.messageId = `qq-chat:sandbox:${Date.now()}`;
    // 指令带图：图片放进「引用消息」，绘图这类需要图片的指令能直接从引用取图
    if (imageUrls.length) {
        try {
            entry.session.quote = { id: `qq-chat:sandbox-quote:${Date.now()}`, content: imageUrls.map((url) => `<img src="${url}"/>`).join('') };
        }
        catch { /* 忽略 */ }
    }
    // 权限：沙盒里的「控制台用户」默认给管理员等级，保证绝大多数指令可执行
    try {
        const authority = Number(config?.commandAuthority ?? 4);
        if (Number.isFinite(authority)) {
            const user = await entry.session.observeUser(['id', 'authority', 'permissions']);
            user.authority = authority;
        }
    }
    catch { /* 忽略 */ }
    let emitted = 0;
    const emit = (fragment) => {
        try {
            const elements = koishi_1.h.normalize(fragment);
            if (elements.length) {
                emitted += 1;
                entry.onMessage?.(elements, elements.join(''));
            }
        }
        catch { /* 忽略无法解析的输出 */ }
    };
    if (commandLine && content.startsWith(prefix)) {
        // 指令：直接执行（返回值不回发，交给沙盒展示）
        const timeoutMs = Math.max(1000, Number(config?.commandTimeoutMs) || 50000);
        let settled = false;
        // 超时只提示、不取消：绘图 / 生图这类慢指令算完后的结果照样推给沙盒（以前超时就把它丢掉了）
        const timer = setTimeout(() => {
            if (settled)
                return;
            emit((0, koishi_1.h)('text', { content: `指令 /${commandLine} 还在执行中，结果出来后会继续推给你…` }));
        }, timeoutMs);
        entry.session.execute(commandLine, true).then((result) => {
            settled = true;
            clearTimeout(timer);
            if (result)
                emit(result);
        }).catch((error) => {
            settled = true;
            clearTimeout(timer);
            if (!emitted)
                emit((0, koishi_1.h)('text', { content: `执行失败：${error && error.message ? error.message : error}` }));
        });
        return { success: true };
    }
    // 普通消息 / 纯图片：真实派发进中间件
    try {
        entry.bot.dispatch(entry.session);
    }
    catch (error) {
        return { success: false, error: String(error && error.message ? error.message : error) };
    }
    return { success: true };
}
function resetSandboxStream(data) {
    const key = `${String(data?.selfId || '')}:${String(data?.channelId || '')}`;
    const entry = sandboxStreams.get(key);
    if (entry?.pending) {
        try {
            entry.pending(undefined);
        }
        catch { /* 忽略 */ }
    }
    sandboxStreams.delete(key);
    return { success: true };
}
