import { type RGB, clamp, mixc, mod, rgba } from './paint';

/**
 * 一天里画面顶部和地平线处“绢”的颜色，按钟点插值。
 * 天空不画成蓝色，而是绢本身：顶部旧一些、深一些，地平线处是留白的雾。
 * 早晚染上霞光，夜里像在灯下看画，整体压暗。
 */
const SKY: [number, RGB, RGB][] = [
  [0, [40, 38, 46], [64, 60, 64]],
  [5, [44, 40, 50], [74, 66, 70]],
  [6.5, [156, 132, 124], [232, 184, 156]],
  [8, [206, 190, 158], [238, 226, 200]],
  [12, [212, 198, 164], [242, 234, 212]],
  [16, [208, 192, 156], [240, 228, 202]],
  [18.3, [188, 150, 118], [242, 190, 140]],
  [19.5, [110, 88, 92], [186, 128, 112]],
  [21, [50, 46, 54], [80, 72, 76]],
  [24, [40, 38, 46], [64, 60, 64]],
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
    // 太阳是一枚朱红的圆，像画上的印
    return { x: W * (0.12 + 0.76 * u), y: HZ - Math.sin(clamp(u, 0, 1) * Math.PI) * H * 0.22 + 8, r: 12, c: [204, 70, 44], glow: 46, a: 1 };
  }
  const hh = mod(x - 19.2, 24);
  if (hh < 10.2) {
    const u = hh / 10.2;
    return { x: W * (0.86 - 0.72 * u), y: HZ - Math.sin(u * Math.PI) * H * 0.2 + 8, r: 10, c: [244, 236, 214], glow: 56, a: Math.max(0.25, night) };
  }
  return null;
}

export function drawSky(ctx: CanvasRenderingContext2D, W: number, HZ: number, sky: Sky, _night: number, body: Body | null) {
  const g = ctx.createLinearGradient(0, 0, 0, HZ);
  g.addColorStop(0, rgba(sky.top, 1));
  g.addColorStop(0.6, rgba(mixc(sky.top, sky.bot, 0.7), 1));
  g.addColorStop(1, rgba(sky.bot, 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HZ + 1);

  if (body) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, HZ); ctx.clip();
    const gg = ctx.createRadialGradient(body.x, body.y, 0, body.x, body.y, body.glow);
    gg.addColorStop(0, rgba(body.c, 0.3 * body.a));
    gg.addColorStop(1, rgba(body.c, 0));
    ctx.fillStyle = gg;
    ctx.fillRect(body.x - body.glow, body.y - body.glow, body.glow * 2, body.glow * 2);
    ctx.fillStyle = rgba(body.c, 0.95 * body.a);
    ctx.beginPath(); ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
