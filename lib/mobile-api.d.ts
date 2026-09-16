import { PluginLogger } from './logger';
/**
 * 手机端 API（REST + SSE）。
 *
 * 控制台内部走的是 websocket RPC（@koishijs/client 的 send / receive），手机 App / PWA
 * 没法直接用（要连 websocket、还要控制台登录态），所以这里补一层标准 HTTP 接口：
 *
 *   POST /qq-chat/api/login     用访问密码换一个长期令牌（同时写 cookie，方便媒体请求）
 *   GET  /qq-chat/api/me        机器人 / 频道 / 未读总览（含每个频道最后一条消息预览）
 *   GET  /qq-chat/api/channels  频道列表
 *   GET  /qq-chat/api/messages  拉某个频道的历史消息（分页）
 *   POST /qq-chat/api/send      发消息（文字 / 图片 / 文件 / 引用）
 *   POST /qq-chat/api/read      标记频道已读
 *   POST /qq-chat/api/rpc       通用桥：按名字调用控制台里注册的监听器（手机 App 功能对齐）
 *   GET  /qq-chat/api/events    SSE 实时推送（新消息 / 发送状态 / 未读变化）
 *
 * 鉴权：访问密码（config.mobilePassword）换令牌 → Authorization: Bearer <token>
 *      也接受控制台登录 cookie（同一个浏览器登录过控制台就直接能用）。
 */
export interface MobileApiDeps {
    /** 控制台监听器登记表（由 ApiHandlers 注册），供 /rpc 与 REST 端点复用 */
    getRegistry: () => Record<string, (data: any) => any>;
    /** 控制台登录态校验（沿用 index.ts 里的访问控制开关） */
    isConsoleAuthed: (routerCtx: any) => Promise<boolean>;
    /** 严格校验控制台登录 cookie（不看 loginRequired，用于「设了手机密码就必须登录」） */
    hasConsoleSession: (routerCtx: any) => Promise<boolean>;
}
interface MobileToken {
    token: string;
    name: string;
    createdAt: number;
    lastSeenAt: number;
}
export declare class MobileApi {
    private baseDir;
    private logger;
    private deps;
    private mobilePassword;
    private tokens;
    private tokensFile;
    /** SSE 客户端：直接持有响应对象，广播时往里写 */
    private clients;
    /** 登录失败次数（防爆破，按 IP 记） */
    private failures;
    constructor(baseDir: string, logger: PluginLogger, deps: MobileApiDeps, mobilePassword?: string);
    private loadTokens;
    private saveTokens;
    issueToken(name: string, days?: number): Promise<MobileToken>;
    revokeAll(): Promise<void>;
    listTokens(): Promise<{
        name: string;
        createdAt: number;
        lastSeenAt: number;
    }[]>;
    private tokenValid;
    /** 解析请求里的访问令牌（Authorization 头 / cookie / query） */
    private extractToken;
    /** 供 index.ts 判断普通 HTTP 请求（聊天媒体等）是否带着有效的手机端令牌 */
    isRequestAuthed(routerCtx: any): Promise<boolean>;
    /**
     * 是否允许访问：
     *  - 没设手机密码 → 沿用原来的访问控制（启用 auth 时要求控制台登录，否则公开）
     *  - 设了手机密码 → 必须带有效手机令牌或控制台登录 cookie（否则密码形同虚设）
     */
    private authorize;
    /** 是否需要密码：配置了访问密码就一定要（不看 auth 插件） */
    passwordRequired(): boolean;
    /** 把控制台的广播同步给所有手机端 SSE 连接 */
    broadcast(name: string, body: any): void;
    private addClient;
    private json;
    private readBody;
    /** 调用控制台监听器（手机端与网页端共用同一套后端逻辑） */
    private callListener;
    private lastLoginFailure;
    private noteLoginFailure;
    /** 处理 /qq-chat/api/*：返回 true 表示已处理，'stream' 表示连接已交给 SSE */
    handle(routerCtx: any): Promise<true | false | 'stream'>;
}
export {};
