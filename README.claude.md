# README.claude.md — Claude Code 自动配置指引

> 本文件是**写给 Claude Code（AI 助手）看的执行指南**，不是给人类读者的营销文档。
> 人类用户请读 [README.md](README.md)。

## 使用场景

用户把本仓库（`vision-bridge`）复制到本机后，对你说（Claude Code）：

> "配置这个 MCP" / "安装视觉桥接" / "按 README.claude.md 自动配置"

此时请按本文档逐步执行，把 `vision-bridge` MCP 注册到本机 Claude Code，使其 5 个视觉工具可用。

---

## 执行目标

- 本项目依赖安装完成（`npm install`）。
- `vision-bridge` 注册为本机可用 MCP：默认**用户级（全局）注册**，任何项目都能用。
- 5 个工具（`analyze_image` / `diagnose_error_screenshot` / `extract_text_from_screenshot` / `ui_to_artifact` / `understand_technical_diagram`）可被 Claude Code 调用。

> **关于三档识别**：5 个工具均支持可选参数 `detail_level`（`economy` / `standard` / `detailed`），控制「省 token ↔ 识别详细度」。不传则按工具自动选择（`ui_to_artifact` / `understand_technical_diagram` 默认 `detailed`，其余默认 `standard`）。图片重要/复杂或用户要求详尽时用 `detailed`；追求速度与省 token 用 `economy`；拿不准可询问用户。详见 [README.md](README.md)「三档识别模式」。

---

## 前置检查（先做，不要跳过）

1. 确认当前目录是 `vision-bridge` 仓库根目录，且存在：
   - `package.json`
   - `src/index.js`（MCP 入口）
   - `.mcp.json`（项目级注册，已内置，可不动）
   - `scripts/verify.mjs`
2. 记录本仓库的**绝对路径**（Windows 用正斜杠，如 `C:/Users/xxx/vision-bridge`）。
3. 检查密钥来源（**重要**）：
   - 若本目录存在 `.env` 且含 `ARK_API_KEY`：可使用它，但**不要完整打印**（只显示前 8 位 + `****` + 后 4 位）。
   - 若没有：**向用户索要**火山方舟 API Key（`ark-` 开头），可引导到 [火山方舟控制台](https://console.volcengine.com/ark) 获取。

---

## 执行步骤

### 第 1 步：安装依赖

```bash
cd "<本仓库绝对路径>"
npm install
```

预期：`node_modules` 生成、无错误。失败（如网络 / Node 版本 < 18）则停在原地，把报错展示给用户，不要继续。

### 第 2 步：准备密钥（不完整打印）

```bash
export ARK_API_KEY="ark-用户的密钥"     # 若已从 .env 取得，改用它
echo "$ARK_API_KEY" | sed -E 's/^(ark-[0-9a-f]{8}).*(.{4})$/\1****\2/'   # 只展示脱敏值
```

> 若用户希望后续手动运行 `npm run verify`，可顺手把密钥写进 `.env`（该文件已被 `.gitignore` 忽略）。

### 第 3 步：注册 MCP（用户级 / 全局）

**首选：`claude mcp add`**（自动合并写入 `%USERPROFILE%\.claude.json` 的 `mcpServers`，不覆盖其它条目）：

```bash
claude mcp add vision-bridge --scope user --env "ARK_API_KEY=$ARK_API_KEY" -- node "<本仓库绝对路径>/src/index.js"
```

> 等价手动写法（若 `claude mcp add` 不可用）——编辑 `%USERPROFILE%\.claude.json`，在 `mcpServers` 里**合并**（保留其它所有条目）：
> ```json
> { "mcpServers": { "vision-bridge": {
>   "command": "node",
>   "args": ["<本仓库绝对路径>/src/index.js"],
>   "env": { "ARK_API_KEY": "<用户的密钥>" }
> } } }
> ```

> 若用户**只想在本项目内使用**：仓库自带 `.mcp.json`，把密钥写进 `.claude/settings.local.json` 的 `env.ARK_API_KEY`（gitignore，不提交）即可，无需改全局配置。
>
> ⚠️ 不要用 `npx -y ark-vision-bridge` 注册：该包不在 npm 公共源，新机器上解析不到。

### 第 4 步：验证

```bash
# A. 冒烟：启动应看到启动日志（stdio 阻塞，timeout 3 秒后自动退出）
timeout 3 node src/index.js 2>&1 | head -5
#    预期：ark-vision-bridge 启动 | 模型=doubao-seed-2-0-lite-260428 ...

# B. 完整 E2E（initialize → tools/list → 用测试图调 OCR；真实调用火山方舟 API，产生少量费用）
npm run verify
```

冒烟失败则停下排查（见排错速查），不要带着坏配置收尾。

### 第 5 步：告知用户

- **重启 Claude Code（或开新会话）** 后 `vision-bridge` 才生效（MCP 在启动时加载）。
- 用 `claude mcp list` 确认状态，应看到 `vision-bridge` 连接正常。
- 用法示例："用 extract_text_from_screenshot 读取 <本地图片路径>"，或直接问"帮我看看这张图：<路径>"。

---

## 约束（必须遵守）

- 全程只操作：本仓库文件、`%USERPROFILE%\.claude.json`（仅合并 `mcpServers`，不删其它字段）、`.claude/settings.local.json`（项目级时）。
- **密钥安全**：`ARK_API_KEY` 只写入 gitignore 文件（`.env`、`.claude/settings.local.json`）或 `~/.claude.json` 的 `env`；**绝不**写进源码、`.mcp.json`、README 或任何会被提交的文件。全程**不完整打印密钥**。
- **不改源码**：`src/` 与 `scripts/` 原样保留。
- 若本机已存在同名 `vision-bridge` 配置，先提示用户确认覆盖，再写入。
- 不要改动本仓库的 `.mcp.json`（它是项目级注册，供本项目内使用）。

---

## 排错速查

| 现象 | 原因 | 处理 |
|------|------|------|
| `npm install` 失败 | 网络 / Node 版本 < 18 | 检查网络、升级 Node ≥ 18，重跑第 1 步 |
| 启动报"缺少环境变量 ARK_API_KEY" | 密钥没传给子进程 | 确认第 3 步 env 含 `ARK_API_KEY`；`claude mcp list` 查状态 |
| 调用返回 404 `InvalidEndpointOrModel.NotFound` | 模型未开通 / 无推理资源 | 到火山方舟控制台开通，或把 `ARK_MODEL_ID` 换成账号内可用的模型 / 推理接入点（`ep-xxx`） |
| 调用超时 / 5xx / 限流 | Ark 侧瞬时故障 | 等待重试耗尽；可调 `ARK_TIMEOUT_MS` / `ARK_MAX_ATTEMPTS` |
| 新会话里没有这 5 个工具 | 未重启 / 配置未生效 | 重启 Claude Code；`claude mcp list` 确认 vision-bridge 连接正常 |
