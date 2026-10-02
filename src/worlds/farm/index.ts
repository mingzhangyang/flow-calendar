import type { World } from '../world';
import type { EventView, Frame } from '../../model/types';
import { DAY, MINUTE, fmtDay, fmtTime, isAllDay, localHours } from '../../model/time';
import { daylightAt } from '../../model/daylight';
import { type RGB, SANS, clamp, drawLabel, drawOrb, hashStr, mixc, mod, rgba, rng, smooth } from '../hike/paint';
import { type Sky, celestial, drawSky, nightAt, skyAt } from '../hike/sky';
import { type Look, AZURITE, INK, MALACHITE, OCHRE, SHELL_WHITE, SILK, VERMILION, lookAt, pigment } from '../hike/look';
import { drawSilk } from '../hike/silk';
import { Sprite } from '../hike/sprites';
import { ART as HIKE_ART } from '../hike/art';
import { ART as CLIMB_ART } from '../climb/art';
import { colorOf, subLabel } from '../climb';
import { ART } from './art';

/**
 * 农场世界：斜俯视一片田，把日历铺在地上。
 *
 * 一天是一块地，一周一行（周一到周日从左到右），往远处是以后的周，近处是过去的周。
 * 一块地里横向是这一天的钟点：6 点在左边、22 点在右边，夜里的日程挤在两头。
 *
 * 做过的事留在地里：日程占着的时段，地就翻成垄（叠在一起只算一次，全天日程不算），
 * 农夫在今天的地里从左往右走，忙时锄地。翻过的地过几天发芽、长成青苗，两周左右熟成金黄；
 * 没做事的日子，地只是空着，慢慢长草。还没到的日程是地头插的小旗。
 *
 * 透视：v 是往远处数的行数（一周一行），vc 是视角所在的位置，
 *   z = 1 + (v − vc) · s，屏幕 y = HZ + D / z，x 也按 1/z 往中间收。
 * 透视很缓（散点透视，像界画）：往后两个月的九行都排得下，再远就淡进雾里，
 * 远山坐在雾上（MZ），真正的地平线 HZ 在画面之外。
 * 视角随时间连续往前挪：一周走一行，所以这一周的那行总在画面中下部前后徘徊。
 */

/** 地里的一天从几点到几点（铺满一块地的宽） */
const DAY0 = 6, DAY1 = 22;
/** 田埂：每块地四边各让出多少 */
const RIDGE = 0.07;
/** 地块的进深和宽度之比（斜俯视压扁） */
const TILT = 0.7;
/** 往后排得下几行（两个月多一点） */
const AHEAD = 9.5;

interface Hit { id: string; x: number; y: number; w: number; h: number }
interface Box { x0: number; x1: number; y0: number; y1: number }
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** 本地小时数 → 第几天（本地午夜为界） */
const dayOf = (h: number) => Math.floor(h / 24);
/** 第几天 → 第几周、周几（0 是周一）。第 0 天（1970-01-01）是周四 */
const weekOf = (d: number) => Math.floor((d + 3) / 7);
const colOf = (d: number) => mod(d + 3, 7);

/** 一块地里，某个钟点在横向的位置（地的坐标，0–1 是一整块地连田埂） */
function uIn(hod: number): number {
  return RIDGE + ((clamp(hod, DAY0, DAY1) - DAY0) / (DAY1 - DAY0)) * (1 - 2 * RIDGE);
}

/** 一天里做过的事：翻过的地在横向占的几段（地的坐标，已合并） */
type Spans = [number, number][];

export class FarmWorld implements World {
  readonly id = 'farm';
  readonly name = '农场';

  private W = 0; private H = 0;
  private insetTop = 0; private insetBottom = 0;
  /** 透视的地平线（多半在画面之外）、“视角所在”那一行的屏幕高度，以及两者之差 */
  private HZ = 0; private FY = 0; private D = 0;
  /** 雾线：远处的田淡进雾里，远山坐在这里 */
  private MZ = 0;
  /** 在 z = 1 处一块地有多宽（像素），以及每往远处一行 z 增加多少 */
  private Fx = 0; private s = 0;
  /** 视角所在的行（连续） */
  private vc = 0;
  private hits: Hit[] = [];
  /** 每天翻过的地（这一帧算的） */
  private tilled = new Map<number, Spans>();

  private art: {
    bare: Sprite; till: Sprite; walk: Sprite; hoe: Sprite; rest: Sprite;
    trees: Sprite[]; clouds: Sprite[]; ranges: Sprite[];
  };

  constructor(invalidate: () => void) {
    const s = (a: { url: string; w: number; h: number; peak: number; ax: number }) => new Sprite(a, invalidate);
    this.art = {
      bare: s(ART.plotBare),
      till: s(ART.plotTilled),
      walk: s(ART.farmerWalk1),
      hoe: s(ART.farmerHoe1),
      // 还没有农夫坐着的图，先借登山的人歇脚的那张（同样斗笠、石青衣）
      rest: s(CLIMB_ART.climberRest1),
      trees: [HIKE_ART.treeWillow1, HIKE_ART.treeWillow1, HIKE_ART.treeBroad1].map(s),
      clouds: [HIKE_ART.cloud1, HIKE_ART.cloud2].map(s),
      ranges: [HIKE_ART.rangeFar, HIKE_ART.rangeMid].map(s),
    };
  }

  resize(w: number, h: number, insets: { top: number; bottom: number }) {
    this.W = w; this.H = h;
    this.insetTop = insets.top; this.insetBottom = insets.bottom;
    this.MZ = h * 0.3;
    this.FY = h * 0.68;
    // 一周七块地铺满屏宽；桌面上不至于太大
    this.Fx = Math.min((w * 0.9) / 7, h * 0.075);
    // 眼前一行高 row0，往后 AHEAD 行占掉雾线以下八成的高度：
    // 前 n 行一共高 n·row0 / (1 + n·s)，由此定 s；地方宽裕时几乎是平行的
    const row0 = TILT * this.Fx, room = 0.8 * (this.FY - this.MZ);
    this.s = clamp(((AHEAD * row0) / room - 1) / AHEAD, 0.02, 0.2);
    this.D = row0 / this.s;
    this.HZ = this.FY - this.D;
  }

  /* ---------- 坐标 ---------- */

  private zAt(v: number) { return 1 + (v - this.vc) * this.s; }
  private xAt(u: number, z: number) { return this.W / 2 + (u - 3.5) * (this.Fx / z); }
  private yAt(z: number) { return this.HZ + this.D / z; }
  private P(u: number, v: number): [number, number] {
    const z = this.zAt(v);
    return [this.xAt(u, z), this.yAt(z)];
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame) {
    const { W, H } = this;
    const T = localHours(f.view), nowH = localHours(f.now);
    // 视角所在的行：一周一行，往前连续地挪；这一周的那行在“视角”线上下半行内徘徊
    this.vc = (T / 24 + 3) / 7 - 0.5;
    this.tilled = tillage(f.events, nowH);

    const hod = mod(T, 24);
    const sky = skyAt(hod), night = nightAt(hod);
    const look = lookAt(sky, daylightAt(f.view));

    ctx.fillStyle = rgba(sky.bot, 1);
    ctx.fillRect(0, 0, W, H);
    drawSky(ctx, W, this.MZ, sky, night, celestial(hod, W, H, this.MZ, night));
    this.drawSkyClouds(ctx, T, look);
    this.drawRanges(ctx, sky, look);
    this.drawFields(ctx, nowH, sky, look);
    drawSilk(ctx, W, H, look);
    this.drawDayNumbers(ctx, nowH, look);
    this.hits = [];
    const reserved = this.drawFarmer(ctx, f, nowH, look);
    this.drawStakes(ctx, f.events, T, look, reserved);
  }

  dragHours(_x: number, y: number, _dx: number, dy: number): number {
    // 让手指下的那块地跟着手指走：y = HZ + D/z，z = 1 + (v − vc)s，
    // 所以 dvc = dy · z² / (D·s)。离地平线太近时封顶，免得一下跳出好几个月。
    const z = this.D / Math.max(this.D * 0.3, y - this.HZ);
    return ((dy * z * z) / (this.D * this.s)) * 7 * 24;
  }

  hitTest(x: number, y: number): string | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (Math.abs(x - h.x) <= h.w / 2 && y <= h.y + 8 && y >= h.y - h.h) return h.id;
    }
    return null;
  }

  isAnimating() { return false; }

  idleRedrawMs() {
    // 农夫一小时只在地里挪几个像素，按分钟重画就够了
    return 60_000;
  }

  describe(f: Frame): string {
    const nowH = localHours(f.now);
    const d0 = dayOf(nowH) - colOf(dayOf(nowH));
    let hours = 0;
    for (let d = d0; d <= dayOf(nowH); d++) {
      for (const [a, b] of this.tilled.get(d) ?? []) hours += ((b - a) / (1 - 2 * RIDGE)) * (DAY1 - DAY0);
    }
    return `一天是一块地，一周一行，往远处是以后的日子。这周已经翻了约 ${Math.round(hours)} 小时的地。`
      + '做过的事翻成垄，过几天长出庄稼；没做事的日子，地空着长草。';
  }

  /* ---------- 远处 ---------- */

  /** 地平线上的远山：远足的两层远山，钉在屏幕上不动 */
  private drawRanges(ctx: CanvasRenderingContext2D, sky: Sky, look: Look) {
    const { W, H, MZ } = this;
    const [far, mid] = this.art.ranges;
    if (far.ready && mid.ready) {
      ([[far, 0.1, 0.4], [mid, 0.07, 0.25]] as const).forEach(([s, peak, mist]) => {
        const h = Math.max((H * peak) / s.info.peak, W / s.aspect);
        const w = h * s.aspect;
        s.draw(ctx, W / 2 - w / 2, MZ - h, w, h, look, mist, 0.8);
      });
    }
    // 雾线以下先铺一层绢色的地
    ctx.fillStyle = rgba(pigment(mixc(SILK, sky.bot, 0.4), look), 1);
    ctx.fillRect(0, MZ, W, H - MZ);
  }

  /** 天上两朵云，随视角时间缓缓飘 */
  private drawSkyClouds(ctx: CanvasRenderingContext2D, T: number, look: Look) {
    const { W, H } = this;
    if (!this.art.clouds.every(c => c.ready)) return;
    const r = rng(53);
    for (let i = 0; i < 2; i++) {
      const s = this.art.clouds[i % 2];
      const w = Math.min(W * (0.4 + r() * 0.3), H * 0.4), h = w / s.aspect;
      const span = W + w;
      const x = mod(r() * span + T * (0.012 + r() * 0.015) * W, span) - w;
      const y = H * (0.1 + r() * 0.12);
      s.draw(ctx, x, y - h / 2, w, h, look, 0.08, 0, { alpha: 0.4 + 0.6 * look.daylight, flip: r() < 0.5 });
    }
  }

  /* ---------- 田 ---------- */

  /** 从远到近一行一行画：田埂和两边的草地、七块地、地头的树 */
  private drawFields(ctx: CanvasRenderingContext2D, nowH: number, sky: Sky, look: Look) {
    const { W, H, HZ, MZ, D, s } = this;
    // 远处画到雾线，近处画到屏幕底边
    const wFar = Math.ceil(this.vc + (D / (MZ - HZ) - 1) / s);
    const wNear = Math.floor(this.vc + (D / (H - HZ + 20) - 1) / s);
    const today = dayOf(nowH);
    const haze = mixc(sky.bot, SHELL_WHITE, 0.2 * look.daylight);
    const meadow = pigment(mixc(MALACHITE, OCHRE, 0.3), look);
    const soil = pigment(mixc(SILK, OCHRE, 0.55), look);
    const line = pigment(mixc(INK, OCHRE, 0.4), look);
    const dpr = ctx.getTransform().a || 1;

    ctx.save();
    ctx.beginPath(); ctx.rect(0, MZ, W, H - MZ); ctx.clip();
    // 草地：贴着田铺开，往两边淡成绢底（一整块画，边上不起台阶）
    const g = ctx.createLinearGradient(this.xAt(-1.8, 1), 0, this.xAt(8.8, 1), 0);
    g.addColorStop(0, rgba(meadow, 0));
    g.addColorStop(0.14, rgba(meadow, 0.6));
    g.addColorStop(0.86, rgba(meadow, 0.6));
    g.addColorStop(1, rgba(meadow, 0));
    ctx.fillStyle = g;
    this.quad(ctx, -1.8, 8.8, wNear, wFar + 1);
    ctx.fill();
    for (let w = wFar; w >= wNear; w--) {
      const z0 = this.zAt(w), z1 = this.zAt(w + 1);
      if (z0 <= 0.05) continue;
      const y0 = this.yAt(z0), y1 = this.yAt(z1);
      const rowPx = y0 - y1;
      // 越远越淡进雾里
      const mist = this.mistAt((y0 + y1) / 2);

      for (let col = 0; col < 7; col++) {
        const d = 7 * w - 3 + col;
        const pu0 = col + RIDGE, pu1 = col + 1 - RIDGE, pv0 = w + RIDGE, pv1 = w + 1 - RIDGE;
        const spans = d <= today ? this.tilled.get(d) : undefined;
        if (rowPx < 4) {
          // 太远了，只剩一块颜色
          ctx.fillStyle = rgba(mixc(soil, haze, mist), 1);
          this.quad(ctx, pu0, pu1, pv0, pv1);
          ctx.fill();
          continue;
        }
        const need = ((pu1 - pu0) * this.Fx * dpr) / z0;
        const bare = this.art.bare.litLevel(look, need);
        ctx.fillStyle = rgba(soil, 1);
        this.quad(ctx, pu0, pu1, pv0, pv1);
        ctx.fill();
        if (bare) this.texQuad(ctx, bare, col, pu0, pu1, pv0, pv1, 0.5);
        // 翻过的地
        const till = spans?.length ? this.art.till.litLevel(look, need) : null;
        if (spans) {
          for (const [a, b] of spans) {
            if (till) this.texQuad(ctx, till, col, col + a, col + b, pv0, pv1, 0.9);
            else {
              ctx.fillStyle = rgba(pigment(mixc(OCHRE, INK, 0.3), look), 0.8);
              this.quad(ctx, col + a, col + b, pv0, pv1);
              ctx.fill();
            }
          }
        }
        // 过去的日子：翻过的地长庄稼，空着的地长草
        const age = (nowH - (d + 1) * 24) / 24;
        if (age > 0 && rowPx >= 9) {
          if (spans?.length) this.drawCrops(ctx, col, w, spans, age, rowPx, look);
          this.drawGrass(ctx, d, col, w, spans ?? [], age, rowPx, look);
        }
        // 墨线勾一下地的边，雾里淡掉
        ctx.strokeStyle = rgba(line, 0.35 * (1 - mist));
        ctx.lineWidth = clamp(rowPx * 0.02, 0.5, 1.2);
        this.quad(ctx, pu0, pu1, pv0, pv1);
        ctx.stroke();
        if (mist > 0.01) {
          ctx.fillStyle = rgba(haze, 0.85 * mist);
          ctx.fill();
        }
      }
      if (rowPx >= 6) this.drawTrees(ctx, w, mist, look);
    }
    ctx.restore();

    // 雾线上的雾，远处的田淡进去
    const fog = ctx.createLinearGradient(0, MZ - 6, 0, MZ + H * 0.08);
    fog.addColorStop(0, rgba(haze, 1));
    fog.addColorStop(1, rgba(haze, 0));
    ctx.fillStyle = fog;
    ctx.fillRect(0, MZ - 6, W, H * 0.08 + 6);
    // 更早以前（近处、画面下方）渐渐淡成留白
    const blank = pigment(mixc(SILK, sky.bot, 0.5), look);
    const y0 = this.FY + H * 0.1;
    const past = ctx.createLinearGradient(0, y0, 0, H);
    past.addColorStop(0, rgba(blank, 0));
    past.addColorStop(1, rgba(blank, 0.85));
    ctx.fillStyle = past;
    ctx.fillRect(0, y0, W, H - y0);
  }

  /** 屏幕高度 y 处被雾吞掉多少：眼前的几行清楚，往雾线越来越淡 */
  private mistAt(y: number) {
    return smooth(this.FY - (this.FY - this.MZ) * 0.3, this.MZ + 4, y);
  }

  /** 地上 u0–u1、v0–v1 这一块的轮廓（透视下是梯形） */
  private quad(ctx: CanvasRenderingContext2D, u0: number, u1: number, v0: number, v1: number) {
    const a = this.P(u0, v0), b = this.P(u1, v0), c = this.P(u1, v1), d = this.P(u0, v1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
    ctx.closePath();
  }

  /**
   * 把正俯视的地块贴图贴到透视下的梯形上：按进深切成几条，每条各自缩放，
   * 远处的垄自然挤紧。贴图跟着整块地走（第 col 块地占满一张图），翻了一半的地只露出那一截。
   */
  private texQuad(
    ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, col: number,
    u0: number, u1: number, v0: number, v1: number, alpha: number,
  ) {
    const iw = img.width, ih = img.height;
    const pu0 = col + RIDGE, span = 1 - 2 * RIDGE;
    const sx0 = ((u0 - pu0) / span) * iw, sw = ((u1 - u0) / span) * iw;
    if (sw <= 0.5) return;
    const y0 = this.yAt(this.zAt(v0)), y1 = this.yAt(this.zAt(v1));
    const n = clamp(Math.round((y0 - y1) / 5), 1, 12);
    ctx.save();
    this.quad(ctx, u0, u1, v0, v1);
    ctx.clip();
    ctx.globalAlpha = alpha;
    for (let k = 0; k < n; k++) {
      const va = v0 + ((v1 - v0) * k) / n, vb = v0 + ((v1 - v0) * (k + 1)) / n;
      const za = this.zAt(va), zb = this.zAt(vb);
      const ya = this.yAt(za), yb = this.yAt(zb);
      const xl = Math.min(this.xAt(u0, za), this.xAt(u0, zb)), xr = Math.max(this.xAt(u1, za), this.xAt(u1, zb));
      // 图的上沿是地的远边
      const sy = (1 - (k + 1) / n) * ih;
      ctx.drawImage(img, sx0, sy, sw, ih / n, xl, yb - 0.5, xr - xl, ya - yb + 1);
    }
    ctx.restore();
  }

  /**
   * 翻过的地上长庄稼：头一天是撒下的种子，两三天后冒芽，一周左右是青苗，
   * 两周左右熟成金黄。一垄一垄地长，跟着垄的方向。
   */
  private drawCrops(ctx: CanvasRenderingContext2D, col: number, w: number, spans: Spans, age: number, rowPx: number, look: Look) {
    const pv0 = w + RIDGE, pv1 = w + 1 - RIDGE;
    const ROWS = 5, STEP = 1 / 15;
    const grow = smooth(1, 8, age), ripe = smooth(7, 15, age);
    const green = pigment(mixc(MALACHITE, AZURITE, 0.15), look);
    const gold = pigment([196, 158, 72], look);
    ctx.save();
    ctx.lineCap = 'round';
    if (grow < 0.05) {
      // 种子：垄上一排小点
      ctx.fillStyle = rgba(pigment(mixc(OCHRE, SHELL_WHITE, 0.55), look), 0.8);
      for (let j = 0; j < ROWS; j++) {
        const v = pv0 + ((j + 0.5) / ROWS) * (pv1 - pv0);
        for (const [a, b] of spans) {
          for (let u = col + a + STEP / 2; u < col + b; u += STEP) {
            const [x, y] = this.P(u, v);
            ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
          }
        }
      }
      ctx.restore();
      return;
    }
    const tall = rowPx * (0.05 + 0.15 * grow);
    ctx.strokeStyle = rgba(mixc(green, gold, ripe), 0.8);
    ctx.lineWidth = clamp(rowPx * 0.02, 0.6, 1.3);
    ctx.beginPath();
    for (let j = 0; j < ROWS; j++) {
      const v = pv0 + ((j + 0.5) / ROWS) * (pv1 - pv0);
      const k = this.zAt(pv0) / this.zAt(v);
      for (const [a, b] of spans) {
        for (let u = col + a + (j % 2 ? STEP * 0.9 : STEP * 0.4); u < col + b; u += STEP) {
          const [x, y] = this.P(u, v);
          const h = tall * k * (0.8 + 0.4 * jitter(u * 31 + j));
          // 一株：中间一笔，长高了两边再各一笔叶子
          ctx.moveTo(x, y); ctx.lineTo(x + h * 0.08, y - h);
          if (grow > 0.4) {
            ctx.moveTo(x, y - h * 0.3); ctx.lineTo(x - h * 0.35, y - h * 0.75);
            ctx.moveTo(x, y - h * 0.35); ctx.lineTo(x + h * 0.4, y - h * 0.7);
          }
        }
      }
    }
    ctx.stroke();
    // 熟了：穗头一点泥金
    if (ripe > 0.3) {
      ctx.fillStyle = rgba(gold, ripe);
      for (let j = 0; j < ROWS; j++) {
        const v = pv0 + ((j + 0.5) / ROWS) * (pv1 - pv0);
        const k = this.zAt(pv0) / this.zAt(v);
        for (const [a, b] of spans) {
          for (let u = col + a + (j % 2 ? STEP * 0.9 : STEP * 0.4); u < col + b; u += STEP) {
            const [x, y] = this.P(u, v);
            const h = tall * k * (0.8 + 0.4 * jitter(u * 31 + j));
            const r = Math.max(0.7, rowPx * 0.03);
            ctx.beginPath(); ctx.ellipse(x + h * 0.08, y - h, r * 0.7, r * 1.3, 0.2, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  }

  /** 没翻过的地，日子过去后慢慢长草：一丛一丛，越久越密 */
  private drawGrass(ctx: CanvasRenderingContext2D, d: number, col: number, w: number, spans: Spans, age: number, rowPx: number, look: Look) {
    const dense = smooth(0, 6, age);
    const n = Math.round(18 * dense);
    if (!n) return;
    const r = rng(d * 13 + 1);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(pigment(mixc(MALACHITE, OCHRE, 0.25), look), 0.75);
    ctx.lineWidth = clamp(rowPx * 0.02, 0.6, 1.3);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = RIDGE + r() * (1 - 2 * RIDGE), v = w + RIDGE + 0.05 + r() * (0.9 - 2 * RIDGE);
      const big = r();
      if (spans.some(([s0, s1]) => a > s0 - 0.03 && a < s1 + 0.03)) continue;
      const [x, y] = this.P(col + a, v);
      const h = rowPx * (0.06 + 0.1 * big) * (0.5 + 0.5 * dense) * (this.zAt(w) / this.zAt(v));
      ctx.moveTo(x, y); ctx.lineTo(x - h * 0.4, y - h * 0.8);
      ctx.moveTo(x, y); ctx.lineTo(x + h * 0.05, y - h);
      ctx.moveTo(x, y); ctx.lineTo(x + h * 0.45, y - h * 0.75);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 田两边稀稀落落几棵树，多是柳；钉在行上，跟着拖动走 */
  private drawTrees(ctx: CanvasRenderingContext2D, w: number, mist: number, look: Look) {
    const r = rng(w * 31 + 7);
    for (const side of [-1, 1]) {
      if (r() > 0.4) { r(); r(); r(); continue; }
      const u = side < 0 ? -0.2 - r() * 0.7 : 7.2 + r() * 0.7;
      const v = w + r();
      const s = this.art.trees[Math.floor(r() * this.art.trees.length)];
      if (!s.ready) continue;
      const z = this.zAt(v);
      if (z <= 0.05) continue;
      const [x, y] = this.P(u, v);
      const h = (this.Fx / z) * (1 + 0.3 * jitter(w * 7 + side));
      if (x < -h || x > this.W + h) continue;
      s.drawSmall(ctx, x, y, h, look, 1 - 0.85 * mist, side > 0);
    }
  }

  /* ---------- 地上的字 ---------- */

  /** 每块地左下角写日子：今天用朱砂；每月一号写月份 */
  private drawDayNumbers(ctx: CanvasRenderingContext2D, nowH: number, look: Look) {
    const { D, s, H, HZ, MZ } = this;
    const today = dayOf(nowH);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = look.halo;
    ctx.shadowBlur = 4;
    const wTop = Math.ceil(this.vc + (D / (MZ - HZ) - 1) / s);
    const wBottom = Math.floor(this.vc + (D / (H - HZ + 20) - 1) / s);
    for (let w = wTop; w >= wBottom; w--) {
      const z0 = this.zAt(w);
      if (z0 <= 0.05) break;
      const rowPx = (D * s) / (z0 * this.zAt(w + 1));
      const mist = this.mistAt(this.yAt(z0));
      if (rowPx < 14 || mist > 0.95) continue;
      const size = clamp(rowPx * 0.26, 9, 13);
      for (let col = 0; col < 7; col++) {
        const d = 7 * w - 3 + col;
        const [x, y] = this.P(col + RIDGE + 0.04, w + RIDGE + 0.04);
        if (y > H + 10) continue;
        const date = new Date(noonOf(d));
        const isToday = d === today;
        const text = date.getDate() === 1 ? `${date.getMonth() + 1}月` : String(date.getDate());
        ctx.font = `${isToday || date.getDate() === 1 ? 600 : 500} ${size}px ${SANS}`;
        const c: RGB = isToday ? look.now : look.mark;
        // 更早以前的跟着地一起淡成留白（同 drawFields 最后那层）
        const old = 1 - 0.85 * smooth(this.FY + H * 0.1, H, y);
        ctx.fillStyle = rgba(c, (isToday ? 1 : 0.7) * (1 - mist) * old);
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();
  }

  /* ---------- 农夫 ---------- */

  /** 农夫在今天的地里，横向随钟点走；返回他和头顶文字占掉的地方 */
  private drawFarmer(ctx: CanvasRenderingContext2D, f: Frame, nowH: number, look: Look): Box[] {
    const { W, H } = this;
    const d = dayOf(nowH), hod = nowH - d * 24;
    const w = weekOf(d), col = colOf(d);
    const v = w + 0.42;
    const z = this.zAt(v);
    if (z <= 0.05) return [];
    const [x, y] = this.P(col + uIn(hod), v);
    if (x < -40 || x > W + 40 || y > H - this.insetBottom + 20 || y < this.MZ) return [];
    const live = f.events.find(e => e.state === 'live' && !isAllDay(e.start, e.end));
    const night = (hod >= DAY1 || hod < DAY0) && !live;
    const ch = clamp((this.Fx / z) * 0.85, 24, 72);
    const s = night ? this.art.rest : live ? this.art.hoe : this.art.walk;
    if (s.ready) {
      s.drawSmall(ctx, x, y, s === this.art.walk ? ch : ch * 0.85, look, 1, false);
    } else {
      ctx.fillStyle = rgba(pigment(AZURITE, look), 1);
      ctx.beginPath(); ctx.ellipse(x, y - ch * 0.4, ch * 0.15, ch * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    }

    // 头顶两行字：“现在”和钟点；忙着的时候换成日程的名字和还要准备几项
    const title = live ? `现在 · ${live.title}` : '现在';
    const sub = live ? subLabel(live) : `${fmtDay(f.now)} ${fmtTime(f.now)}`;
    const ty = Math.max(this.insetTop + 84, y - ch - 8);
    ctx.save();
    ctx.shadowColor = look.halo; ctx.shadowBlur = 6;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = `600 13px ${SANS}`;
    const w1 = ctx.measureText(title).width;
    ctx.font = `500 12px ${SANS}`;
    const w2 = ctx.measureText(sub).width;
    const half = Math.max(w1, w2) / 2 + 4;
    const tx = clamp(x, half + 4, W - half - 4);
    ctx.font = `600 13px ${SANS}`;
    ctx.fillStyle = rgba(look.now, 1);
    ctx.fillText(title, tx, ty - 16);
    ctx.font = `500 12px ${SANS}`;
    ctx.fillStyle = rgba(look.now, 0.75);
    ctx.fillText(sub, tx, ty);
    ctx.restore();
    return [
      { x0: tx - half, x1: tx + half, y0: ty - 34, y1: ty + 2 },
      { x0: x - ch * 0.5, x1: x + ch * 0.5, y0: y - ch, y1: y + 4 },
    ];
  }

  /* ---------- 日程 ---------- */

  /**
   * 还没做的日程是地头插的小旗（在地的远边，按开始的钟点排开），进行中的旗外勾一圈朱砂；
   * 做完的只在地的近边留一点颜色，写了结论的留得深、钤一方小朱印。
   */
  private drawStakes(ctx: CanvasRenderingContext2D, events: EventView[], T: number, look: Look, reserved: Box[]) {
    const { W, H, D, s } = this;
    const dark = 1 - look.daylight;
    const line = mixc(pigment(INK, look), mixc(SHELL_WHITE, look.tint, 0.3), dark);
    const shadow = pigment(mixc(OCHRE, INK, 0.6), look);
    const red = mixc(pigment(VERMILION, look), [255, 200, 170], 0.45 * dark);
    const vLo = this.vc + (D / (H - this.HZ + 20) - 1) / s;
    const vHi = this.vc + (D / (this.MZ - this.HZ) - 1) / s;

    type Item = { ev: EventView; h: number; x: number; y: number; top: number; z: number };
    const items: Item[] = [];
    // 同一天里挨得太近的旗往近处错开一点，免得叠成一根
    const lanes = new Map<string, [number, number][]>();
    for (const ev of events) {
      const sH = localHours(ev.start);
      const allDay = isAllDay(ev.start, ev.end);
      const d = dayOf(sH);
      const w = weekOf(d);
      if (w + 1 < vLo || w > vHi) continue;
      const hod = allDay ? 13 : sH - d * 24;
      const u = colOf(d) + uIn(hod);
      const ended = ev.state === 'ended';
      const key = `${d}|${ended ? 1 : 0}`;
      const used = lanes.get(key) ?? [];
      let lane = 0;
      while (lane < 2 && used.some(([pu, pl]) => pl === lane && Math.abs(pu - u) < 0.12)) lane++;
      used.push([u, lane]);
      lanes.set(key, used);
      // 小旗插在地的远边；做完的那一点落在地中间
      const v = ended ? w + 0.42 + lane * 0.16 : w + 1 - RIDGE - 0.1 - lane * 0.16;
      const z = this.zAt(v);
      if (z <= 0.05) continue;
      const [x, y] = this.P(u, v);
      if (x < -20 || x > W + 20 || y > H + 20) continue;
      items.push({ ev, h: allDay ? d * 24 + 13 : sH, x, y, top: y, z });
    }
    // 远的先画
    items.sort((a, b) => b.z - a.z);

    const labels: Item[] = [];
    for (const it of items) {
      const { ev, x, y, z } = it;
      const mist = this.mistAt(y);
      const raw = colorOf(ev.title);
      const fill = mixc(pigment(raw, look), raw, 0.4 * dark);
      const paint = { fill, pale: SHELL_WHITE, line, lineA: 0.75 - 0.2 * dark, shadow, seed: hashStr(ev.id) };
      const size = this.Fx / z;
      if (ev.state === 'ended') {
        const r = clamp(size * 0.04, 1.2, 3);
        const cy = drawOrb(ctx, { x, wy: y, z: 1, r }, paint, (ev.outcome ? 0.95 : 0.5) * (1 - 0.7 * mist));
        if (ev.outcome && r > 2) {
          const q = Math.max(2.5, r * 0.9);
          ctx.fillStyle = rgba(red, 0.9);
          ctx.fillRect(x + r * 0.9, cy - r * 1.6, q, q);
        }
        it.top = cy - r;
        this.hits.push({ id: ev.id, x, y: y + 2, w: Math.max(r * 4, 24), h: Math.max(r * 4, 24) });
      } else {
        // 木桩挑一面小旗，旗是日程的颜色；一周以后的只剩地头一点颜色，越往后地越安静
        const ph = clamp(size * 0.36, 3, 34) * (1 - 0.8 * smooth(5 * 24, 8 * 24, it.h - T));
        const a = 1 - 0.75 * mist;
        if (ph < 7) {
          ctx.fillStyle = rgba(fill, a);
          ctx.beginPath(); ctx.arc(x, y - ph, Math.max(1, ph * 0.3), 0, Math.PI * 2); ctx.fill();
          it.top = y - ph - 2;
        } else {
          ctx.strokeStyle = rgba(line, 0.75 * a);
          ctx.lineWidth = clamp(ph * 0.04, 0.8, 1.4);
          ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x, y - ph); ctx.stroke();
          const fw = ph * 0.5, fh = ph * 0.34, ft = y - ph;
          ctx.beginPath();
          ctx.moveTo(x, ft);
          ctx.quadraticCurveTo(x + fw * 0.5, ft + fh * 0.1, x + fw, ft + fh * 0.45);
          ctx.quadraticCurveTo(x + fw * 0.5, ft + fh * 0.7, x, ft + fh);
          ctx.closePath();
          ctx.fillStyle = rgba(fill, a);
          ctx.fill();
          ctx.lineWidth = clamp(ph * 0.03, 0.6, 1);
          ctx.stroke();
          if (ev.state === 'live') {
            ctx.strokeStyle = rgba(red, 0.85);
            ctx.lineWidth = clamp(ph * 0.05, 1, 2);
            ctx.beginPath(); ctx.arc(x + fw * 0.35, ft + fh * 0.5, fw * 0.85, 0, Math.PI * 2); ctx.stroke();
          }
          it.top = ft - 3;
        }
        this.hits.push({ id: ev.id, x: x + ph * 0.2, y: y + 2, w: Math.max(ph, 24), h: Math.max(ph + 6, 26) });
      }
      // 只给视角前后一天半里的写字；进行中的写在农夫头顶
      if (ev.state !== 'live' && Math.abs(it.h - T) < 36 && mist < 0.3) labels.push(it);
    }

    // 标签：离视角近的优先，最多两个，彼此不重叠，也不压住农夫
    labels.sort((a, b) => Math.abs(a.h - T) - Math.abs(b.h - T));
    const taken = [...reserved];
    let shown = 0;
    for (const it of labels) {
      if (shown >= 2) break;
      const { ev, x } = it;
      const sub = subLabel(ev);
      ctx.font = `600 12px ${SANS}`;
      let half = ctx.measureText(ev.title).width / 2;
      ctx.font = `500 10.5px ${SANS}`;
      half = Math.max(half, ctx.measureText(sub).width / 2) + 4;
      const lx = clamp(x, half + 4, W - half - 4);
      const box: Box = { x0: lx - half, x1: lx + half, y0: it.top - 32, y1: it.top + 2 };
      if (box.y0 < this.insetTop + 52 || box.y1 > H - this.insetBottom - 60) continue;
      if (taken.some(b => overlaps(b, box))) continue;
      taken.push(box);
      shown++;
      drawLabel(ctx, lx, it.top, ev.title, sub, ev.state === 'ended' ? 0.7 : 1, look);
    }
  }
}

/**
 * 每天翻过的地：日程占着、而且已经过去的时段（到 nowH 为止），换成地里横向的几段。
 * 叠在一起的只算一次；全天日程不算；跨午夜的拆到两天里。
 */
function tillage(events: EventView[], nowH: number): Map<number, Spans> {
  const raw = new Map<number, Spans>();
  for (const ev of events) {
    if (isAllDay(ev.start, ev.end)) continue;
    const s = localHours(ev.start), e = Math.min(localHours(ev.end), nowH);
    if (e <= s) continue;
    for (let d = dayOf(s); d * 24 < e; d++) {
      const a = uIn(Math.max(s, d * 24) - d * 24), b = uIn(Math.min(e, (d + 1) * 24) - d * 24);
      if (b - a < 1e-3) continue;
      let list = raw.get(d);
      if (!list) raw.set(d, (list = []));
      list.push([a, b]);
    }
  }
  for (const [d, list] of raw) {
    list.sort((p, q) => p[0] - q[0]);
    const merged: Spans = [];
    for (const [a, b] of list) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    raw.set(d, merged);
  }
  return raw;
}

/** 第 d 天的中午（毫秒），用来取日期 */
function noonOf(d: number): number {
  const guess = d * DAY + 12 * 3_600_000;
  return guess + new Date(guess).getTimezoneOffset() * MINUTE;
}

/** 0–1 的固定随机数 */
function jitter(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
