import { nanoid } from 'nanoid';
import { Browser, Page } from 'playwright-core';
import {
  PerformanceMetrics,
  PerformanceIssue,
  Recommendation,
  AnalysisSession,
  PerformanceAnalysisResult,
  Screenshot
} from '../types/performance.js';
import {
  launchBrowser,
  visitPage,
  collectPerformanceMetrics,
  saveScreenshot,
  getScreenshotData
} from '../utils/browser.js';

// 会话存储
const sessions: Map<string, AnalysisSession> = new Map();

// 分析URL的性能
export async function analyzePerformance(
  url: string,
  saveScreenshotOption: boolean = true,
  timeout: number = 30000
): Promise<PerformanceAnalysisResult> {
  // 生成会话ID
  const sessionId = nanoid();
  const timestamp = new Date().toISOString();
  
  let browser: Browser | null = null;
  let page: Page | null = null;
  
  try {
    // 启动浏览器
    browser = await launchBrowser();
    
    // 访问页面
    const pageResult = await visitPage(browser, url, timeout);
    if (!('page' in pageResult)) {
      page = pageResult;
    } else {
      page = pageResult.page;
    }
    
    // 收集性能指标
    const metrics = await collectPerformanceMetrics(page);
    
    // 保存截图(如果启用)
    let screenshotInfo: Screenshot | undefined = undefined;
    if (saveScreenshotOption) {
      const screenshotPath = await saveScreenshot(page, sessionId);
      if (screenshotPath) {
        screenshotInfo = {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          path: screenshotPath,
          format: 'png'
        };
      }
    }
    
    // 分析性能问题
    const issues = analyzeIssues(metrics);
    
    // 生成优化建议
    const recommendations = generateRecommendations(issues);
    
    // 创建会话数据
    const session: AnalysisSession = {
      id: sessionId,
      url,
      timestamp,
      metrics,
      issues,
      recommendations,
      screenshot: screenshotInfo
    };
    
    // 存储会话数据
    sessions.set(sessionId, session);
    
    // 构建结果对象
    const analysisResult: PerformanceAnalysisResult = {
      sessionId,
      url,
      timestamp,
      metrics,
      issues,
      recommendations,
      screenshot: screenshotInfo ? {
        id: screenshotInfo.id,
        timestamp: screenshotInfo.timestamp,
        format: screenshotInfo.format
      } : undefined
    };
    
    return analysisResult;
  } catch (error) {
    console.error('Error analyzing performance:', error);
    throw error;
  } finally {
    // 关闭页面和浏览器
    if (page) await page.close();
    if (browser) await browser.close();
  }
}

// 分析性能问题
function analyzeIssues(metrics: PerformanceMetrics): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  
  // 检查加载时间
  if (metrics.navigationTiming.loadTime > 3000) {
    issues.push({
      id: nanoid(),
      category: 'general',
      severity: metrics.navigationTiming.loadTime > 5000 ? 'critical' : 'high',
      description: `页面加载时间(${Math.round(metrics.navigationTiming.loadTime)}ms)过长，影响用户体验。`,
    });
  }
  
  // 检查首次内容绘制时间
  if (metrics.navigationTiming.firstContentfulPaint > 1000) {
    issues.push({
      id: nanoid(),
      category: 'general',
      severity: metrics.navigationTiming.firstContentfulPaint > 2000 ? 'high' : 'medium',
      description: `首次内容绘制时间(${Math.round(metrics.navigationTiming.firstContentfulPaint)}ms)过长，用户感知页面加载缓慢。`,
    });
  }
  
  // 检查大体积资源
  const largeResources = metrics.resources.slowestResources.filter(r => r.size > 500000);
  if (largeResources.length > 0) {
    issues.push({
      id: nanoid(),
      category: largeResources[0].type === 'img' ? 'images' : 
               largeResources[0].type === 'script' ? 'javascript' : 
               largeResources[0].type === 'stylesheet' ? 'css' : 'network',
      severity: 'high',
      description: `发现${largeResources.length}个大体积资源(>500KB)，增加了加载时间和流量消耗。`,
      affectedResources: largeResources.map(r => r.url),
    });
  }
  
  // 检查慢加载资源
  const slowResources = metrics.resources.slowestResources.filter(r => r.duration > 1000);
  if (slowResources.length > 0) {
    issues.push({
      id: nanoid(),
      category: 'network',
      severity: 'medium',
      description: `发现${slowResources.length}个加载缓慢的资源(>1秒)，影响页面加载性能。`,
      affectedResources: slowResources.map(r => r.url),
    });
  }
  
  // 检查资源总量
  if (metrics.resources.totalCount > 60) {
    issues.push({
      id: nanoid(),
      category: 'network',
      severity: 'medium',
      description: `页面加载了大量资源(${metrics.resources.totalCount}个)，增加了请求开销和加载时间。`,
    });
  }
  
  // 检查页面总大小
  if (metrics.resources.totalSize > 3 * 1024 * 1024) { // 3MB
    issues.push({
      id: nanoid(),
      category: 'general',
      severity: 'high',
      description: `页面总大小(${(metrics.resources.totalSize / (1024 * 1024)).toFixed(2)}MB)过大，影响加载速度和流量消耗。`,
    });
  }
  
  // 根据资源类型检查特定问题
  const jsSize = metrics.resources.byType['script']?.size || 0;
  if (jsSize > 1 * 1024 * 1024) { // 1MB
    issues.push({
      id: nanoid(),
      category: 'javascript',
      severity: 'high',
      description: `JavaScript资源总大小(${(jsSize / (1024 * 1024)).toFixed(2)}MB)过大，增加了加载、解析和执行时间。`,
    });
  }
  
  const cssSize = metrics.resources.byType['stylesheet']?.size || 0;
  if (cssSize > 500 * 1024) { // 500KB
    issues.push({
      id: nanoid(),
      category: 'css',
      severity: 'medium',
      description: `CSS资源总大小(${(cssSize / 1024).toFixed(2)}KB)过大，增加了加载和渲染时间。`,
    });
  }
  
  const imgSize = metrics.resources.byType['img']?.size || 0;
  if (imgSize > 2 * 1024 * 1024) { // 2MB
    issues.push({
      id: nanoid(),
      category: 'images',
      severity: 'high',
      description: `图片资源总大小(${(imgSize / (1024 * 1024)).toFixed(2)}MB)过大，增加了加载时间和流量消耗。`,
    });
  }

  // 检查HTTP/2协议使用情况
  const nq = metrics.networkQuality;
  const totalProtocolDetected = nq.http2ResourceCount + nq.http1ResourceCount;
  if (totalProtocolDetected > 0 && nq.http1ResourceCount > 0 &&
      nq.http1ResourceCount >= nq.http2ResourceCount) {
    issues.push({
      id: nanoid(),
      category: 'network',
      severity: 'medium',
      description: `发现${nq.http1ResourceCount}个资源未使用HTTP/2协议加载，无法利用多路复用提升并发效率。`,
      affectedResources: nq.http1Resources.slice(0, 5),
    });
  }

  // 检查gzip/brotli压缩启用情况
  if (nq.uncompressedCount > 0) {
    issues.push({
      id: nanoid(),
      category: 'network',
      severity: nq.uncompressedCount > 3 ? 'high' : 'medium',
      description: `发现${nq.uncompressedCount}个文本资源未启用gzip/brotli压缩，存在不必要的传输体积浪费。`,
      affectedResources: nq.uncompressedResources.slice(0, 5).map(r => r.url),
    });
  }

  // 检查TTFB(首字节时间)
  if (nq.avgTtfb > 200 || nq.highTtfbCount > 0) {
    issues.push({
      id: nanoid(),
      category: 'network',
      severity: nq.avgTtfb > 500 ? 'high' : 'medium',
      description: `服务器首字节响应时间(TTFB)偏高，平均${Math.round(nq.avgTtfb)}ms，共${nq.highTtfbCount}个资源超过500ms阈值。`,
      affectedResources: nq.highTtfbResources.slice(0, 5).map(r => r.url),
    });
  }

  // 检查缓存命中率
  const totalCacheable = nq.cacheHitCount + nq.cacheMissCount;
  if (totalCacheable > 5 && nq.cacheHitRate < 0.5) {
    issues.push({
      id: nanoid(),
      category: 'network',
      severity: 'medium',
      description: `浏览器缓存命中率偏低(${(nq.cacheHitRate * 100).toFixed(1)}%)，${nq.cacheMissCount}个资源每次都需重新下载，增加了重复加载开销。`,
    });
  }

  return issues;
}

// 生成优化建议
function generateRecommendations(issues: PerformanceIssue[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  
  // 为每个问题生成相应的建议
  for (const issue of issues) {
    switch (issue.category) {
      case 'general':
        if (issue.description.includes('加载时间')) {
          recommendations.push({
            id: nanoid(),
            issueId: issue.id,
            title: '优化页面加载时间',
            description: '减少页面加载时间，提升用户体验。',
            difficulty: 'medium',
            expectedImpact: 'high',
            implementationSteps: [
              '优化关键渲染路径',
              '减少阻塞渲染的资源',
              '实施延迟加载非关键资源',
              '考虑使用服务端渲染或静态生成',
              '优化服务器响应时间'
            ],
            resourceLinks: [
              'https://web.dev/fast',
              'https://developers.google.com/web/fundamentals/performance/critical-rendering-path'
            ]
          });
        } else if (issue.description.includes('页面总大小')) {
          recommendations.push({
            id: nanoid(),
            issueId: issue.id,
            title: '减少页面体积',
            description: '减少页面总体积，加快加载速度并降低流量消耗。',
            difficulty: 'medium',
            expectedImpact: 'high',
            implementationSteps: [
              '压缩文本资源(HTML, CSS, JavaScript)',
              '优化图片体积和格式',
              '移除未使用的代码和资源',
              '考虑使用代码拆分和按需加载',
              '实施资源缓存策略'
            ]
          });
        }
        break;
        
      case 'network':
        if (issue.description.includes('未使用HTTP/2')) {
          recommendations.push({
            id: nanoid(),
            issueId: issue.id,
            title: '升级到HTTP/2或HTTP/3',
            description: '启用HTTP/2协议，利用多路复用减少请求延迟，显著提升并发资源加载效率。',
            difficulty: 'medium',
            expectedImpact: 'high',
            implementationSteps: [
              '在服务器或CDN上启用HTTP/2支持',
              '确保使用HTTPS（HTTP/2要求TLS）',
              'Nginx配置：在listen指令添加 http2 参数（如 listen 443 ssl http2）',
              '若使用CDN，在控制台确认HTTP/2已开启',
              '验证：浏览器DevTools → Network面板 → Protocol列查看是否显示h2',
            ],
            resourceLinks: [
              'https://web.dev/performance-http2/',
              'https://nginx.org/en/docs/http/ngx_http_v2_module.html',
            ]
          });
        } else if (issue.description.includes('未启用gzip/brotli压缩')) {
          recommendations.push({
            id: nanoid(),
            issueId: issue.id,
            title: '启用服务器端压缩(gzip/brotli)',
            description: '对文本类资源启用gzip或brotli压缩，通常可减少60-80%的传输体积。',
            difficulty: 'easy',
            expectedImpact: 'high',
            implementationSteps: [
              'Nginx：添加 gzip on; 并配置 gzip_types text/html text/css application/javascript application/json',
              'Nginx：优先启用brotli压缩（需安装ngx_brotli模块，压缩率比gzip高15-25%）',
              'Express：安装并使用 compression 中间件（npm install compression）',
              'CDN：在控制台开启压缩功能（通常默认已开启，检查是否禁用）',
              '验证：curl -H "Accept-Encoding: gzip, br" -I <url>，检查响应头 Content-Encoding',
            ],
            resourceLinks: [
              'https://web.dev/reduce-network-payloads-using-text-compression/',
              'https://nginx.org/en/docs/http/ngx_http_gzip_module.html',
            ]
          });
        } else if (issue.description.includes('TTFB')) {
          recommendations.push({
            id: nanoid(),
            issueId: issue.id,
            title: '降低服务器首字节响应时间(TTFB)',
            description: '优化服务器处理速度和网络路径，减少用户等待第一字节的时间。',
            difficulty: 'medium',
            expectedImpact: 'high',
            implementationSteps: [
              '启用服务器端缓存（Redis/Memcached）减少重复计算和数据库查询',
              '使用CDN将内容分发到更靠近用户的边缘节点',
              '优化慢查询，为高频查询字段添加数据库索引',
              '对动态页面使用服务端渲染缓存或SSG静态生成',
              '检查DNS解析耗时，考虑换用更快的DNS提供商',
              '添加资源预解析：<link rel="dns-prefetch" href="//example.com">',
            ],
            resourceLinks: [
              'https://web.dev/ttfb/',
              'https://web.dev/optimize-ttfb/',
            ]
          });
        } else if (issue.description.includes('缓存命中率')) {
          recommendations.push({
            id: nanoid(),
            issueId: issue.id,
            title: '优化浏览器缓存策略',
            description: '为静态资源配置合适的缓存响应头，减少重复请求，提升二次访问速度。',
            difficulty: 'easy',
            expectedImpact: 'high',
            implementationSteps: [
              '为静态资源（JS/CSS/图片/字体）设置 Cache-Control: max-age=31536000, immutable',
              '使用内容哈希文件名（如 main.a1b2c3.js）实现无感缓存破坏',
              '对HTML文件设置 Cache-Control: no-cache 确保始终校验最新版本',
              '配置 ETag 和 Last-Modified 响应头支持条件请求（304 Not Modified）',
              '考虑使用Service Worker实现精细化离线缓存策略',
            ],
            resourceLinks: [
              'https://web.dev/http-cache/',
              'https://web.dev/codelab-http-cache/',
            ]
          });
        } else if (issue.description.includes('加载缓慢的资源')) {
          recommendations.push({
            id: nanoid(),
            issueId: issue.id,
            title: '优化慢加载资源',
            description: '提高资源加载速度，减少用户等待时间。',
            difficulty: 'medium',
            expectedImpact: 'high',
            implementationSteps: [
              '使用CDN分发资源',
              '优化服务器响应时间',
              '考虑预加载关键资源',
              '减小资源文件大小',
              '使用HTTP/2或HTTP/3提高并行下载效率'
            ]
          });
        } else if (issue.description.includes('大量资源')) {
          recommendations.push({
            id: nanoid(),
            issueId: issue.id,
            title: '减少HTTP请求数量',
            description: '减少页面加载的资源数量，降低请求开销。',
            difficulty: 'medium',
            expectedImpact: 'medium',
            implementationSteps: [
              '合并小型CSS和JavaScript文件',
              '使用CSS Sprites合并图标',
              '内联关键CSS',
              '移除未使用的资源',
              '实施延迟加载非关键资源'
            ]
          });
        }
        break;
        
      case 'javascript':
        recommendations.push({
          id: nanoid(),
          issueId: issue.id,
          title: '优化JavaScript性能',
          description: '减少JavaScript体积和执行时间，提高页面响应速度。',
          difficulty: 'hard',
          expectedImpact: 'high',
          implementationSteps: [
            '代码分割和懒加载',
            '使用工具清除未使用代码',
            '压缩和最小化JavaScript文件',
            '避免大型框架(如不需要)',
            '优化JavaScript执行时间',
            '考虑使用Web Workers处理复杂计算'
          ],
          resourceLinks: [
            'https://web.dev/optimize-javascript-execution/',
            'https://web.dev/reduce-javascript-payloads-with-code-splitting/'
          ]
        });
        break;
        
      case 'css':
        recommendations.push({
          id: nanoid(),
          issueId: issue.id,
          title: '优化CSS性能',
          description: '减少CSS体积和复杂度，加快渲染速度。',
          difficulty: 'medium',
          expectedImpact: 'medium',
          implementationSteps: [
            '移除未使用的CSS规则',
            '简化CSS选择器',
            '内联关键CSS',
            '延迟加载非关键CSS',
            '压缩CSS文件',
            '考虑使用CSS框架的按需导入'
          ]
        });
        break;
        
      case 'images':
        recommendations.push({
          id: nanoid(),
          issueId: issue.id,
          title: '优化图片资源',
          description: '减少图片体积，加快加载速度。',
          difficulty: 'easy',
          expectedImpact: 'high',
          implementationSteps: [
            '使用适当的图片格式(如WebP, AVIF)',
            '根据设备提供响应式图片',
            '压缩图片体积',
            '实施延迟加载非关键图片',
            '考虑使用图片CDN进行自动优化'
          ],
          resourceLinks: [
            'https://web.dev/optimize-images/',
            'https://web.dev/serve-responsive-images/'
          ]
        });
        break;
    }
  }
  
  return recommendations;
}

// 获取会话数据
export function getSession(sessionId: string): AnalysisSession | undefined {
  return sessions.get(sessionId);
}

// 获取会话截图数据
export async function getSessionScreenshot(sessionId: string): Promise<string | null> {
  const session = sessions.get(sessionId);
  if (!session || !session.screenshot) {
    return null;
  }
  
  try {
    const imageData = await getScreenshotData(session.screenshot.path);
    return imageData;
  } catch (error) {
    console.error('Error getting screenshot data:', error);
    return null;
  }
}