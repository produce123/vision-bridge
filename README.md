# 👁️ vision-bridge

> **MCP 视觉桥接服务** —— 为**无多模态能力的文本型 AI 编码代理**（如 Claude Code + DeepSeek）提供识图能力。

![Type](https://img.shields.io/badge/type-MCP服务-lightgrey)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## 📌 这个 MCP 解决什么问题

Claude Code / DeepSeek 这类**文本型代理看不到图片**。`vision-bridge` 给它们接上"看图的眼"：

- 基于**火山方舟统一 base_url**，**Responses 接口优先，失败自动降级 Chat Completions 兼容接口**（双接口自动降级，任一成功即返回）
- 调用豆包视觉模型：`doubao-seed-2-0-lite-260428`
- 图片**只读本地磁盘**，以 `data:{mime};base64` 内联进请求体，**不上传任何第三方图床/外网**

## ✨ 暴露的 5 个 MCP 工具

| 工具 | 能力 |
|---|---|
| `analyze_image` | 通用图片解析：生成详尽、可独立引用的视觉描述 |
| `diagnose_error_screenshot` | 报错截图诊断：解读报错/堆栈，定位故障，给修复建议 |
| `extract_text_from_screenshot` | OCR：提取图片全部文字，保持原样与阅读顺序 |
| `ui_to_artifact` | 识别 UI 界面，输出 DesignQA + 可运行前端代码（html/react/vue） |
| `understand_technical_diagram` | 解析流程图/架构图/网络拓扑/ER 图/技术图纸 |

---

## 📦 安装

### 方式 A：复制本项目 + 让 Claude Code 自动配置（推荐，零手动）

把本仓库**整个文件夹**复制到新机器，进入该目录启动 Claude Code，对它说：

> **"按 README.claude.md 自动配置这个 MCP"**

Claude Code 会自己完成：校验 → 装依赖 → 取密钥 → 注册 MCP → 验证。详见 [README.claude.md](README.claude.md)。

### 方式 B：手动注册全局 MCP

```bash
# 1. 装依赖（Node ≥ 18）
cd <本项目路径>
npm install

# 2. 提供密钥并注册到全局配置（合并写入 %USERPROFILE%\.claude.json，密钥写入 env）
set ARK_API_KEY=ark-你的密钥 && npm run setup-config
```

> ⚠️ `setup-config` 注册的是 `npx -y ark-vision-bridge` 形式；新机器上 npx 解析不到本包时，改用下面的稳定写法（直接注册绝对路径）—— 编辑 `%USERPROFILE%\.claude.json` 的 `mcpServers`，合并（保留其它条目）：
>
> ```json
> { "command": "node", "args": ["<本项目绝对路径>/src/index.js"],
>   "env": { "ARK_API_KEY": "ark-你的密钥" } }
> ```

### 方式 C：项目级 MCP（本项目已内置）

项目根目录自带 `.mcp.json`，**在本项目内**启动 Claude Code 即自动以项目级接入（密钥通过 `${ARK_API_KEY}` 展开，实体放 `.claude/settings.local.json`，两者均不提交）。

---

## 🔧 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `ARK_API_KEY` | 火山方舟 API Key（**必填**） | 无 |
| `ARK_MODEL_ID` | 视觉模型 ID | `doubao-seed-2-0-lite-260428` |
| `ARK_BASE_URL` | 火山方舟统一 base | `https://ark.cn-beijing.volces.com/api/v3` |
| `ARK_TIMEOUT_MS` | 单次请求超时 | `180000` |
| `ARK_MAX_ATTEMPTS` | 最大尝试次数 | `3` |

---

## ✅ 验证

```bash
# A. 冒烟：命令行直接启动（stdio 阻塞，看到启动日志即正常）
set ARK_API_KEY=ark-你的密钥 && node src/index.js
#    预期：ark-vision-bridge 启动 | 模型=doubao-seed-2-0-lite-260428 ...

# B. 完整 E2E（initialize → tools/list → 用测试图调 OCR；真实调用 API，产生少量费用）
set ARK_API_KEY=ark-你的密钥 && npm run verify
```

---

## 🏗️ 项目结构

```
vision-bridge/
├─ .mcp.json              ← 项目级 MCP 注册（${VAR} 展开，不含密钥）
├─ .claude/
│  ├─ CLAUDE.md           ← 项目提示词（开发约定）
│  └─ settings.local.json ← 密钥 env（gitignore，不提交）
├─ src/
│  ├─ index.js            ← MCP 服务入口（stdio 传输，5 个工具）
│  ├─ ark.js              ← Ark Responses API 客户端（超时 + 限流/5xx 指数退避重试）
│  ├─ image.js            ← 本地图片读取/魔数校验/自动压缩/data URI Base64
│  └─ prompts.js          ← 5 个工具的提示词模板
├─ scripts/
│  ├─ make-test-image.mjs ← 生成联调测试图
│  ├─ setup-config.mjs    ← 注册全局 MCP 配置（合并写入，密钥脱敏打印）
│  ├─ verify.mjs          ← E2E 验证（initialize → tools/list → tools/call）
│  └─ call-tool.mjs
├─ README.md              ← 用户手册（本文件）
├─ README.claude.md       ← Claude Code 自动配置指引
└─ package.json
```

---

## 🔬 双接口自动降级（技术细节）

调用顺序（`src/ark.js` 的 `callVision`）：

1. **Responses**（`client.responses.create`）：`{ model, input: [{ role:"user", content:[ {type:"input_image", image_url: dataUri}, {type:"input_text", text} ] }] }`
2. 若超时 / 网络异常 / 4xx / 5xx / 限流，**自动降级**到 **Chat Completions**（`client.chat.completions.create`）：`{ model, messages: [{ role:"user", content:[ {type:"image_url", image_url:{url: dataUri}}, {type:"text", text} ] }] }`

两套请求体结构不同、独立构造、**不混用字段**；任一接口成功即返回；两套都失败抛 `AllInterfacesFailed`（附两边错误码/HTTP 状态/requestId）。429/408/5xx、网络/超时按指数退避（1s/2s/4s）重试 `ARK_MAX_ATTEMPTS` 次。

## 🖼️ 图片处理

- 支持格式：jpg/jpeg/png/gif/webp/bmp/tiff/avif（以文件头魔数校验为准）
- 超 **4MB** 或单边超 **2560px** 自动用 sharp 转 JPEG（`rotate` 修 EXIF、透明底补白、质量 82），保证不超单图 **10MB** 上限
- 文件不存在 / 非图片 / 超限、API 超时、限流(429)、服务端错误(5xx) 均被捕获；429/408/5xx 自动指数退避重试，重试耗尽后把 Ark 错误码 + requestId 透出给代理

## 📊 实测记录（2026-08-16）

- **已通过完整 E2E**：`initialize → tools/list → tools/call` 全链路验证成功；`extract_text_from_screenshot` 正确 OCR 本地测试图，`diagnose_error_screenshot` / `analyze_image` 均给出专业结果。
- Ark 服务端偶发 `InternalServiceError(500)` 属**瞬时故障**（当时纯文本请求也 500），一段时间后自动恢复，无需改代码；桥接的超时重试与错误透出已覆盖此类情况。
- 单次视觉推理可能数秒到数分钟（取决于 Ark 侧负载），可调 `ARK_TIMEOUT_MS`（默认 180000）与 `ARK_MAX_ATTEMPTS`（默认 3）。

---

## 🙏 上游致敬（尊重劳动成果）

本项目为**能力对标实现，不是 fork / 复制**：

- **上游开源项目**：[mcp-vision-bridge](https://github.com/KuaaMU/mcp-vision-bridge)（GitHub，作者 KuaaMU）
- 本项目**5 个视觉工具与能力设计参照上游**，但实现**完全自研**：换用火山方舟豆包模型、Responses + Chat Completions 双接口自动降级、sharp 本地压缩等均为本项目独有实现，包名亦改名 `ark-vision-bridge`。
- 本项目对外发布或用于商业场景时，**必须保留本致谢与参考链接**。

## 📄 许可证

MIT

## 🔗 参考

- [火山方舟 Responses API 文档](https://docs.volcengine.com/docs/82379/1783719)
- [mcp-vision-bridge 开源项目](https://github.com/KuaaMU/mcp-vision-bridge)
