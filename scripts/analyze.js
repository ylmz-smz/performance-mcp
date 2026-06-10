#!/usr/bin/env node

/**
 * 网页性能分析 CLI
 * 用法: performance-cli <url> [options]
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const PKG_PATH = join(ROOT_DIR, 'package.json');

const USAGE = `
网页性能分析 CLI

用法:
  performance-cli <url> [options]
  performance-cli [options]

参数:
  <url>                     要分析的网页 URL；省略时进入交互输入

选项:
  --timeout <ms>            页面加载超时时间，默认 30000
  --warm-cache              先预热缓存，再进行正式测量
  --no-screenshot           不保存页面截图
  --format <text|json|md>   输出格式，默认 text
  --json                    等同于 --format json
  -o, --output <file>       将报告写入文件
  -h, --help                显示帮助
  -v, --version             显示版本号

示例:
  performance-cli https://example.com
  performance-cli https://example.com --timeout 45000 --warm-cache
  performance-cli https://example.com --json -o report.json
  performance-cli https://example.com --format md -o report.md
`.trim();

function readPackageJson() {
  return JSON.parse(readFileSync(PKG_PATH, 'utf8'));
}

function parseArgs(argv) {
  const options = {
    url: undefined,
    timeout: 30000,
    saveScreenshot: true,
    warmCache: false,
    format: 'text',
    output: undefined,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '--timeout') {
      const value = argv[++i];
      const timeout = Number.parseInt(value, 10);
      if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new Error('--timeout 必须是正整数毫秒值');
      }
      options.timeout = timeout;
    } else if (arg.startsWith('--timeout=')) {
      const timeout = Number.parseInt(arg.slice('--timeout='.length), 10);
      if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new Error('--timeout 必须是正整数毫秒值');
      }
      options.timeout = timeout;
    } else if (arg === '--warm-cache') {
      options.warmCache = true;
    } else if (arg === '--no-screenshot') {
      options.saveScreenshot = false;
    } else if (arg === '--screenshot') {
      options.saveScreenshot = true;
    } else if (arg === '--json') {
      options.format = 'json';
    } else if (arg === '--format') {
      const value = argv[++i];
      options.format = normalizeFormat(value);
    } else if (arg.startsWith('--format=')) {
      options.format = normalizeFormat(arg.slice('--format='.length));
    } else if (arg === '-o' || arg === '--output') {
      options.output = argv[++i];
      if (!options.output) {
        throw new Error(`${arg} 需要提供文件路径`);
      }
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      if (!options.output) {
        throw new Error('--output 需要提供文件路径');
      }
    } else if (arg.startsWith('-')) {
      throw new Error(`未知选项: ${arg}`);
    } else if (!options.url) {
      options.url = arg;
    } else {
      throw new Error(`只能提供一个 URL，收到额外参数: ${arg}`);
    }
  }

  return options;
}

function normalizeFormat(format) {
  if (format === 'markdown') return 'md';
  if (['text', 'json', 'md'].includes(format)) return format;
  throw new Error('--format 只支持 text、json、md');
}

function promptForUrl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question('请输入要分析的URL: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

function formatMs(ms) {
  return `${Math.round(ms)}ms`;
}

function toSerializableResult(result) {
  return {
    sessionId: result.sessionId,
    url: result.url,
    timestamp: result.timestamp,
    metrics: result.metrics,
    issues: result.issues,
    recommendations: result.recommendations,
    screenshot: result.screenshot,
  };
}

function renderText(result) {
  const metrics = result.metrics;
  const nav = metrics.navigationTiming;
  const resources = metrics.resources;
  const network = metrics.networkQuality;
  const cacheMode = result.options?.warmCache ? '热缓存' : '冷缓存';

  const lines = [
    '性能分析结果',
    '',
    `URL: ${result.url}`,
    `分析时间: ${result.timestamp}`,
    `会话ID: ${result.sessionId}`,
    `缓存模式: ${cacheMode}`,
    '',
    '关键性能指标',
    `- 页面加载时间: ${formatMs(nav.loadTime)}`,
    `- DOM内容加载时间: ${formatMs(nav.domContentLoaded)}`,
    `- 首次绘制时间: ${formatMs(nav.firstPaint)}`,
    `- 首次内容绘制: ${formatMs(nav.firstContentfulPaint)}`,
    `- 最大内容绘制: ${formatMs(nav.largestContentfulPaint)}`,
    `- 总阻塞时间: ${formatMs(nav.totalBlockingTime)}`,
    `- 累积布局偏移: ${nav.cumulativeLayoutShift.toFixed(3)}`,
    '',
    '资源统计',
    `- 总资源数: ${resources.totalCount}`,
    `- 总资源大小: ${formatBytes(resources.totalSize)}`,
    '',
    '网络质量',
    `- HTTP/2+资源: ${network.http2ResourceCount}`,
    `- HTTP/1.x资源: ${network.http1ResourceCount}`,
    `- 平均TTFB: ${formatMs(network.avgTtfb)}`,
    `- 缓存命中率: ${(network.cacheHitRate * 100).toFixed(1)}%`,
    `- 未压缩文本资源: ${network.uncompressedCount}`,
    '',
    `发现的问题(${result.issues.length}个)`,
    ...renderIssueLines(result.issues),
    '',
    `优化建议(${result.recommendations.length}个)`,
    ...renderRecommendationLines(result.recommendations),
  ];

  if (result.screenshot) {
    lines.push('', `截图: 已保存为 ${result.screenshot.format}`);
  }

  return lines.join('\n');
}

function renderMarkdown(result) {
  const metrics = result.metrics;
  const nav = metrics.navigationTiming;
  const resources = metrics.resources;
  const network = metrics.networkQuality;
  const cacheMode = result.options?.warmCache ? '热缓存' : '冷缓存';

  return [
    '# 性能分析结果',
    '',
    `- URL: ${result.url}`,
    `- 分析时间: ${result.timestamp}`,
    `- 会话ID: ${result.sessionId}`,
    `- 缓存模式: ${cacheMode}`,
    '',
    '## 关键性能指标',
    '',
    `- 页面加载时间: ${formatMs(nav.loadTime)}`,
    `- DOM内容加载时间: ${formatMs(nav.domContentLoaded)}`,
    `- 首次绘制时间: ${formatMs(nav.firstPaint)}`,
    `- 首次内容绘制: ${formatMs(nav.firstContentfulPaint)}`,
    `- 最大内容绘制: ${formatMs(nav.largestContentfulPaint)}`,
    `- 总阻塞时间: ${formatMs(nav.totalBlockingTime)}`,
    `- 累积布局偏移: ${nav.cumulativeLayoutShift.toFixed(3)}`,
    '',
    '## 资源统计',
    '',
    `- 总资源数: ${resources.totalCount}`,
    `- 总资源大小: ${formatBytes(resources.totalSize)}`,
    '',
    '## 网络质量',
    '',
    `- HTTP/2+资源: ${network.http2ResourceCount}`,
    `- HTTP/1.x资源: ${network.http1ResourceCount}`,
    `- 平均TTFB: ${formatMs(network.avgTtfb)}`,
    `- 缓存命中率: ${(network.cacheHitRate * 100).toFixed(1)}%`,
    `- 未压缩文本资源: ${network.uncompressedCount}`,
    '',
    `## 发现的问题(${result.issues.length}个)`,
    '',
    ...renderIssueLines(result.issues),
    '',
    `## 优化建议(${result.recommendations.length}个)`,
    '',
    ...renderRecommendationLines(result.recommendations),
    result.screenshot ? `\n截图已保存，格式: ${result.screenshot.format}` : '',
  ].join('\n');
}

function renderIssueLines(issues) {
  if (issues.length === 0) {
    return ['- 未发现明显性能问题'];
  }

  return issues.map((issue) => `- [${issue.severity.toUpperCase()}] ${issue.description}`);
}

function renderRecommendationLines(recommendations) {
  if (recommendations.length === 0) {
    return ['- 暂无建议'];
  }

  return recommendations.map((rec) => `- ${rec.title}: ${rec.description} (难度: ${rec.difficulty}, 预期影响: ${rec.expectedImpact})`);
}

function renderResult(result, format) {
  if (format === 'json') {
    return `${JSON.stringify(toSerializableResult(result), null, 2)}\n`;
  }
  if (format === 'md') {
    return `${renderMarkdown(result)}\n`;
  }
  return `${renderText(result)}\n`;
}

async function loadAnalyzer() {
  try {
    const analyzer = await import('../build/analyzer/performanceAnalyzer.js');
    const browser = await import('../build/utils/browser.js');
    return {
      analyzePerformance: analyzer.analyzePerformance,
      closeBrowserResources: browser.closeBrowserResources,
    };
  } catch (error) {
    throw new Error(`无法加载构建产物，请先运行 npm run build。原始错误: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = readPackageJson();

  if (options.help) {
    console.log(USAGE);
    return;
  }

  if (options.version) {
    console.log(pkg.version);
    return;
  }

  const url = options.url || await promptForUrl();
  if (!url) {
    throw new Error('未提供 URL');
  }

  const { analyzePerformance, closeBrowserResources } = await loadAnalyzer();

  try {
    process.stderr.write(`开始分析: ${url}\n`);
    const result = await analyzePerformance(
      url,
      options.saveScreenshot,
      options.timeout,
      options.warmCache,
    );
    result.options = {
      warmCache: options.warmCache,
      saveScreenshot: options.saveScreenshot,
      timeout: options.timeout,
    };

    const output = renderResult(result, options.format);
    if (options.output) {
      await writeFile(options.output, output, 'utf8');
      process.stderr.write(`报告已写入: ${options.output}\n`);
    } else {
      process.stdout.write(output);
    }
  } finally {
    await closeBrowserResources();
  }
}

main().catch((error) => {
  process.stderr.write(`错误: ${error.message || error}\n`);
  process.exit(1);
});
