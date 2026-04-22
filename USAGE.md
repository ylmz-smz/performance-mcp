# @ylmz/performance-analyzer-mcp 使用说明

> 版本：1.0.7  
> 一款基于 MCP（Model Context Protocol）协议的网页性能分析工具，支持 CLI 直接调用和 AI 助手集成两种使用方式。

---

## 目录

- [环境要求](#环境要求)
- [安装](#安装)
- [CLI 使用方式](#cli-使用方式)
  - [Mac 使用](#mac---cli)
  - [Windows 使用](#windows---cli)
- [MCP 集成使用方式](#mcp-集成使用方式)
  - [Cursor 集成](#cursor-集成)
  - [Claude Desktop 集成](#claude-desktop-集成)
  - [SSE 模式集成](#sse-模式集成)
- [可用工具列表](#可用工具列表)
- [性能指标说明](#性能指标说明)
- [常见问题](#常见问题)

---

## 环境要求

| 要求 | 说明 |
|------|------|
| Node.js | v16.0.0 及以上 |
| 网络 | 需要能访问目标网页 |
| 磁盘 | 安装时会自动下载 Chromium（约 200MB） |

---

## 安装

### 全局安装（推荐）

```bash
npm install -g @ylmz/performance-analyzer-mcp
```

安装完成后会自动下载 Chromium 浏览器内核，请耐心等待。

### 验证安装

```bash
performance-mcp --version
```

---

## CLI 使用方式

CLI 工具通过 `performance-cli` 命令直接在终端中分析网页性能，无需配置 AI 助手。

---

### Mac - CLI

#### 分析指定网址

```bash
performance-cli https://www.example.com
```

#### 分析并指定超时时间

通过 URL 参数传入（默认 30 秒）：

```bash
performance-cli https://www.example.com
```

#### 交互式输入 URL

直接运行命令，按提示输入要分析的网址：

```bash
performance-cli
```

#### 使用 npx（无需全局安装）

```bash
npx @ylmz/performance-analyzer-mcp https://www.example.com
```

#### 输出示例

```
🚀 启动性能分析服务...
📊 开始分析: https://www.example.com
✅ 分析完成！

📈 性能指标：
  首次内容绘制 (FCP):   1.23 秒
  最大内容绘制 (LCP):   2.45 秒
  页面完全加载:          3.12 秒
  DOM 内容加载:          1.80 秒
  资源总数:             42 个
  资源总大小:           1.2 MB

⚠️  发现的性能问题：
  - 图片未压缩优化（3 个大图片资源）
  - 首字节时间较慢（TTFB > 600ms）

💡 优化建议：
  1. 对图片进行 WebP 格式转换和压缩
  2. 检查服务端响应速度，考虑使用 CDN
```

---

### Windows - CLI

> **注意**：Windows 下工具已内置 UTF-8 编码处理，中文输出显示正常。

#### 打开 PowerShell 或命令提示符（CMD）

**分析指定网址：**

```powershell
performance-cli https://www.example.com
```

**交互式输入 URL：**

```powershell
performance-cli
```

**使用 npx（无需全局安装）：**

```powershell
npx @ylmz/performance-analyzer-mcp https://www.example.com
```

#### Windows 编码问题处理

如果终端出现乱码，请在运行前执行：

```cmd
chcp 65001
```

或使用 **PowerShell**（推荐，默认支持 UTF-8）：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
performance-cli https://www.example.com
```

#### 使用 Windows Terminal（推荐终端）

Windows Terminal 默认支持 UTF-8，是 Windows 上最推荐的使用环境，无需额外配置。

---

## MCP 集成使用方式

MCP 模式将工具集成到 AI 助手中，让 AI（如 Claude、Cursor）能够直接调用性能分析能力。

---

### Cursor 集成

#### STDIO 模式（推荐）

1. 打开 Cursor，进入 **Settings → MCP**

2. 编辑 MCP 配置文件 `~/.cursor/mcp.json`（Mac）或 `%APPDATA%\Cursor\mcp.json`（Windows）

**Mac 配置：**

```json
{
  "mcpServers": {
    "performance-analyzer": {
      "command": "npx",
      "args": ["-y", "@ylmz/performance-analyzer-mcp"]
    }
  }
}
```

**Windows 配置：**

```json
{
  "mcpServers": {
    "performance-analyzer": {
      "command": "npx",
      "args": ["-y", "@ylmz/performance-analyzer-mcp"],
      "env": {
        "LANG": "en_US.UTF-8"
      }
    }
  }
}
```

> **提示**：使用 `npx` 方式无需全局安装，Cursor 会自动拉取最新版本，是最推荐的配置方式。

3. 重启 Cursor，在对话中直接询问：
   > "帮我分析 https://www.example.com 的性能"

---

### Claude Desktop 集成

#### Mac 配置

配置文件路径：`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "performance-analyzer": {
      "command": "npx",
      "args": ["-y", "@ylmz/performance-analyzer-mcp"]
    }
  }
}
```

#### Windows 配置

配置文件路径：`%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "performance-analyzer": {
      "command": "npx",
      "args": ["-y", "@ylmz/performance-analyzer-mcp"],
      "env": {
        "LANG": "en_US.UTF-8"
      }
    }
  }
}
```

> **Windows 路径提示**：`%APPDATA%` 通常是 `C:\Users\你的用户名\AppData\Roaming`

#### 重启后验证

重启 Claude Desktop，在对话框中输入：
> "使用 performance-analyzer 分析 https://www.example.com 的性能表现"

Claude 将自动调用工具并返回分析报告。

---

### SSE 模式集成

SSE 模式适合 Web 应用集成，通过 HTTP 长连接与服务通信。

#### 启动 SSE 服务端

**Mac：**

```bash
# 默认端口 3001
performance-mcp --transport=sse

# 指定端口
performance-mcp --transport=sse --port=3002
```

**Windows（PowerShell）：**

```powershell
# 默认端口 3001
performance-mcp --transport=sse

# 指定端口
performance-mcp --transport=sse --port=3002
```

#### 验证服务是否正常

```bash
curl http://localhost:3001/health
```

#### 在 MCP 客户端中配置 SSE 连接（Mac / Windows 通用）

```json
{
  "mcpServers": {
    "performance-analyzer": {
      "url": "http://localhost:3001/sse"
    }
  }
}
```

> 若使用自定义端口（如 3002），将 URL 中的端口号对应修改即可。

#### 使用 SSE 客户端脚本直接测试

```bash
# Mac
node scripts/sse-client.js https://www.example.com

# Windows（PowerShell）
node scripts/sse-client.js https://www.example.com

# 自定义端口
node scripts/sse-client.js https://www.example.com 3002
```

---

## 可用工具列表

集成到 AI 助手后，以下三个工具可供调用：

### 1. `analyze-performance` — 分析网页性能

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | 是 | — | 要分析的网页完整 URL |
| `saveScreenshot` | boolean | 否 | `true` | 是否保存页面截图 |
| `timeout` | number | 否 | `30000` | 页面加载超时时间（毫秒） |

**AI 调用示例提示词：**
> "分析 https://www.example.com 的性能，不需要保存截图，超时设置为 60 秒"

---

### 2. `get-screenshot` — 获取分析截图

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 由 `analyze-performance` 返回的会话 ID |

**AI 调用示例提示词：**
> "获取刚才分析会话的截图"

---

### 3. `get-analysis-details` — 获取详细分析报告

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 由 `analyze-performance` 返回的会话 ID |

**AI 调用示例提示词：**
> "给我刚才那次分析的完整详细报告"

---

## 性能指标说明

### 导航时间指标

| 指标 | 说明 | 参考标准 |
|------|------|----------|
| `loadTime` | 页面完全加载时间 | < 3s 良好 |
| `domContentLoaded` | DOM 内容加载完成时间 | < 2s 良好 |
| `firstPaint` | 首次绘制时间 | < 1s 良好 |
| `firstContentfulPaint` (FCP) | 首次内容绘制时间 | < 1.8s 良好 |
| `largestContentfulPaint` (LCP) | 最大内容绘制时间 | < 2.5s 良好 |

### 资源统计指标

| 指标 | 说明 |
|------|------|
| `totalSize` | 所有资源总大小 |
| `totalCount` | 资源总数量 |
| `byType` | 按类型分类统计（JS/CSS/图片等） |
| `slowestResources` | 加载最慢的资源列表 |

---

## 常见问题

### Q1：安装后提示找不到 `performance-mcp` 命令

**Mac：**

检查 npm 全局 bin 目录是否在 PATH 中：

```bash
npm config get prefix
# 将输出目录的 bin 子目录加入 ~/.zshrc 或 ~/.bashrc
export PATH="$(npm config get prefix)/bin:$PATH"
```

**Windows：**

以管理员身份运行 PowerShell，重新全局安装：

```powershell
npm install -g @ylmz/performance-analyzer-mcp
```

或检查 npm 全局路径：

```powershell
npm config get prefix
# 确认该路径已在系统环境变量 Path 中
```

---

### Q2：Chromium 下载失败

工具依赖 Playwright 内置 Chromium，若自动下载失败：

**Mac：**

```bash
npx playwright-core install chromium
```

**Windows（PowerShell 管理员）：**

```powershell
npx playwright-core install chromium
```

如遇网络问题，可配置镜像源：

```bash
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright npx playwright-core install chromium
```

---

### Q3：Windows 终端出现乱码

在 CMD 中运行前执行：

```cmd
chcp 65001
```

或改用 **Windows Terminal** / **PowerShell**，它们对 UTF-8 支持更好。

---

### Q4：SSE 服务端口被占用

指定其他端口启动：

```bash
performance-mcp --transport=sse --port=3002
```

同时修改客户端配置中的端口号。

---

### Q5：分析超时或页面加载失败

增大超时时间（单位：毫秒）：

在 AI 对话中指定：
> "分析 https://www.example.com，超时设置为 60000 毫秒"

---

## 快速参考卡

```
# 全局安装
npm install -g @ylmz/performance-analyzer-mcp

# CLI 直接分析
performance-cli https://www.example.com

# MCP STDIO 服务（供 AI 助手调用）
performance-mcp

# MCP SSE 服务（供 Web 应用集成）
performance-mcp --transport=sse --port=3001

# 健康检查（SSE 模式）
curl http://localhost:3001/health
```
