import { type RGB, rgba } from './paint';
import { NIGHT_KEEP, type Look } from './look';
import type { ArtInfo } from './art';

/**
 * 画好的素材（assets/art 经 scripts/prepare-art.mjs 处理后的 WebP）。
 *
 * 素材自带颜色，不再整体染色；只按此刻的光处理，和 look.ts 里的 pigment() 一个意思：
 *   夜里：叠一层预先压暗的“夜里版”，按夜的程度混合；
 *   天色：在图片自己的像素上（source-atop）薄薄罩一层天色，远处和山脚罩得更多，淡进雾里。
 * 图片只解码一次；着色结果缓存起来，光没变就直接贴上去：
 *   draw()      大小固定的（远山、雪山、云）：按“尺寸 + 光”缓存，每种大小各留一份；
 *   drawSmall() 大小随透视一直在变的（岸上的树、草、牛羊）：按光着色一份原图大小的，
 *               再预先缩出几级小图，画的时候挑刚好够大的那级，远处的小东西不闪。
 */
export class Sprite {
  private day: HTMLImageElement | null = null;
  private night: HTMLCanvasElement | null = null;
  /** 尺寸 → 这个尺寸上次着色时的光、着色结果 */
  private cache = new Map<string, { light: string; canvas: HTMLCanvasElement }>();
  /** drawSmall 用：原图大小的着色结果和逐级减半的小图 */
  private mips: HTMLCanvasElement[] = [];
  private mipLight = '';

  constructor(readonly info: ArtInfo, onReady: () => void) {
    const img = new Image();
    img.src = info.url;
    img.decode().then(() => {
      this.day = img;
      this.night = nightVersion(img);
      onReady();
    }, () => { /* 加载失败就一直用代码画的版本 */ });
  }

  get ready() { return this.day !== null; }

  /** 宽高比 */
  get aspect() { return this.info.w / this.info.h; }

  /**
   * 画在 (x, y, w, h)（CSS 像素）。
   * mist：整体被雾吞掉多少；foot：底边被雾吞掉多少（从上到下渐变）。
   * alpha：整体透明度；flip：左右翻转。
   */
  draw(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
    look: Look, mist: number, foot: number, opt: { alpha?: number; flip?: boolean } = {},
  ) {
    if (!this.day || !this.night) return;
    const dpr = ctx.getTransform().a || 1;
    const dw = Math.max(1, Math.round(w * dpr)), dh = Math.max(1, Math.round(h * dpr));
    const size = `${dw}x${dh}`;
    const light = lightKey(look, mist, foot);
    let entry = this.cache.get(size);
    if (!entry || entry.light !== light) {
      if (!entry) {
        if (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value!);
        entry = { light, canvas: document.createElement('canvas') };
        entry.canvas.width = dw; entry.canvas.height = dh;
        this.cache.set(size, entry);
      }
      entry.light = light;
      this.paintLit(entry.canvas, look, mist, foot);
    }
    blit(ctx, entry.canvas, x, y, w, h, opt.alpha ?? 1, !!opt.flip);
  }

  /**
   * 岸上的东西：底边的落地点（info.ax，或传入的 anchor）对准 (x, y)，高 h（CSS 像素）。
   * 近处的东西不罩雾；远处淡掉用 alpha。
   */
  drawSmall(
    ctx: CanvasRenderingContext2D, x: number, y: number, h: number,
    look: Look, alpha: number, flip: boolean, anchor = this.info.ax,
  ) {
    if (!this.day || !this.night) return;
    const light = lightKey(look, 0, 0);
    if (light !== this.mipLight || !this.mips.length) {
      this.mipLight = light;
      const base = (this.mips[0] ??= document.createElement('canvas'));
      if (base.width !== this.info.w) { base.width = this.info.w; base.height = this.info.h; }
      this.paintLit(base, look, 0, 0);
      // 逐级减半，直到很小
      let i = 1;
      for (let w = base.width >> 1, hh = base.height >> 1; w >= 8 && hh >= 8; w >>= 1, hh >>= 1, i++) {
        const c = (this.mips[i] ??= document.createElement('canvas'));
        if (c.width !== w) { c.width = w; c.height = hh; }
        const g = c.getContext('2d')!;
        g.clearRect(0, 0, w, hh);
        g.imageSmoothingQuality = 'high';
        g.drawImage(this.mips[i - 1], 0, 0, w, hh);
      }
      this.mips.length = i;
    }
    // 挑刚好够大的那一级（屏幕像素不超过它的高度）
    const need = h * (ctx.getTransform().a || 1);
    let lv = this.mips.length - 1;
    while (lv > 0 && this.mips[lv].height < need) lv--;
    const w = h * this.aspect;
    const ax = flip ? 1 - anchor : anchor;
    blit(ctx, this.mips[lv], x - ax * w, y - h, w, h, alpha, flip);
  }

  /** 在 c 上画出此刻光线下的这张图（铺满 c） */
  private paintLit(c: HTMLCanvasElement, look: Look, mist: number, foot: number) {
    const dw = c.width, dh = c.height;
    const k = (1 - look.daylight) * (1 - mist);
    const t = look.tint;
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, dw, dh);
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.day!, 0, 0, dw, dh);
    if (k > 0.01) {
      g.globalAlpha = Math.min(1, k);
      g.drawImage(this.night!, 0, 0, dw, dh);
      g.globalAlpha = 1;
    }
    // 天色：同 pigment()，先染 12%，再按雾的多少往天色靠
    g.globalCompositeOperation = 'source-atop';
    const base = 0.12 + 0.88 * mist;
    const fog = g.createLinearGradient(0, 0, 0, dh);
    fog.addColorStop(0, rgba(t, base));
    fog.addColorStop(0.55, rgba(t, base));
    fog.addColorStop(1, rgba(t, base + (1 - base) * foot));
    g.fillStyle = fog;
    g.fillRect(0, 0, dw, dh);
    g.globalCompositeOperation = 'source-over';
  }
}

/** 光的量化：变化小到看不出来时不重新着色 */
function lightKey(look: Look, mist: number, foot: number) {
  const k = (1 - look.daylight) * (1 - mist);
  return `${Math.round(k * 48)}|${look.tint.map(v => Math.round(v / 3)).join(',')}|${mist}|${foot}`;
}

function blit(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number, alpha: number, flip: boolean) {
  if (alpha < 0.01) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  if (flip) {
    ctx.save();
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(img, x, y, w, h);
  }
  ctx.globalAlpha = prev;
}

/** 夜里版：每个通道按 NIGHT_KEEP 压暗（保留色相，略偏青），透明度不变 */
function nightVersion(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  const [r, gg, b]: RGB = NIGHT_KEEP;
  for (let i = 0; i < px.length; i += 4) {
    px[i] *= r; px[i + 1] *= gg; px[i + 2] *= b;
  }
  g.putImageData(d, 0, 0);
  return c;
}
