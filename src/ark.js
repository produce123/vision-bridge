/**
 * 火山方舟（Volcengine Ark）视觉调用层 —— 自动双接口降级。
 *
 * 统一 base_url（可被环境变量 ARK_BASE_URL 覆盖）：
 *   https://ark.cn-beijing.volces.com/api/v3
 *
 * 调用策略：
 *   1. 优先：client.responses.create()            —— Responses 接口（input / input_image）
 *   2. 降级：client.chat.completions.create()     —— Chat 兼容接口（messages / image_url 对象格式）
 *
 * ❗ 两套接口请求体结构不同，各自独立构造，绝不混用字段。
 * 任意一个接口成功即返回结果；两个都失败则抛出最终错误（带两边的错误详情）。
 */

import OpenAI from "openai";

const ARK_BASE_URL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";

export class ArkError extends Error {
  /**
   * @param {number} status  HTTP 状态码；0 = 网络错误 / 超时 / SDK 错误
   * @param {string} code    Ark 或 SDK 错误码
   * @param {string} message 人类可读错误信息
   * @param {string} requestId 请求 ID（便于向火山引擎工单反馈）
   */
  constructor(status, code, message, requestId = "") {
    super(message);
    this.name = "ArkError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => Math.floor(Math.random() * 300); // 避免多个重试同时打爆服务

/** 归一化 SDK / fetch 抛出的各类错误为 ArkError */
function normalizeError(err) {
  if (err instanceof ArkError) return err;
  const status = typeof err?.status === "number" ? err.status : 0;
  const code =
    err?.error?.code || err?.code || err?.type || (status ? `HTTP${status}` : err?.name || "SDKError");
  const message = err?.error?.message || err?.message || String(err);
  const requestId = err?.error?.request_id || err?.requestId || err?.request_id || "";
  return new ArkError(status, code, message, requestId);
}

/** 是否值得重试：网络/超时(status 0)、408、限流(429)、服务端错误(5xx) */
function isRetryable(e) {
  return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
}

function describeErr(e) {
  if (e instanceof ArkError) {
    return `${e.code}${e.status ? `(HTTP ${e.status})` : ""}${e.requestId ? `#${e.requestId}` : ""}: ${e.message}`;
  }
  return e?.message || String(e);
}

/**
 * 带指数退避重试的调用封装（保持原有重试语义：3 次、1s/2s/4s）。
 * @param {() => Promise<any>} call      返回 SDK 原始响应的调用
 * @param {(res:any)=>string}  extract   从响应提取文本
 */
async function withRetry(call, extract, { maxAttempts, log, label }) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await call();
      return extract(res);
    } catch (err) {
      lastErr = normalizeError(err);
      if (!isRetryable(lastErr)) throw lastErr; // 4xx 业务错误：不重试
      log(
        `[ark] ${label} 第 ${attempt}/${maxAttempts} 次失败（${describeErr(lastErr)}）` +
          (attempt < maxAttempts ? "，退避重试…" : "，放弃"),
      );
      if (attempt < maxAttempts) await delay(Math.min(1000 * 2 ** (attempt - 1), 8000) + jitter());
    }
  }
  throw lastErr;
}

/** 从 Responses 响应对象提取最终文本（output[].message.content[].output_text） */
function extractResponsesText(data) {
  if (Array.isArray(data?.output)) {
    const parts = [];
    for (const item of data.output) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" || c?.type === "text") parts.push(c.text);
        }
      } else if (item?.type === "reasoning" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "summary_text") parts.push(`[思考过程] ${c.text}`);
        }
      }
    }
    if (parts.length) return parts.join("\n");
  }
  if (typeof data?.output_text === "string") return data.output_text;
  if (typeof data?.output === "string") return data.output;
  throw new ArkError(0, "UnexpectedResponse", "无法解析 Responses 响应结构");
}

/** 从 Chat Completions 响应对象提取最终文本（choices[0].message.content） */
function extractChatText(res) {
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const parts = content.filter((c) => c?.type === "text").map((c) => c.text);
    if (parts.length) return parts.join("\n");
  }
  throw new ArkError(0, "EmptyContent", "Chat Completions 返回为空");
}

/** 创建 OpenAI SDK 客户端（重试统一交由本层管理，故 maxRetries=0） */
export function createClient(apiKey, { timeoutMs = 180000 } = {}) {
  return new OpenAI({
    apiKey,
    baseURL: ARK_BASE_URL,
    timeout: timeoutMs,
    maxRetries: 0,
  });
}

/**
 * 核心入口：Responses 优先，失败自动降级 Chat Completions。
 *
 * @param {object} opts
 * @param {string} opts.model     模型 ID
 * @param {string} opts.apiKey    ARK API Key
 * @param {string} opts.dataUri   图片 data URI（data:{mime};base64,...）
 * @param {string} opts.prompt    给视觉模型的提示词
 * @param {number} [opts.timeoutMs=180000]
 * @param {number} [opts.maxAttempts=3]
 * @param {(s:string)=>void} [opts.log]
 * @param {object} [opts.client]  可选注入的 client（测试用）
 * @returns {Promise<string>}
 */
export async function callVision({
  model,
  apiKey,
  dataUri,
  prompt,
  timeoutMs = 180000,
  maxAttempts = 3,
  log = () => {},
  client,
}) {
  if (!apiKey) throw new ArkError(0, "MissingKey", "缺少环境变量 ARK_API_KEY");
  if (!model) throw new ArkError(0, "MissingModel", "缺少环境变量 ARK_MODEL_ID");

  const c = client || createClient(apiKey, { timeoutMs });
  const retryOpts = { maxAttempts, log };

  // ── Responses 请求体（input / input_image）──
  const responsesInput = [
    {
      role: "user",
      content: [
        { type: "input_image", image_url: dataUri },
        { type: "input_text", text: prompt },
      ],
    },
  ];
  // ── Chat Completions 请求体（messages / image_url 对象格式）──
  const chatMessages = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: dataUri } },
        { type: "text", text: prompt },
      ],
    },
  ];

  // 1) 优先 Responses
  let responsesErr = null;
  try {
    log("[ark] 使用 Responses 接口（input/input_image）…");
    return await withRetry(
      () => c.responses.create({ model, input: responsesInput }, { timeout: timeoutMs, maxRetries: 0 }),
      extractResponsesText,
      { ...retryOpts, label: "Responses" },
    );
  } catch (e) {
    responsesErr = normalizeError(e);
    log(`[ark] Responses 失败（${describeErr(responsesErr)}），自动降级到 Chat Completions 重试…`);
  }

  // 2) 降级 Chat Completions
  try {
    log("[ark] 使用 Chat Completions 兼容接口（messages/image_url）…");
    return await withRetry(
      () =>
        c.chat.completions.create(
          { model, messages: chatMessages },
          { timeout: timeoutMs, maxRetries: 0 },
        ),
      extractChatText,
      { ...retryOpts, label: "ChatCompletions" },
    );
  } catch (chatErr) {
    throw new ArkError(
      0,
      "AllInterfacesFailed",
      `两套接口均失败。Responses: ${describeErr(responsesErr)}；Chat Completions: ${describeErr(chatErr)}`,
    );
  }
}

/** 仅走 Responses 接口（供测试/单独使用） */
export async function callResponses({ model, apiKey, dataUri, prompt, timeoutMs = 180000, maxAttempts = 3, log = () => {}, client }) {
  const c = client || createClient(apiKey, { timeoutMs });
  const input = [
    { role: "user", content: [
      { type: "input_image", image_url: dataUri },
      { type: "input_text", text: prompt },
    ]},
  ];
  return withRetry(
    () => c.responses.create({ model, input }, { timeout: timeoutMs, maxRetries: 0 }),
    extractResponsesText,
    { maxAttempts, log, label: "Responses" },
  );
}

/** 仅走 Chat Completions 接口（供测试/单独使用） */
export async function callChatCompletions({ model, apiKey, dataUri, prompt, timeoutMs = 180000, maxAttempts = 3, log = () => {}, client }) {
  const c = client || createClient(apiKey, { timeoutMs });
  const messages = [
    { role: "user", content: [
      { type: "image_url", image_url: { url: dataUri } },
      { type: "text", text: prompt },
    ]},
  ];
  return withRetry(
    () => c.chat.completions.create({ model, messages }, { timeout: timeoutMs, maxRetries: 0 }),
    extractChatText,
    { maxAttempts, log, label: "ChatCompletions" },
  );
}
