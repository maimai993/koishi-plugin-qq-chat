/**
 * 假适配器：一个独立平台（qq-chat-sandbox）的虚拟机器人。
 * 消息走 Koishi 完整中间件（指令、插件都会响应），但 sendMessage 不发到任何真实平台，
 * 而是把内容交给回调（推给控制台沙盒对话框），由用户编辑后再发到真实频道。
 * 参考：@koishijs/plugin-sandbox
 */
import { Bot, Context, h } from 'koishi';
export interface SandboxBotOptions {
    platform?: string;
    selfId?: string;
    /** 拦截到的发送内容：channelId + 规范化后的元素 */
    onSend?: (channelId: string, elements: h[]) => void;
}
export declare class SandboxBot extends Bot<Context, any> {
    hidden: boolean;
    onSend: (channelId: string, elements: h[]) => void;
    constructor(ctx: Context, options?: SandboxBotOptions);
    sendMessage(channelId: string, content: any, options?: any): Promise<any[]>;
    sendPrivateMessage(channelId: string, content: any, options?: any): Promise<any[]>;
}
export declare function ensureSandboxBot(ctx: Context, onSend: (channelId: string, elements: h[]) => void): SandboxBot;
