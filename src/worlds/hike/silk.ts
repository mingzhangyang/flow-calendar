import { mixc, rgba, rng } from './paint';
import { type Look, INK, OCHRE } from './look';

/**
 * 绢的纹理：细密的经线、纬线和一点斑驳。
 * 只生成一次，平铺在整幅画上。
 */
let cached: { ctx: CanvasRenderingContext2D; pattern: CanvasPattern } | null = null;

export function silkPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (cached && cached.ctx === ctx) return cached.pattern;
  const size = 192;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = rng(5);

  // 纬线和经线：每一根的深浅略有不同
  for (let y = 0; y < size; y++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(70,50,20,${(0.05 * (0.5 - v)).toFixed(3)})` : `rgba(255,248,230,${(0.06 * (v - 0.5)).toFixed(3)})`;
    g.fillRect(0, y, size, 1);
  }
  for (let x = 0; x < size; x += 1) {
    const v = r();
    g.fillStyle = `rgba(70,50,20,${(0.025 * v).toFixed(3)})`;
    g.fillRect(x, 0, 1, size);
  }
  // 斑驳：几块很淡的旧色
  for (let i = 0; i < 26; i++) {
    const x = r() * size, y = r() * size, rad = 8 + r() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(120,86,40,${(0.03 + r() * 0.03).toFixed(3)})`);
    gr.addColorStop(1, 'rgba(120,86,40,0)');
    g.fillStyle = gr;
    // 靠边的斑也画到对边去，平铺时看不出接缝
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.save(); g.translate(ox, oy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore();
    }
  }
  const pattern = ctx.createPattern(c, 'repeat')!;
  cached = { ctx, pattern };
  return pattern;
}

/** 整幅画盖一层绢的经纬和四角的旧色（所有东西画完、文字之前） */
export function drawSilk(ctx: CanvasRenderingContext2D, W: number, H: number, look: Look) {
  ctx.save();
  ctx.fillStyle = silkPattern(ctx);
  ctx.globalAlpha = 0.55 + 0.25 * look.daylight;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  const r = Math.hypot(W, H) / 2;
  const g = ctx.createRadialGradient(W / 2, H * 0.45, r * 0.45, W / 2, H * 0.45, r);
  g.addColorStop(0, rgba(OCHRE, 0));
  g.addColorStop(1, rgba(mixc(OCHRE, INK, 0.4), 0.16));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
