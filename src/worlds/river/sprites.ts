import { type RGB, rgba } from './paint';
import { NIGHT_KEEP, type Look } from './look';
import type { ArtInfo } from './art';

/**
 * 画好的素材（assets/art 经 scripts/prepare-art.mjs 处理后的 WebP）。
 *
 * 素材自带颜色，不再整体染色；只按此刻的光处理，和 look.ts 里的 pigment() 一个意思：
 *   夜里：叠一层预先压暗的“夜里版”，按夜的程度混合；
 *   天色：在图片自己的像素上（source-atop）薄薄罩一层天色，远处和山脚罩得更多，淡进雾里。
 * 图片只解码一次；着色结果按“尺寸 + 光”缓存，光没变就直接贴上去。
 */
export class Sprite {
  private day: HTMLImageElement | null = null;
  private night: HTMLCanvasElement | null = null;
  private cache: HTMLCanvasElement | null = null;
  private key = '';

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
   */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, look: Look, mist: number, foot: number) {
    if (!this.day || !this.night) return;
    const dpr = ctx.getTransform().a || 1;
    const dw = Math.max(1, Math.round(w * dpr)), dh = Math.max(1, Math.round(h * dpr));
    const k = (1 - look.daylight) * (1 - mist);
    const t = look.tint;
    // 光的量化：变化小到看不出来时不重新着色
    const key = `${dw}x${dh}|${Math.round(k * 48)}|${t.map(v => Math.round(v / 3)).join(',')}|${mist}|${foot}`;
    if (key !== this.key || !this.cache) {
      this.key = key;
      const c = (this.cache ??= document.createElement('canvas'));
      if (c.width !== dw || c.height !== dh) { c.width = dw; c.height = dh; }
      const g = c.getContext('2d')!;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, dw, dh);
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.day, 0, 0, dw, dh);
      if (k > 0.01) {
        g.globalAlpha = Math.min(1, k);
        g.drawImage(this.night, 0, 0, dw, dh);
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
    }
    ctx.drawImage(this.cache!, x, y, w, h);
  }
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
