#!/usr/bin/env node
/**
 * ark-vision-bridge —— 基于火山方舟全新 Responses API 的 MCP 视觉桥接服务。
 *
 * 为无多模态能力的文本型 AI 代理（Claude Code + DeepSeek）提供识图能力。
 * 通过标准 MCP stdio 协议对外暴露 5 个视觉工具。
 *
 * 配置：环境变量 ARK_API_KEY / ARK_MODEL_ID（必填，MCP 配置 env 中提供）。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callVision, ArkError } from "./ark.js";
import { loadImageData } from "./image.js";
import { buildPrompt } from "./prompts.js";

const ARK_API_KEY = process.env.ARK_API_KEY || "";
const ARK_MODEL_ID = process.env.ARK_MODEL_ID || "doubao-seed-2-0-lite-260428";
const ARK_TIMEOUT_MS = Number(process.env.ARK_TIMEOUT_MS || 180000);
const ARK_MAX_ATTEMPTS = Number(process.env.ARK_MAX_ATTEMPTS || 3);

if (!ARK_API_KEY) {
  console.error("[vision-bridge] 错误：缺少环境变量 ARK_API_KEY（请在 MCP 配置的 env 中提供）");
  process.exit(1);
}

const server = new McpServer({ name: "ark-vision-bridge", version: "1.0.0" });
const log = (...a) => console.error("[vision-bridge]", ...a);

/** 读图 → 转 data URI → 调 Ark Responses API → 返回模型文本 */
async function runVision(imagePath, prompt) {
  log(`读取图片: ${imagePath}`);
  const img = await loadImageData(imagePath);
  const dim = img.width && img.height ? `，${img.width}x${img.height}` : "";
  log(
    `图片就绪: ${img.mime} ${(img.size / 1024).toFixed(1)}KB${dim}` +
      (img.compressed ? `（已压缩，原始 ${(img.originalSize / 1024).toFixed(1)}KB）` : ""),
  );

  // 双接口自动降级：Responses 优先（input/input_image），失败自动切 Chat Completions（messages/image_url）
  log(`调用 ${ARK_MODEL_ID}（Responses 优先，失败自动降级 Chat Completions）...`);
  const text = await callVision({
    model: ARK_MODEL_ID,
    apiKey: ARK_API_KEY,
    dataUri: img.dataUri,
    prompt,
    timeoutMs: ARK_TIMEOUT_MS,
    maxAttempts: ARK_MAX_ATTEMPTS,
    log,
  });
  log(`完成（${text.length} 字符）`);
  return text;
}

const ok = (text) => ({ content: [{ type: "text", text }] });

function fail(err) {
  const msg =
    err instanceof ArkError
      ? `视觉 API 错误 [${err.code}]${err.status ? ` HTTP ${err.status}` : ""}` +
        `${err.requestId ? ` (requestId: ${err.requestId})` : ""}: ${err.message}`
      : err.message || String(err);
  log(`工具执行失败: ${msg}`);
  return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
}

const imagePathField = z
  .string()
  .describe("本地图片路径（绝对或相对路径），支持 jpg/png/gif/webp/bmp/tiff/avif");

// ─── 1. 通用图片解析 ─────────────────────────────────────────────
server.tool(
  "analyze_image",
  "通用图片解析：读取本地图片，交给视觉模型生成完整、详尽、可独立引用的视觉描述（适合无法看到图片的文本型 AI 代理）。",
  {
    image_path: imagePathField,
    question: z.string().optional().describe("可选：希望视觉模型重点回答的问题"),
  },
  async (args) => {
    try {
      return ok(await runVision(args.image_path, buildPrompt("analyze_image", args)));
    } catch (e) {
      return fail(e);
    }
  },
);

// ─── 2. 报错截图诊断 ─────────────────────────────────────────────
server.tool(
  "diagnose_error_screenshot",
  "分析程序报错截图：逐字解读报错信息与堆栈，定位故障原因，给出按优先级排列的可执行修复建议。",
  {
    image_path: imagePathField.describe("报错截图的本地路径"),
    context: z.string().optional().describe("可选：补充的项目/代码上下文，帮助定位"),
  },
  async (args) => {
    try {
      return ok(await runVision(args.image_path, buildPrompt("diagnose", args)));
    } catch (e) {
      return fail(e);
    }
  },
);

// ─── 3. OCR 文字提取 ─────────────────────────────────────────────
server.tool(
  "extract_text_from_screenshot",
  "OCR 文字提取：提取图片中全部文字，逐字准确、保持原样与阅读顺序，适合截图/文档/表单等。",
  {
    image_path: imagePathField.describe("截图或文档图片的本地路径"),
  },
  async (args) => {
    try {
      return ok(await runVision(args.image_path, buildPrompt("ocr", args)));
    } catch (e) {
      return fail(e);
    }
  },
);

// ─── 4. UI → 前端代码 ────────────────────────────────────────────
server.tool(
  "ui_to_artifact",
  "识别 UI 界面并输出可直接运行的前端代码：先输出 DesignQA 设计解析，再输出完整 HTML（或 react/vue）代码。",
  {
    image_path: imagePathField.describe("UI 截图/设计的本地路径"),
    framework: z.enum(["html", "react", "vue"]).optional().describe("目标前端框架，默认 html"),
    description: z.string().optional().describe("可选：功能需求说明，帮助还原"),
  },
  async (args) => {
    try {
      return ok(
        await runVision(
          args.image_path,
          buildPrompt("ui", { ...args, framework: args.framework || "html" }),
        ),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

// ─── 5. 技术图表解析 ─────────────────────────────────────────────
server.tool(
  "understand_technical_diagram",
  "解析流程图/架构图/网络拓扑/数据库 ER 图/技术图纸：还原所有节点、文字与连接关系，让读者无需看图即可理解结构。",
  {
    image_path: imagePathField.describe("技术图表的本地路径"),
    diagram_type: z
      .enum(["flowchart", "architecture", "network", "database", "general"])
      .optional()
      .describe("可选：图表类型提示"),
    question: z.string().optional().describe("可选：希望重点回答的问题"),
  },
  async (args) => {
    try {
      return ok(await runVision(args.image_path, buildPrompt("diagram", args)));
    } catch (e) {
      return fail(e);
    }
  },
);

// ─── 启动（stdio 标准 MCP 传输）─────────────────────────────────
const transport = new StdioServerTransport();
log(
  `ark-vision-bridge 启动 | 模型=${ARK_MODEL_ID} | 超时=${ARK_TIMEOUT_MS}ms | 重试=${ARK_MAX_ATTEMPTS}次 | ` +
    `base=${process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"} | ` +
    `双接口：Responses 优先，失败自动降级 Chat Completions`,
);
await server.connect(transport);
