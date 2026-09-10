"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxBot = void 0;
exports.ensureSandboxBot = ensureSandboxBot;
/**
 * 假适配器：一个独立平台（qq-chat-sandbox）的虚拟机器人。
 * 消息走 Koishi 完整中间件（指令、插件都会响应），但 sendMessage 不发到任何真实平台，
 * 而是把内容交给回调（推给控制台沙盒对话框），由用户编辑后再发到真实频道。
 * 参考：@koishijs/plugin-sandbox
 */
const koishi_1 = require("koishi");
const PLATFORM = 'qq-chat-sandbox';
const SELF_ID = 'sandbox';
class SandboxBot extends koishi_1.Bot {
    constructor(ctx, options) {
        super(ctx, { platform: options?.platform || PLATFORM, selfId: options?.selfId || SELF_ID }, undefined);
        this.hidden = true;
        this.status = 1;
        // 显式挂上平台/自身 ID，避免个别版本里只存在 config 上
        this.platform = this.config?.platform || PLATFORM;
        this.selfId = this.config?.selfId || SELF_ID;
        this.user = { id: this.selfId, name: '沙盒' };
        this.onSend = options?.onSend || (() => { });
    }
    async sendMessage(channelId, content, options) {
        try {
            this.onSend(channelId, koishi_1.h.normalize(content));
        }
        catch { /* 忽略 */ }
        return [];
    }
    async sendPrivateMessage(channelId, content, options) {
        return this.sendMessage(channelId, content, options);
    }
}
exports.SandboxBot = SandboxBot;
// 取（或创建）虚拟机器人；每次调用替换回调
function ensureSandboxBot(ctx, onSend) {
    let bot = (ctx?.bots || []).find((item) => item && item.platform === PLATFORM && item.selfId === SELF_ID);
    if (!bot) {
        bot = new SandboxBot(ctx, { platform: PLATFORM, selfId: SELF_ID, onSend });
        try {
            ctx.bots.push(bot);
        }
        catch (error) {
            ;
            ctx.logger?.warn?.('注册沙盒虚拟机器人失败:', error);
        }
    }
    else {
        bot.onSend = onSend;
    }
    return bot;
}
