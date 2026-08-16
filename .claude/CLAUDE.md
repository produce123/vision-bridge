# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

**vision-bridge**（包名 `ark-vision-bridge`）—— MCP 视觉桥接服务：为**无多模态能力的文本型 AI 编码代理**（如 Claude Code + DeepSeek）提供识图能力。

- 基于**火山方舟统一 base_url**，**Responses 接口优先，失败自动降级 Chat Completions 兼容接口**（双接口自动降级，任一成功即返回）
- 调用豆包视觉模型：`doubao-seed-2-0-lite-260428`
- 图片**只读本地磁盘**，以 `data:{mime};base64` 内联进请求体，**不上传第三方图床/外网**
- 本目录是从 `C:\Users\produce\mcp-vision-bridge` **打包进工作台的副本**。全局 MCP 配置（`~/.claude.json`）里的 `vision-bridge` 条目通过 npx 解析本包；项目级注册见 `.mcp.json`。
- 对标开源项目 [mcp-vision-bridge](https://github.com/KuaaMU/mcp-vision-bridge) 的能力设计。

## 若被复制到新机器（自动配置入口）

本仓库被用户复制到新机器打开、且用户要求"配置/安装这个 MCP"时：**按 `README.claude.md` 执行自动配置**（校验 → 装依赖 → 取密钥 → 注册 MCP → 验证）。人类用户读 `README.md`。

## 暴露的 5 个 MCP 工具

| 工具 | 能力 |
|---|---|
| `analyze_image` | 通用图片解析：生成详尽、可独立引用的视觉描述 |
| `diagnose_error_screenshot` | 报错截图诊断：解读报错/堆栈，定位故障，给修复建议 |
| `extract_text_from_screenshot` | OCR：提取图片全部文字，保持原样与阅读顺序 |
| `ui_to_artifact` | 识别 UI 界面，输出 DesignQA + 可运行前端代码（html/react/vue） |
| `understand_technical_diagram` | 解析流程图/架构图/网络拓扑/ER 图/技术图纸 |

## 常用命令

```bash
# 安装依赖（Node ≥ 18）
npm install

# 直接启动（stdio，阻塞等待 MCP 握手；看到启动日志即正常）
node src/index.js

# 生成联调测试图
npm run make-test-image

# 完整 E2E 验证（initialize → tools/list → 用测试图调 OCR）
npm run verify

# 注册到用户全局 MCP 配置（%USERPROFILE%\.claude.json，合并写入；需先提供 ARK_API_KEY）
set ARK_API_KEY=ark-xxxx && npm run setup-config
```

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `ARK_API_KEY` | 火山方舟 API Key（**必填**，存 `.env`） | 无 |
| `ARK_MODEL_ID` | 视觉模型 ID | `doubao-seed-2-0-lite-260428` |
| `ARK_BASE_URL` | 火山方舟统一 base | `https://ark.cn-beijing.volces.com/api/v3` |
| `ARK_TIMEOUT_MS` | 单次请求超时 | `180000` |
| `ARK_MAX_ATTEMPTS` | 最大尝试次数 | `3` |

## 架构说明

- **入口** `src/index.js`：MCP stdio 服务，注册 5 个工具；启动时校验 `ARK_API_KEY`，缺失即退出（exit 1）。
- **`src/ark.js`**：`callVision` —— Responses 优先，超时/网络/4xx/5xx/限流自动降级 Chat Completions；429/408/5xx 按指数退避（1s/2s/4s）重试 `ARK_MAX_ATTEMPTS` 次；两套接口都失败抛 `AllInterfacesFailed`（透出两侧错误码/HTTP 状态/requestId）。两套请求体独立构造，不混用字段。
- **`src/image.js`**：本地图片读取、文件头魔数校验、超 4MB 或单边超 2560px 自动用 sharp 转 JPEG（`rotate` 修 EXIF、透明底补白、质量 82），保证不超单图 10MB。
- **`src/prompts.js`**：5 个工具的提示词模板。
- **`scripts/`**：`make-test-image.mjs`（生成测试图）、`setup-config.mjs`（注册全局 MCP，密钥脱敏打印）、`verify.mjs`（E2E 验证）、`call-tool.mjs`。

## 上游致敬（本项目的设计来源，必须保留）

本项目为**能力对标实现，不是 fork / 复制**，功能设计源自以下开源项目，特此致谢：

- **上游开源项目**：[mcp-vision-bridge](https://github.com/KuaaMU/mcp-vision-bridge)（GitHub，作者 KuaaMU）
- 本项目的**5 个视觉工具与能力设计**参照上游，但**实现完全自研**：换用火山方舟豆包视觉模型（`doubao-seed-2-0-lite`）、Responses 优先 + Chat Completions 自动降级、本地图片压缩（sharp）、超时与指数退避重试等均为本项目独有实现，包名亦改名 `ark-vision-bridge`。
- **尊重劳动成果**：本项目若对外发布或用于商业场景，必须保留上述出处声明与 README 中的参考链接。

## 密钥链路（重要）

- **项目级 MCP 注册**（`.mcp.json`，启动时被读取）：`env` 里用 `${ARK_API_KEY}` / `${ARK_MODEL_ID:-...}` **展开引用**（Claude Code 1.0.48+ 项目级专属能力），文件本身不含密钥。
- **密钥实体**存在两处，均被 gitignore、不提交：
  - `.claude/settings.local.json` → `env.ARK_API_KEY`：供 Claude Code 启动时展开 `${ARK_API_KEY}`（文档支持的来源之一）。**改它后需重启 Claude Code（或新会话）才生效。**
  - `.env` → 供**手动/脚本运行**（`source .env && node src/index.js`、`npm run verify`）使用。
- **已知坑**：`${VAR}` 展开只读「claude 启动时进程环境 / settings env」，**不会自动读项目 `.env`**。若变量缺失，`.mcp.json` 会把字面 `${ARK_API_KEY}` 原样传给子进程，MCP 启动即报"缺少 ARK_API_KEY"。排查连接失败时先用 `claude mcp list` 看状态。

## 注意（必须遵守）

- **密钥安全**：`ARK_API_KEY` 只在 `.claude/settings.local.json` 和 `.env`（均 gitignore），**绝不写入 `.mcp.json` / 源码 / 任何被提交的文件**。若本项目日后 `git init`，提交前确认这两处未被纳入。
- 若 Ark 返回 404 `InvalidEndpointOrModel.NotFound`：到 [火山方舟控制台](https://console.volcengine.com/ark) 确认模型已开通服务/有推理资源，或换 `ARK_MODEL_ID`。
- 单次视觉推理可能数秒到数分钟（取决于 Ark 侧负载），可调 `ARK_TIMEOUT_MS` / `ARK_MAX_ATTEMPTS`。
- 改了源码后如需全局生效，重跑 `setup-config` 或把全局 MCP 配置指向 `node <本项目路径>\src\index.js`，然后重启 Claude Code。
