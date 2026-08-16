/**
 * 手动调用某个 MCP 工具并打印模型返回，方便单独验证。
 * 用法：
 *   ARK_API_KEY=ark-xxx node scripts/call-tool.mjs <toolName> <imagePath> [参数JSON]
 * 示例：
 *   node scripts/call-tool.mjs analyze_image D:/a.png
 *   node scripts/call-tool.mjs diagnose_error_screenshot D:/err.png '{"context":"node app.js"}'
 *   node scripts/call-tool.mjs ui_to_artifact D:/ui.png '{"framework":"html"}'
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, "..", "src", "index.js");
const [toolName, imagePath, extraArgsJson] = process.argv.slice(2);

if (!toolName || !imagePath) {
  console.error("用法: node scripts/call-tool.mjs <toolName> <imagePath> [参数JSON]");
  process.exit(1);
}
if (!process.env.ARK_API_KEY) {
  console.error("请先设置 ARK_API_KEY");
  process.exit(1);
}

let extraArgs = {};
if (extraArgsJson) {
  try {
    extraArgs = JSON.parse(extraArgsJson);
  } catch (e) {
    console.error("参数JSON解析失败:", e.message);
    process.exit(1);
  }
}

const child = spawn(process.execPath, [entry], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, ARK_MODEL_ID: process.env.ARK_MODEL_ID || "doubao-seed-2-0-lite-260428" },
});

let seq = 0;
const pending = new Map();
let buf = "";
function send(method, params = {}) {
  const id = ++seq;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  }
});

const TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS || 600000); // 桥接自身有 180s×3 重试，测试等待放宽到 10min
const timer = setTimeout(() => {
  console.error("⏰ 超时");
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);

async function main() {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "call-tool", version: "1.0.0" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const args = { image_path: imagePath, ...extraArgs };
  console.log(`调用工具: ${toolName}\n参数: ${JSON.stringify(args)}\n`);
  const result = await send("tools/call", { name: toolName, arguments: args });
  const text = (result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  console.log(text);
}

main()
  .then(() => {
    clearTimeout(timer);
    child.kill();
  })
  .catch((e) => {
    clearTimeout(timer);
    console.error("❌ 调用失败:", e.message);
    child.kill();
    process.exit(1);
  });
