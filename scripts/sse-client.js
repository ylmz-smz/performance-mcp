#!/usr/bin/env node

/**
 * 性能分析MCP服务 SSE模式客户端示例
 * 用法: node scripts/sse-client.js <url> [port]
 */

import fetch from 'node-fetch';
import EventSource from 'eventsource';
import readline from 'readline';

const args = process.argv.slice(2);
const initialUrl = args[0];
const port = args[1] || 3001;
const sseEndpoint = `http://localhost:${port}/sse`;
const messagesEndpoint = `http://localhost:${port}/messages`;

function formatTime(ms) {
  return `${(ms / 1000).toFixed(2)}秒`;
}

function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function promptForUrl() {
  const rl = createPrompt();
  return await new Promise((resolve) => {
    rl.question('请输入要分析的URL: ', (inputUrl) => {
      rl.close();
      resolve(inputUrl.trim());
    });
  });
}

async function sendToolRequest(toolName, toolArgs, connectionId) {
  const request = {
    jsonrpc: '2.0',
    id: `${Date.now()}`,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: toolArgs,
    },
  };

  const response = await fetch(messagesEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Connection-ID': connectionId,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`请求失败: ${response.status} ${response.statusText}\n${errorText}`);
  }

  return await response.json();
}

async function printAnalysisSummary(responseText, connectionId) {
  const sessionIdMatch = responseText.match(/会话ID: ([a-zA-Z0-9_-]+)/);
  if (!sessionIdMatch?.[1]) {
    console.log(responseText);
    return;
  }

  const sessionId = sessionIdMatch[1];
  const loadTimeMatch = responseText.match(/页面加载时间: (\d+)ms/);
  const fpMatch = responseText.match(/首次绘制时间: (\d+)ms/);
  const fcpMatch = responseText.match(/首次内容绘制: (\d+)ms/);
  const resCountMatch = responseText.match(/总资源数: (\d+)个/);
  const resSizeMatch = responseText.match(/总资源大小: ([\d.]+)MB/);
  const issuesMatch = responseText.match(/发现的问题\((\d+)个\)/);
  const recsMatch = responseText.match(/优化建议\((\d+)个\)/);

  console.log('\n📊 性能摘要:');
  console.log('--------------------------------------------------');
  if (loadTimeMatch) console.log(`⏱️  页面加载时间: ${formatTime(Number.parseInt(loadTimeMatch[1], 10))}`);
  if (fpMatch) console.log(`🎨 首次绘制: ${formatTime(Number.parseInt(fpMatch[1], 10))}`);
  if (fcpMatch) console.log(`🖼️  首次内容绘制: ${formatTime(Number.parseInt(fcpMatch[1], 10))}`);
  if (resCountMatch) console.log(`📦 总资源数: ${resCountMatch[1]}个`);
  if (resSizeMatch) console.log(`💾 总资源大小: ${resSizeMatch[1]}MB`);
  console.log('--------------------------------------------------');

  if (issuesMatch) {
    console.log(`\n🔴 发现了 ${issuesMatch[1]} 个性能问题`);
  }
  if (recsMatch) {
    console.log(`💡 ${recsMatch[1]} 个优化建议可供参考`);
  }

  const detailsResponse = await sendToolRequest('get-analysis-details', { sessionId }, connectionId);
  if (!detailsResponse.result?.content?.[0]?.text) {
    return;
  }

  const details = detailsResponse.result.content[0].text;
  console.log('\n📋 详细分析报告已生成');
  if (details.includes('加载最慢的资源')) {
    const slowResourcesSection = details.split('加载最慢的资源')[1]?.split('发现的问题')[0] || '';
    const slowResources = slowResourcesSection.match(/\d+\. \[[^\]]+\].+/g);
    if (slowResources?.length) {
      console.log('\n⚠️  加载最慢的资源:');
      slowResources.slice(0, 3).forEach((resource) => {
        console.log(`  ${resource.split('\n')[0]}`);
      });
    }
  }
}

async function runAnalysis(targetUrl, connectionId) {
  console.log(`🔍 开始分析URL: ${targetUrl}`);
  const analyzeResponse = await sendToolRequest(
    'analyze-performance',
    { url: targetUrl, saveScreenshot: true },
    connectionId,
  );

  const result = analyzeResponse.result;
  if (!result?.content?.[0]?.text) {
    throw new Error('服务未返回可读的分析结果');
  }

  if (result.isError) {
    throw new Error(result.content[0].text);
  }

  console.log('✅ 分析完成!');
  await printAnalysisSummary(result.content[0].text, connectionId);
}

async function waitForConnectionId(eventSource) {
  return await new Promise((resolve, reject) => {
    let settled = false;

    function finish(fn, value) {
      if (!settled) {
        settled = true;
        fn(value);
      }
    }

    eventSource.onopen = () => {
      console.log('✅ SSE连接成功打开');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.jsonrpc === '2.0' && data.method === 'connection/init' && data.params?.connectionId) {
          finish(resolve, data.params.connectionId);
        } else if (data?.connectionId) {
          finish(resolve, data.connectionId);
        }
      } catch (_) {
        // 忽略非JSON消息
      }
    };

    eventSource.onerror = (error) => {
      finish(reject, new Error(`SSE连接错误: ${JSON.stringify(error)}`));
    };

    setTimeout(() => {
      finish(reject, new Error('等待SSE连接初始化超时'));
    }, 10000);
  });
}

async function main() {
  console.log(`🚀 连接性能分析服务(SSE模式): ${sseEndpoint}`);
  const eventSource = new EventSource(sseEndpoint, {
    headers: {
      Accept: 'text/event-stream',
    },
    https: {
      rejectUnauthorized: false,
    },
  });

  try {
    const connectionId = await waitForConnectionId(eventSource);
    console.log(`✅ SSE连接已建立，连接ID: ${connectionId}`);

    const targetUrl = initialUrl || await promptForUrl();
    if (!targetUrl) {
      throw new Error('未提供有效的URL');
    }

    await runAnalysis(targetUrl, connectionId);
    console.log('\n🏁 分析完成! SSE连接即将关闭');
  } finally {
    eventSource.close();
  }
}

main().catch((error) => {
  console.error('客户端执行出错:', error.message || error);
  process.exit(1);
});
