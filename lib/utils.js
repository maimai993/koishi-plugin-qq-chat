"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Utils = void 0;
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const node_url_1 = require("node:url");
const node_fs_1 = require("node:fs");
class Utils {
    constructor(config, ctx) {
        this.config = config;
        this.ctx = ctx;
        this.persistImageWriteCount = 0;
        this.pendingTasks = new Set();
    }
    extractTextContent(elements) {
        let text = '';
        for (const element of elements) {
            if (element.type === 'text') {
                text += element.attrs?.content || '';
            }
            else if (element.type === 'p') {
                if (element.children && element.children.length > 0) {
                    text += this.extractTextContent(element.children) + '\n';
                }
            }
            else if (element.children && element.children.length > 0) {
                text += this.extractTextContent(element.children);
            }
        }
        return text;
    }
    isBase64(str) {
        if (!str || typeof str !== 'string')
            return false;
        if (str.startsWith('data:')) {
            return str.includes('base64,');
        }
        if (str.length > 100) {
            const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
            return base64Regex.test(str);
        }
        return false;
    }
    async persistBase64ImageAsync(base64Data) {
        if (!this.ctx || !base64Data.startsWith('data:image/'))
            return base64Data;
        try {
            const dir = (0, node_path_1.join)(this.ctx.baseDir, 'data', 'qq-chat', 'persist-images');
            await node_fs_1.promises.mkdir(dir, { recursive: true });
            const hash = (0, node_crypto_1.createHash)('md5').update(base64Data).digest('hex');
            const ext = base64Data.split(';')[0].split('/')[1] || 'png';
            const filename = `${hash}.${ext}`;
            const filePath = (0, node_path_1.join)(dir, filename);
            if (!(await this.fileExists(filePath))) {
                const base64Content = base64Data.split(',')[1];
                await node_fs_1.promises.writeFile(filePath, Buffer.from(base64Content, 'base64'));
            }
            this.persistImageWriteCount += 1;
            if (this.persistImageWriteCount % 20 === 0) {
                this.trackTask(this.cleanupPersistImagesAsync(dir));
            }
            return (0, node_url_1.pathToFileURL)(filePath).href;
        }
        catch {
            return base64Data;
        }
    }
    async cleanupPersistImagesAsync(dir) {
        try {
            const fileNames = await node_fs_1.promises.readdir(dir);
            const files = await Promise.all(fileNames.map(async (name) => {
                const filePath = (0, node_path_1.join)(dir, name);
                const stats = await node_fs_1.promises.stat(filePath);
                return { path: filePath, mtime: stats.mtimeMs };
            }));
            files.sort((a, b) => b.mtime - a.mtime);
            for (const file of files.slice(this.config.maxPersistImages)) {
                try {
                    await node_fs_1.promises.unlink(file.path);
                }
                catch {
                    continue;
                }
            }
        }
        catch { }
    }
    async cleanBase64ContentAsync(obj, isBotMessage = false) {
        if (obj === null || obj === undefined) {
            return obj;
        }
        if (typeof obj === 'string') {
            if (this.isBase64(obj)) {
                if (isBotMessage && !obj.startsWith('data:image/')) {
                    return '[富媒体内容已省略]';
                }
                return await this.persistBase64ImageAsync(obj);
            }
            return obj;
        }
        if (Array.isArray(obj)) {
            const cleanedItems = await Promise.all(obj.map(item => this.cleanBase64ContentAsync(item, isBotMessage)));
            return cleanedItems;
        }
        if (typeof obj === 'object') {
            const cleaned = {};
            const source = obj;
            for (const [key, value] of Object.entries(source)) {
                const type = typeof source.type === 'string' ? source.type : undefined;
                if (isBotMessage && type && !['text', 'image', 'img'].includes(type)) {
                    if (typeof value === 'string' && (key === 'src' || key === 'url' || key === 'file') && this.isBase64(value)) {
                        cleaned[key] = '[富媒体内容已省略]';
                        continue;
                    }
                }
                if (typeof value === 'string'
                    && (key === 'src' || key === 'url' || key === 'file' || key === 'data' || key === 'content')
                    && this.isBase64(value)) {
                    if (isBotMessage && !value.startsWith('data:image/')) {
                        cleaned[key] = '[富媒体内容已省略]';
                    }
                    else {
                        cleaned[key] = await this.persistBase64ImageAsync(value);
                    }
                }
                else {
                    cleaned[key] = await this.cleanBase64ContentAsync(value, isBotMessage);
                }
            }
            return cleaned;
        }
        return obj;
    }
    async dispose() {
        await Promise.allSettled([...this.pendingTasks]);
    }
    trackTask(task) {
        this.pendingTasks.add(task);
        void task.finally(() => {
            this.pendingTasks.delete(task);
        });
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
exports.Utils = Utils;
