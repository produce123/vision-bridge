/**
 * 三档识别模式配置：省 token（economy）/ 标准（standard）/ 详细（detailed）。
 *
 * 核心原理：视觉模型的 token 消耗与「图像分辨率（像素数）」近似线性，
 * 与文件字节数无关。因此降分辨率是省 token 的最大杠杆。
 *
 * - maxDimension：图像长边上限（px）。超过则 sharp 缩小到该值（不放大）。
 * - jpegQuality：压缩质量（仅对需转 JPEG 的压缩路径生效）。
 *
 * 档位由「工具参数 detail_level」显式指定，否则按工具默认档位自动选择
 * （见 TOOL_DEFAULTS）。调用方（文本型 AI 代理）可在必要时询问用户。
 */

export const TIERS = {
  economy: { label: "省token", maxDimension: 1280, jpegQuality: 70 },
  standard: { label: "标准", maxDimension: 1600, jpegQuality: 82 },
  detailed: { label: "详细", maxDimension: 2048, jpegQuality: 88 },
};

/** 各工具默认档位（key 与 buildPrompt 的 tool key 一致） */
export const TOOL_DEFAULTS = {
  analyze_image: "standard",
  diagnose: "standard",
  ocr: "standard",
  ui: "detailed",
  diagram: "detailed",
};

export const DETAIL_LEVELS = ["economy", "standard", "detailed"];

/** 解析工具档位：显式指定优先，否则按工具默认 */
export function resolveTier(tool, detailLevel) {
  if (detailLevel && TIERS[detailLevel]) return detailLevel;
  return TOOL_DEFAULTS[tool] || "standard";
}
