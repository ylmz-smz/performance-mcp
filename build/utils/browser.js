import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as playwright from 'playwright-core';
import { config, ErrorCode, McpError } from '../config.js';
/**
 * 浏览器池类 - 管理多个浏览器实例
 */
class BrowserPool {
    instances = [];
    cleanupInterval = null;
    constructor() {
        // 启动定期清理任务
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000); // 每分钟检查一次
    }
    /**
     * 获取可用的浏览器实例
     */
    async getBrowser() {
        // 检查是否有可用实例
        const availableInstance = this.instances.find(instance => !instance.inUse);
        if (availableInstance) {
            availableInstance.inUse = true;
            availableInstance.lastUsedAt = new Date();
            return availableInstance.browser;
        }
        // 如果没有可用实例，检查是否达到最大实例限制
        if (this.instances.length >= config.browserPool.maxInstances) {
            throw new McpError(ErrorCode.ResourceLimitExceeded, `已达到最大浏览器实例数限制(${config.browserPool.maxInstances})`, { currentCount: this.instances.length });
        }
        // 创建新的浏览器实例
        try {
            const browser = await playwright.chromium.launch({
                headless: true,
            });
            const instance = {
                browser,
                createdAt: new Date(),
                lastUsedAt: new Date(),
                inUse: true
            };
            this.instances.push(instance);
            return browser;
        }
        catch (error) {
            throw new McpError(ErrorCode.BrowserError, '无法启动浏览器实例', { originalError: error.message });
        }
    }
    /**
     * 释放浏览器实例
     */
    async releaseBrowser(browser) {
        const index = this.instances.findIndex(instance => instance.browser === browser);
        if (index !== -1) {
            this.instances[index].inUse = false;
            this.instances[index].lastUsedAt = new Date();
        }
    }
    /**
     * 清理过期的浏览器实例
     */
    async cleanup() {
        const now = new Date();
        const instancesToRemove = [];
        // 找出需要清理的实例
        for (const instance of this.instances) {
            // 清理超过最大生命周期的实例
            const lifetime = now.getTime() - instance.createdAt.getTime();
            if (lifetime > config.browserPool.maxLifetime) {
                instancesToRemove.push(instance);
                continue;
            }
            // 清理超过空闲超时的未使用实例
            if (!instance.inUse) {
                const idleTime = now.getTime() - instance.lastUsedAt.getTime();
                if (idleTime > config.browserPool.idleTimeout) {
                    instancesToRemove.push(instance);
                }
            }
        }
        // 关闭并移除实例
        for (const instance of instancesToRemove) {
            try {
                await instance.browser.close();
            }
            catch (error) {
                console.error('关闭浏览器实例时出错:', error);
            }
            const index = this.instances.indexOf(instance);
            if (index !== -1) {
                this.instances.splice(index, 1);
            }
        }
    }
    /**
     * 关闭所有浏览器实例
     */
    async closeAll() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        for (const instance of this.instances) {
            try {
                await instance.browser.close();
            }
            catch (error) {
                console.error('关闭浏览器实例时出错:', error);
            }
        }
        this.instances = [];
    }
}
// 创建浏览器池实例
const browserPool = new BrowserPool();
/**
 * 过滤URL是否允许访问
 */
function isUrlAllowed(url) {
    if (!config.urlFiltering.enabled) {
        return true;
    }
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        // 检查黑名单
        if (config.urlFiltering.blacklist.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
            return false;
        }
        // 检查白名单(如果有设置)
        if (config.urlFiltering.whitelist.length > 0) {
            return config.urlFiltering.whitelist.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        }
        // 检查localhost访问权限
        if ((hostname === 'localhost' || hostname === '127.0.0.1') && !config.urlFiltering.allowLocalhost) {
            return false;
        }
        // 检查内网IP访问权限
        const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const match = hostname.match(ipPattern);
        if (match && !config.urlFiltering.allowPrivateIps) {
            const ipParts = match.slice(1).map(part => parseInt(part, 10));
            // 检查是否为内网IP
            if (ipParts[0] === 10 || // 10.0.0.0/8
                (ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] <= 31) || // 172.16.0.0/12
                (ipParts[0] === 192 && ipParts[1] === 168) // 192.168.0.0/16
            ) {
                return false;
            }
        }
        return true;
    }
    catch (error) {
        throw new McpError(ErrorCode.InvalidRequest, '无效的URL格式', { url });
    }
}
/**
 * 启动浏览器
 */
export async function launchBrowser() {
    return await browserPool.getBrowser();
}
/**
 * 访问页面并返回Page对象
 */
export async function visitPage(browserOrUrl, urlOrTimeout, timeoutArg) {
    // 如果第一个参数是Browser对象
    if (typeof browserOrUrl !== 'string') {
        const browser = browserOrUrl;
        const url = urlOrTimeout;
        const timeout = timeoutArg;
        // URL有效性检查
        if (!url || typeof url !== 'string') {
            throw new McpError(ErrorCode.InvalidRequest, 'URL必须是有效的字符串', { url });
        }
        // URL过滤检查
        if (!isUrlAllowed(url)) {
            throw new McpError(ErrorCode.URLBlocked, '此URL不允许访问', { url });
        }
        try {
            // 创建新页面
            const page = await browser.newPage({
                viewport: config.performance.defaultViewport,
                bypassCSP: true, // 绕过内容安全策略以允许JavaScript注入
            });
            // 设置超时
            const actualTimeout = Math.min(timeout || config.performance.defaultTimeout, config.performance.maxTimeout);
            // 页面导航
            try {
                await page.goto(url, {
                    waitUntil: 'networkidle',
                    timeout: actualTimeout,
                });
            }
            catch (error) {
                await page.close();
                if (error.name === 'TimeoutError') {
                    throw new McpError(ErrorCode.TimeoutError, `页面加载超时(${actualTimeout}ms)`, { url, timeout: actualTimeout });
                }
                throw new McpError(ErrorCode.NetworkError, '页面访问失败', { url, originalError: error.message });
            }
            return page;
        }
        catch (error) {
            // 如果不是McpError，则转换为McpError
            if (!(error instanceof McpError)) {
                error = new McpError(ErrorCode.BrowserError, '浏览器操作出错', { url, originalError: error.message });
            }
            throw error;
        }
    }
    // 原始逻辑 - 当第一个参数是URL时
    const url = browserOrUrl;
    const timeout = typeof urlOrTimeout === 'number' ? urlOrTimeout : config.performance.defaultTimeout;
    // URL有效性检查
    if (!url || typeof url !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'URL必须是有效的字符串', { url });
    }
    // URL过滤检查
    if (!isUrlAllowed(url)) {
        throw new McpError(ErrorCode.URLBlocked, '此URL不允许访问', { url });
    }
    // 获取浏览器实例
    const browser = await browserPool.getBrowser();
    try {
        // 创建新页面
        const page = await browser.newPage({
            viewport: config.performance.defaultViewport,
            bypassCSP: true, // 绕过内容安全策略以允许JavaScript注入
        });
        // 设置超时
        const actualTimeout = Math.min(timeout || config.performance.defaultTimeout, config.performance.maxTimeout);
        // 页面导航
        try {
            await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: actualTimeout,
            });
        }
        catch (error) {
            await page.close();
            if (error.name === 'TimeoutError') {
                throw new McpError(ErrorCode.TimeoutError, `页面加载超时(${actualTimeout}ms)`, { url, timeout: actualTimeout });
            }
            throw new McpError(ErrorCode.NetworkError, '页面访问失败', { url, originalError: error.message });
        }
        return { page, browser };
    }
    catch (error) {
        // 如果不是McpError，则转换为McpError
        if (!(error instanceof McpError)) {
            error = new McpError(ErrorCode.BrowserError, '浏览器操作出错', { url, originalError: error.message });
        }
        // 释放浏览器实例
        await browserPool.releaseBrowser(browser);
        throw error;
    }
}
/**
 * 预热缓存后访问页面：先冷访问一次预热 HTTP 缓存，再访问一次用于指标采集
 * 模拟真实用户回访时的缓存命中场景
 */
export async function visitPageWithWarmCache(browser, url, timeout) {
    const actualTimeout = Math.min(timeout || config.performance.defaultTimeout, config.performance.maxTimeout);
    if (!isUrlAllowed(url)) {
        throw new McpError(ErrorCode.URLBlocked, '此URL不允许访问', { url });
    }
    // 创建共享 BrowserContext，同一 Context 内的多个页面共享 HTTP 缓存
    const context = await browser.newContext({
        viewport: config.performance.defaultViewport,
        bypassCSP: true,
    });
    try {
        // 第一次访问：预热缓存（忽略超时错误，缓存可能已部分建立）
        const warmPage = await context.newPage();
        try {
            await warmPage.goto(url, { waitUntil: 'networkidle', timeout: actualTimeout });
        }
        catch (_) {
            // 预热阶段超时不中断流程
        }
        finally {
            await warmPage.close();
        }
        // 第二次访问：使用缓存进行正式测量
        const page = await context.newPage();
        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: actualTimeout });
        }
        catch (error) {
            await page.close();
            if (error.name === 'TimeoutError') {
                throw new McpError(ErrorCode.TimeoutError, `页面加载超时(${actualTimeout}ms)`, { url, timeout: actualTimeout });
            }
            throw new McpError(ErrorCode.NetworkError, '页面访问失败', { url, originalError: error.message });
        }
        // 页面关闭时自动释放 Context
        page.on('close', () => { context.close().catch(() => { }); });
        return page;
    }
    catch (error) {
        await context.close().catch(() => { });
        if (!(error instanceof McpError)) {
            throw new McpError(ErrorCode.BrowserError, '浏览器操作出错', { url, originalError: error.message });
        }
        throw error;
    }
}
/**
 * 收集页面性能指标
 */
export async function collectPerformanceMetrics(page) {
    try {
        // 基本导航时间指标
        const navTiming = await page.evaluate(() => {
            const performance = window.performance;
            const timing = performance.timing || {};
            const navigation = performance.navigation || {};
            // 计算关键时间指标
            const loadTime = timing.loadEventEnd - timing.navigationStart;
            const domContentLoaded = timing.domContentLoadedEventEnd - timing.navigationStart;
            return {
                loadTime,
                domContentLoaded,
                navigationType: navigation.type,
                redirectCount: navigation.redirectCount
            };
        });
        // 收集资源信息
        const resources = await page.evaluate(() => {
            const entries = window.performance.getEntriesByType('resource');
            const compressibleTypes = ['script', 'stylesheet', 'xmlhttprequest', 'fetch'];
            const result = {
                totalSize: 0,
                totalCount: entries.length,
                byType: {},
                slowest: [],
                networkQuality: {
                    http2Count: 0,
                    http1Count: 0,
                    http1Resources: [],
                    compressedCount: 0,
                    uncompressedCount: 0,
                    uncompressedResources: [],
                    totalTtfb: 0,
                    ttfbCount: 0,
                    highTtfbCount: 0,
                    highTtfbResources: [],
                    cacheHitCount: 0,
                    cacheMissCount: 0,
                }
            };
            // 处理每个资源
            entries.forEach((entry) => {
                const size = entry.transferSize || 0;
                const duration = entry.duration || 0;
                const type = entry.initiatorType || 'other';
                const decodedSize = entry.decodedBodySize || 0;
                const protocol = entry.nextHopProtocol || '';
                const ttfb = (entry.responseStart || 0) - (entry.requestStart || 0);
                // 累计总大小
                result.totalSize += size;
                // 按类型统计
                if (!result.byType[type]) {
                    result.byType[type] = { count: 0, size: 0 };
                }
                result.byType[type].count += 1;
                result.byType[type].size += size;
                // 记录慢资源
                if (duration > 500) { // 超过500ms的资源
                    result.slowest.push({
                        url: entry.name,
                        duration,
                        size,
                        type
                    });
                }
                // 缓存命中检测：transferSize=0 且 decodedBodySize>0 表示命中浏览器缓存
                if (decodedSize > 0) {
                    if (size === 0) {
                        result.networkQuality.cacheHitCount++;
                    }
                    else {
                        result.networkQuality.cacheMissCount++;
                    }
                }
                // HTTP协议版本检测（仅对有协议信息的资源统计）
                if (protocol) {
                    if (protocol.startsWith('h2') || protocol.startsWith('h3')) {
                        result.networkQuality.http2Count++;
                    }
                    else if (protocol.startsWith('http/1')) {
                        result.networkQuality.http1Count++;
                        result.networkQuality.http1Resources.push(entry.name);
                    }
                }
                // 压缩检测：对文本类资源比较 transferSize 与 decodedBodySize 的比率
                // 比率 > 0.9 视为未启用压缩（传输大小接近原始大小）
                if (compressibleTypes.includes(type) && decodedSize > 1024 && size > 0) {
                    const ratio = size / decodedSize;
                    if (ratio > 0.9) {
                        result.networkQuality.uncompressedCount++;
                        result.networkQuality.uncompressedResources.push({ url: entry.name, size: decodedSize, type });
                    }
                    else {
                        result.networkQuality.compressedCount++;
                    }
                }
                // TTFB检测（仅对非缓存的有效资源，即有实际网络传输的资源）
                if (ttfb > 0 && size > 0) {
                    result.networkQuality.totalTtfb += ttfb;
                    result.networkQuality.ttfbCount++;
                    if (ttfb > 500) {
                        result.networkQuality.highTtfbCount++;
                        result.networkQuality.highTtfbResources.push({ url: entry.name, ttfb });
                    }
                }
            });
            // 排序慢资源
            result.slowest.sort((a, b) => b.duration - a.duration);
            result.slowest = result.slowest.slice(0, 10); // 只保留最慢的10个
            // 限制各列表长度，避免返回数据过大
            result.networkQuality.http1Resources = result.networkQuality.http1Resources.slice(0, 10);
            result.networkQuality.uncompressedResources = result.networkQuality.uncompressedResources.slice(0, 10);
            result.networkQuality.highTtfbResources.sort((a, b) => b.ttfb - a.ttfb);
            result.networkQuality.highTtfbResources = result.networkQuality.highTtfbResources.slice(0, 10);
            return result;
        });
        // 收集网页绘制性能指标
        const paintTiming = await page.evaluate(() => {
            const entries = performance.getEntriesByType('paint');
            const result = {};
            entries.forEach((entry) => {
                if (entry.name === 'first-paint') {
                    result.firstPaint = entry.startTime;
                }
                else if (entry.name === 'first-contentful-paint') {
                    result.firstContentfulPaint = entry.startTime;
                }
            });
            return result;
        });
        // 收集Core Web Vitals
        const webVitals = await collectWebVitals(page);
        // 组装完整的性能指标数据
        const resourceStats = Object.entries(resources.byType).map(([type, stats]) => ({
            type,
            count: stats.count,
            size: stats.size
        }));
        const slowestResources = resources.slowest.map((res) => ({
            url: res.url,
            duration: res.duration,
            size: res.size,
            type: res.type
        }));
        // 计算缓存命中率
        const totalCacheable = resources.networkQuality.cacheHitCount + resources.networkQuality.cacheMissCount;
        const cacheHitRate = totalCacheable > 0 ? resources.networkQuality.cacheHitCount / totalCacheable : 0;
        // 计算平均TTFB
        const avgTtfb = resources.networkQuality.ttfbCount > 0
            ? resources.networkQuality.totalTtfb / resources.networkQuality.ttfbCount
            : 0;
        // 返回符合PerformanceMetrics接口的结构
        return {
            navigationTiming: {
                loadTime: navTiming.loadTime,
                domContentLoaded: navTiming.domContentLoaded,
                firstPaint: paintTiming.firstPaint || 0,
                firstContentfulPaint: paintTiming.firstContentfulPaint || 0,
                largestContentfulPaint: webVitals.largestContentfulPaint,
                firstInputDelay: webVitals.firstInputDelay,
                totalBlockingTime: webVitals.totalBlockingTime,
                cumulativeLayoutShift: webVitals.cumulativeLayoutShift
            },
            resources: {
                totalSize: resources.totalSize,
                totalCount: resources.totalCount,
                byType: resources.byType,
                slowestResources: slowestResources
            },
            networkQuality: {
                http2ResourceCount: resources.networkQuality.http2Count,
                http1ResourceCount: resources.networkQuality.http1Count,
                http1Resources: resources.networkQuality.http1Resources,
                compressedCount: resources.networkQuality.compressedCount,
                uncompressedCount: resources.networkQuality.uncompressedCount,
                uncompressedResources: resources.networkQuality.uncompressedResources,
                avgTtfb,
                highTtfbCount: resources.networkQuality.highTtfbCount,
                highTtfbResources: resources.networkQuality.highTtfbResources,
                cacheHitCount: resources.networkQuality.cacheHitCount,
                cacheMissCount: resources.networkQuality.cacheMissCount,
                cacheHitRate,
            }
        };
    }
    catch (error) {
        throw new McpError(ErrorCode.AnalysisError, '收集性能指标失败', { originalError: error.message });
    }
}
/**
 * 收集Core Web Vitals指标
 */
async function collectWebVitals(page) {
    // 注入web-vitals库
    await page.evaluate(() => {
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js';
            script.onload = resolve;
            document.head.appendChild(script);
        });
    });
    // 收集指标
    const webVitals = await page.evaluate(() => {
        return new Promise((resolve) => {
            const metrics = {
                largestContentfulPaint: 0,
                firstInputDelay: 0,
                cumulativeLayoutShift: 0,
                totalBlockingTime: 0
            };
            // @ts-ignore - 全局web-vitals变量由上面注入的脚本提供
            const { onLCP, onFID, onFCP, onCLS, onINP } = window.webVitals;
            let metricsCollected = 0;
            const totalMetrics = 3; // LCP + CLS + TBT(longtask)
            function checkComplete() {
                metricsCollected++;
                if (metricsCollected >= totalMetrics) {
                    resolve(metrics);
                }
            }
            onLCP(({ value }) => {
                metrics.largestContentfulPaint = value;
                checkComplete();
            });
            // onFID 在 web-vitals v3 中已废弃，优先使用 onINP；两者都尝试
            try {
                if (typeof onINP === 'function') {
                    onINP(({ value }) => {
                        metrics.firstInputDelay = value;
                    });
                }
                else if (typeof onFID === 'function') {
                    onFID(({ value }) => {
                        metrics.firstInputDelay = value;
                    });
                }
            }
            catch (_) { /* 忽略不支持的指标 */ }
            onCLS(({ value }) => {
                metrics.cumulativeLayoutShift = value;
                checkComplete();
            });
            // TBT 通过 PerformanceObserver longtask 计算（非 web-vitals 提供）
            try {
                let tbt = 0;
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        const blockingTime = entry.duration - 50;
                        if (blockingTime > 0)
                            tbt += blockingTime;
                    }
                });
                observer.observe({ type: 'longtask', buffered: true });
                // 等待足够时间后取 TBT 快照
                setTimeout(() => {
                    observer.disconnect();
                    metrics.totalBlockingTime = Math.round(tbt);
                    checkComplete();
                }, 3000);
            }
            catch (_) {
                // 浏览器不支持 longtask，直接完成
                checkComplete();
            }
            // 30秒后无论如何都返回结果
            setTimeout(() => {
                resolve(metrics);
            }, 30000);
        });
    });
    return webVitals;
}
/**
 * 保存页面截图
 */
export async function saveScreenshot(page, sessionId) {
    // 检查screenshots配置
    const screenshotsEnabled = Boolean(config.screenshots && config.screenshots.enabled);
    if (!screenshotsEnabled) {
        return '';
    }
    try {
        // 确保截图目录存在
        await ensureDirectoryExists(config.screenshots.directory);
        // 生成截图文件名
        const filename = `${sessionId}_${Date.now()}.${config.screenshots.format}`;
        const filePath = path.join(config.screenshots.directory, filename);
        // 捕获截图
        await page.screenshot({
            path: filePath,
            fullPage: true,
            type: config.screenshots.format,
        });
        return filePath;
    }
    catch (error) {
        throw new McpError(ErrorCode.ScreenshotError, '截图保存失败', { originalError: error.message });
    }
}
/**
 * 确保目录存在
 */
async function ensureDirectoryExists(directory) {
    try {
        await fsPromises.mkdir(directory, { recursive: true });
    }
    catch (error) {
        throw new McpError(ErrorCode.InternalError, '无法创建目录', { directory, originalError: error.message });
    }
}
/**
 * 清理过期的截图文件
 */
export async function cleanupOldScreenshots() {
    // 检查screenshots配置
    const screenshotsEnabled = Boolean(config.screenshots && config.screenshots.enabled);
    if (!screenshotsEnabled) {
        return;
    }
    try {
        const directory = config.screenshots.directory;
        // 确保目录存在
        try {
            await fsPromises.access(directory);
        }
        catch (error) {
            // 目录不存在，跳过清理
            return;
        }
        // 读取所有文件
        const files = await fsPromises.readdir(directory);
        const now = Date.now();
        for (const file of files) {
            try {
                const filePath = path.join(directory, file);
                const stats = await fsPromises.stat(filePath);
                // 检查文件是否过期
                const fileAge = now - stats.mtimeMs;
                if (fileAge > config.screenshots.maxAge) {
                    await fsPromises.unlink(filePath);
                }
            }
            catch (error) {
                console.error(`清理截图文件失败: ${file}`, error);
            }
        }
    }
    catch (error) {
        console.error('截图清理过程出错:', error);
    }
}
/**
 * 获取截图数据
 */
export async function getScreenshotData(path) {
    // 检查文件是否存在
    if (!fs.existsSync(path)) {
        throw new McpError(ErrorCode.ScreenshotNotFound, '找不到请求的截图', { path });
    }
    try {
        // 读取文件并转换为base64
        const data = await fsPromises.readFile(path);
        return data.toString('base64');
    }
    catch (error) {
        throw new McpError(ErrorCode.ScreenshotError, '无法读取截图数据', { error: error.message });
    }
}
/**
 * 预热浏览器实例
 * 启动一个浏览器实例以确保后续请求能够快速响应
 */
export async function prewarmBrowser() {
    try {
        // 启动浏览器实例
        const browser = await browserPool.getBrowser();
        // 创建一个页面并执行基本操作以确保完全加载
        const page = await browser.newPage();
        await page.goto('about:blank');
        // 执行一些基本脚本以初始化JavaScript引擎
        await page.evaluate(() => {
            // 执行一些简单操作以预热JS引擎
            const now = new Date();
            const timestamp = now.getTime();
            const testArray = Array.from({ length: 1000 }, (_, i) => i);
            testArray.reduce((sum, current) => sum + current, 0);
            return { timestamp };
        });
        // 关闭页面但保留浏览器实例
        await page.close();
        // 释放实例回池，但不关闭它
        await browserPool.releaseBrowser(browser);
        console.log('浏览器实例预热成功');
    }
    catch (error) {
        console.error('浏览器预热失败:', error);
        throw error;
    }
}
// 启动定期截图清理
let screenshotCleanupInterval = null;
// 检查screenshots配置
const screenshotsEnabled = Boolean(config.screenshots && config.screenshots.enabled);
if (screenshotsEnabled && config.screenshots.cleanupInterval > 0) {
    screenshotCleanupInterval = setInterval(cleanupOldScreenshots, config.screenshots.cleanupInterval);
}
// 确保在进程退出时关闭所有浏览器和清理任务
process.on('exit', () => {
    if (screenshotCleanupInterval) {
        clearInterval(screenshotCleanupInterval);
    }
    // closeAllBrowsers() 是异步的，但这里无法等待它完成
    // 尽最大努力尝试关闭
    browserPool.closeAll().catch(console.error);
});
// 处理意外退出
process.on('SIGINT', async () => {
    if (screenshotCleanupInterval) {
        clearInterval(screenshotCleanupInterval);
    }
    try {
        await browserPool.closeAll();
    }
    catch (error) {
        console.error('关闭浏览器时出错:', error);
    }
    process.exit(0);
});
