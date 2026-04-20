import path from 'path';
import fs from 'fs';
import { z } from 'zod';
// 定义基本配置架构
const configSchema = z.object({
    // 服务器配置
    server: z.object({
        name: z.string().default('performance-analyzer'),
        version: z.string().default('1.0.0'),
        ssePort: z.number().default(3001),
        sseEnableHttps: z.boolean().default(false),
        sslCertPath: z.string().optional(),
        sslKeyPath: z.string().optional(),
    }),
    // 性能分析配置
    performance: z.object({
        defaultTimeout: z.number().default(30000),
        maxTimeout: z.number().default(60000),
        defaultViewport: z.object({
            width: z.number().default(1920),
            height: z.number().default(1080),
        }),
    }),
    // 浏览器实例池配置
    browserPool: z.object({
        maxInstances: z.number().default(5),
        idleTimeout: z.number().default(30000), // 浏览器实例空闲超时时间(毫秒)
        maxLifetime: z.number().default(3600000), // 浏览器实例最大生命周期(毫秒)
    }),
    // 截图管理配置
    screenshots: z.object({
        directory: z.string().default(path.join(process.cwd(), 'screenshots')),
        format: z.enum(['png', 'jpeg']).default('png'),
        maxAge: z.number().default(86400000), // 截图最大保存时间(毫秒)，默认24小时
        cleanupInterval: z.number().default(3600000), // 清理间隔(毫秒)，默认1小时
    }),
    // 错误处理配置
    errors: z.object({
        logDetailedErrors: z.boolean().default(true),
    }),
    // 限流配置
    rateLimiting: z.object({
        enabled: z.boolean().default(false),
        maxRequestsPerMinute: z.number().default(60),
        ipWhitelist: z.array(z.string()).default([]),
    }),
    // URL过滤配置
    urlFiltering: z.object({
        enabled: z.boolean().default(false),
        allowLocalhost: z.boolean().default(true),
        allowPrivateIps: z.boolean().default(false),
        whitelist: z.array(z.string()).default([]),
        blacklist: z.array(z.string()).default([]),
    }),
});
// 配置文件路径
const CONFIG_FILE_PATH = process.env.CONFIG_FILE_PATH || path.join(process.cwd(), 'mcp-config.json');
// 默认配置
const defaultConfig = {
    server: {
        name: 'performance-analyzer',
        version: '1.0.0',
        ssePort: 3001,
        sseEnableHttps: false,
    },
    performance: {
        defaultTimeout: 30000,
        maxTimeout: 60000,
        defaultViewport: {
            width: 1920,
            height: 1080,
        },
    },
    browserPool: {
        maxInstances: 5,
        idleTimeout: 30000,
        maxLifetime: 3600000,
    },
    screenshots: {
        directory: path.join(process.cwd(), 'screenshots'),
        format: 'png',
        maxAge: 86400000,
        cleanupInterval: 3600000,
    },
    errors: {
        logDetailedErrors: true,
    },
    rateLimiting: {
        enabled: false,
        maxRequestsPerMinute: 60,
        ipWhitelist: [],
    },
    urlFiltering: {
        enabled: false,
        allowLocalhost: true,
        allowPrivateIps: false,
        whitelist: [],
        blacklist: [],
    },
};
// 尝试加载配置文件
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE_PATH)) {
            const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
            const mergedConfig = { ...defaultConfig };
            // 合并各个部分的配置
            for (const section of Object.keys(defaultConfig)) {
                if (fileConfig[section]) {
                    mergedConfig[section] = {
                        ...defaultConfig[section],
                        ...fileConfig[section]
                    };
                }
            }
            // 验证配置
            return configSchema.parse(mergedConfig);
        }
    }
    catch (error) {
        console.error('配置文件加载错误：', error);
        console.error('将使用默认配置');
    }
    // 如果无法加载配置文件，使用默认配置
    return defaultConfig;
}
// 导出配置
export const config = loadConfig();
// 导出错误码常量 - 基于JSON-RPC标准错误码
export var ErrorCode;
(function (ErrorCode) {
    // 标准JSON-RPC错误码
    ErrorCode[ErrorCode["ParseError"] = -32700] = "ParseError";
    ErrorCode[ErrorCode["InvalidRequest"] = -32600] = "InvalidRequest";
    ErrorCode[ErrorCode["MethodNotFound"] = -32601] = "MethodNotFound";
    ErrorCode[ErrorCode["InvalidParams"] = -32602] = "InvalidParams";
    ErrorCode[ErrorCode["InternalError"] = -32603] = "InternalError";
    // 自定义错误码 (从-32000开始)
    ErrorCode[ErrorCode["BrowserError"] = -32000] = "BrowserError";
    ErrorCode[ErrorCode["NetworkError"] = -32001] = "NetworkError";
    ErrorCode[ErrorCode["TimeoutError"] = -32002] = "TimeoutError";
    ErrorCode[ErrorCode["ScreenshotError"] = -32003] = "ScreenshotError";
    ErrorCode[ErrorCode["ResourceLimitExceeded"] = -32004] = "ResourceLimitExceeded";
    ErrorCode[ErrorCode["InvalidURL"] = -32005] = "InvalidURL";
    ErrorCode[ErrorCode["URLBlocked"] = -32006] = "URLBlocked";
    ErrorCode[ErrorCode["RateLimitExceeded"] = -32007] = "RateLimitExceeded";
    ErrorCode[ErrorCode["AnalysisError"] = -32008] = "AnalysisError";
    ErrorCode[ErrorCode["SessionNotFound"] = -32009] = "SessionNotFound";
    ErrorCode[ErrorCode["ScreenshotNotFound"] = -32010] = "ScreenshotNotFound";
})(ErrorCode || (ErrorCode = {}));
// 定义标准化错误类，继承自Error
export class McpError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(message);
        this.name = 'McpError';
        this.code = code;
        this.data = data;
    }
    // 转换为JSON-RPC错误响应
    toJSON() {
        return {
            code: this.code,
            message: this.message,
            data: this.data
        };
    }
}
