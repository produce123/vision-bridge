/**
 * 本地图片处理管线：读取 → 校验 → 自动压缩 → 标准 data URI Base64。
 *
 * 设计要点：
 *  - 只读取本地磁盘文件，绝不将图片上传到任何第三方图床/外网；
 *  - 图片以 Base64 data URI（data:{mime};base64,{data}）内联进请求体；
 *  - 超过 4MB 或单边超过 2560px 的图片自动用 sharp 压缩（转 JPEG），
 *    兜底保证不超过火山方舟单图 10MB 上限。
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // Ark 单图硬上限 10MB
const COMPRESS_THRESHOLD_BYTES = 4 * 1024 * 1024; // 超过 4MB 触发压缩
const DEFAULT_MAX_DIMENSION = 1600; // 默认长边上限（标准档），可按档位覆盖
const DEFAULT_JPEG_QUALITY = 82;

const EXT_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

/** 根据文件头魔数嗅探真实 MIME（扩展名可造假，魔数为准） */
function sniffMime(buf) {
  const b = buf.subarray(0, 16);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return "image/webp";
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) return "image/tiff";
  if (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) return "image/tiff";
  return null;
}

async function compressImage(buf, maxDimension, quality) {
  let q = quality;
  const pipeline = () =>
    sharp(buf, { failOn: "none" })
      .rotate() // 依据 EXIF 方向自动旋转
      .flatten({ background: "#ffffff" }) // 透明底补白，转 JPEG 不显黑
      .resize(maxDimension, maxDimension, { fit: "inside", withoutEnlargement: true });
  let out = await pipeline().jpeg({ quality: q }).toBuffer();
  // 若仍超 10MB，逐步降质量直到达标
  while (out.length > MAX_IMAGE_BYTES && q > 30) {
    q -= 15;
    out = await pipeline().jpeg({ quality: q }).toBuffer();
  }
  return out;
}

/**
 * 加载本地图片并返回可交给 Responses API 的 data URI。
 * @param {string} imagePath 绝对或相对路径
 * @param {string} [cwd] 相对路径解析基准，默认进程 cwd
 */
export async function loadImageData(
  imagePath,
  cwd = process.cwd(),
  { maxDimension = DEFAULT_MAX_DIMENSION, jpegQuality = DEFAULT_JPEG_QUALITY } = {},
) {
  const abs = path.resolve(cwd, imagePath);
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    throw new Error(`文件不存在或无法访问：${imagePath}（解析路径 ${abs}）`);
  }
  if (!st.isFile()) throw new Error(`目标不是文件：${abs}`);
  if (st.size === 0) throw new Error(`文件为空：${abs}`);

  const ext = path.extname(abs).toLowerCase();
  if (!EXT_MIME[ext]) {
    throw new Error(
      `不支持的图片扩展名 "${ext || "（无）"}"，支持：${Object.keys(EXT_MIME).join(", ")}`,
    );
  }

  const buf = await fs.readFile(abs);
  const mime = sniffMime(buf);
  if (!mime) {
    throw new Error(`无法识别图片内容（文件可能损坏或不是有效图片）：${abs}`);
  }

  // 读取尺寸信息（解码失败不致命，压缩阶段会再尝试）
  let width = null;
  let height = null;
  try {
    const meta = await sharp(buf, { failOn: "none" }).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch {
    /* 忽略 */
  }

  let processed = buf;
  let outMime = mime;
  const originalSize = buf.length;
  const tooBig = buf.length > COMPRESS_THRESHOLD_BYTES;
  const tooWide = width != null && height != null && (width > maxDimension || height > maxDimension);

  if (tooBig || tooWide) {
    try {
      processed = await compressImage(buf, maxDimension, jpegQuality);
      outMime = "image/jpeg";
    } catch (e) {
      if (buf.length > MAX_IMAGE_BYTES) {
        throw new Error(
          `图片过大（${(buf.length / 1048576).toFixed(1)}MB）且压缩失败：${e.message}`,
        );
      }
      // 压缩失败但体积可接受 → 保留原图
    }
  }

  // 压缩后重新读取实际尺寸（供调用方做元信息注入）
  if (processed !== buf) {
    try {
      const meta = await sharp(processed, { failOn: "none" }).metadata();
      width = meta.width ?? width;
      height = meta.height ?? height;
    } catch {
      /* 保留原尺寸 */
    }
  }

  if (processed.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `图片超过单图 10MB 上限（${(processed.length / 1048576).toFixed(1)}MB），请缩小后再试`,
    );
  }

  const dataUri = `data:${outMime};base64,${processed.toString("base64")}`;
  return {
    absPath: abs,
    mime: outMime,
    originalMime: mime,
    originalSize,
    size: processed.length,
    width,
    height,
    compressed: processed !== buf,
    dataUri,
  };
}
