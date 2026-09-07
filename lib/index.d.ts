import { Console } from '@koishijs/console';
import { Context } from 'koishi';
import { Config } from './config';
export declare const name = "qq-chat";
export declare const reusable = false;
export declare const filter = true;
export declare const inject: {
    required: string[];
    optional: string[];
};
declare module 'koishi' {
    interface Context {
        console: Console;
    }
}
export declare const usage = "\n\n---\n\n\u5F00\u542F\u540E\uFF0C\u5373\u53EF\u5728koishi\u63A7\u5236\u53F0\u64CD\u4F5C\u673A\u5668\u4EBA\u6536\u53D1\u6D88\u606F\u5566\n\n---\n";
export { Config } from './config';
export declare function apply(ctx: Context, config: Config): Promise<void>;
