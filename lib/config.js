"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.CONSOLE_AUTHORITY = void 0;
const koishi_1 = require("koishi");
/**
 * 控制台监听 / 广播所需的权限等级（与插件页面一致）。
 * 启用 @koishijs/plugin-auth 后，未登录（或权限不足）的客户端调用这些接口会被拒绝；
 * 没启用 auth 插件时该选项不生效，行为与以前完全一致。
 */
exports.CONSOLE_AUTHORITY = 4;
exports.Config = koishi_1.Schema.intersect([
    koishi_1.Schema.object({
        maxMessagesPerChannel: koishi_1.Schema.number().default(500).description('每个群组最大保存消息数量').min(50).max(1500).step(1),
        messageChunkSize: koishi_1.Schema.number().default(100).description('单个消息分块文件最大消息数量').min(20).max(500).step(1),
        channelCacheLimit: koishi_1.Schema.number().default(50).description('内存中最多缓存的频道消息数量').min(1).max(200).step(1),
        maxPersistImages: koishi_1.Schema.number().default(100).description('持久化存储的图片缓存数量').min(10).max(500).step(1),
        ocrApiKey: koishi_1.Schema.string().default('helloworld').description('OCR 接口密钥（OCR.space 免费 key，默认 helloworld）。用于识别 B 站小程序卡片封面上的 UP 主，从而精确匹配视频。'),
    }).description('基础设置'),
    koishi_1.Schema.object({
        chatBackground: koishi_1.Schema.string().default('').description('聊天区背景图片：本地图片绝对路径（如 D:/pics/bg.jpg）或 http(s) 链接；留空使用纯色背景'),
        chatBackgroundBlur: koishi_1.Schema.number().default(0).description('背景图片模糊程度（px），0 表示不模糊').min(0).max(30).step(1),
        chatBackgroundDim: koishi_1.Schema.number().default(12).description('背景图片遮罩浓度（%），越大文字越清晰').min(0).max(90).step(2),
    }).description('聊天背景'),
    koishi_1.Schema.object({
        theme: koishi_1.Schema.union([
            koishi_1.Schema.const('koishi').description('跟随 Koishi 控制台'),
            koishi_1.Schema.const('system').description('跟随系统'),
            koishi_1.Schema.const('dark').description('深色'),
            koishi_1.Schema.const('light').description('浅色'),
        ]).default('koishi').description('聊天界面主题（独立窗口同样生效）。'),
    }).description('主题'),
    koishi_1.Schema.object({
        commandBridge: koishi_1.Schema.boolean().default(true).description('控制台发送的 /指令 由 Koishi 本地执行，拦截输出后再发到 QQ（关闭则原样发给 QQ）'),
        commandPrefix: koishi_1.Schema.string().default('/').description('本地指令前缀，例如 /'),
        commandAuthority: koishi_1.Schema.number().default(4).description('执行指令时使用的权限等级（4 = 管理员，保证多数指令可用）').min(0).max(5).step(1),
        commandTimeoutMs: koishi_1.Schema.number().default(50000).description('指令执行超时（毫秒）。绘图类指令耗时较长，建议 ≥50000；客户端 RPC 上限 60 秒').min(1000).max(55000).step(1000),
        commandMaxLength: koishi_1.Schema.number().default(1200).description('指令输出发送到 QQ 的最大长度').min(100).max(5000).step(100),
        commandEditRules: koishi_1.Schema.string().role('textarea').default('').description('输出编辑规则：每行一条「查找=>替换」，按顺序应用；用 \\n 表示换行'),
    }).description('控制台指令桥接'),
    koishi_1.Schema.object({
        loginRequired: koishi_1.Schema.boolean().default(true).description('启用 auth 插件时，独立窗口 / 沙盒窗口与聊天媒体是否要求先登录控制台（关闭后这些地址将重新变为公开，仅建议内网调试时关闭）'),
    }).description('访问控制'),
    koishi_1.Schema.object({
        clearIndexedDBOnStart: koishi_1.Schema.boolean().default(true).description('启动时强制清空IndexedDB缓存（适用于紧急情况，防止浏览器卡死）'),
        loggerinfo: koishi_1.Schema.boolean().default(false).description('日志调试模式').experimental(),
    }).description('开发者选项'),
]);
