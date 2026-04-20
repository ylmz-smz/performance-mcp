#!/usr/bin/env node

/**
 * 性能分析MCP服务 CLI 演示工具
 * 用法: node scripts/demo.js [url]
 * 如果不提供URL，脚本会启动服务并等待用户输入
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import readline from 'readline';

// 获取当前脚本的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 项目根目录
const ROOT_DIR = join(__dirname, '..');
const BUILD_DIR = join(ROOT_DIR, 'build');

// 命令行参数
const args = process.argv.slice(2);
const url = args[0];

/**
 * 格式化时间
 */
function formatTime(ms) {
  return `${(ms/1000).toFixed(2)}秒`;
}

/**
 * 创建用户输入接口
 */
function createUserInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 启动性能分析服务...');
  
  // 启动MCP服务
  const mcpProcess = spawn('node', [join(BUILD_DIR, 'index.js')], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: ROOT_DIR,
  });
  
  // 创建读写接口
  const rl = readline.createInterface({
    input: mcpProcess.stdout,
    output: process.stdout,
    terminal: false,
  });
  
  // 捕获输出进行处理
  let responseBuffer = '';
  let collectingResponse = false;
  let sessionId = null;
  let awaitingUrlInput = !url; // 如果没有提供URL，则等待用户输入
  
  rl.on('line', async (line) => {
    try {
      const data = JSON.parse(line);
      
      // 处理MCP消息
      if (data.type === 'ready') {
        console.log('✅ 性能分析服务已就绪');
        
        if (awaitingUrlInput) {
          // 如果没有提供URL，提示用户输入
          const userRl = createUserInterface();
          userRl.question('请输入要分析的URL: ', (inputUrl) => {
            console.log(`🔍 开始分析URL: ${inputUrl}`);
            userRl.close();
            
            // 发送分析请求（改为JSON-RPC 2.0格式）
            const request = {
              jsonrpc: "2.0",
              id: "1",
              method: "tools/call",
              params: {
                name: "analyze-performance",
                arguments: { url: inputUrl, saveScreenshot: true }
              }
            };
            
            mcpProcess.stdin.write(JSON.stringify(request) + '\n');
          });
        } else {
          // 如果提供了URL，直接分析
          console.log(`🔍 开始分析URL: ${url}`);
          
          // 发送分析请求（改为JSON-RPC 2.0格式）
          const request = {
            jsonrpc: "2.0",
            id: "1",
            method: "tools/call",
            params: {
              name: "analyze-performance",
              arguments: { url, saveScreenshot: true }
            }
          };
          
          mcpProcess.stdin.write(JSON.stringify(request) + '\n');
        }
      } else if ((data.jsonrpc === "2.0" && data.id === "1" && data.result) || 
                (data.type === 'response' && data.id === '1')) {
        // 适配两种可能的响应格式
        const content = data.result ? data.result.content : data.content;
        
        // 检查是否有错误
        const isError = data.result ? data.result.isError : data.isError;
        if (isError) {
          const errorText = content && content[0] ? content[0].text : "未知错误";
          console.error('❌ 分析过程中发生错误:', errorText);
          process.exit(1);
        }
        
        // 获取响应文本
        const responseText = content && content[0] ? content[0].text : "";
        
        // 检查是否是等待URL输入的提示
        if (responseText.includes('请提供要分析的网页URL')) {
          console.log('等待URL输入...');
          const userRl = createUserInterface();
          userRl.question('请输入要分析的URL: ', (inputUrl) => {
            console.log(`🔍 开始分析URL: ${inputUrl}`);
            userRl.close();
            
            // 发送分析请求（改为JSON-RPC 2.0格式）
            const request = {
              jsonrpc: "2.0",
              id: "1",
              method: "tools/call",
              params: {
                name: "analyze-performance",
                arguments: { url: inputUrl, saveScreenshot: true }
              }
            };
            
            mcpProcess.stdin.write(JSON.stringify(request) + '\n');
          });
          return;
        }
        
        console.log('✅ 分析完成!');
        
        // 提取会话ID
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
          
          // 使用JSON-RPC 2.0格式
          const detailsRequest = {
            jsonrpc: "2.0",
            id: "2",
            method: "tools/call",
            params: {
              name: "get-analysis-details",
              arguments: { sessionId }
            }
          };
          
          mcpProcess.stdin.write(JSON.stringify(detailsRequest) + '\n');
        }
      }
      else if ((data.jsonrpc === "2.0" && data.id === "2" && data.result) || 
               (data.type === 'response' && data.id === '2')) {
        // 适配两种可能的响应格式
        const content = data.result ? data.result.content : data.content;
        const details = content && content[0] ? content[0].text : "";
        
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
        
        console.log('\n🏁 分析完成! 服务即将关闭...');
        
        // 延迟关闭进程
        setTimeout(() => {
          mcpProcess.kill();
          process.exit(0);
        }, 1000);
      }
    } catch (err) {
      // 非JSON行，忽略
    }
  });
  
  // 处理MCP进程退出
  mcpProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`❌ 性能分析服务异常退出，退出码: ${code}`);
      process.exit(1);
    }
  });
}

// 启动演示
main().catch(err => {
  console.error('演示脚本执行出错:', err);
  process.exit(1);
});