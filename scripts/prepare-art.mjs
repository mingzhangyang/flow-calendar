/**
 * 把 assets/art/ 里的原图处理成河流世界用的 WebP：
 *   1. 抠掉绢底：从图片四边泛洪，只抠和外边相连的底色（主体里的白雪不动），
 *      按与底色的色差给透明度，边缘柔和过渡，并去掉边缘残留的底色。
 *   2. 山脚的白雾改成按高度的透明渐变，让山脚融进画面里的地平线雾。
 *   3. 裁掉上下空白，按屏幕实际用到的最大像素缩小，转 WebP。
 * 输出到 src/worlds/river/art/，并生成 index.ts（图片地址和几何信息）。
 * 原图不动。用法：npm run art
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const SRC = 'assets/art';
const OUT = 'src/worlds/river/art';

/**
 * fade: 从 fade[0] 到 fade[1]（占原图高度的比例）逐渐变透明，
 *       fade[1] 就是“山脚”，画的时候对准地平线。没有 fade 的（云）按内容四周裁边。
 * width: 输出宽度（像素）。
 * lo、hi: 抠底的色差范围，见下面 LO、HI。云没有墨线，放宽一些，边缘更柔。
 */
const JOBS = [
  { name: 'range-far', fade: [0.56, 0.7], width: 3072 },
  { name: 'range-mid', fade: [0.58, 0.72], width: 3072 },
  { name: 'range-near', fade: [0.6, 0.74], width: 3072 },
  { name: 'peak-1', fade: [0.66, 0.84], width: 1024 },
  { name: 'cloud-1', width: 1024, lo: 4, hi: 46 },
  { name: 'cloud-2', width: 1024, lo: 4, hi: 46 },
];

/** 色差低于 LO 全透明，高于 HI 不透明；泛洪只穿过色差低于 HI 的像素 */
const LO = 10, HI = 38;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

async function prepare({ name, fade, width, lo = LO, hi = HI }) {
  const { data, info } = await sharp(`${SRC}/${name}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;

  // 底色：上边一行的中位数
  const ch = [[], [], []];
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) ch[c].push(data[x * 3 + c]);
  const bg = ch.map(v => v.sort((a, b) => a - b)[v.length >> 1]);

  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 3] - bg[0], g = data[i * 3 + 1] - bg[1], b = data[i * 3 + 2] - bg[2];
    dist[i] = Math.sqrt(r * r + g * g + b * b);
  }

  // 从四边泛洪
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = i => { if (!seen[i] && dist[i] < hi) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp], x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < N - W) push(i + W);
  }

  const out = Buffer.alloc(N * 4);
  let top = H;
  const box = [W, H, 0, 0]; // 有内容的范围：左、上、右、下
  for (let y = 0; y < H; y++) {
    const keep = fade ? 1 - smooth(fade[0] * H, fade[1] * H, y) : 1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let a = seen[i] ? smooth(lo, hi, dist[i]) : 1;
      for (let c = 0; c < 3; c++) {
        let v = data[i * 3 + c];
        // 半透明的边缘：去掉混进来的底色，免得在暗天色上留一圈亮边
        if (a > 0.04 && a < 1) v = (v - bg[c] * (1 - a)) / a;
        out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
      a *= keep;
      out[i * 4 + 3] = Math.round(a * 255);
      if (a > 0.5 && y < top) top = y;
      if (a > 0.02) {
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x + 1); box[3] = Math.max(box[3], y + 1);
      }
    }
  }

  // 山：裁掉上方空白（留一点余量）和山脚以下；云：按内容四周裁边
  const m = Math.round(H * 0.01);
  const x0 = fade ? 0 : Math.max(0, box[0] - m), x1 = fade ? W : Math.min(W, box[2] + m);
  const y0 = Math.max(0, (fade ? top : box[1]) - m);
  const y1 = fade ? Math.round(fade[1] * H) : Math.min(H, box[3] + m);
  const height = Math.round(((y1 - y0) * width) / (x1 - x0));
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .resize({ width, height })
    .webp({ quality: 82, alphaQuality: 80, effort: 6 })
    .toFile(`${OUT}/${name}.webp`);

  // peak: 最高处离山脚多远（占输出高度的比例）；云没有山脚，记 0
  return { name, width, height, peak: fade ? (y1 - top) / (y1 - y0) : 0, bg };
}

await mkdir(OUT, { recursive: true });
const done = [];
for (const job of JOBS) {
  const r = await prepare(job);
  console.log(r.name, `${r.width}×${r.height}`, 'bg', r.bg.join(','), 'peak', r.peak.toFixed(3));
  done.push(r);
}

const id = n => n.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const lines = [
  '// 由 scripts/prepare-art.mjs 生成，不要手改',
  ...done.map(r => `import ${id(r.name)} from './${r.name}.webp';`),
  '',
  '/** w、h：图片像素；peak：最高处到山脚（图片底边）的距离，占图片高度的比例（云为 0） */',
  'export interface ArtInfo { url: string; w: number; h: number; peak: number }',
  '',
  'export const ART = {',
  ...done.map(r => `  ${id(r.name)}: { url: ${id(r.name)}, w: ${r.width}, h: ${r.height}, peak: ${r.peak.toFixed(3)} },`),
  '} satisfies Record<string, ArtInfo>;',
  '',
];
await writeFile(`${OUT}/index.ts`, lines.join('\n'));
