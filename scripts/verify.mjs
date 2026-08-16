/**
 * E2E 验证脚本：以 stdio 启动 MCP 服务，依次做 initialize → tools/list →
 * tools/call（用一个真实测试图走完整视觉链路）。
 *
 * 用法：
 *   ARK_API_KEY=ark-xxxx node scripts/verify.mjs [图片路径]
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const entry = path.join(root, "src", "index.js");
const imagePath = process.argv[2] || path.join(root, "test-error-screenshot.png");

if (!process.env.ARK_API_KEY) {
  console.error("请用 ARK_API_KEY=ark-xxxx node scripts/verify.mjs 提供密钥");
  process.exit(1);
}

const child = spawn(process.execPath, [entry], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    ARK_MODEL_ID: process.env.ARK_MODEL_ID || "doubao-seed-2-0-lite-260428",
  },
});

let seq = 0;
const pending = new Map();
let buf = "";

function send(method, params = {}) {
  const id = ++seq;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  child.stdin.write(msg + "\n");
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
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});

async function main() {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "verify", version: "1.0.0" },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
  );

  const tools = await send("tools/list", {});
  const names = tools.tools.map((t) => t.name);
  console.log("📦 工具列表:", names.join(", "));
  const required = [
    "analyze_image",
    "diagnose_error_screenshot",
    "extract_text_from_screenshot",
    "ui_to_artifact",
    "understand_technical_diagram",
  ];
  const missing = required.filter((n) => !names.includes(n));
  if (missing.length) {
    console.error("❌ 缺少工具:", missing.join(", "));
    process.exit(1);
  }
  console.log("✅ 5 个工具全部就绪");

  console.log(`\n🔎 调用 extract_text_from_screenshot: ${imagePath}`);
  const result = await send("tools/call", {
    name: "extract_text_from_screenshot",
    arguments: { image_path: imagePath },
  });
  const text =
    (result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n") || "";
  console.log("---- 模型返回 ----");
  console.log(text.slice(0, 2000));
  if (result?.isError) {
    console.error("\n❌ 工具返回错误");
    process.exit(1);
  }
  console.log("\n✅ E2E 验证通过（初始化/工具列表/工具调用链路正常）");
}

const timer = setTimeout(() => {
  console.error("⏰ 验证超时（200s）");
  child.kill();
  process.exit(1);
}, 200000);

main()
  .then(() => {
    clearTimeout(timer);
    child.kill();
  })
  .catch((e) => {
    clearTimeout(timer);
    console.error("❌ 验证失败:", e.message);
    child.kill();
    process.exit(1);
  });
