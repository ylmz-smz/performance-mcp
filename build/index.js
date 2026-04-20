#!/usr/bin/env node
import { createPerformanceServer } from './server/server.js';
// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    let transport = 'stdio';
    let port = 3001; // 设置默认端口为3001
    // 查找传输模式参数
    const transportArg = args.find(arg => arg.startsWith('--transport='));
    if (transportArg) {
        const transportValue = transportArg.split('=')[1].toLowerCase();
        if (transportValue === 'sse') {
            transport = 'sse';
            // 如果是SSE模式，查找端口参数
            const portArg = args.find(arg => arg.startsWith('--port='));
            if (portArg) {
                port = parseInt(portArg.split('=')[1], 10);
            }
        }
    }
    return { transport, port };
}
// 主函数
async function main() {
    try {
        // 解析命令行参数
        const { transport, port } = parseArgs();
        // 创建和配置服务器
        const { server, start } = await createPerformanceServer({
            ssePort: port,
        }, transport);
        // 启动服务器
        try {
            await start();
            if (transport === 'stdio') {
                process.stderr.write('性能分析MCP服务已启动(STDIO模式)\n');
                process.stderr.write('服务已准备就绪，等待用户输入URL...\n');
                process.stderr.write('可以直接调用analyze-performance工具，无需提供URL参数\n');
            }
            else {
                process.stderr.write(`性能分析MCP服务已启动(SSE模式)，监听端口: ${port}\n`);
                process.stderr.write(`可以使用以下地址测试服务器健康状态: http://localhost:${port}/health\n`);
                process.stderr.write('服务已准备就绪，等待用户输入URL...\n');
            }
        }
        catch (error) {
            if (error.code === 'EADDRINUSE' && transport === 'sse') {
                console.error(`错误: 端口 ${port} 已被占用。`);
                console.error('可能是另一个实例正在运行或其他程序正在使用此端口。');
                console.error(`解决方案: 1) 停止使用此端口的程序，或 2) 使用--port参数指定不同端口`);
                console.error(`例如: npm run start:sse -- --port=3002`);
                process.exit(1);
            }
            throw error;
        }
    }
    catch (error) {
        console.error('启动服务器出错:', error);
        process.exit(1);
    }
}
// 设置未捕获异常处理
process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
    process.exit(1);
});
// 启动服务
main().catch(error => {
    console.error('服务启动失败:', error);
    process.exit(1);
});
