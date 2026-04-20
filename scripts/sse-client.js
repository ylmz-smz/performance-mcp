#!/usr/bin/env node

/**
 * 性能分析MCP服务 SSE模式客户端示例
 * 用法: node scripts/sse-client.js <url> [port]
 */

import fetch from 'node-fetch';
import EventSource from 'eventsource';

// 命令行参数
const args = process.argv.slice(2);
const url = args[0];
const port = args[1] || 3001;
let awaitingUrlInput = !url; // 如果未提供URL，等待用户输入

// SSE连接和消息路径
const SSE_ENDPOINT = `http://localhost:${port}/sse`;
const MESSAGES_ENDPOINT = `http://localhost:${port}/messages`;

if (!url) {
  console.error('请提供要分析的URL');
  console.error('用法: node scripts/sse-client.js <url> [port]');
  process.exit(1);
}

/**
 * 格式化时间
 */
function formatTime(ms) {
  return `${(ms/1000).toFixed(2)}秒`;
}

/**
 * 发送工具请求
 */
async function sendToolRequest(toolName, args, connectionId) {
  try {
    // 构建JSON-RPC 2.0格式请求
    const request = {
      jsonrpc: "2.0",
      id: Date.now().toString(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    };

    console.log(`发送请求到 ${toolName}...`);
    
    // 发送请求
    const response = await fetch(MESSAGES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Connection-ID': connectionId
      },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`请求失败: ${response.status} ${response.statusText}\n${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('发送请求失败:', error);
    throw error;
  }
}

// 连接到SSE服务器
console.log(`尝试连接到SSE服务器: http://localhost:${port}/sse`);
const es = new EventSource(`http://localhost:${port}/sse`);

// 读取用户输入
function promptForUrl() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.question('请输入要分析的URL: ', (inputUrl) => {
    console.log(`开始分析URL: ${inputUrl}`);
    rl.close();
    sendAnalysisRequest(inputUrl);
  });
}

// 发送分析请求
function sendAnalysisRequest(targetUrl) {
  // ... existing code for sending request ...
  // 替换请求中的URL
  request.params.arguments.url = targetUrl;
  
  // ... continue with existing code ...
}

// 处理连接打开事件
es.onopen = function() {
  console.log('已连接到SSE服务器');
  
  // 获取connectionId
  es.addEventListener('connection', function(e) {
    const data = JSON.parse(e.data);
    connectionId = data.connectionId;
    console.log(`已获取连接ID: ${connectionId}`);
    
    if (awaitingUrlInput) {
      // 如果未提供URL，提示用户输入
      promptForUrl();
    } else {
      // 如果提供了URL，直接分析
      console.log(`开始分析URL: ${url}`);
      sendAnalysisRequest(url);
    }
  });
};

/**
 * 主函数
 */
async function main() {
  console.log('🚀 连接性能分析服务(SSE模式)...');

  let connectionId = null;
  let sessionId = null;
  let eventSource = null;

  try {
    // 创建SSE连接
    console.log(`尝试连接到: ${SSE_ENDPOINT}`);
    
    // 添加额外的选项
    const eventSourceOptions = {
      headers: {
        'Accept': 'text/event-stream'
      },
      https: {
        rejectUnauthorized: false
      }
    };
    
    eventSource = new EventSource(SSE_ENDPOINT, eventSourceOptions);
    
    // 添加打开事件处理器
    eventSource.onopen = () => {
      console.log('✅ SSE连接成功打开');
    };
    
    // 处理SSE消息
    eventSource.onmessage = async (event) => {
      console.log('收到原始消息:', event.data);
      
      try {
        const data = JSON.parse(event.data);
        console.log('解析后的消息:', data);
        
        // 处理JSON-RPC 2.0格式消息
        if (data.jsonrpc === '2.0') {
          // 处理连接初始化消息
          if (data.method === 'connection/init' && data.params && data.params.connectionId) {
            connectionId = data.params.connectionId;
            console.log(`✅ SSE连接已建立，连接ID: ${connectionId}`);
            
            // 连接成功后开始分析
            await startAnalysis();
          }
          
          // 处理服务器就绪消息
          else if (data.method === 'server/ready') {
            console.log('✅ 服务器已就绪，版本:', data.params.version);
          }
          
          // 处理心跳消息
          else if (data.method === 'server/heartbeat') {
            console.log('💓 收到心跳消息');
          }
        }
        // 兼容旧格式
        else {
          // 处理连接ID
          if (data.connectionId && !connectionId) {
            connectionId = data.connectionId;
            console.log(`✅ SSE连接已建立，连接ID: ${connectionId}`);
            
            // 连接成功后开始分析
            await startAnalysis();
          }
          
          // 处理心跳消息
          if (data.type === 'heartbeat') {
            console.log('💓 收到心跳消息');
          }
        }
      } catch (err) {
        console.log('收到非JSON消息或解析错误:', err.message, '\n原始消息:', event.data);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('SSE连接错误:', error);
      
      // 连接出错时尝试重新连接
      if (eventSource.readyState === EventSource.CLOSED) {
        console.log('连接已关闭，尝试重新连接...');
        setTimeout(() => {
          eventSource.close();
          main().catch(console.error);
        }, 5000);
      }
    };
    
    // 分析函数
    async function startAnalysis() {
      try {
        console.log(`🔍 开始分析URL: ${url}`);
        
        // 发送分析请求
        const analyzeResponse = await sendToolRequest('analyze-performance', { 
          url, 
          saveScreenshot: true 
        }, connectionId);
        
        console.log('✅ 分析完成!');
        
        if (analyzeResponse.result) {
          const content = analyzeResponse.result.content;
          
          // 检查是否有错误
          if (analyzeResponse.result.isError) {
            const errorText = content && content[0] ? content[0].text : "未知错误";
            console.error('❌ 分析过程中发生错误:', errorText);
            return;
          }
          
          // 检查是否是等待URL输入的提示
          if (content && content[0] && content[0].text && content[0].text.includes('请提供要分析的网页URL')) {
            console.log('等待URL输入...');
            promptForUrl();
            return;
          }
          
          // 提取分析结果
          const responseText = content && content[0] ? content[0].text : "";
          const sessionIdMatch = responseText.match(/会话ID: ([a-zA-Z0-9_-]+)/);
          
          if (sessionIdMatch && sessionIdMatch[1]) {
            sessionId = sessionIdMatch[1];
            
            // 提取关键性能指标并格式化输出
            const loadTimeMatch = responseText.match(/页面加载时间: (\d+)ms/);
            const fpcMatch = responseText.match(/首次绘制时间: (\d+)ms/);
            const fcpMatch = responseText.match(/首次内容绘制: (\d+)ms/);
            const resCountMatch = responseText.match(/总资源数: (\d+)个/);
            const resSizeMatch = responseText.match(/总资源大小: ([\d.]+)MB/);
            
            console.log('\n📊 性能摘要:');
            console.log('--------------------------------------------------');
            if (loadTimeMatch) console.log(`⏱️  页面加载时间: ${formatTime(parseInt(loadTimeMatch[1], 10))}`);
            if (fpcMatch) console.log(`🎨 首次绘制: ${formatTime(parseInt(fpcMatch[1], 10))}`);
            if (fcpMatch) console.log(`🖼️  首次内容绘制: ${formatTime(parseInt(fcpMatch[1], 10))}`);
            if (resCountMatch) console.log(`📦 总资源数: ${resCountMatch[1]}个`);
            if (resSizeMatch) console.log(`💾 总资源大小: ${resSizeMatch[1]}MB`);
            console.log('--------------------------------------------------');
            
            // 提取问题和建议数量
            const issuesMatch = responseText.match(/发现的问题\((\d+)个\)/);
            const recsMatch = responseText.match(/优化建议\((\d+)个\)/);
            
            if (issuesMatch) {
              console.log(`\n🔴 发现了 ${issuesMatch[1]} 个性能问题`);
              
              // 提取问题
              const issuesSection = responseText.split('发现的问题')[1].split('优化建议')[0];
              const issues = issuesSection.match(/- \[[A-Z]+\] .+/g);
              
              if (issues) {
                issues.forEach(issue => {
                  console.log(`  ${issue}`);
                });
              }
            }
            
            if (recsMatch) {
              console.log(`\n💡 ${recsMatch[1]} 个优化建议可供参考`);
            }
            
            // 获取详情
            console.log('\n📝 获取完整分析报告...');
            
            // 获取分析详情
            const detailsResponse = await sendToolRequest('get-analysis-details', { 
              sessionId 
            }, connectionId);
            
            if (detailsResponse.result) {
              const detailsContent = detailsResponse.result.content;
              const details = detailsContent && detailsContent[0] ? detailsContent[0].text : "";
              
              console.log('\n📋 详细分析报告已生成');
              console.log('--------------------------------------------------');
              console.log('报告摘要:');
              
              // 提取慢资源信息
              if (details.includes('加载最慢的资源')) {
                const slowResourcesSection = details.split('加载最慢的资源')[1].split('发现的问题')[0];
                const slowResources = slowResourcesSection.match(/\d+\. \[[^\]]+\].+/g);
                
                if (slowResources && slowResources.length > 0) {
                  console.log('\n⚠️  加载最慢的资源:');
                  slowResources.slice(0, 3).forEach(resource => {
                    console.log(`  ${resource.split('\n')[0]}`);
                  });
                }
              }
              
              console.log('\n🏁 分析完成!');
              console.log('您可以按Ctrl+C关闭连接');
            }
          }
        }
      } catch (error) {
        console.error('分析过程发生错误:', error);
      }
    }
  } catch (err) {
    console.error('启动SSE客户端出错:', err);
    if (eventSource) {
      eventSource.close();
    }
    process.exit(1);
  }
}

// 启动客户端
main().catch(err => {
  console.error('客户端执行出错:', err);
  process.exit(1);
}); 