/// <reference types="node" />
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import crypto from 'crypto';
// MCP消息格式常量和验证函数
const MCP_PROTOCOL_VERSION = '1.0';
const JSONRPC_VERSION = '2.0';
// 验证JSON-RPC请求格式
function validateJsonRpcRequest(request) {
    // 必须是对象
    if (!request || typeof request !== 'object') {
        return {
            valid: false,
            error: { code: -32600, message: '无效请求: 请求必须是一个对象' }
        };
    }
    // 验证必要字段
    if (request.jsonrpc !== JSONRPC_VERSION) {
        return {
            valid: false,
            error: { code: -32600, message: `无效请求: jsonrpc字段必须为"${JSONRPC_VERSION}"` }
        };
    }
    if (typeof request.id === 'undefined' || request.id === null) {
        return {
            valid: false,
            error: { code: -32600, message: '无效请求: id字段是必需的' }
        };
    }
    if (typeof request.method !== 'string' || request.method.trim() === '') {
        return {
            valid: false,
            error: { code: -32600, message: '无效请求: method字段必须是非空字符串' }
        };
    }
    return { valid: true };
}
// 验证方法调用参数
function validateMethodParams(method, params) {
    // 工具调用必须有params对象
    if (method.startsWith('tool/') && (!params || typeof params !== 'object')) {
        return {
            valid: false,
            error: { code: -32602, message: '无效参数: 工具调用必须提供params对象' }
        };
    }
    return { valid: true };
}
// SSEServerTransport 实现MCP服务器传输层
class SSEServerTransport {
    handle;
    res;
    connectionId;
    protocolVersion = MCP_PROTOCOL_VERSION;
    connected = false;
    constructor(res, connectionId) {
        this.res = res;
        this.connectionId = connectionId;
    }
    // 连接到MCP服务器
    async connect(handle) {
        this.handle = handle;
        this.connected = true;
        console.log(`SSE连接建立: ${this.connectionId} (协议版本: ${this.protocolVersion})`);
    }
    // 发送响应到客户端
    async sendResponse(id, result) {
        if (!this.res || this.res.closed) {
            console.error(`无法发送响应: 连接已关闭 (ID: ${this.connectionId})`);
            return;
        }
        // 创建JSON-RPC 2.0格式响应
        const jsonRpcResponse = {
            jsonrpc: JSONRPC_VERSION,
            id: id,
            result: result
        };
        try {
            // 使用SSE格式发送
            this.res.write(`data: ${JSON.stringify(jsonRpcResponse)}\n\n`);
            console.log(`发送响应: ${JSON.stringify(jsonRpcResponse)}`);
        }
        catch (error) {
            console.error(`发送响应失败: ${error}`);
        }
    }
    // 发送错误响应到客户端
    async sendErrorResponse(id, error) {
        if (!this.res || this.res.closed) {
            console.error(`无法发送错误响应: 连接已关闭 (ID: ${this.connectionId})`);
            return;
        }
        // 创建JSON-RPC 2.0格式错误响应
        const jsonRpcError = {
            jsonrpc: JSONRPC_VERSION,
            id: id,
            error: {
                code: error.code || -32000,
                message: error.message || 'Unknown Error',
                data: error.data || null
            }
        };
        try {
            // 使用SSE格式发送
            this.res.write(`data: ${JSON.stringify(jsonRpcError)}\n\n`);
            console.log(`发送错误响应: ${JSON.stringify(jsonRpcError)}`);
        }
        catch (error) {
            console.error(`发送错误响应失败: ${error}`);
        }
    }
    // 关闭连接
    close() {
        try {
            if (this.res && !this.res.closed) {
                // 发送关闭消息
                const closeMessage = {
                    jsonrpc: JSONRPC_VERSION,
                    method: 'server/close',
                    params: {
                        reason: "Server closed connection"
                    }
                };
                this.res.write(`data: ${JSON.stringify(closeMessage)}\n\n`);
                this.res.end();
                console.log(`关闭SSE连接: ${this.connectionId}`);
            }
            this.connected = false;
        }
        catch (error) {
            console.error(`关闭连接异常: ${error}`);
        }
    }
    // 获取连接ID
    getConnectionId() {
        return this.connectionId;
    }
    // 获取处理器，用于访问
    getHandle() {
        return this.handle;
    }
    // 获取连接状态
    isConnected() {
        return this.connected;
    }
    // 处理和验证接收到的请求
    async processRequest(request) {
        if (!this.handle) {
            console.error(`无法处理请求: 连接未初始化 (ID: ${this.connectionId})`);
            return false;
        }
        // 验证请求格式
        const formatValidation = validateJsonRpcRequest(request);
        if (!formatValidation.valid) {
            if (formatValidation.error) {
                await this.sendErrorResponse(request.id || null, formatValidation.error);
            }
            return false;
        }
        // 验证方法参数
        const paramsValidation = validateMethodParams(request.method, request.params);
        if (!paramsValidation.valid) {
            if (paramsValidation.error) {
                await this.sendErrorResponse(request.id, paramsValidation.error);
            }
            return false;
        }
        try {
            // 处理请求
            await this.handle.receiveRequest(request.id, request.method, request.params || {});
            return true;
        }
        catch (error) {
            console.error(`处理请求失败: ${error.message || error}`);
            await this.sendErrorResponse(request.id, {
                code: -32603,
                message: `内部错误: ${error.message || '未知错误'}`,
                data: error.stack
            });
            return false;
        }
    }
    // 添加Transport接口需要的方法
    start() {
        return Promise.resolve();
    }
    send(message) {
        return Promise.resolve();
    }
}
// SSEServer 实现基于Express的SSE服务器
export class SSEServer {
    app;
    connections = {};
    port;
    heartbeatInterval;
    connectionTimeout;
    heartbeatTimer;
    mcpServer; // 添加MCP服务器引用
    server; // 添加HTTP服务器引用
    constructor(config) {
        this.port = config.port || 3001;
        this.heartbeatInterval = config.heartbeatInterval || 30000; // 默认30秒
        this.connectionTimeout = config.connectionTimeout || 300000; // 默认5分钟
        // 创建Express应用
        this.app = express();
        // 添加SSE路由 - 确保在其他中间件之前添加，防止干扰
        this.app.get('/sse', (req, res) => {
            console.log('收到SSE连接请求');
            // 设置必要的响应头
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            // 强制刷新头信息
            res.flushHeaders();
            // 获取传输实例
            const id = this.generateConnectionId();
            const transport = this.getTransport(res, id);
            // 如果MCP服务器已配置，则连接
            if (this.mcpServer) {
                // 发送就绪消息
                res.write(`data: {"jsonrpc":"2.0","method":"server/ready","params":{"version":"1.0.0"}}\n\n`);
                // 连接服务器
                this.mcpServer.connect(transport).catch((error) => {
                    console.error('MCP服务器连接失败:', error);
                });
            }
            // 设置连接关闭处理
            req.on('close', () => {
                console.log(`客户端断开连接: ${id}`);
                this.removeConnection(id);
            });
        });
        // 配置中间件
        this.app.use(cors({
            origin: '*', // 允许所有来源
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'X-Connection-ID']
        }));
        this.app.use(bodyParser.json());
        // 添加健康检查端点
        this.app.get('/health', (req, res) => {
            res.status(200).json({
                status: 'ok',
                connections: Object.keys(this.connections).length,
                uptime: process.uptime()
            });
        });
        // 配置消息路由
        this.app.post('/messages', (req, res) => {
            const connectionId = req.headers['x-connection-id'];
            if (!connectionId) {
                console.error('客户端请求缺少X-Connection-ID头');
                return res.status(400).json({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32001,
                        message: 'Missing Connection ID'
                    }
                });
            }
            // 检查连接是否存在
            const connection = this.connections[connectionId];
            if (!connection) {
                console.error(`未找到连接: ${connectionId}`);
                return res.status(404).json({
                    jsonrpc: '2.0',
                    id: req.body.id || null,
                    error: {
                        code: -32002,
                        message: 'Connection Not Found'
                    }
                });
            }
            // 更新连接最后活动时间
            connection.lastActivity = Date.now();
            // 获取对应的传输实例以处理请求
            try {
                console.log(`处理请求: ${JSON.stringify(req.body)}`);
                // 处理JSON-RPC 2.0请求
                if (req.body.jsonrpc === '2.0' && req.body.method === 'tools/call') {
                    const requestId = req.body.id;
                    const toolName = req.body.params.name;
                    const toolArgs = req.body.params.arguments;
                    this.handleToolCall(connection, requestId, toolName, toolArgs)
                        .catch(error => {
                        console.error('处理工具调用失败:', error);
                        if (connection.transport && connection.transport.getHandle()) {
                            connection.transport.sendErrorResponse(requestId, {
                                code: -32603,
                                message: `内部错误: ${error.message || '未知错误'}`,
                                data: {
                                    stack: error.stack
                                }
                            }).catch(err => {
                                console.error('发送错误响应失败:', err);
                            });
                        }
                    });
                    // 立即返回接收确认
                    return res.status(202).json({
                        jsonrpc: '2.0',
                        id: requestId,
                        result: {
                            status: 'accepted'
                        }
                    });
                }
                // 处理MCP请求，转发到服务器
                if (connection.transport && connection.transport.getHandle()) {
                    const handle = connection.transport.getHandle();
                    if (handle) {
                        handle.receiveRequest(req.body.id, req.body.method, req.body.params).catch((error) => {
                            console.error('处理请求失败:', error);
                        });
                        // 确认接收
                        return res.status(202).json({
                            jsonrpc: '2.0',
                            id: req.body.id,
                            result: {
                                status: 'accepted'
                            }
                        });
                    }
                }
                // 无法处理请求
                console.error('无法处理请求，传输未就绪');
                return res.status(500).json({
                    jsonrpc: '2.0',
                    id: req.body.id || null,
                    error: {
                        code: -32603,
                        message: 'Internal Error: Transport not ready'
                    }
                });
            }
            catch (error) {
                console.error('处理请求异常:', error);
                return res.status(500).json({
                    jsonrpc: '2.0',
                    id: req.body.id || null,
                    error: {
                        code: -32603,
                        message: `Internal Error: ${error.message || 'Unknown error'}`,
                        data: {
                            stack: error.stack
                        }
                    }
                });
            }
        });
    }
    // 处理工具调用
    async handleToolCall(connection, requestId, toolName, toolArgs) {
        // 创建运行工具的请求
        try {
            const transport = connection.transport;
            if (transport) {
                const handle = transport.getHandle();
                if (handle) {
                    await handle.receiveRequest(requestId, toolName, toolArgs);
                }
                else {
                    console.error(`无法处理工具调用: 传输处理程序未初始化`);
                }
            }
            else {
                console.error(`无法处理工具调用: 连接传输未初始化`);
            }
        }
        catch (error) {
            console.error(`执行工具失败: ${error}`);
        }
    }
    // 为连接创建或获取传输实例
    getTransport(res, connectionId) {
        // 确保设置了正确的内容类型 - 但请注意，此时响应头可能已被设置，所以我们只在未设置的情况下添加
        if (!res.headersSent) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            res.flushHeaders();
        }
        // 生成连接ID如果没有提供
        const id = connectionId || this.generateConnectionId();
        // 创建传输实例
        const transport = new SSEServerTransport(res, id);
        // 储存连接信息
        this.connections[id] = {
            res,
            id,
            lastActivity: Date.now(),
            transport: transport
        };
        // 设置连接超时
        this.connections[id].timeoutId = setTimeout(() => {
            this.closeConnection(id, 'Connection timeout');
        }, this.connectionTimeout);
        // 设置终止事件处理
        res.on('close', () => {
            console.log(`客户端断开连接: ${id}`);
            this.removeConnection(id);
        });
        // 发送连接ID到客户端(使用JSON-RPC 2.0格式)
        res.write(`data: {"jsonrpc":"2.0","method":"connection/init","params":{"connectionId":"${id}"}}\n\n`);
        return transport;
    }
    // 生成唯一连接ID
    generateConnectionId() {
        return crypto.randomUUID();
    }
    // 关闭特定连接
    closeConnection(connectionId, reason) {
        const connection = this.connections[connectionId];
        if (connection) {
            try {
                // 发送关闭消息
                if (connection.res && !connection.res.closed) {
                    const closeMessage = {
                        jsonrpc: '2.0',
                        method: 'server/close',
                        params: {
                            reason: reason
                        }
                    };
                    connection.res.write(`data: ${JSON.stringify(closeMessage)}\n\n`);
                    connection.res.end();
                }
            }
            catch (error) {
                console.error(`关闭连接消息发送失败: ${error}`);
            }
            // 清除超时定时器
            if (connection.timeoutId) {
                clearTimeout(connection.timeoutId);
            }
            // 移除连接
            this.removeConnection(connectionId);
        }
    }
    // 移除连接
    removeConnection(connectionId) {
        if (this.connections[connectionId]) {
            const connection = this.connections[connectionId];
            // 清除超时定时器
            if (connection.timeoutId) {
                clearTimeout(connection.timeoutId);
            }
            // 从连接映射中删除
            delete this.connections[connectionId];
            console.log(`移除连接: ${connectionId}, 当前连接数: ${Object.keys(this.connections).length}`);
        }
    }
    // 发送心跳消息
    sendHeartbeats() {
        const now = Date.now();
        let connectionCount = 0;
        for (const id in this.connections) {
            const connection = this.connections[id];
            if (connection.res && !connection.res.closed) {
                // 发送心跳消息(使用JSON-RPC 2.0格式)
                try {
                    const heartbeatMessage = {
                        jsonrpc: '2.0',
                        method: 'server/heartbeat',
                        params: {
                            timestamp: now
                        }
                    };
                    connection.res.write(`data: ${JSON.stringify(heartbeatMessage)}\n\n`);
                    connectionCount++;
                }
                catch (error) {
                    console.error(`发送心跳消息失败: ${error}`);
                    this.removeConnection(id);
                }
            }
            else {
                // 移除已关闭的连接
                this.removeConnection(id);
            }
        }
        if (connectionCount > 0) {
            console.log(`发送心跳消息到 ${connectionCount} 个活跃连接`);
        }
    }
    // 启动服务器
    async start() {
        try {
            // 启动HTTP服务器
            return new Promise((resolve, reject) => {
                this.server = this.app.listen(this.port, () => {
                    console.log(`SSE服务器已启动，监听端口: ${this.port}`);
                    console.log(`SSE端点: http://localhost:${this.port}/sse`);
                    console.log(`消息端点: http://localhost:${this.port}/messages`);
                    // 启动心跳检查
                    this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), this.heartbeatInterval);
                    resolve();
                }).on('error', (err) => {
                    console.error(`启动SSE服务器失败:`, err);
                    if (err.code === 'EADDRINUSE') {
                        console.error(`端口 ${this.port} 已被占用。请尝试使用其他端口或确保没有其他实例正在运行。`);
                    }
                    reject(err);
                });
            });
        }
        catch (error) {
            console.error('启动SSE服务器失败:', error);
            throw error;
        }
    }
    // 关闭服务器
    async stop() {
        try {
            // 清理心跳定时器
            if (this.heartbeatTimer) {
                clearInterval(this.heartbeatTimer);
                this.heartbeatTimer = undefined;
            }
            // 关闭所有连接
            for (const connectionId in this.connections) {
                this.closeConnection(connectionId, "Server shutting down");
            }
            // 关闭HTTP服务器
            if (this.server) {
                return new Promise((resolve, reject) => {
                    this.server.close((err) => {
                        if (err) {
                            console.error('关闭HTTP服务器出错:', err);
                            reject(err);
                        }
                        else {
                            console.log('HTTP服务器已关闭');
                            resolve();
                        }
                    });
                });
            }
            return Promise.resolve();
        }
        catch (error) {
            console.error('停止SSE服务器出错:', error);
            throw error;
        }
    }
    // 设置MCP服务器引用
    setMcpServer(server) {
        this.mcpServer = server;
    }
}
// 创建SSE服务器的工厂函数
export function createSSEServer(config) {
    return new SSEServer(config);
}
