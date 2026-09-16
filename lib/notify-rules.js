"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotifyRuleStore = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
class NotifyRuleStore {
    constructor(baseDir, logger) {
        this.logger = logger;
        this.state = null;
        this.writeTimer = null;
        this.filePath = node_path_1.default.join(baseDir, 'data', 'qq-chat', 'v2', 'notify-settings.json');
    }
    async ensureLoaded() {
        if (this.state)
            return this.state;
        try {
            const raw = await node_fs_1.promises.readFile(this.filePath, 'utf8');
            const data = JSON.parse(raw);
            this.state = {
                muted: Array.isArray(data?.muted) ? data.muted.map((x) => String(x)).filter(Boolean) : [],
                updatedAt: Number(data?.updatedAt) || 0
            };
        }
        catch {
            this.state = { muted: [], updatedAt: 0 };
        }
        return this.state;
    }
    scheduleWrite() {
        if (this.writeTimer)
            return;
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null;
            void this.flush();
        }, 400);
        this.writeTimer?.unref?.();
    }
    async flush() {
        if (!this.state)
            return;
        try {
            await node_fs_1.promises.mkdir(node_path_1.default.dirname(this.filePath), { recursive: true });
            await node_fs_1.promises.writeFile(this.filePath, JSON.stringify({ version: 1, ...this.state }, null, 2), 'utf8');
        }
        catch (error) {
            this.logger.warn('保存推送设置失败:', error?.message || error);
        }
    }
    async get() {
        const state = await this.ensureLoaded();
        return { muted: [...state.muted], updatedAt: state.updatedAt };
    }
    /** 覆盖免打扰列表（控制台与手机端都往这里同步） */
    async setMuted(muted) {
        const state = await this.ensureLoaded();
        state.muted = [...new Set((muted || []).map((x) => String(x)).filter(Boolean))];
        state.updatedAt = Date.now();
        this.scheduleWrite();
        return { muted: [...state.muted], updatedAt: state.updatedAt };
    }
    /** 单个频道的免打扰开关 */
    async setChannelMuted(key, muted) {
        const state = await this.ensureLoaded();
        const set = new Set(state.muted);
        if (muted)
            set.add(key);
        else
            set.delete(key);
        return await this.setMuted([...set]);
    }
    /** 判断某条消息要不要推送：免打扰频道里只有「@机器人」和「引用机器人」才推 */
    shouldNotify(muted, selfId, channelId, options = {}) {
        const key = `${selfId}:${channelId}`;
        if (!muted.includes(key))
            return true;
        return !!(options.atBot || options.replyToBot);
    }
    async dispose() {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
            this.writeTimer = null;
        }
        await this.flush();
    }
}
exports.NotifyRuleStore = NotifyRuleStore;
