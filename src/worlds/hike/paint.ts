/** 远足世界用到的绘图小工具 */
export type RGB = [number, number, number];

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mod = (x: number, m: number) => ((x % m) + m) % m;
export const mixc = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;

export const SANS = '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",system-ui,-apple-system,sans-serif';

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function strokeLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

export function ellipsePath(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
}

/** 日程点的颜料：朱砂、石青、石绿、泥金（与 look.ts 的颜料一致） */
export const PALETTE: RGB[] = [
  [196, 64, 40],   // 朱砂
  [52, 104, 150],  // 石青
  [62, 138, 112],  // 石绿
  [190, 146, 64],  // 泥金
];

export interface OrbGeom { x: number; wy: number; z: number; r: number }

/** 日程点在此刻光线下的用色（由世界按 look 算好） */
export interface OrbPaint {
  fill: RGB;      // 颜料本色（已按光和雾处理）
  pale: RGB;      // 颜料薄处透出的亮色（蛤粉）
  line: RGB;      // 勾边：白天是墨，夜里是淡淡的蛤粉
  lineA: number;
  shadow: RGB;    // 地上的淡影
  seed: number;   // 让每个点的边略有不同
}

/** 略不规整的圆，像毛笔点出来的 */
function dotPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number) {
  const s = (seed % 628) / 100, n = r > 10 ? 28 : 16;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = 1 + 0.012 * Math.sin(3 * t + s) + 0.008 * Math.sin(5 * t + 2.3 * s);
    const px = x + Math.cos(t) * r * k, py = y + Math.sin(t) * r * k;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

/**
 * 画一个日程点：一笔矿物颜料点在路面上方，颜料中间薄、边上积得厚，外面一圈细墨线。
 * 不发光。返回点心的 y。
 */
export function drawOrb(ctx: CanvasRenderingContext2D, o: OrbGeom, p: OrbPaint, a: number): number {
  const r = o.r, cy = o.wy - r * 1.15;
  if (a < 0.01) return cy;
  if (r > 2.5) {
    ctx.fillStyle = rgba(p.shadow, 0.16 * a);
    ellipsePath(ctx, o.x, o.wy + r * 0.1, r * 1.05, r * 0.26); ctx.fill();
  }
  if (r < 2.2) {
    // 太远太小，只剩一点颜色
    ctx.fillStyle = rgba(p.fill, a);
    ctx.beginPath(); ctx.arc(o.x, cy, r, 0, Math.PI * 2); ctx.fill();
    return cy;
  }
  dotPath(ctx, o.x, cy, r, p.seed);
  const g = ctx.createRadialGradient(o.x - r * 0.22, cy - r * 0.28, 0, o.x, cy, r);
  g.addColorStop(0, rgba(mixc(p.fill, p.pale, 0.16), a));
  g.addColorStop(0.65, rgba(p.fill, a));
  g.addColorStop(1, rgba(mixc(p.fill, p.shadow, 0.28), a));
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = rgba(p.line, p.lineA * a);
  ctx.lineWidth = clamp(r * 0.075, 0.7, 1.8);
  ctx.stroke();
  return cy;
}

export interface Ink { ink: RGB; inkSoft: number; halo: string }

export function drawLabel(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  title: string, sub: string, a: number, ink: Ink, align: CanvasTextAlign = 'center',
) {
  if (a < 0.02) return;
  ctx.save();
  ctx.shadowColor = ink.halo; ctx.shadowBlur = 6;
  ctx.textAlign = align; ctx.textBaseline = 'bottom';
  ctx.fillStyle = rgba(ink.ink, a); ctx.font = `600 12px ${SANS}`;
  ctx.fillText(title, x, y - (sub ? 14 : 0));
  if (sub) {
    ctx.font = `500 10.5px ${SANS}`; ctx.fillStyle = rgba(ink.ink, a * ink.inkSoft);
    ctx.fillText(sub, x, y);
  }
  ctx.restore();
}
