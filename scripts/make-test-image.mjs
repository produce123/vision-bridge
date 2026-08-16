/**
 * 生成一张用于联调/验证的「报错截图」测试图片（SVG → PNG）。
 * 用法：node scripts/make-test-image.mjs [输出路径]
 */

import sharp from "sharp";
import path from "node:path";

const out = process.argv[2] || path.join(process.cwd(), "test-error-screenshot.png");

const svg = `<svg width="960" height="640" xmlns="http://www.w3.org/2000/svg">
  <rect width="960" height="640" fill="#1e1e2e"/>
  <rect x="40" y="40" width="880" height="72" rx="10" fill="#313244"/>
  <text x="60" y="88" font-family="Consolas,monospace" font-size="30" font-weight="bold" fill="#f38ba8">ERROR: TypeError: Cannot read properties of undefined (reading 'name')</text>
  <text x="60" y="150" font-family="Consolas,monospace" font-size="22" fill="#a6adc8">    at processData (app.js:42:17)</text>
  <text x="60" y="185" font-family="Consolas,monospace" font-size="22" fill="#a6adc8">    at main (app.js:88:5)</text>
  <text x="60" y="220" font-family="Consolas,monospace" font-size="22" fill="#a6adc8">    at Object.&lt;anonymous&gt; (index.js:110:1)</text>
  <rect x="40" y="260" width="420" height="96" rx="10" fill="#89b4fa"/>
  <text x="60" y="312" font-family="sans-serif" font-size="28" font-weight="bold" fill="#11111b">Hello Vision Bridge 2026</text>
  <text x="60" y="342" font-family="sans-serif" font-size="20" fill="#11111b">Server started on port 4567</text>
  <rect x="500" y="260" width="420" height="96" rx="10" fill="#a6e3a1"/>
  <text x="520" y="312" font-family="sans-serif" font-size="28" font-weight="bold" fill="#11111b">OCR test 12345</text>
  <text x="520" y="342" font-family="sans-serif" font-size="20" fill="#11111b">EXTRA_MODE: enabled</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(path.resolve(out));
console.log(`✅ 测试图片已生成: ${path.resolve(out)}`);
