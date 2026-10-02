import { type RGB, clamp, mixc, mod, rgba, rng } from './paint';

/** 一天里天空顶部和地平线的颜色，按钟点插值 */
const SKY: [number, RGB, RGB][] = [
  [0, [8, 11, 26], [20, 27, 51]],
  [5, [10, 14, 32], [32, 30, 62]],
  [6.5, [40, 52, 100], [235, 150, 120]],
  [8, [70, 120, 190], [190, 215, 230]],
  [12, [60, 130, 205], [205, 228, 240]],
  [16, [70, 125, 195], [215, 220, 215]],
  [18.3, [55, 70, 130], [245, 170, 105]],
  [19.5, [35, 38, 85], [190, 95, 115]],
  [21, [12, 16, 38], [32, 36, 72]],
  [24, [8, 11, 26], [20, 27, 51]],
];

export interface Sky { top: RGB; bot: RGB }

export function skyAt(hourOfDay: number): Sky {
  const x = mod(hourOfDay, 24);
  for (let i = 1; i < SKY.length; i++) {
    if (x <= SKY[i][0]) {
      const a = SKY[i - 1], b = SKY[i];
      let u = (x - a[0]) / (b[0] - a[0]);
      u = u * u * (3 - 2 * u);
      return { top: mixc(a[1], b[1], u), bot: mixc(a[2], b[2], u) };
    }
  }
  return { top: SKY[0][1], bot: SKY[0][2] };
}

/** 夜的浓度：0 白天，1 深夜 */
export function nightAt(hourOfDay: number): number {
  const x = mod(hourOfDay, 24);
  if (x < 5) return 1;
  if (x < 7) return 1 - (x - 5) / 2;
  if (x < 18.5) return 0;
  if (x < 21) return (x - 18.5) / 2.5;
  return 1;
}

export interface Body { x: number; y: number; r: number; c: RGB; glow: number; a: number }

/** 太阳或月亮的位置 */
export function celestial(hourOfDay: number, W: number, H: number, HZ: number, night: number): Body | null {
  const x = mod(hourOfDay, 24);
  if (x > 5.6 && x < 18.9) {
    const u = (x - 5.8) / 12.9;
    return { x: W * (0.12 + 0.76 * u), y: HZ - Math.sin(clamp(u, 0, 1) * Math.PI) * H * 0.22 + 8, r: 13, c: [255, 236, 200], glow: 90, a: 1 };
  }
  const hh = mod(x - 19.2, 24);
  if (hh < 10.2) {
    const u = hh / 10.2;
    return { x: W * (0.86 - 0.72 * u), y: HZ - Math.sin(u * Math.PI) * H * 0.2 + 8, r: 9, c: [232, 236, 248], glow: 60, a: Math.max(0.25, night) };
  }
  return null;
}

/** 星星是固定的：不闪烁，静止时不需要重画 */
const STARS: [number, number, number, number][] = [];
{
  const r = rng(3);
  for (let i = 0; i < 130; i++) STARS.push([r(), r() * 0.95, 0.5 + r() * 1.2, 0.35 + r() * 0.55]);
}

export function drawSky(ctx: CanvasRenderingContext2D, W: number, HZ: number, sky: Sky, night: number, body: Body | null) {
  const g = ctx.createLinearGradient(0, 0, 0, HZ);
  g.addColorStop(0, rgba(sky.top, 1));
  g.addColorStop(1, rgba(sky.bot, 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HZ + 1);

  if (night > 0.01) {
    for (const s of STARS) {
      ctx.fillStyle = rgba([235, 240, 255], night * s[3]);
      ctx.fillRect(s[0] * W, s[1] * HZ, s[2], s[2]);
    }
  }

  if (body) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, HZ); ctx.clip();
    const gg = ctx.createRadialGradient(body.x, body.y, 0, body.x, body.y, body.glow);
    gg.addColorStop(0, rgba(body.c, 0.45 * body.a));
    gg.addColorStop(1, rgba(body.c, 0));
    ctx.fillStyle = gg;
    ctx.fillRect(body.x - body.glow, body.y - body.glow, body.glow * 2, body.glow * 2);
    ctx.fillStyle = rgba(body.c, 0.95 * body.a);
    ctx.beginPath(); ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
