import path from 'path';

// 错误码枚举
export const ErrorCode = {
  // 一般错误
  InvalidRequest: 'INVALID_REQUEST',        // 无效请求
  InternalError: 'INTERNAL_ERROR',          // 内部错误
  
  // 资源错误
  ResourceLimitExceeded: 'RESOURCE_LIMIT_EXCEEDED', // 资源限制超出
  
  // 浏览器相关错误
  BrowserError: 'BROWSER_ERROR',            // 浏览器错误
  TimeoutError: 'TIMEOUT_ERROR',            // 超时错误
  NetworkError: 'NETWORK_ERROR',            // 网络错误
  
  // URL相关错误
  URLBlocked: 'URL_BLOCKED',                // URL被阻止
  URLInvalid: 'URL_INVALID',                // 无效URL
  
  // 截图相关错误
  ScreenshotError: 'SCREENSHOT_ERROR',      // 截图错误
  ScreenshotNotFound: 'SCREENSHOT_NOT_FOUND', // 截图未找到
  
  // 分析相关错误
  AnalysisError: 'ANALYSIS_ERROR',          // 分析错误
  SessionNotFound: 'SESSION_NOT_FOUND',     // 会话未找到
};

// 通用错误类
export class McpError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'McpError';
  }
  
  // 转换为可序列化对象
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

// 全局配置
export const config = {
  // 浏览器池配置
  browserPool: {
    maxInstances: 5,            // 最大浏览器实例数
    maxLifetime: 30 * 60 * 1000, // 浏览器实例最大生命周期(30分钟)
    idleTimeout: 5 * 60 * 1000,  // 空闲浏览器实例超时时间(5分钟)
  },
  
  // 截图配置
  screenshots: {
    enabled: true,               // 是否启用截图功能
    directory: path.join(process.cwd(), 'screenshots'), // 截图存储目录
    format: 'png',               // 默认截图格式
    maxAge: 24 * 60 * 60 * 1000, // 截图最大保存时间(24小时)
    cleanupInterval: 60 * 60 * 1000, // 清理间隔(1小时)
  },
  
  // 性能测试配置
  performance: {
    defaultTimeout: 30000,       // 默认页面加载超时(30秒)
    maxTimeout: 60000,           // 最大允许的超时时间(60秒)
    defaultViewport: {           // 默认视口尺寸
      width: 1920,
      height: 1080,
    },
    // 性能指标阈值
    thresholds: {
      loadTime: 3000,            // 页面加载时间阈值(毫秒)
      firstContentfulPaint: 1500, // 首次内容绘制阈值(毫秒)
      largestContentfulPaint: 2500, // 最大内容绘制阈值(毫秒)
      totalBlockingTime: 300,    // 总阻塞时间阈值(毫秒)
      cumulativeLayoutShift: 0.1, // 累积布局偏移阈值
      firstInputDelay: 100,      // 首次输入延迟阈值(毫秒)
      resourcesCount: 100,       // 资源数量阈值
      totalSize: 5 * 1024 * 1024, // 总资源大小阈值(5MB)
      imageSize: 2 * 1024 * 1024, // 图片大小阈值(2MB)
      scriptSize: 1 * 1024 * 1024, // JavaScript大小阈值(1MB)
      cssSize: 0.5 * 1024 * 1024, // CSS大小阈值(0.5MB)
    },
  },
  
  // URL过滤配置
  urlFiltering: {
    enabled: true,              // 是否启用URL过滤
    allowLocalhost: false,      // 是否允许访问localhost
    allowPrivateIps: false,     // 是否允许访问内网IP
    blacklist: [],              // 域名黑名单
    whitelist: [],              // 域名白名单(为空则允许所有非黑名单域名)
  },
  
  // HTTPS配置
  https: {
    enabled: false,             // 是否启用HTTPS(SSE模式)
    cert: '',                   // 证书文件路径
    key: '',                    // 密钥文件路径
  },
  
  // 数据保留配置
  dataRetention: {
    sessions: {
      enabled: true,            // 是否启用会话保留
      maxAge: 7 * 24 * 60 * 60 * 1000, // 会话最大保留时间(7天)
      maxCount: 1000,           // 最大保留会话数
    },
  },
  
  // 日志配置
  logging: {
    level: 'info',              // 日志级别
    console: true,              // 是否输出到控制台
    file: false,                // 是否输出到文件
    filePath: path.join(process.cwd(), 'logs'), // 日志目录
  },
};

// 读取环境变量配置(如果存在)
if (process.env.MCP_MAX_BROWSER_INSTANCES) {
  config.browserPool.maxInstances = parseInt(process.env.MCP_MAX_BROWSER_INSTANCES, 10);
}

if (process.env.MCP_SCREENSHOTS_ENABLED) {
  config.screenshots.enabled = process.env.MCP_SCREENSHOTS_ENABLED === 'true';
}

if (process.env.MCP_SCREENSHOTS_DIR) {
  config.screenshots.directory = process.env.MCP_SCREENSHOTS_DIR;
}

if (process.env.MCP_DEFAULT_TIMEOUT) {
  config.performance.defaultTimeout = parseInt(process.env.MCP_DEFAULT_TIMEOUT, 10);
}

if (process.env.MCP_ALLOW_LOCALHOST) {
  config.urlFiltering.allowLocalhost = process.env.MCP_ALLOW_LOCALHOST === 'true';
}

if (process.env.MCP_URL_WHITELIST) {
  config.urlFiltering.whitelist = process.env.MCP_URL_WHITELIST.split(',');
}

if (process.env.MCP_URL_BLACKLIST) {
  config.urlFiltering.blacklist = process.env.MCP_URL_BLACKLIST.split(',');
}

// 确保配置有效性
function validateConfig() {
  if (config.browserPool.maxInstances <= 0) {
    config.browserPool.maxInstances = 1;
  }
  
  if (config.performance.defaultTimeout > config.performance.maxTimeout) {
    config.performance.defaultTimeout = config.performance.maxTimeout;
  }
}

validateConfig();