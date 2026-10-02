/** 河流世界用到的绘图小工具 */
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

/** 光球的颜色：取自青绿山水的矿物颜料 */
export const PALETTE: RGB[] = [
  [214, 84, 56],   // 朱砂
  [66, 128, 186],  // 石青
  [58, 156, 122],  // 石绿
  [216, 166, 70],  // 泥金
];

export interface OrbGeom { x: number; wy: number; z: number; r: number }

/** 画一颗浮在水面上的光球，返回球心的 y */
export function drawOrb(
  ctx: CanvasRenderingContext2D, o: OrbGeom, col: RGB, a: number,
  opt: { night?: number; glow?: number; rim?: number } = {},
): number {
  const r = o.r, cy = o.wy - r * 1.15, nt = opt.night ?? 0;
  if (a < 0.01) return cy;
  if (r > 3) { ctx.fillStyle = rgba(col, 0.22 * a); ellipsePath(ctx, o.x, o.wy + r * 0.15, r * 1.15, r * 0.3); ctx.fill(); }
  const gr = r * (2.3 + nt * 1.2);
  const g = ctx.createRadialGradient(o.x, cy, 0, o.x, cy, gr);
  g.addColorStop(0, rgba(col, (0.38 + 0.3 * nt) * a * (opt.glow ?? 1)));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g; ctx.fillRect(o.x - gr, cy - gr, gr * 2, gr * 2);
  const g2 = ctx.createRadialGradient(o.x - r * 0.3, cy - r * 0.35, r * 0.1, o.x, cy, r);
  g2.addColorStop(0, rgba(mixc(col, [255, 255, 255], 0.6), a));
  g2.addColorStop(1, rgba(col, a * 0.9));
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(o.x, cy, r, 0, Math.PI * 2); ctx.fill();
  if (opt.rim && r > 2) {
    // 浅色水面上，给光球加一圈深一点的边，免得和背景糊在一起
    ctx.strokeStyle = rgba(mixc(col, [0, 0, 0], 0.35), 0.55 * a * opt.rim);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
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
