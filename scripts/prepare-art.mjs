/**
 * 把 assets/art/ 里的原图处理成远足世界用的 WebP：
 *   1. 抠掉绢底：从图片四边泛洪，只抠和外边相连的底色（主体里的白雪不动），
 *      按与底色的色差给透明度，边缘柔和过渡，并去掉边缘残留的底色。
 *   2. 山脚的白雾改成按高度的透明渐变，让山脚融进画面里的地平线雾。
 *   3. 裁掉上下空白，按屏幕实际用到的最大像素缩小，转 WebP。
 * 输出到 src/worlds/hike/art/，并生成 index.ts（图片地址和几何信息）。
 * 原图不动。用法：npm run art
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const SRC = 'assets/art';
const OUT = 'src/worlds/hike/art';

/**
 * fade: 从 fade[0] 到 fade[1]（占原图高度的比例）逐渐变透明，
 *       fade[1] 就是“山脚”，画的时候对准地平线。没有 fade 的（云）按内容四周裁边。
 * width: 输出宽度（像素）。
 * lo、hi: 抠底的色差范围，见下面 LO、HI。云没有墨线，放宽一些，边缘更柔；
 *         羊毛和绢底颜色很近，牛羊收紧一些，免得把毛也抠掉。
 * ground: 岸上的精灵图（树、草、牛羊）。底边裁到落地处，并记下落地点的横向位置。
 * flood: false 时不从四边泛洪，全图按色差抠（树、草：枝叶间围住的底色也要去掉）。
 */
const JOBS = [
  { name: 'range-far', fade: [0.56, 0.7], width: 3072 },
  { name: 'range-mid', fade: [0.58, 0.72], width: 3072 },
  { name: 'range-near', fade: [0.6, 0.74], width: 3072 },
  { name: 'peak-1', fade: [0.66, 0.84], width: 1024 },
  { name: 'cloud-1', width: 1024, lo: 4, hi: 46 },
  { name: 'cloud-2', width: 1024, lo: 4, hi: 46 },
  { name: 'tree-broad-1', width: 512, ground: true, flood: false },
  { name: 'tree-pine-1', width: 512, ground: true, flood: false },
  { name: 'tree-willow-1', width: 512, ground: true, flood: false },
  { name: 'grass-1', width: 192, ground: true, flood: false },
  { name: 'grass-2', width: 192, ground: true, flood: false },
  { name: 'grass-3', width: 192, ground: true, flood: false },
  { name: 'buffalo-1', width: 256, ground: true, lo: 10, hi: 30 },
  { name: 'buffalo-2', width: 256, ground: true, lo: 10, hi: 30 },
  { name: 'sheep-1', width: 192, ground: true, lo: 9, hi: 24 },
];

/** 色差低于 LO 全透明，高于 HI 不透明；泛洪只穿过色差低于 HI 的像素 */
const LO = 10, HI = 38;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

async function prepare({ name, fade, width, ground = false, flood = true, lo = LO, hi = HI }) {
  const { data, info } = await sharp(`${SRC}/${name}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;

  // 底色：每一行取左右两端、每一列取上下两端的中位数（有的图中间有一条底色略深的横带），
  // 每个像素和它所在行、列的底色比，取近的那个
  const median = idx => [0, 1, 2].map(c => idx.map(i => data[i * 3 + c]).sort((a, b) => a - b)[idx.length >> 1]);
  const E = 6;
  let rowBg = Array.from({ length: H }, (_, y) => median([...Array(E).keys()].flatMap(k => [y * W + k, y * W + W - 1 - k])));
  let colBg = Array.from({ length: W }, (_, x) => median([...Array(E).keys()].flatMap(k => [k * W + x, (H - 1 - k) * W + x])));
  if (fade) {
    // 山的下半截两边和底边是白雾，不能当底色（否则雪会被抠掉），只用上边一行
    const top = median([...Array(W).keys()]);
    rowBg = rowBg.map(() => top); colBg = colBg.map(() => top);
  }
  const bg = colBg[W >> 1];

  const dist = new Float32Array(N);
  const bgOf = new Array(N);
  const d2 = (i, b) => {
    const r = data[i * 3] - b[0], g = data[i * 3 + 1] - b[1], bl = data[i * 3 + 2] - b[2];
    return Math.sqrt(r * r + g * g + bl * bl);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = d2(i, rowBg[y]), b = d2(i, colBg[x]);
    dist[i] = Math.min(a, b);
    bgOf[i] = a < b ? rowBg[y] : colBg[x];
  }

  // 从四边泛洪
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = i => { if (!seen[i] && dist[i] < hi) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  // 不泛洪的（树、草）：枝叶间围住的绢底也要抠掉，全图按色差算
  if (!flood) seen.fill(1);
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
        if (a > 0.04 && a < 1) v = (v - bgOf[i][c] * (1 - a)) / a;
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

  // 精灵图的落地处：最低的一行“实”的像素；落地点取这几行实像素的平均横坐标
  let foot = H, ax = 0.5;
  if (ground) {
    const solid = y => { let n = 0; for (let x = 0; x < W; x++) if (out[(y * W + x) * 4 + 3] > 160) n++; return n; };
    foot = H;
    while (foot > 0 && solid(foot - 1) < 3) foot--;
    let sx = 0, n = 0;
    for (let y = Math.max(0, foot - Math.round(H * 0.03)); y < foot; y++) {
      for (let x = 0; x < W; x++) if (out[(y * W + x) * 4 + 3] > 160) { sx += x; n++; }
    }
    ax = n ? sx / n : W / 2;
  }

  // 山：裁掉上方空白（留一点余量）和山脚以下；云：按内容四周裁边；精灵图：底边裁到落地处
  const m = Math.round(H * 0.01);
  const x0 = fade ? 0 : Math.max(0, box[0] - m), x1 = fade ? W : Math.min(W, box[2] + m);
  const y0 = Math.max(0, (fade ? top : box[1]) - m);
  const y1 = fade ? Math.round(fade[1] * H) : ground ? foot : Math.min(H, box[3] + m);
  if (ground) ax = (ax - x0) / (x1 - x0);
  const height = Math.round(((y1 - y0) * width) / (x1 - x0));
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .resize({ width, height })
    .webp({ quality: 82, alphaQuality: 80, effort: 6 })
    .toFile(`${OUT}/${name}.webp`);

  // peak: 最高处离山脚多远（占输出高度的比例）；云没有山脚，记 0
  return { name, width, height, peak: fade ? (y1 - top) / (y1 - y0) : 0, ax, bg };
}

await mkdir(OUT, { recursive: true });
const done = [];
for (const job of JOBS) {
  const r = await prepare(job);
  console.log(r.name, `${r.width}×${r.height}`, 'bg', r.bg.join(','), 'peak', r.peak.toFixed(3), 'ax', r.ax.toFixed(3));
  done.push(r);
}

const id = n => n.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const lines = [
  '// 由 scripts/prepare-art.mjs 生成，不要手改',
  ...done.map(r => `import ${id(r.name)} from './${r.name}.webp';`),
  '',
  '/**',
  ' * w、h：图片像素；peak：最高处到山脚（图片底边）的距离，占图片高度的比例（云和精灵图为 0）；',
  ' * ax：落地点（底边上树干、脚的位置）离左边多远，占图片宽度的比例',
  ' */',
  'export interface ArtInfo { url: string; w: number; h: number; peak: number; ax: number }',
  '',
  'export const ART = {',
  ...done.map(r => `  ${id(r.name)}: { url: ${id(r.name)}, w: ${r.width}, h: ${r.height}, peak: ${r.peak.toFixed(3)}, ax: ${r.ax.toFixed(3)} },`),
  '} satisfies Record<string, ArtInfo>;',
  '',
];
await writeFile(`${OUT}/index.ts`, lines.join('\n'));
