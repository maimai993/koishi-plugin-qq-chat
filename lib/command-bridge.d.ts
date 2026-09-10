export declare function elementsToText(elements: any, maxLength: any): string;
export declare function applyEditRules(text: any, rulesText: any, maxLength: any): string;
export declare function runBridgedCommand(options: any): Promise<{
    success: boolean;
    error: string;
    command?: undefined;
    output?: undefined;
    edited?: undefined;
    elements?: undefined;
} | {
    success: boolean;
    error: string;
    command: string;
    output?: undefined;
    edited?: undefined;
    elements?: undefined;
} | {
    success: boolean;
    command: string;
    output: string;
    edited: string;
    elements: any[];
    error?: undefined;
}>;
export declare function runSandboxCommand(options: any): Promise<{
    success: boolean;
    command: string;
    output: string;
    edited: string;
    error?: undefined;
} | {
    success: boolean;
    error: any;
    command?: undefined;
} | {
    success: boolean;
    error: string;
    command: string;
}>;
export declare function clearSandboxSession(data: any): {
    success: boolean;
};
export declare function runSimulatedMessage(options: any): Promise<{
    success: boolean;
    error: string;
    command?: undefined;
    output?: undefined;
    edited?: undefined;
} | {
    success: boolean;
    command: string;
    output: string;
    edited: string;
    error?: undefined;
}>;
export declare function pushSandboxStream(options: any): Promise<{
    success: boolean;
    error: string;
    promptAnswered?: undefined;
} | {
    success: boolean;
    promptAnswered: boolean;
    error?: undefined;
} | {
    success: boolean;
    error?: undefined;
    promptAnswered?: undefined;
}>;
export declare function resetSandboxStream(data: any): {
    success: boolean;
};
