import { type RGB, ellipsePath, mixc, mod, rgba, rng, smooth } from './paint';
import type { Sky } from './sky';
import { type Look, AZURITE, INK, MALACHITE, OCHRE, SHELL_WHITE, SILK, pigment } from './look';
import { Sprite } from './sprites';
import { ART } from './art';

/**
 * 路两边的景物：远山、白云、树、草、小溪、牛羊。
 *
 * 远山在无穷远处，钉在屏幕上不动；白云随时间缓缓往一边飘。
 * 路边的东西钉在时间轴上，和日程一样沿路走来，拖动时一起移动。
 * 每样东西的位置和样子都由它所在的时间段决定，同一时刻永远长一个样。
 */

/** 岸上每隔多少小时放一处景物 */
const SLOT = 0.5;
/** 比这更远的景物不画（已经挤在地平线的雾里） */
const FAR_Z = 40;
/** 贴地的东西（小溪、草地晕染）排序时加上这个数，总在立着的树、草、牛羊之前画 */
const FLAT = 1e4;

type Project = (X: number, h: number) => [number, number, number];

/** 墨色：白天是浓墨，夜里换成灯下的淡赭灰，免得在暗岸上看不见 */
function inkOf(look: Look): RGB {
  return mixc(mixc(look.land, [196, 186, 166], 0.3), INK, look.daylight);
}

/**
 * 画好的远山：从远到近三层，每层的山峰高度（占屏高）和被雾吞掉的程度。
 * 素材的山脚对准地平线，往下一点藏进地平线的雾里。
 */
const RANGES = [
  { art: ART.rangeFar, peak: 0.12, mist: 0.22 },
  { art: ART.rangeMid, peak: 0.095, mist: 0.1 },
  { art: ART.rangeNear, peak: 0.07, mist: 0.02 },
];
/** 雪山：峰高占屏高的比例 */
const PEAK_H = 0.145;

export class Scenery {
  private W = 0; private H = 0; private HZ = 0;
  private S = 0;
  /** 画好的远山和雪山；没加载好之前用代码画的兜底 */
  private ranges: Sprite[];
  private snow: Sprite;
  private cloudArt: Sprite[];
  /** 岸上的精灵图：阔叶树、松、柳；三种草；低头吃草和抬头的水牛；羊 */
  private treeArt: Sprite[];
  private grassArt: Sprite[];
  private buffaloArt: Sprite[];
  private sheepArt: Sprite;
  /** 三层远山的轮廓高度（像素），每 3 像素一个采样，从远到近 */
  private ridges: Float32Array[] = [];
  /** 路尽头的雪山：轮廓高度和峰高 */
  private peak: Float32Array = new Float32Array(0);
  private peakH = 0;
  private clouds: { u: number; v: number; w: number; speed: number; puffs: [number, number, number][]; art: number; flip: boolean }[] = [];

  constructor(invalidate: () => void) {
    this.ranges = RANGES.map(r => new Sprite(r.art, invalidate));
    this.snow = new Sprite(ART.peak1, invalidate);
    this.cloudArt = [ART.cloud1, ART.cloud2].map(a => new Sprite(a, invalidate));
    this.treeArt = [ART.treeBroad1, ART.treePine1, ART.treeWillow1].map(a => new Sprite(a, invalidate));
    this.grassArt = [ART.grass1, ART.grass2, ART.grass3].map(a => new Sprite(a, invalidate));
    this.buffaloArt = [ART.buffalo1, ART.buffalo2].map(a => new Sprite(a, invalidate));
    this.sheepArt = new Sprite(ART.sheep1, invalidate);
  }

  resize(W: number, H: number, HZ: number) {
    this.W = W; this.H = H; this.HZ = HZ;
    this.S = Math.min(W * 0.55, H * 0.6);
    this.ridges = [0, 1, 2].map(i => makeRidge(W, H, i));
    this.peakH = H * 0.145;
    this.peak = makePeak(W, H, this.peakH);

    const r = rng(29);
    this.clouds = [];
    for (let i = 0; i < 5; i++) {
      const puffs: [number, number, number][] = [];
      const n = 4 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) puffs.push([(k / (n - 1)) - 0.5 + (r() - 0.5) * 0.12, (r() - 0.5) * 0.5, 0.35 + r() * 0.45]);
      this.clouds.push({
        u: r(), v: 0.08 + r() * 0.5, w: Math.min(Math.max(W, H * 0.75) * (0.22 + r() * 0.22), H * 0.3), speed: 0.012 + r() * 0.02, puffs,
        art: i % 2, flip: r() < 0.5,
      });
    }
  }

  /* ---------- 天上：远山与白云 ---------- */

  drawFar(ctx: CanvasRenderingContext2D, sky: Sky, look: Look, T: number) {
    this.drawClouds(ctx, sky, look, T);
    if (this.snow.ready && this.ranges.every(r => r.ready)) this.drawArtMountains(ctx, look);
    else this.drawMountains(ctx, sky, look);
  }

  /** 画好的雪山和三层远山，钉在屏幕上不动 */
  private drawArtMountains(ctx: CanvasRenderingContext2D, look: Look) {
    const { W, H, HZ } = this;
    const foot = HZ + H * 0.006;
    {
      const s = this.snow, h = (H * PEAK_H) / s.info.peak, w = h * s.aspect;
      s.draw(ctx, W / 2 - w / 2, foot - h, w, h, look, 0.12, 0.6);
    }
    RANGES.forEach((r, i) => {
      const s = this.ranges[i];
      // 至少铺满屏幕宽度；窄屏上按高度来，只露出中间路远去的山口和两边的山
      const h = Math.max((H * r.peak) / s.info.peak, W / s.aspect);
      const w = h * s.aspect;
      s.draw(ctx, W / 2 - w / 2, foot - h, w, h, look, r.mist, 0.75);
    });
  }

  /**
   * （兜底）青绿山峦：山脚赭石，往上石绿，山脊石青，墨线勾勒。
   * 颜色沿着山脊走：把山脊线在山体里描几道宽窄不同的色带，
   * 这样每座峰的峰顶都是青的，而不是整层只有最高处才青。
   */
  private drawMountains(ctx: CanvasRenderingContext2D, sky: Sky, look: Look) {
    const { W, HZ } = this;
    this.drawSnowPeak(ctx, look);
    const mist = [0.55, 0.35, 0.15];
    this.ridges.forEach((ridge, i) => {
      const m = mist[i];
      let top = HZ, maxV = 0;
      for (const v of ridge) { top = Math.min(top, HZ - v); maxV = Math.max(maxV, v); }

      const shape = new Path2D();
      shape.moveTo(0, HZ + 2);
      for (let k = 0; k < ridge.length; k++) shape.lineTo(k * 3, HZ - ridge[k]);
      shape.lineTo(W, HZ + 2);
      shape.closePath();
      const line = new Path2D();
      for (let k = 0; k < ridge.length; k++) {
        if (k) line.lineTo(k * 3, HZ - ridge[k]); else line.moveTo(0, HZ - ridge[k]);
      }

      // 底色：赭石，往下淡进雾里
      const g = ctx.createLinearGradient(0, top, 0, HZ);
      g.addColorStop(0, rgba(pigment(mixc(OCHRE, MALACHITE, 0.4), look, m), 1));
      g.addColorStop(0.6, rgba(pigment(OCHRE, look, m + 0.15), 1));
      g.addColorStop(1, rgba(pigment(SILK, look, 0.85), 1));
      ctx.fillStyle = g;
      ctx.fill(shape);

      ctx.save();
      ctx.clip(shape);
      ctx.lineJoin = 'round';
      // 贴着山脊叠几道由宽到窄、由绿到青的淡色，叠出柔和的过渡：越靠山脊越青越浓
      for (let j = 0; j < 8; j++) {
        const t = j / 7;
        ctx.strokeStyle = rgba(pigment(mixc(MALACHITE, AZURITE, t * t), look, m), 0.2 + 0.08 * t);
        ctx.lineWidth = maxV * (1.1 - 1.0 * t);
        ctx.stroke(line);
      }
      // 山脚的雾
      const fog = ctx.createLinearGradient(0, HZ - maxV * 0.45, 0, HZ);
      fog.addColorStop(0, rgba(sky.bot, 0));
      fog.addColorStop(1, rgba(sky.bot, 0.9));
      ctx.fillStyle = fog;
      ctx.fillRect(0, HZ - maxV * 0.45, W, maxV * 0.45 + 2);
      ctx.restore();

      // 墨线勾勒山脊
      ctx.strokeStyle = rgba(pigment(INK, look, m), 0.5);
      ctx.lineWidth = 0.9;
      ctx.stroke(line);
    });
  }

  /** （兜底）路的尽头，最远处的一座雪山：青绿的山体，峰顶一层蛤粉白雪 */
  private drawSnowPeak(ctx: CanvasRenderingContext2D, look: Look) {
    const { W, HZ, peak, peakH } = this;
    const cx = W / 2, top = HZ - peakH, m = 0.6;
    const shape = new Path2D();
    shape.moveTo(0, HZ + 2);
    for (let k = 0; k < peak.length; k++) shape.lineTo(k * 3, HZ - peak[k]);
    shape.lineTo(W, HZ + 2);
    shape.closePath();
    const line = new Path2D();
    let open = false;
    for (let k = 0; k < peak.length; k++) {
      if (peak[k] < peakH * 0.12) { open = false; continue; }
      if (open) line.lineTo(k * 3, HZ - peak[k]); else line.moveTo(k * 3, HZ - peak[k]);
      open = true;
    }

    const g = ctx.createLinearGradient(0, top, 0, HZ);
    g.addColorStop(0, rgba(pigment(AZURITE, look, m), 1));
    g.addColorStop(0.45, rgba(pigment(MALACHITE, look, m), 1));
    g.addColorStop(1, rgba(pigment(SILK, look, 0.85), 1));
    ctx.fillStyle = g;
    ctx.fill(shape);

    ctx.save();
    ctx.clip(shape);
    // 积雪：蛤粉白，早晚被霞光染暖，夜里随画面一起压暗
    const snow = pigment(SHELL_WHITE, look, 0.15);
    const snowLine = (x: number) => {
      // 雪线参差，沟里的雪舌往下伸
      const n = Math.sin(x * 0.07) * 0.03 + Math.sin(x * 0.19 + 1) * 0.015;
      const tongue = Math.max(0, Math.sin(x * 0.055 + 0.6)) ** 6 * 0.16;
      return HZ - peakH * (0.56 - n - tongue);
    };
    ctx.beginPath();
    ctx.moveTo(0, top - 2);
    ctx.lineTo(W, top - 2);
    for (let x = W; x >= 0; x -= 3) ctx.lineTo(x, snowLine(x));
    ctx.closePath();
    ctx.fillStyle = rgba(snow, 0.95);
    ctx.fill();

    // 背光的一面：右侧淡淡一层石青
    const sh = ctx.createLinearGradient(cx - peakH * 0.2, 0, cx + peakH * 1.4, 0);
    sh.addColorStop(0, rgba(AZURITE, 0));
    sh.addColorStop(0.25, rgba(pigment(AZURITE, look), 0.22));
    sh.addColorStop(1, rgba(pigment(AZURITE, look), 0.08));
    ctx.fillStyle = sh;
    ctx.fillRect(cx - peakH * 0.2, top - 2, peakH * 3, peakH + 4);

    // 几笔皴，从峰顶往下
    ctx.strokeStyle = rgba(pigment(INK, look, 0.3), 0.22);
    ctx.lineWidth = 1;
    for (const [dx, len] of [[-0.25, 0.3], [0.18, 0.38], [0.42, 0.26], [-0.55, 0.22]]) {
      const x0 = cx + dx * peakH * 0.6;
      const y0 = HZ - peak[Math.round(x0 / 3)] + 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + dx * peakH * 0.3, y0 + peakH * len * 0.5, x0 + dx * peakH * 0.5, y0 + peakH * len);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = rgba(pigment(INK, look, 0.35), 0.55);
    ctx.lineWidth = 1;
    ctx.stroke(line);
  }

  /**
   * 云：画好的两种云，轮流用、有的左右翻转。随视角时间缓缓往一边飘，飘出去再从另一边进来。
   * 图片没加载好时用代码画的留白兜底。
   */
  private drawClouds(ctx: CanvasRenderingContext2D, sky: Sky, look: Look, T: number) {
    const { W, HZ } = this;
    if (this.cloudArt.every(s => s.ready)) {
      const alpha = 0.4 + 0.6 * look.daylight; // 夜里的云淡一些，免得在暗天上发灰
      for (const cl of this.clouds) {
        const s = this.cloudArt[cl.art];
        // 图片里的云比代码画的那团略宽，按 1.8 倍画
        const w = cl.w * 1.8, h = w / s.aspect;
        const span = W + w;
        const x = mod(cl.u * span + T * cl.speed * W, span) - w;
        s.draw(ctx, x, cl.v * HZ - h / 2, w, h, look, 0.08, 0, { alpha, flip: cl.flip });
      }
      return;
    }

    const col = mixc(pigment(SHELL_WHITE, look, 0.2), sky.bot, 0.15);
    const alpha = 0.4 + 0.35 * look.daylight;
    for (const cl of this.clouds) {
      const span = W + cl.w * 2;
      const cx = mod(cl.u * span + T * cl.speed * W, span) - cl.w;
      const cy = cl.v * HZ;
      for (const [px, py, pr] of cl.puffs) {
        const x = cx + px * cl.w, y = cy + py * cl.w * 0.12, r = pr * cl.w * 0.4;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, 0.32);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, rgba(col, alpha * 0.55));
        g.addColorStop(0.6, rgba(col, alpha * 0.3));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }
    }
  }

  /* ---------- 岸上：树、草、小溪、牛羊 ---------- */

  drawBanks(ctx: CanvasRenderingContext2D, project: Project, edgeX: (h: number, side: -1 | 1) => number, T: number, tau: number, look: Look) {
    const ink = inkOf(look);
    const grass = pigment(mixc(MALACHITE, INK, 0.35), look);
    const wash = pigment(mixc(MALACHITE, AZURITE, 0.3), look);
    const water = look.water;
    const wool = pigment(SHELL_WHITE, look, 0.1);
    const leaves: [RGB, RGB] = [pigment(MALACHITE, look), pigment(mixc(AZURITE, MALACHITE, 0.3), look)];
    const items: [number, () => void][] = [];
    // 精灵图都加载好了就用画好的，否则用代码画的兜底；摆放完全一样
    const art = [...this.treeArt, ...this.grassArt, ...this.buffaloArt, this.sheepArt].every(s => s.ready);

    // 小溪最长 12 小时，下游早已走过去了上游还看得见，所以往回多看一段
    const k0 = Math.floor((T - tau * 0.7 - 14) / SLOT), k1 = Math.ceil((T + tau * (FAR_Z - 1)) / SLOT);
    for (let k = k0; k <= k1; k++) {
      for (const side of [-1, 1] as const) {
        const r = rng(k * 2 + (side > 0 ? 1 : 0) + 7_000_000);
        const h0 = k * SLOT + r() * SLOT;
        const fade = (z: number) => smooth(FAR_Z, FAR_Z * 0.45, z);
        /** 路边一点：离路边 d（世界单位）、时刻 h */
        const at = (d: number, h: number) => project(edgeX(h, side) + side * (0.03 + d), h);

        // 小溪：从远处的田野里弯弯曲曲地流过来，到路边为止。
        // 主要顺着纵深走（几个小时那么长），横向只离开路边一点，透视下才像从远处流来，而不是横躺在田里
        if (r() < 0.04) {
          const len = 5 + r() * 7, reach = 0.5 + r() * 0.8, wig = r() * 6, amp = 0.12 + r() * 0.16;
          // 溪的中线（离路边距离 d，时刻 h），再往两边各让出半个溪宽，投影成一条带子；u = 0 在路边，u = 1 是上游
          const mid: [number, number, number][] = [];
          for (let i = 0; i <= 40; i++) {
            const u = i / 40;
            const d = -0.025 + reach * Math.sqrt(u) + amp * Math.sin(u * 5.5 + wig) * Math.min(1, u * 4);
            const h = h0 + u * len + 0.25 * Math.sin(u * 5.3 + wig * 1.7) * u;
            mid.push([d, h, 0.03 * (1 - 0.7 * u)]); // 越往上游越窄
          }
          const left: [number, number, number][] = [], right: [number, number, number][] = [];
          for (let i = 0; i < mid.length; i++) {
            const a = mid[Math.max(0, i - 1)], b = mid[Math.min(mid.length - 1, i + 1)];
            // 屏幕之外的世界里，1 小时大约等于 0.3 个横向单位，按这个比例求法线
            let tx = b[0] - a[0], th = (b[1] - a[1]) * 0.3;
            const n = Math.hypot(tx, th) || 1; tx /= n; th /= n;
            const [d, h, w] = mid[i];
            left.push(at(d - th * w, h + (tx * w) / 0.3));
            right.push(at(d + th * w, h - (tx * w) / 0.3));
          }
          // 下游已经走到身后的那一截剪掉，只画还在眼前的部分
          let i0 = left.length;
          while (i0 > 0 && left[i0 - 1][2] > 0.35 && right[i0 - 1][2] > 0.35) i0--;
          if (left.length - i0 >= 2) {
            const l = left.slice(i0), rr = right.slice(i0);
            items.push([FLAT + l[0][2], () => stream(ctx, l, rr, ink, water, fade)]);
          }
        }

        // 草地的淡墨晕染
        if (r() < 0.55) {
          const [x, y, z] = at(0.1 + r() * 1.3, h0 + r() * SLOT);
          const s = this.scale(z);
          if (s && z < FAR_Z) items.push([FLAT + z, () => {
            ctx.fillStyle = rgba(wash, 0.16 * fade(z));
            ellipsePath(ctx, x, y, 0.22 * s, 0.03 * s);
            ctx.fill();
          }]);
        }

        // 路边的草：一两丛压在路边上，让路边不那么齐整（用自己的随机数，不影响别的景物）
        {
          const re = rng(k * 2 + (side > 0 ? 1 : 0) + 9_000_000);
          const n = Math.floor(re() * 3), eseed = Math.floor(re() * 1e9);
          for (let i = 0; i < n; i++) {
            const [x, y, z] = at(-0.09 + re() * 0.1, k * SLOT + re() * SLOT);
            const s = this.scale(z);
            if (s && z < FAR_Z * 0.5 && s * 0.04 > 1.5) {
              items.push([z, art
                ? () => this.grassSprite(ctx, x, y, s, look, fade(z), rng(eseed + i))
                : () => tuft(ctx, x, y, s, grass, fade(z), rng(eseed + i))]);
            }
          }
        }

        const kind = r();
        const seed = Math.floor(r() * 1e9);
        if (kind < 0.32) {
          // 树要稀：这一格里多半空着留白，偶尔一棵，少有两棵
          // （为了不打乱别的景物，随机数照旧取，只是不画）
          const u = r();
          const n = kind < 0.12 ? (u < 0.75 ? 1 : 2) : 0, d = 0.12 + r() * 1.2;
          for (let i = 0; i < n; i++) {
            const [x, y, z] = at(d + i * (0.15 + r() * 0.2), h0 + (r() - 0.5) * 0.5);
            const s = this.scale(z);
            if (s && z < FAR_Z && s * 0.2 > 2) {
              items.push([z, art
                ? () => this.treeSprite(ctx, x, y, s, d, look, fade(z), rng(seed + i))
                : () => tree(ctx, x, y, s, ink, leaves, fade(z), rng(seed + i))]);
            }
          }
        } else if (kind < 0.58) {
          // 一丛丛草
          const n = 2 + Math.floor(r() * 4);
          for (let i = 0; i < n; i++) {
            const [x, y, z] = at(0.03 + r() * 1.1, h0 + r() * SLOT);
            const s = this.scale(z);
            if (s && z < FAR_Z * 0.5 && s * 0.04 > 1.5) {
              items.push([z, art
                ? () => this.grassSprite(ctx, x, y, s, look, fade(z), rng(seed + i))
                : () => tuft(ctx, x, y, s, grass, fade(z), rng(seed + i))]);
            }
          }
        } else if (kind < 0.65) {
          // 一两头牛
          const n = 1 + Math.floor(r() * 2), d = 0.2 + r() * 0.9;
          for (let i = 0; i < n; i++) {
            const [x, y, z] = at(d + i * 0.12, h0 + i * 0.15);
            const s = this.scale(z);
            if (s && z < FAR_Z * 0.6 && s * 0.07 > 3) {
              items.push([z, art
                ? () => this.buffaloSprite(ctx, x, y, s, look, fade(z), rng(seed + i))
                : () => cow(ctx, x, y, s, ink, fade(z), rng(seed + i))]);
            }
          }
        } else if (kind < 0.73) {
          // 一小群羊
          const n = 2 + Math.floor(r() * 4), d = 0.2 + r() * 0.9;
          for (let i = 0; i < n; i++) {
            const [x, y, z] = at(d + (r() - 0.5) * 0.25, h0 + (r() - 0.5) * 0.35);
            const s = this.scale(z);
            if (s && z < FAR_Z * 0.6 && s * 0.05 > 2.5) {
              items.push([z, art
                ? () => this.sheepSprite(ctx, x, y, s, look, fade(z), rng(seed + i))
                : () => sheep(ctx, x, y, s, ink, wool, fade(z), rng(seed + i))]);
            }
          }
        }
      }
    }

    items.sort((a, b) => b[0] - a[0]); // 远的先画
    ctx.save();
    ctx.lineCap = 'round';
    for (const [, paint] of items) paint();
    ctx.restore();
  }

  /*
   * 画好的岸上景物：底边的落地点对准地面上那一点，按透视缩放（s = 深度 z 处一个世界单位的像素数），
   * 远处用 a 淡掉。样子由 r（这一处景物自己的随机数）决定，同一时刻永远一样。
   */

  /** 树：以柳为主（靠路的几乎都是柳），偶尔一棵阔叶树或松 */
  private treeSprite(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, d: number, look: Look, a: number, r: () => number) {
    const u = r();
    const willow = d < 0.35 ? 0.9 : 0.7;
    const kind = u < willow ? 2 : u < willow + (1 - willow) * 0.6 ? 0 : 1;
    // 树高大约和路宽相当（路宽 1 个单位）
    const h = (0.45 + r() * 0.25) * s;
    this.treeArt[kind].drawSmall(ctx, x, y, h, look, a, r() < 0.5);
  }

  private grassSprite(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, look: Look, a: number, r: () => number) {
    const g = this.grassArt[Math.floor(r() * 3)];
    g.drawSmall(ctx, x, y, (0.045 + r() * 0.035) * s, look, a, r() < 0.5);
  }

  /** 水牛：多半低头吃草，偶尔抬着头；朝向随机 */
  private buffaloSprite(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, look: Look, a: number, r: () => number) {
    const b = this.buffaloArt[r() < 0.6 ? 0 : 1];
    const w = (0.095 + r() * 0.02) * s;
    b.drawSmall(ctx, x, y, w / b.aspect, look, a, r() < 0.5);
  }

  private sheepSprite(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, look: Look, a: number, r: () => number) {
    const w = (0.052 + r() * 0.012) * s;
    this.sheepArt.drawSmall(ctx, x, y, w / this.sheepArt.aspect, look, a, r() < 0.5);
  }

  /** 深度 z 处，一个世界单位有多少像素；太近（在“现在”线后面很远）就不画 */
  private scale(z: number): number {
    if (z < 0.3) return 0;
    return this.S / z;
  }
}

/* ---------- 远山的轮廓 ---------- */

/** 雪山：一座尖峰带两个肩，左右不对称 */
function makePeak(W: number, H: number, ph: number): Float32Array {
  const n = Math.ceil(W / 3) + 1;
  const out = new Float32Array(n);
  const cx = W / 2;
  const parts: [number, number, number][] = [
    [0, 1, H * 0.1],
    [-H * 0.1, 0.66, H * 0.09],
    [H * 0.085, 0.72, H * 0.07],
    [H * 0.2, 0.38, H * 0.1],
  ];
  for (let k = 0; k < n; k++) {
    const x = k * 3;
    let v = 0;
    for (const [dx, f, w] of parts) v = Math.max(v, ph * f * Math.exp(-((Math.abs(x - cx - dx) / w) ** 1.25)));
    v += Math.sin(x * 0.23) * 0.6 + Math.sin(x * 0.09) * 1.2;
    out[k] = Math.max(0, v);
  }
  return out;
}

function makeRidge(W: number, H: number, layer: number): Float32Array {
  const r = rng(101 + layer * 17);
  const n = Math.ceil(W / 3) + 1;
  const out = new Float32Array(n);
  // 远的层更高更淡，近的层更矮；中间留出路远去的山口
  const maxH = H * [0.12, 0.085, 0.05][layer];
  const peaks: [number, number, number][] = [];
  for (let x = -H * 0.2; x < W + H * 0.2; x += H * (0.07 + r() * 0.1)) {
    const gap = 1 - 0.55 * Math.exp(-(((x - W / 2) / (W * 0.18)) ** 2));
    peaks.push([x, maxH * (0.45 + r() * 0.55) * gap, H * (0.05 + r() * 0.06)]);
  }
  for (let k = 0; k < n; k++) {
    const x = k * 3;
    let v = 0;
    for (const [cx, ph, pw] of peaks) {
      const t = (x - cx) / pw;
      v = Math.max(v, ph / (1 + t * t) ** 1.4);
    }
    // 细小的起伏，像笔锋
    v += Math.sin(x * 0.11 + layer) * 0.8 + Math.sin(x * 0.037 + layer * 2) * 1.6;
    out[k] = Math.max(0, v);
  }
  return out;
}

/* ---------- 水墨笔触 ---------- */

function stream(
  ctx: CanvasRenderingContext2D, left: [number, number, number][], right: [number, number, number][],
  ink: RGB, water: RGB, fade: (z: number) => number,
) {
  // 每一段的浓淡：离“现在”线太近会变得很粗，淡掉；上游渐渐隐进田里；太远的淡进雾里
  const n = left.length - 1;
  const alpha = (i: number) => {
    const z = Math.min(left[i][2], right[i][2]);
    return fade(z) * smooth(0.7, 1.3, z) * smooth(n, n * 0.6, i);
  };
  if (alpha(0) < 0.02 && alpha(n >> 1) < 0.02) return;
  // 水面用一道顺着溪的渐变填满，避免分段画出接缝
  const [x0, y0] = left[0], [x1, y1] = left[n];
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  let last = 0;
  for (let i = 0; i <= n; i += 4) {
    const t = Math.max(last, Math.min(1, ((left[i][0] - x0) * dx + (left[i][1] - y0) * dy) / len2));
    last = t;
    g.addColorStop(t, rgba(water, 0.75 * alpha(i)));
  }
  ctx.beginPath();
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = n; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  // 两岸各一道淡墨，一段一段画，跟着同样淡掉
  ctx.lineWidth = 0.8;
  for (const side of [left, right]) {
    for (let i = 1; i <= n; i++) {
      const a = alpha(i);
      if (a < 0.02) continue;
      ctx.strokeStyle = rgba(ink, 0.22 * a);
      ctx.beginPath();
      ctx.moveTo(side[i - 1][0], side[i - 1][1]);
      ctx.lineTo(side[i][0], side[i][1]);
      ctx.stroke();
    }
  }
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: RGB, leaves: [RGB, RGB], a: number, r: () => number) {
  const ht = (0.16 + r() * 0.14) * s;
  const lean = (r() - 0.5) * 0.3 * ht;
  const tx = x + lean, ty = y - ht * 0.82;

  ctx.strokeStyle = rgba(ink, 0.8 * a);
  ctx.lineWidth = Math.max(0.6, 0.011 * s);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - lean * 0.4, y - ht * 0.45, tx, ty);
  ctx.stroke();

  if (r() < 0.5) {
    // 松：一层层横着的墨块
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const cy = y - ht * (0.42 + 0.55 * u);
      const cx = x + lean * ((y - cy) / (ht * 0.82)) + (r() - 0.5) * ht * 0.08;
      const rx = ht * (0.3 - 0.17 * u) * (0.8 + r() * 0.4);
      // 每一层用几笔短促的墨点叠出来，边缘参差
      const dabs = 3 + Math.floor(r() * 3);
      for (let j = 0; j < dabs; j++) {
        const ox = ((j / (dabs - 1)) - 0.5) * rx * 1.4 + (r() - 0.5) * rx * 0.3;
        const rr = rx * (0.3 + r() * 0.25) * (1 - Math.abs(ox) / (rx * 1.6));
        ctx.fillStyle = rgba(mixc(leaves[1], ink, 0.25), (0.55 + r() * 0.3) * a);
        ellipsePath(ctx, cx + ox, cy + (r() - 0.5) * rx * 0.12 + Math.abs(ox) * 0.12, rr * 1.3, rr * 0.5);
        ctx.fill();
      }
    }
  } else {
    // 阔叶树：几团叠起来的淡墨
    const n = 5 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2, d = r() * ht * 0.2;
      ctx.fillStyle = rgba(leaves[i % 2], (0.45 + r() * 0.3) * a);
      ctx.beginPath();
      ctx.arc(tx + Math.cos(ang) * d * 1.3, ty + Math.sin(ang) * d * 0.8, ht * (0.12 + r() * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 点苔
  const dots = 3 + Math.floor(r() * 4);
  ctx.fillStyle = rgba(ink, 0.7 * a);
  for (let i = 0; i < dots; i++) {
    ctx.beginPath();
    ctx.arc(tx + (r() - 0.5) * ht * 0.5, ty + (r() - 0.3) * ht * 0.35, Math.max(0.4, 0.006 * s), 0, Math.PI * 2);
    ctx.fill();
  }
}

function tuft(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, c: RGB, a: number, r: () => number) {
  const n = 4 + Math.floor(r() * 4);
  ctx.strokeStyle = rgba(c, 0.6 * a);
  ctx.lineWidth = Math.max(0.5, 0.004 * s);
  for (let i = 0; i < n; i++) {
    const ang = (r() - 0.5) * 1.3, len = (0.025 + r() * 0.03) * s;
    const ex = x + Math.sin(ang) * len, ey = y - Math.cos(ang) * len;
    ctx.beginPath();
    ctx.moveTo(x + (r() - 0.5) * 0.01 * s, y);
    ctx.quadraticCurveTo(x + Math.sin(ang) * len * 0.3, y - len * 0.6, ex, ey);
    ctx.stroke();
  }
}

function cow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: RGB, a: number, r: () => number) {
  const dir = r() < 0.5 ? -1 : 1;
  const bw = 0.036 * s, bh = 0.016 * s, by = y - 0.03 * s;
  ctx.strokeStyle = rgba(ink, 0.8 * a);
  ctx.lineWidth = Math.max(0.5, 0.005 * s);
  for (const lx of [-0.7, -0.45, 0.45, 0.7]) {
    ctx.beginPath(); ctx.moveTo(x + lx * bw, by); ctx.lineTo(x + lx * bw, y); ctx.stroke();
  }
  ctx.fillStyle = rgba(ink, 0.82 * a);
  ellipsePath(ctx, x, by, bw, bh); ctx.fill();
  // 低头吃草或抬着头
  const grazing = r() < 0.6;
  const hx = x + dir * bw * 1.1, hy = grazing ? y - 0.008 * s : by - bh * 0.6;
  ctx.beginPath(); ctx.moveTo(x + dir * bw * 0.7, by - bh * 0.3); ctx.lineTo(hx, hy); ctx.stroke();
  ellipsePath(ctx, hx, hy, 0.009 * s, 0.006 * s); ctx.fill();
  ctx.lineWidth = Math.max(0.4, 0.003 * s);
  ctx.beginPath(); ctx.moveTo(x - dir * bw, by - bh * 0.2); ctx.lineTo(x - dir * bw * 1.25, by + bh * 1.1); ctx.stroke();
}

function sheep(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: RGB, wool: RGB, a: number, r: () => number) {
  const dir = r() < 0.5 ? -1 : 1;
  const bw = 0.02 * s, by = y - 0.018 * s;
  ctx.strokeStyle = rgba(ink, 0.7 * a);
  ctx.lineWidth = Math.max(0.5, 0.004 * s);
  for (const lx of [-0.5, 0.5]) {
    ctx.beginPath(); ctx.moveTo(x + lx * bw, by); ctx.lineTo(x + lx * bw, y); ctx.stroke();
  }
  // 几团白色的毛，外面一圈淡墨
  ctx.fillStyle = rgba(wool, 0.95 * a);
  ctx.beginPath();
  for (const [ox, oy, rr] of [[-0.5, 0.1, 0.55], [0, -0.2, 0.65], [0.5, 0.1, 0.55]]) {
    ctx.moveTo(x + ox * bw + rr * bw * 0.7, by + oy * bw);
    ctx.arc(x + ox * bw, by + oy * bw, rr * bw * 0.7, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.strokeStyle = rgba(ink, 0.35 * a);
  ctx.lineWidth = Math.max(0.4, 0.002 * s);
  ctx.stroke();
  ctx.fillStyle = rgba(ink, 0.85 * a);
  ellipsePath(ctx, x + dir * bw * 1.05, by - bw * 0.15, bw * 0.28, bw * 0.2);
  ctx.fill();
}

