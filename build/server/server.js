import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createSSEServer } from './sseTransport.js';
import { analyzePerformance, getSession, getSessionScreenshot } from '../analyzer/performanceAnalyzer.js';
import { prewarmBrowser } from '../utils/browser.js';
// 模块级 handler：避免在 createPerformanceServer 复杂泛型上下文中触发 TS2589
async function getScreenshotHandler({ sessionId }) {
    try {
        const session = getSession(sessionId);
        if (!session) {
            return { content: [{ type: 'text', text: `找不到会话ID: ${sessionId}` }], isError: true };
        }
        if (!session.screenshot) {
            return { content: [{ type: 'text', text: `该会话没有保存截图` }], isError: true };
        }
        const screenshotData = await getSessionScreenshot(sessionId);
        if (!screenshotData) {
            return { content: [{ type: 'text', text: `无法加载截图数据` }], isError: true };
        }
        return {
            content: [{
                    type: 'image',
                    data: screenshotData,
                    mimeType: (session.screenshot.format === 'png' ? 'image/png' : 'image/jpeg'),
                }],
        };
    }
    catch (error) {
        process.stderr.write(`获取截图失败: ${error}\n`);
        return { content: [{ type: 'text', text: `获取截图失败: ${error.message || '未知错误'}` }], isError: true };
    }
}
// 默认配置
const DEFAULT_CONFIG = {
    name: 'performance-analyzer',
    version: '1.0.0',
    ssePort: 3001,
    maxRetries: 3,
    retryDelay: 1000,
    prewarmBrowser: true,
};
// 创建性能分析MCP服务器
export async function createPerformanceServer(config = {}, transportMode = 'stdio') {
    // 合并配置，确保所有字段都有默认值
    const mergedConfig = {
        ...DEFAULT_CONFIG,
        ...config,
        ssePort: config.ssePort || DEFAULT_CONFIG.ssePort,
        maxRetries: config.maxRetries || DEFAULT_CONFIG.maxRetries,
        retryDelay: config.retryDelay || DEFAULT_CONFIG.retryDelay,
        prewarmBrowser: config.prewarmBrowser !== undefined ? config.prewarmBrowser : DEFAULT_CONFIG.prewarmBrowser
    };
    // 创建MCP服务器实例
    const server = new McpServer({
        name: mergedConfig.name,
        version: mergedConfig.version,
    });
    // 预热浏览器实例
    if (mergedConfig.prewarmBrowser) {
        try {
            process.stderr.write('预热浏览器实例中...\n');
            await prewarmBrowser();
            process.stderr.write('浏览器实例预热完成\n');
        }
        catch (error) {
            process.stderr.write(`浏览器预热失败，将在首次请求时初始化: ${error}\n`);
        }
    }
    // 注册工具: 分析性能
    server.tool('analyze-performance', '分析指定URL的网页性能', {
        url: z.string().url().optional().describe('要分析的网页URL'),
        saveScreenshot: z.boolean().optional().default(true).describe('是否保存页面截图'),
        timeout: z.number().optional().default(30000).describe('页面加载超时时间(毫秒)'),
    }, async ({ url, saveScreenshot, timeout }) => {
        // 如果没有提供URL，返回等待输入的提示
        if (!url) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `请提供要分析的网页URL。
              
示例：
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "analyze-performance",
    "arguments": { 
      "url": "https://example.com", 
      "saveScreenshot": true 
    }
  }
}`,
                    },
                ],
            };
        }
        try {
            // 执行性能分析
            const result = await analyzePerformance(url, saveScreenshot, timeout);
            // 构建友好的响应信息
            const response = `
## 性能分析结果:

### 基本信息
- URL: ${result.url}
- 分析时间: ${result.timestamp}
- 会话ID: ${result.sessionId}

### 关键性能指标
- 页面加载时间: ${Math.round(result.metrics.navigationTiming.loadTime)}ms
- DOM内容加载时间: ${Math.round(result.metrics.navigationTiming.domContentLoaded)}ms
- 首次绘制时间: ${Math.round(result.metrics.navigationTiming.firstPaint)}ms
- 首次内容绘制: ${Math.round(result.metrics.navigationTiming.firstContentfulPaint)}ms
- 最大内容绘制: ${Math.round(result.metrics.navigationTiming.largestContentfulPaint)}ms

### 资源统计
- 总资源数: ${result.metrics.resources.totalCount}个
- 总资源大小: ${(result.metrics.resources.totalSize / (1024 * 1024)).toFixed(2)}MB

### 资源类型统计
${Object.entries(result.metrics.resources.byType).map(([type, stats]) => `- ${type}: ${stats.count}个资源，共${(stats.size / 1024).toFixed(2)}KB`).join('\n')}

### 网络质量检测
- HTTP/2资源: ${result.metrics.networkQuality.http2ResourceCount}个 / HTTP/1.x资源: ${result.metrics.networkQuality.http1ResourceCount}个
- 压缩情况: ${result.metrics.networkQuality.compressedCount}个已压缩 / ${result.metrics.networkQuality.uncompressedCount}个未压缩
- 平均TTFB: ${Math.round(result.metrics.networkQuality.avgTtfb)}ms (高TTFB资源: ${result.metrics.networkQuality.highTtfbCount}个)
- 缓存命中率: ${(result.metrics.networkQuality.cacheHitRate * 100).toFixed(1)}% (命中: ${result.metrics.networkQuality.cacheHitCount}个 / 未命中: ${result.metrics.networkQuality.cacheMissCount}个)

### 发现的问题(${result.issues.length}个):
${result.issues.map(issue => `- [${issue.severity.toUpperCase()}] ${issue.description}`).join('\n')}

### 优化建议(${result.recommendations.length}个):
${result.recommendations.map(rec => `- ${rec.title}: ${rec.description} (难度: ${rec.difficulty}, 预期影响: ${rec.expectedImpact})`).join('\n')}

${result.screenshot ? '已保存页面截图，可使用get-screenshot工具查看' : ''}

要查看详细的分析数据和获取截图，可使用会话ID: ${result.sessionId}
        `;
            return {
                content: [
                    {
                        type: 'text',
                        text: response,
                    },
                ],
            };
        }
        catch (error) {
            console.error('性能分析失败:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `分析失败: ${error.message || '未知错误'}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 注册工具: 获取截图
    server.tool('get-screenshot', '获取指定分析会话的页面截图', { sessionId: z.string().describe('分析会话ID') }, getScreenshotHandler);
    // 注册工具: 获取分析详情
    server.tool('get-analysis-details', '获取指定分析会话的详细结果', {
        sessionId: z.string().describe('分析会话ID'),
    }, async ({ sessionId }) => {
        try {
            // 获取会话数据
            const session = getSession(sessionId);
            if (!session) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `找不到会话ID: ${sessionId}`,
                        },
                    ],
                    isError: true,
                };
            }
            // 构建详细报告
            const details = `
# 网页性能分析详细报告

## 基本信息
- URL: ${session.url}
- 分析时间: ${session.timestamp}
- 会话ID: ${session.id}

## 性能指标详情

### 导航时间
- 页面加载时间: ${Math.round(session.metrics.navigationTiming.loadTime)}ms
- DOM内容加载: ${Math.round(session.metrics.navigationTiming.domContentLoaded)}ms
- 首次绘制: ${Math.round(session.metrics.navigationTiming.firstPaint)}ms
- 首次内容绘制: ${Math.round(session.metrics.navigationTiming.firstContentfulPaint)}ms
- 最大内容绘制: ${Math.round(session.metrics.navigationTiming.largestContentfulPaint)}ms
- 首次输入延迟: ${Math.round(session.metrics.navigationTiming.firstInputDelay)}ms
- 总阻塞时间: ${Math.round(session.metrics.navigationTiming.totalBlockingTime)}ms
- 累积布局偏移: ${session.metrics.navigationTiming.cumulativeLayoutShift.toFixed(3)}

### 资源统计
- 总资源数: ${session.metrics.resources.totalCount}个
- 总资源大小: ${(session.metrics.resources.totalSize / (1024 * 1024)).toFixed(2)}MB

### 资源类型统计
${Object.entries(session.metrics.resources.byType).map(([type, stats]) => `- ${type}: ${stats.count}个资源，共${(stats.size / 1024).toFixed(2)}KB`).join('\n')}

### 加载最慢的资源
${session.metrics.resources.slowestResources.map((res, i) => `${i + 1}. [${res.type}] ${res.url.substring(0, 80)}${res.url.length > 80 ? '...' : ''}\n   大小: ${(res.size / 1024).toFixed(2)}KB, 加载时间: ${res.duration.toFixed(0)}ms`).join('\n')}

## 发现的问题

${session.issues.map(issue => `### [${issue.severity.toUpperCase()}] ${issue.category.toUpperCase()}: ${issue.description}
${issue.affectedResources ? `受影响资源:\n${issue.affectedResources.map(r => `- ${r.substring(0, 80)}${r.length > 80 ? '...' : ''}`).join('\n')}` : ''}`).join('\n\n')}

## 优化建议

${session.recommendations.map(rec => `### ${rec.title} (难度: ${rec.difficulty}, 预期影响: ${rec.expectedImpact})
${rec.description}

实施步骤:
${rec.implementationSteps.map(step => `- ${step}`).join('\n')}
${rec.resourceLinks ? `\n相关资源:\n${rec.resourceLinks.map(link => `- ${link}`).join('\n')}` : ''}`).join('\n\n')}
        `;
            return {
                content: [
                    {
                        type: 'text',
                        text: details,
                    },
                ],
            };
        }
        catch (error) {
            console.error('获取分析详情失败:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `获取分析详情失败: ${error.message || '未知错误'}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 返回服务器和启动函数
    return {
        server,
        start: async () => {
            try {
                if (transportMode === 'stdio') {
                    // 使用标准输入输出传输
                    const transport = new StdioServerTransport();
                    // 添加重试逻辑
                    let connected = false;
                    let retries = 0;
                    while (!connected && retries < mergedConfig.maxRetries) {
                        try {
                            await server.connect(transport);
                            connected = true;
                            process.stderr.write('MCP服务器(STDIO)启动成功\n');
                        }
                        catch (error) {
                            retries++;
                            console.error(`MCP服务器连接失败(${retries}/${mergedConfig.maxRetries}):`, error);
                            if (retries < mergedConfig.maxRetries) {
                                process.stderr.write(`等待${mergedConfig.retryDelay}ms后重试...\n`);
                                await new Promise(resolve => setTimeout(resolve, mergedConfig.retryDelay));
                            }
                            else {
                                throw new Error(`MCP服务器连接失败，已达到最大重试次数(${mergedConfig.maxRetries})`);
                            }
                        }
                    }
                }
                else if (transportMode === 'sse') {
                    // 使用SSE传输
                    const sseServer = createSSEServer({
                        port: mergedConfig.ssePort,
                    });
                    // 设置MCP服务器引用
                    sseServer.setMcpServer(server);
                    // 启动SSE服务器并处理可能的错误
                    try {
                        await sseServer.start();
                        process.stderr.write(`性能分析MCP服务器(SSE)启动成功，端口: ${mergedConfig.ssePort}\n`);
                        process.stderr.write(`可以通过以下地址访问SSE端点: http://localhost:${mergedConfig.ssePort}/sse\n`);
                    }
                    catch (error) {
                        console.error(`SSE服务器启动失败: ${error.message || '未知错误'}`);
                        if (error.code === 'EADDRINUSE') {
                            console.error(`端口 ${mergedConfig.ssePort} 已被占用。请尝试使用--port参数指定另一个端口。`);
                            console.error(`例如: npm run start:sse -- --port=3002`);
                        }
                        throw error;
                    }
                    // 设置进程退出处理
                    process.on('SIGINT', async () => {
                        process.stderr.write('收到SIGINT信号，正在关闭服务器...\n');
                        try {
                            await sseServer.stop();
                            process.stderr.write('服务器已优雅关闭\n');
                            process.exit(0);
                        }
                        catch (error) {
                            process.stderr.write(`关闭服务器时出错: ${error}\n`);
                            process.exit(1);
                        }
                    });
                    process.on('SIGTERM', async () => {
                        process.stderr.write('收到SIGTERM信号，正在关闭服务器...\n');
                        try {
                            await sseServer.stop();
                            process.stderr.write('服务器已优雅关闭\n');
                            process.exit(0);
                        }
                        catch (error) {
                            process.stderr.write(`关闭服务器时出错: ${error}\n`);
                            process.exit(1);
                        }
                    });
                }
                else {
                    throw new Error(`不支持的传输模式: ${transportMode}`);
                }
            }
            catch (error) {
                console.error('启动性能分析MCP服务器失败:', error);
                throw error;
            }
        },
    };
}
