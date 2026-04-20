# 网页性能分析MCP服务

这是一个基于MCP（Model Context Protocol）的网页性能分析服务，能够分析网页性能指标并提供优化建议。

## 功能特性

- **网页性能分析**：收集和分析各种性能指标
- **性能问题检测**：识别潜在的性能瓶颈
- **优化建议生成**：提供针对性的优化方案
- **截图功能**：捕获网页状态

## 环境要求

- Node.js (v16+)
- npm 或 yarn
- 支持Playwright的环境

## 安装

```bash
# 安装依赖
npm install

# 构建项目
npm run build
```

## 使用方式

服务支持两种传输模式和两种交互方式：

### 传输模式

#### STDIO模式（默认）

适用于集成到LLM应用中：

```bash
npm start
```

#### SSE模式

适用于Web应用集成，SSE模式提供基于HTTP的实时通信：

```bash
npm run start:sse
```

或指定端口：

```bash
node build/index.js --transport=sse --port=3002
```

### 交互方式

#### 方式一：直接提供URL（传统方式）

```bash
# 使用 analyze.js CLI 分析指定URL
node scripts/analyze.js https://example.com
```

#### 方式二：先启动服务，后输入URL（交互式）

```bash
# 启动服务，不指定URL
node scripts/demo.js
# 然后根据提示输入URL
```

或者直接调用MCP工具：

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "analyze-performance",
    "arguments": {}
  }
}
```

服务会提示您输入URL，然后再次调用工具并提供URL：

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "analyze-performance",
    "arguments": { 
      "url": "https://example.com"
    }
  }
}
```

### 开发模式

使用TypeScript直接运行（无需预编译）：

```bash
# STDIO模式
npm run dev

# SSE模式
npm run dev:sse
```

## 客户端示例

### STDIO模式客户端

```bash
# 分析指定URL
node scripts/analyze.js https://example.com

# 交互式输入URL
node scripts/analyze.js
```

### SSE模式客户端

```bash
# 分析指定URL（默认端口3001）
npm run client:sse https://example.com

# 分析指定URL（自定义端口）
node scripts/sse-client.js https://example.com 3002

# 交互式输入URL
npm run client:sse
```

## SSE模式说明

SSE模式下，服务器和客户端通过Server-Sent Events进行通信：

1. **连接建立**：
   - 客户端连接到`/sse`端点
   - 服务器生成唯一连接ID并返回给客户端

2. **消息传递**：
   - 客户端在请求头中添加`X-Connection-ID`
   - 请求使用JSON-RPC 2.0格式发送到`/messages`端点

3. **连接维护**：
   - 服务器每30秒发送心跳消息
   - 连接默认30分钟超时自动关闭

## 可用工具

MCP服务提供三个主要工具：

1. **analyze-performance**
   - 分析指定URL的性能
   - 参数：
     - `url`: 要分析的网页URL
     - `saveScreenshot`: 是否保存截图（可选，默认true）
     - `timeout`: 页面加载超时时间（可选，默认30000ms）

2. **get-screenshot**
   - 获取指定会话的页面截图
   - 参数：
     - `sessionId`: 分析会话ID

3. **get-analysis-details**
   - 获取详细分析报告
   - 参数：
     - `sessionId`: 分析会话ID

## 项目结构

```
└── src/
    ├── analyzer/         # 性能分析核心逻辑
    ├── server/           # MCP服务器实现
    ├── types/            # 类型定义
    ├── utils/            # 工具函数
    └── index.ts          # 程序入口
```

## 性能指标说明

服务收集和分析的主要性能指标包括：

### 导航时间指标

- **loadTime**: 页面完全加载的时间
- **domContentLoaded**: DOM内容加载完成的时间
- **firstPaint**: 首次绘制时间
- **firstContentfulPaint**: 首次内容绘制时间
- **largestContentfulPaint**: 最大内容绘制时间

### 资源统计指标

- **totalSize**: 所有资源的总大小
- **totalCount**: 资源总数量
- **byType**: 按类型分类的资源统计
- **slowestResources**: 加载最慢的资源列表 