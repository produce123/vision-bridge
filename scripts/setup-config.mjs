#!/usr/bin/env node
/**
 * 把 vision-bridge 注册进用户全局 MCP 配置（Windows: %USERPROFILE%\.claude.json）。
 * 只修改 mcpServers 字段，其余内容原样保留（合并，不覆盖）。
 *
 * 用法：
 *   ARK_API_KEY=ark-xxxx node scripts/setup-config.mjs
 *   ARK_MODEL_ID=xxx node scripts/setup-config.mjs   # 可选，默认 doubao-seed-2-0-lite-260428
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configPath = path.join(os.homedir(), ".claude.json");
const apiKey = process.env.ARK_API_KEY || "";
const modelId = process.env.ARK_MODEL_ID || "doubao-seed-2-0-lite-260428";

if (!apiKey) {
  console.error("错误：请用 ARK_API_KEY=ark-xxxx node scripts/setup-config.mjs 提供密钥");
  process.exit(1);
}

let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    console.error(`解析 ${configPath} 失败：${e.message}`);
    process.exit(1);
  }
}
if (!config || typeof config !== "object" || Array.isArray(config)) {
  console.error(`${configPath} 顶层不是 JSON 对象，拒绝覆盖。请手动检查该文件。`);
  process.exit(1);
}

config.mcpServers = config.mcpServers || {};
config.mcpServers["vision-bridge"] = {
  command: "npx",
  args: ["-y", "ark-vision-bridge"],
  env: {
    ARK_API_KEY: apiKey,
    ARK_MODEL_ID: modelId,
  },
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

// 只打印 vision-bridge 片段，密钥脱敏
const shown = JSON.parse(JSON.stringify(config.mcpServers["vision-bridge"]));
if (shown.env?.ARK_API_KEY) {
  const k = shown.env.ARK_API_KEY;
  shown.env.ARK_API_KEY = k.slice(0, 8) + "****" + k.slice(-4);
}
console.log(`✅ 已写入全局 MCP 配置: ${configPath}`);
console.log("mcpServers.vision-bridge =");
console.log(JSON.stringify(shown, null, 2));
