// 性能分析相关的类型定义

// 资源统计类型
export interface ResourceStat {
  type: string;
  count: number;
  size: number;
}

// 慢资源类型
export interface SlowResource {
  url: string;
  duration: number;
  size: number;
  type: string;
}

// 性能指标类型
export interface PerformanceMetrics {
  navigationTiming: {
    loadTime: number;           // 页面完成加载时间
    domContentLoaded: number;   // DOM内容加载完成时间
    firstPaint: number;         // 首次绘制时间
    firstContentfulPaint: number; // 首次内容绘制
    largestContentfulPaint: number; // 最大内容绘制
    firstInputDelay: number;    // 首次输入延迟
    totalBlockingTime: number;  // 总阻塞时间
    cumulativeLayoutShift: number; // 累积布局偏移
  };
  resources: {
    totalSize: number;          // 资源总大小 (字节)
    totalCount: number;         // 资源总数量
    byType: Record<string, {    // 按资源类型分类
      count: number;            // 该类型资源数量
      size: number;             // 该类型资源总大小
    }>;
    slowestResources: Array<{   // 加载最慢的资源列表
      url: string;              // 资源URL
      duration: number;         // 加载耗时
      size: number;             // 资源大小
      type: string;             // 资源类型
    }>;
  };
  networkQuality: {                   // 网络质量指标
    http2ResourceCount: number;       // 使用HTTP/2+的资源数量
    http1ResourceCount: number;       // 使用HTTP/1.x的资源数量
    http1Resources: string[];         // HTTP/1.x资源URL列表
    compressedCount: number;          // 已压缩文本资源数量
    uncompressedCount: number;        // 未压缩文本资源数量
    uncompressedResources: Array<{ url: string; size: number; type: string }>; // 未压缩资源列表
    avgTtfb: number;                  // 平均TTFB(ms)
    highTtfbCount: number;            // 高TTFB资源数量(>500ms)
    highTtfbResources: Array<{ url: string; ttfb: number }>; // 高TTFB资源列表
    cacheHitCount: number;            // 缓存命中数量
    cacheMissCount: number;           // 缓存未命中数量
    cacheHitRate: number;             // 缓存命中率(0-1)
  };
  // 用于browser.ts中的扁平化属性
  loadTime?: number;
  domContentLoaded?: number;
  firstPaint?: number;
  firstContentfulPaint?: number;
  largestContentfulPaint?: number;
  firstInputDelay?: number;
  totalBlockingTime?: number;
  cumulativeLayoutShift?: number;
  resourceCount?: number;
  totalSize?: number;
  resourceStats?: ResourceStat[];
  slowestResources?: SlowResource[];
}

// 性能问题类型
export interface PerformanceIssue {
  id: string;                   // 问题唯一标识
  category: 'network' | 'javascript' | 'css' | 'images' | 'fonts' | 'general'; // 问题类别
  severity: 'critical' | 'high' | 'medium' | 'low'; // 严重程度
  description: string;          // 问题描述
  affectedResources?: string[]; // 受影响的资源
}

// 优化建议类型
export interface Recommendation {
  id: string;                   // 建议唯一标识
  issueId: string;              // 对应问题ID
  title: string;                // 标题
  description: string;          // 建议描述
  difficulty: 'easy' | 'medium' | 'hard'; // 实施难度
  expectedImpact: 'high' | 'medium' | 'low'; // 预期影响
  implementationSteps: string[]; // 实施步骤
  resourceLinks?: string[];      // 相关资源链接
}

// 截图信息类型
export interface Screenshot {
  id: string;                   // 截图唯一标识
  timestamp: string;            // 创建时间戳
  path: string;                 // 本地存储路径
  format: 'png' | 'jpeg';       // 图片格式
  data?: string;                // 图片数据(Base64编码)
}

// 分析会话类型
export interface AnalysisSession {
  id: string;                   // 会话唯一标识
  url: string;                  // 分析的URL
  timestamp: string;            // 分析时间戳
  metrics: PerformanceMetrics;  // 性能指标
  issues: PerformanceIssue[];   // 发现的问题
  recommendations: Recommendation[]; // 优化建议
  screenshot?: Screenshot;      // 截图信息
}

// 完整分析结果类型
export interface PerformanceAnalysisResult {
  sessionId: string;            // 会话ID
  url: string;                  // 分析的URL
  timestamp: string;            // 分析时间
  metrics: PerformanceMetrics;  // 性能指标
  issues: PerformanceIssue[];   // 发现的问题
  recommendations: Recommendation[]; // 优化建议
  screenshot?: {                // 截图信息
    id: string;                 // 截图ID
    timestamp: string;          // 截图时间
    format: 'png' | 'jpeg';     // 格式
  };
}

// 工具请求类型
export interface AnalyzePerformanceRequest {
  url: string;                 // 要分析的URL
  saveScreenshot?: boolean;    // 是否保存截图
  timeout?: number;            // 访问超时时间(毫秒)
}

export interface GetScreenshotRequest {
  sessionId: string;           // 会话ID
}