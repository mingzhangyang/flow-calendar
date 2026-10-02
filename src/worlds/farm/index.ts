import type { World } from '../world';
import type { EventView, Frame } from '../../model/types';
import { DAY, HOUR, MINUTE, fmtDay, fmtTime, isAllDay, localHours } from '../../model/time';
import { daylightAt } from '../../model/daylight';
import { type RGB, SANS, clamp, hashStr, mixc, mod, rgba, rng, smooth } from '../hike/paint';
import { subLabel } from '../climb';

/**
 * 农场世界：农民画。把日历铺在地上，从上往下看，拼成一块块彩色的格子。
 *
 * 一天是一块地，一周一行（周一到周日从左到右），往上是以后的周，往下是过去的周。
 * 一块地里横向是这一天的钟点：6 点在左边、22 点在右边，夜里的日程挤在两头。
 *
 * 做过的事留在地里：日程占着、已经过去的时段翻成垄（叠在一起只算一次，全天日程不算），
 * 过几天冒芽、长成青苗，两周左右熟成金黄；没做事的日子，地空着长草开花。
 * 还没到的日程是插在地里的小旗。农夫在今天的地里随钟点走，忙时锄地，夜里回家坐在门口。
 *
 * 画风：户县农民画——大块饱和的平涂、粗墨线、满纹样，不讲透视。
 * 上面一条天（日月、卷云、圆圆的小山），下面一条村子（红瓦房、粮仓、树、鸡），都钉在屏幕上；
 * 田在两者之间上下滑动：视角随时间连续往前挪，一周一行，这一周那行总在“视角”线上下半行内。
 * 明暗跟着视角所在的时间：白天和夜里各一套颜色，按白天程度混合；早晚天空染橙红。
 */

/** 地里的一天从几点到几点（铺满一块地的宽） */
const DAY0 = 6, DAY1 = 22;
/** 一行的高和一块地的宽之比 */
const ROW_K = 1.1;

/* ---------- 颜色 ---------- */

interface Pal {
  grass: RGB; dot: RGB; bare: RGB; soil: RGB; furrow: RGB; seed: RGB;
  young: RGB; leaf: RGB; ripen: RGB; ripe: RGB; ear: RGB; fallow: RGB; weed: RGB;
  ink: RGB; badge: RGB; red: RGB; yellow: RGB; hill: RGB; hill2: RGB; hillDot: RGB;
  path: RGB; wall: RGB; roof: RGB; roofLine: RGB; window: RGB; door: RGB; trunk: RGB; crown: RGB;
}
const DAY_PAL: Pal = {
  grass: [47, 163, 74], dot: [126, 211, 106], bare: [244, 195, 142], soil: [140, 52, 23], furrow: [247, 197, 49],
  seed: [255, 244, 218], young: [30, 154, 73], leaf: [155, 227, 111], ripen: [185, 194, 30], ripe: [248, 198, 25],
  ear: [232, 84, 27], fallow: [166, 217, 106], weed: [61, 143, 56], ink: [36, 20, 12], badge: [255, 248, 232],
  red: [227, 38, 30], yellow: [247, 197, 49], hill: [36, 140, 66], hill2: [92, 182, 74], hillDot: [190, 236, 120],
  path: [240, 206, 150], wall: [255, 248, 232], roof: [217, 48, 31], roofLine: [140, 30, 16], window: [42, 79, 158],
  door: [140, 52, 23], trunk: [140, 52, 23], crown: [30, 138, 67],
};
/** 夜里：还是那几种颜色，整体压暗，窗子亮起来 */
const NIGHT_PAL: Pal = {
  grass: [24, 92, 52], dot: [52, 132, 76], bare: [168, 120, 82], soil: [86, 34, 18], furrow: [196, 150, 52],
  seed: [214, 200, 172], young: [26, 112, 62], leaf: [112, 176, 92], ripen: [140, 146, 40], ripe: [204, 160, 36],
  ear: [196, 86, 40], fallow: [86, 140, 72], weed: [36, 92, 44], ink: [14, 10, 8], badge: [228, 220, 200],
  red: [220, 70, 56], yellow: [246, 212, 96], hill: [22, 78, 52], hill2: [40, 104, 62], hillDot: [80, 146, 88],
  path: [120, 100, 82], wall: [176, 170, 160], roof: [150, 44, 34], roofLine: [90, 24, 16], window: [255, 214, 90],
  door: [86, 34, 18], trunk: [86, 34, 18], crown: [20, 92, 52],
};
function palAt(daylight: number): Pal {
  const out = {} as Record<keyof Pal, RGB>;
  for (const k of Object.keys(DAY_PAL) as (keyof Pal)[]) out[k] = mixc(NIGHT_PAL[k], DAY_PAL[k], daylight);
  return out;
}
/** 日程的颜色：大红、钴蓝、明黄、桃红（和别的模式用同一个序号，一个日程走到哪儿都是同一种颜色） */
const FLAG: RGB[] = [[227, 38, 30], [29, 95, 204], [242, 183, 5], [214, 60, 142]];
const flagOf = (title: string) => FLAG[hashStr(title) % FLAG.length];

/** 天色：白天天蓝，早晚橙红，夜里靛蓝 */
const SKY: [number, RGB][] = [
  [0, [27, 32, 88]], [5, [35, 42, 102]], [6.3, [242, 154, 107]], [7.6, [126, 200, 234]],
  [17.2, [126, 200, 234]], [18.5, [240, 138, 93]], [19.6, [74, 58, 122]], [21, [27, 32, 88]], [24, [27, 32, 88]],
];
function skyAt(hod: number): RGB {
  for (let i = 1; i < SKY.length; i++) {
    if (hod <= SKY[i][0]) {
      const [a, ca] = SKY[i - 1], [b, cb] = SKY[i];
      return mixc(ca, cb, smooth(0, 1, (hod - a) / (b - a)));
    }
  }
  return SKY[0][1];
}

interface Hit { id: string; x: number; y: number; w: number; h: number }
interface Box { x0: number; x1: number; y0: number; y1: number }
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** 本地小时数 → 第几天（本地午夜为界） */
const dayOf = (h: number) => Math.floor(h / 24);
/** 第几天 → 第几周、周几（0 是周一）。第 0 天（1970-01-01）是周四 */
const weekOf = (d: number) => Math.floor((d + 3) / 7);
const colOf = (d: number) => mod(d + 3, 7);
/** 一块地里，某个钟点在横向的位置（0–1） */
const uIn = (hod: number) => (clamp(hod, DAY0, DAY1) - DAY0) / (DAY1 - DAY0);

/** 一天里翻过的地：横向占的几段（0–1，已合并） */
type Spans = [number, number][];

/** 过去的日子长到哪一步：0 种子 1 冒芽 2 青苗 3 转黄 4 熟了 */
const stageOf = (age: number) => (age < 1 ? 0 : age < 3 ? 1 : age < 8 ? 2 : age < 15 ? 3 : 4);

export class FarmWorld implements World {
  readonly id = 'farm';
  readonly name = '农场';

  private W = 0; private H = 0;
  private insetTop = 0; private insetBottom = 0;
  /** 天那一条的下沿、村子那一条的上沿、“视角”线 */
  private SKY = 0; private VIL = 0; private FY = 0;
  /** 一块地多宽、一行多高、田的左边 */
  private Fx = 0; private RH = 0; private X0 = 0;
  /** 视角所在的行（连续） */
  private vc = 0;
  private hits: Hit[] = [];
  private tilled = new Map<number, Spans>();
  /** 画好的地块：内容和光没变就直接贴 */
  private plots = new Map<string, HTMLCanvasElement>();
  private grassTile: { key: string; pattern: CanvasPattern } | null = null;
  private grain: CanvasPattern | null = null;

  constructor(_invalidate: () => void) { /* 全部用代码画，没有要等的素材 */ }

  resize(w: number, h: number, insets: { top: number; bottom: number }) {
    this.W = w; this.H = h;
    this.insetTop = insets.top; this.insetBottom = insets.bottom;
    this.SKY = insets.top + clamp(h * 0.13, 90, 130);
    this.VIL = h - insets.bottom - clamp(h * 0.11, 70, 110);
    this.FY = h * 0.6;
    // 一周七块地铺满屏宽；桌面上按高度收，往上排得下六七周
    this.Fx = Math.min((w - 20) / 7, h * 0.075);
    this.RH = this.Fx * ROW_K;
    this.X0 = (w - 7 * this.Fx) / 2;
    this.plots.clear();
  }

  /** 地上 v（往上数的行）在屏幕上的高度 */
  private yAt(v: number) { return this.FY - (v - this.vc) * this.RH; }

  draw(ctx: CanvasRenderingContext2D, f: Frame) {
    const { W, H } = this;
    const T = localHours(f.view), nowH = localHours(f.now);
    this.vc = (T / 24 + 3) / 7 - 0.5;
    this.tilled = tillage(f.events, nowH);
    const hod = mod(T, 24);
    const daylight = daylightAt(f.view);
    const pal = palAt(daylight);
    const light = daylight >= 0.5;

    // 田：草地、地块、两边的树
    ctx.save();
    ctx.beginPath(); ctx.rect(0, this.SKY, W, H - this.SKY); ctx.clip();
    this.drawGrass(ctx, pal, daylight);
    this.drawPlots(ctx, nowH, pal, daylight);
    this.drawMargins(ctx, pal);
    ctx.restore();

    this.drawSky(ctx, hod, daylight, pal);
    this.drawVillage(ctx, pal, daylight);
    this.drawGrain(ctx);

    this.hits = [];
    const live = f.events.find(e => e.state === 'live' && !isAllDay(e.start, e.end));
    const reserved = this.drawFarmer(ctx, f, nowH, live, pal, light);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, this.SKY, W, this.VIL - this.SKY); ctx.clip();
    this.drawEvents(ctx, f.events, T, pal, light, reserved);
    ctx.restore();
  }

  dragHours(_x: number, _y: number, _dx: number, dy: number): number {
    // 平铺不讲透视：往下拖一行就是一周，手指下的地跟着手指走
    return (dy / this.RH) * 7 * 24;
  }

  hitTest(x: number, y: number): string | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (Math.abs(x - h.x) <= h.w / 2 && y <= h.y + 6 && y >= h.y - h.h) return h.id;
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
      for (const [a, b] of this.tilled.get(d) ?? []) hours += (b - a) * (DAY1 - DAY0);
    }
    return `一天是一块地，一周一行，往上是以后的日子。这周已经翻了约 ${Math.round(hours)} 小时的地。`
      + '做过的事翻成垄，过几天长出庄稼；没做事的日子，地空着长草。';
  }

  /* ---------- 天 ---------- */

  /** 上面一条天：日月、卷云或星星，底下一排圆圆的小山把远处的田挡住 */
  private drawSky(ctx: CanvasRenderingContext2D, hod: number, daylight: number, pal: Pal) {
    const { W, SKY } = this;
    ctx.fillStyle = rgba(skyAt(hod), 1);
    ctx.fillRect(0, 0, W, SKY);
    const night = 1 - daylight;
    const top = this.insetTop + 52, band = SKY - top;

    // 星星：一些固定的小点，入夜才出来
    if (night > 0.05) {
      const r = rng(9);
      ctx.fillStyle = rgba(pal.yellow, night);
      for (let i = 0; i < 46; i++) {
        const x = r() * W, y = r() * (SKY - 16), s = 0.8 + r() * 1.4;
        ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      }
    }
    // 太阳：一枚红日，外面一圈花瓣似的黄光；月亮：一弯黄月。都从左往右走过天
    const sun = (hod - 5.8) / 13;
    const moonH = mod(hod - 19, 24) / 11;
    const rr = clamp(band * 0.2, 9, 16);
    if (sun > 0 && sun < 1) {
      const x = W * (0.1 + 0.8 * sun), y = top + band * (0.55 - 0.3 * Math.sin(sun * Math.PI));
      ctx.fillStyle = rgba(pal.yellow, 1);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * rr * 1.45, y + Math.sin(a) * rr * 1.45, rr * 0.42, rr * 0.2, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = rgba(pal.red, 1);
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1.5; ctx.stroke();
    } else if (moonH < 1) {
      const x = W * (0.9 - 0.8 * moonH), y = top + band * (0.55 - 0.3 * Math.sin(moonH * Math.PI));
      ctx.fillStyle = rgba(pal.yellow, 1);
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(skyAt(hod), 1);
      ctx.beginPath(); ctx.arc(x + rr * 0.45, y - rr * 0.2, rr * 0.9, 0, Math.PI * 2); ctx.fill();
    }
    // 卷云：白天两朵，钉在屏幕上
    if (daylight > 0.05) {
      ctx.globalAlpha = daylight;
      [[0.22, 0.45], [0.55, 0.25]].forEach(([fx, fy]) => this.cloud(ctx, W * fx, top + band * fy, clamp(band * 0.12, 6, 10), pal));
      ctx.globalAlpha = 1;
    }
    // 小山：一排半圆，深浅两种绿，点满小点，粗墨线
    const n = Math.max(5, Math.round(W / 70));
    const hr = (W / n) * 0.62, base = SKY + 4;
    ctx.lineWidth = 1.6;
    for (let i = -1; i <= n; i++) {
      const x = (i + 0.5) * (W / n) + (i % 2 ? hr * 0.3 : 0);
      const h = hr * (i % 2 ? 0.55 : 0.75);
      ctx.beginPath();
      ctx.ellipse(x, base, hr, h, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = rgba(i % 2 ? pal.hill2 : pal.hill, 1);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.ink, 1);
      ctx.stroke();
      const r = rng(i * 7 + 3);
      ctx.fillStyle = rgba(pal.hillDot, 1);
      for (let k = 0; k < 9; k++) {
        const a = Math.PI + r() * Math.PI, d = r() * 0.8;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * hr * d, base + Math.sin(a) * h * d, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = rgba(pal.ink, 1);
    ctx.fillRect(0, base - 1, W, 2);
  }

  private cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pal: Pal) {
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI, 0);
    ctx.arc(x + r * 1.4, y - r * 0.5, r, Math.PI, 0);
    ctx.arc(x + r * 2.8, y, r, Math.PI, 0);
    ctx.lineTo(x + r * 3.8, y + r * 0.45);
    ctx.lineTo(x - r, y + r * 0.45);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1.3; ctx.stroke();
  }

  /* ---------- 田 ---------- */

  /** 草地：满地小点，跟着田一起滑 */
  private drawGrass(ctx: CanvasRenderingContext2D, pal: Pal, daylight: number) {
    const key = String(Math.round(daylight * 16));
    if (this.grassTile?.key !== key) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = rgba(pal.grass, 1); g.fillRect(0, 0, 64, 64);
      g.fillStyle = rgba(pal.dot, 1);
      const r = rng(4);
      for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(r() * 60 + 2, r() * 60 + 2, 1.1, 0, Math.PI * 2); g.fill(); }
      this.grassTile = { key, pattern: ctx.createPattern(c, 'repeat')! };
    }
    const p = this.grassTile.pattern;
    p.setTransform(new DOMMatrix().translate(0, mod(this.vc * this.RH, 64)));
    ctx.fillStyle = p;
    ctx.fillRect(0, this.SKY, this.W, this.H - this.SKY);
  }

  private visibleRows(): [number, number] {
    // 往上画到天，往下画到画面底边
    return [Math.floor(this.vc + (this.FY - this.H) / this.RH) - 1, Math.ceil(this.vc + (this.FY - this.SKY) / this.RH)];
  }

  private drawPlots(ctx: CanvasRenderingContext2D, nowH: number, pal: Pal, daylight: number) {
    const { Fx, RH, X0 } = this;
    const [w0, w1] = this.visibleRows();
    const today = dayOf(nowH);
    const dpr = ctx.getTransform().a || 1;
    const gap = Fx * 0.07, pw = Fx - 2 * gap, ph = RH - 2 * gap;
    const pad = Math.ceil(Fx * 0.06);
    const lightKey = Math.round(daylight * 16);
    for (let w = w0; w <= w1; w++) {
      const yTop = this.yAt(w + 1);
      for (let col = 0; col < 7; col++) {
        const d = 7 * w - 3 + col;
        const spans = d <= today ? this.tilled.get(d) ?? [] : [];
        const age = (nowH - (d + 1) * 24) / 24;
        const st = d === today ? -1 : d > today ? -2 : stageOf(age);
        // 长草的多少随日子慢慢变，按天取整就够了
        const key = `${d}|${st}|${st === 0 || d < today ? Math.min(7, Math.floor(age)) : ''}|${spans.map(s => s.map(v => v.toFixed(3)).join('-')).join(',')}|${lightKey}|${Math.round(pw * dpr)}x${Math.round(ph * dpr)}`;
        let c = this.plots.get(key);
        if (c) {
          // 最近用过的放到最后，满了从最久没用的删起
          this.plots.delete(key); this.plots.set(key, c);
        } else {
          c = document.createElement('canvas');
          c.width = Math.ceil((pw + 2 * pad) * dpr); c.height = Math.ceil((ph + 2 * pad) * dpr);
          const g = c.getContext('2d')!;
          g.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr);
          paintPlot(g, pw, ph, d, spans, st, age, d === today, pal, daylight >= 0.5);
          this.plots.set(key, c);
          if (this.plots.size > 360) this.plots.delete(this.plots.keys().next().value!);
        }
        ctx.drawImage(c, X0 + col * Fx + gap - pad, yTop + gap - pad, pw + 2 * pad, ph + 2 * pad);
      }
    }
  }

  /** 桌面上田两边空着的草地：棒棒糖似的树、草垛、小水塘，按行钉住，排满（农民画不留空） */
  private drawMargins(ctx: CanvasRenderingContext2D, pal: Pal) {
    const { X0, RH, W } = this;
    if (X0 < 34) return;
    const [w0, w1] = this.visibleRows();
    const room = X0 - 12;
    const s = Math.min(RH * 0.95, room * 0.9);
    const slots = Math.max(1, Math.floor(room / (s * 0.85)));
    for (let w = w1; w >= w0; w--) {
      const r = rng(w * 31 + 7);
      for (const side of [-1, 1]) {
        for (let i = 0; i < slots; i++) {
          const v = r(), k = r(), kind = r();
          if (v > 0.6) continue;
          const cx = (i + 0.3 + 0.4 * k) * (room / slots);
          const x = side < 0 ? 8 + cx : W - 8 - cx;
          const y = this.yAt(w + v);
          if (kind < 0.6) folkTree(ctx, x, y, s, pal);
          else if (kind < 0.82) haystack(ctx, x, y, s * 0.6, pal);
          else pond(ctx, x, y - s * 0.15, s * 0.42, pal);
        }
      }
    }
  }

  /* ---------- 村子 ---------- */

  /** 下面一条村子：土路、红瓦房、圆粮仓、树、两只鸡，钉在屏幕上 */
  private drawVillage(ctx: CanvasRenderingContext2D, pal: Pal, daylight: number) {
    const { W, H, VIL } = this;
    const bh = H - VIL;
    ctx.fillStyle = rgba(pal.path, 1);
    ctx.fillRect(0, VIL, W, bh);
    const r = rng(12);
    ctx.fillStyle = rgba(mixc(pal.path, pal.ink, 0.25), 1);
    for (let i = 0; i < W / 9; i++) { ctx.beginPath(); ctx.arc(r() * W, VIL + 6 + r() * (bh - 8), 0.9 + r() * 0.8, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = rgba(pal.ink, 1);
    ctx.fillRect(0, VIL - 1, W, 2.2);

    const ground = H - this.insetBottom - bh * 0.18;
    const s = clamp(bh * 0.95, 60, 104);
    // 房子在左中，粮仓在它右边，两头各一棵树；宽屏上多种几棵
    const hx = W * 0.5 - s * 0.95;
    this.house = { x: hx, w: s * 1.15, ground };
    house(ctx, hx, ground, s * 1.15, s * 0.5, pal, 1 - daylight);
    granary(ctx, hx + s * 1.55, ground, s * 0.5, pal);
    const trees = Math.max(2, Math.round(W / 220));
    for (let i = 0; i < trees; i++) {
      const left = i % 2 === 0, j = Math.floor(i / 2);
      const x = left ? s * 0.4 + j * s * 0.9 : W - s * 0.4 - j * s * 0.9;
      if (x > hx - s * 0.3 && x < hx + s * 2) continue;
      folkTree(ctx, x, ground, s * 0.95, pal);
    }
    hen(ctx, hx + s * 2.1, ground - 2, s * 0.09, pal);
    hen(ctx, hx + s * 2.45, ground, s * 0.08, pal, true);
  }
  /** 房子的位置：夜里农夫坐在门口 */
  private house = { x: 0, w: 0, ground: 0 };

  /** 一层很淡的纸纹，像画在纸上 */
  private drawGrain(ctx: CanvasRenderingContext2D) {
    if (!this.grain) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const img = g.createImageData(128, 128), r = rng(3);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = r() < 0.5 ? 0 : 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = Math.round(r() * 14);
      }
      g.putImageData(img, 0, 0);
      this.grain = ctx.createPattern(c, 'repeat');
    }
    if (!this.grain) return;
    ctx.fillStyle = this.grain;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  /* ---------- 农夫 ---------- */

  /** 白天在今天的地里随钟点走（忙时锄地），夜里回家坐在门口；返回他和头顶文字占掉的地方 */
  private drawFarmer(ctx: CanvasRenderingContext2D, f: Frame, nowH: number, live: EventView | undefined, pal: Pal, light: boolean): Box[] {
    const { W, Fx, X0, RH } = this;
    const d = dayOf(nowH), hod = nowH - d * 24;
    const home = (hod >= DAY1 || hod < DAY0) && !live;
    let x: number, y: number, s: number;
    if (home) {
      s = clamp((this.H - this.VIL) * 0.55, 34, 60);
      x = this.house.x + this.house.w * 0.78; y = this.house.ground;
      folkFarmer(ctx, x, y, s, 'sit', pal);
    } else {
      const w = weekOf(d), col = colOf(d);
      const gap = Fx * 0.07;
      x = X0 + col * Fx + gap + uIn(hod) * (Fx - 2 * gap);
      y = this.yAt(w) - RH * 0.16;
      if (y < this.SKY + 10 || y > this.VIL) return [];
      s = clamp(RH * 0.8, 30, 70);
      folkFarmer(ctx, x, y, s, live ? 'hoe' : 'walk', pal);
    }
    // 头顶两行字：“现在”和钟点；忙着的时候换成日程的名字和还要准备几项
    const title = live ? `现在 · ${live.title}` : home ? '现在 · 在家歇着' : '现在';
    const sub = live ? subLabel(live) : `${fmtDay(f.now)} ${fmtTime(f.now)}`;
    const ty = Math.max(this.SKY + 34, y - s - 6);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = `700 13px ${SANS}`;
    const w1 = ctx.measureText(title).width;
    ctx.font = `500 12px ${SANS}`;
    const w2 = ctx.measureText(sub).width;
    const half = Math.max(w1, w2) / 2 + 6;
    const tx = clamp(x, half + 4, W - half - 4);
    // 农民画里的字写在一块小牌子上
    tag(ctx, tx - half, ty - 33, half * 2, 35, light ? [255, 248, 232] : [40, 30, 60], pal);
    ctx.fillStyle = light ? rgba(pal.red, 1) : 'rgba(255,236,190,1)';
    ctx.font = `700 13px ${SANS}`;
    ctx.fillText(title, tx, ty - 16);
    ctx.font = `500 12px ${SANS}`;
    ctx.fillStyle = light ? rgba(pal.ink, 0.8) : 'rgba(255,236,190,.8)';
    ctx.fillText(sub, tx, ty);
    ctx.restore();
    return [
      { x0: tx - half, x1: tx + half, y0: ty - 34, y1: ty + 2 },
      { x0: x - s * 0.4, x1: x + s * 0.6, y0: y - s, y1: y + 4 },
    ];
  }

  /* ---------- 日程 ---------- */

  /**
   * 还没做的日程是插在地里的小旗（按开始的钟点排开，挨得近的错开），进行中的旗外画一圈红；
   * 做完的在地的下半截留一颗彩珠，写了结论的旁边盖一方小红印。
   */
  private drawEvents(ctx: CanvasRenderingContext2D, events: EventView[], T: number, pal: Pal, light: boolean, reserved: Box[]) {
    const { Fx, RH, X0, W } = this;
    const [w0, w1] = this.visibleRows();
    const gap = Fx * 0.07, pw = Fx - 2 * gap, ph = RH - 2 * gap;
    type Item = { ev: EventView; h: number; x: number; y: number; top: number };
    const items: Item[] = [];
    const lanes = new Map<string, [number, number][]>();
    for (const ev of events) {
      const sH = localHours(ev.start);
      const allDay = isAllDay(ev.start, ev.end);
      const d = dayOf(sH), w = weekOf(d);
      if (w < w0 || w > w1) continue;
      const hod = allDay ? 13 : sH - d * 24;
      const u = uIn(hod);
      const ended = ev.state === 'ended';
      const key = `${d}|${ended ? 1 : 0}`;
      const used = lanes.get(key) ?? [];
      let lane = 0;
      while (lane < 2 && used.some(([pu, pl]) => pl === lane && Math.abs(pu - u) < 0.14)) lane++;
      used.push([u, lane]);
      lanes.set(key, used);
      const x = X0 + colOf(d) * Fx + gap + u * pw;
      const yTop = this.yAt(w + 1) + gap;
      const y = ended ? yTop + ph * (0.8 - lane * 0.16) : yTop + ph * (0.62 - lane * 0.2);
      items.push({ ev, h: allDay ? d * 24 + 13 : sH, x, y, top: y });
    }

    const labels: Item[] = [];
    for (const it of items) {
      const { ev, x, y } = it;
      const color = flagOf(ev.title);
      if (ev.state === 'ended') {
        const r = clamp(pw * 0.06, 2, 4.5);
        ctx.fillStyle = rgba(mixc(color, pal.ink, light ? 0 : 0.2), ev.outcome ? 1 : 0.7);
        ctx.beginPath(); ctx.arc(x, y - r, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(pal.ink, 0.9); ctx.lineWidth = 1; ctx.stroke();
        if (ev.outcome) {
          const q = r * 1.3;
          ctx.fillStyle = rgba(pal.red, 1);
          ctx.fillRect(x + r * 1.1, y - r * 2.4, q, q);
          ctx.strokeRect(x + r * 1.1, y - r * 2.4, q, q);
        }
        it.top = y - r * 2.6;
        this.hits.push({ id: ev.id, x, y: y + 2, w: Math.max(r * 5, 24), h: Math.max(r * 5, 24) });
      } else {
        // 竹竿挑一面三角小旗
        const s = clamp(ph * 0.3, 9, 20);
        ctx.strokeStyle = rgba(pal.ink, 1);
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.6, y - s * 0.78); ctx.lineTo(x, y - s * 0.56);
        ctx.closePath();
        ctx.fillStyle = rgba(mixc(color, pal.ink, light ? 0 : 0.15), 1);
        ctx.fill();
        ctx.lineWidth = 1; ctx.stroke();
        if (ev.state === 'live') {
          ctx.strokeStyle = rgba(pal.red, 1);
          ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.arc(x + s * 0.2, y - s * 0.72, s * 0.55, 0, Math.PI * 2); ctx.stroke();
        }
        it.top = y - s - 3;
        this.hits.push({ id: ev.id, x: x + s * 0.2, y: y + 2, w: Math.max(s, 24), h: Math.max(s + 6, 26) });
      }
      // 只给视角前后一天半里的写字；进行中的写在农夫头顶
      if (ev.state !== 'live' && Math.abs(it.h - T) < 36) labels.push(it);
    }

    // 标签：离视角近的优先，最多两个，彼此不重叠，也不压住农夫
    labels.sort((a, b) => Math.abs(a.h - T) - Math.abs(b.h - T));
    const taken = [...reserved];
    let shown = 0;
    for (const it of labels) {
      if (shown >= 2) break;
      const { ev, x } = it;
      const sub = subLabel(ev);
      ctx.font = `700 12px ${SANS}`;
      let half = ctx.measureText(ev.title).width / 2;
      ctx.font = `500 10.5px ${SANS}`;
      half = Math.max(half, ctx.measureText(sub).width / 2) + 6;
      const lx = clamp(x, half + 4, W - half - 4);
      const box: Box = { x0: lx - half, x1: lx + half, y0: it.top - 31, y1: it.top + 2 };
      if (box.y0 < this.SKY + 4 || box.y1 > this.VIL - 4) continue;
      if (taken.some(b => overlaps(b, box))) continue;
      taken.push(box);
      shown++;
      tag(ctx, box.x0, box.y0, half * 2, 32, light ? [255, 248, 232] : [40, 30, 60], pal, ev.state === 'ended' ? 0.85 : 1);
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = light ? rgba(pal.ink, 1) : 'rgba(255,236,190,1)';
      ctx.font = `700 12px ${SANS}`;
      ctx.fillText(ev.title, lx, it.top - 14);
      ctx.font = `500 10.5px ${SANS}`;
      ctx.fillStyle = light ? rgba(pal.ink, 0.72) : 'rgba(255,236,190,.75)';
      ctx.fillText(sub, lx, it.top);
      ctx.restore();
    }
  }
}

/* ---------- 一块地 ---------- */

/** 手画似的歪一点的方块 */
function wobble(g: CanvasRenderingContext2D, w: number, h: number, seed: number, amp: number) {
  const r = rng(seed), pts: [number, number][] = [], n = 5;
  for (let i = 0; i < n; i++) pts.push([(w * i) / n, (r() - 0.5) * amp]);
  for (let i = 0; i < n; i++) pts.push([w + (r() - 0.5) * amp, (h * i) / n]);
  for (let i = 0; i < n; i++) pts.push([w - (w * i) / n, h + (r() - 0.5) * amp]);
  for (let i = 0; i < n; i++) pts.push([(r() - 0.5) * amp, h - (h * i) / n]);
  g.beginPath();
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if (i) g.quadraticCurveTo(p[0], p[1], mx, my); else g.moveTo(mx, my);
  });
  g.closePath();
}

/**
 * 画一块地（原点在地的左上角）。st：-2 以后的日子，-1 今天，0–4 过去的日子长到哪一步。
 * 翻过的几段按长到哪一步换颜色和纹样；没翻的地，以后的是浅杏色，过去的长草开花。
 */
function paintPlot(
  g: CanvasRenderingContext2D, pw: number, ph: number, d: number, spans: Spans,
  st: number, age: number, today: boolean, pal: Pal, light: boolean,
) {
  const seed = d * 31 + 7;
  const ink = rgba(pal.ink, 1);
  wobble(g, pw, ph, seed, pw * 0.045);
  g.fillStyle = rgba(st >= 0 ? pal.fallow : pal.bare, 1);
  g.fill();
  g.save();
  g.clip();
  const r = rng(seed);
  if (st >= 0) {
    // 空着的地长草：人字纹越来越密，过两天开几朵小花
    const n = Math.round(4 + 10 * smooth(0, 6, age));
    g.strokeStyle = rgba(pal.weed, 1);
    g.lineWidth = 1.1;
    const s = pw * 0.05;
    for (let i = 0; i < n; i++) {
      const x = r() * pw, y = ph * 0.22 + r() * ph * 0.74;
      if (spans.some(([a, b]) => x > a * pw - 3 && x < b * pw + 3)) continue;
      g.beginPath(); g.moveTo(x - s, y - s * 1.2); g.lineTo(x, y); g.lineTo(x + s, y - s * 1.2); g.stroke();
    }
    if (age > 2) {
      for (let i = 0; i < 3; i++) {
        const x = r() * pw, y = ph * 0.25 + r() * ph * 0.7;
        if (spans.some(([a, b]) => x > a * pw - 3 && x < b * pw + 3)) continue;
        g.fillStyle = i % 2 ? 'rgba(255,255,255,.95)' : light ? 'rgba(240,106,168,1)' : 'rgba(190,96,140,1)';
        g.beginPath(); g.arc(x, y, Math.max(1.2, pw * 0.032), 0, Math.PI * 2); g.fill();
      }
    }
  } else {
    // 还没动的地：底边一排淡淡的点
    g.fillStyle = 'rgba(255,255,255,.4)';
    for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(4 + (i * (pw - 8)) / 8, ph - 4, 0.9, 0, Math.PI * 2); g.fill(); }
  }

  const rows = 6;
  for (const [a, b] of spans) {
    const sx = a * pw, ex = b * pw;
    const tilled = st <= 0;
    g.fillStyle = rgba(tilled ? pal.soil : st <= 2 ? pal.young : st === 3 ? pal.ripen : pal.ripe, 1);
    g.fillRect(sx, 0, ex - sx, ph);
    for (let j = 0; j < rows; j++) {
      const y = ph * 0.24 + (j * ph * 0.7) / rows;
      if (tilled) {
        // 今天、昨天：一道道垄（今天是黄垄，撒了种的是白点）
        g.fillStyle = rgba(st === 0 && !today ? pal.seed : pal.furrow, 1);
        const dot = st === 0 && !today;
        for (let x = sx + 2; x < ex - 1; x += 4) g.fillRect(x, y, dot ? 1.4 : 2.4, dot ? 1.4 : 1.3);
      } else if (st <= 2) {
        // 芽和苗：一对对叶子
        g.fillStyle = rgba(pal.leaf, 1);
        const k = st === 1 ? 0.6 : 1;
        for (let x = sx + 2.5; x < ex - 1; x += 5) {
          g.beginPath();
          g.ellipse(x - 1.2 * k, y, 1.8 * k, 0.9 * k, -0.6, 0, Math.PI * 2);
          g.ellipse(x + 1.2 * k, y, 1.8 * k, 0.9 * k, 0.6, 0, Math.PI * 2);
          g.fill();
        }
      } else {
        // 穗子：一排排人字
        g.strokeStyle = rgba(pal.ear, 1);
        g.lineWidth = 1;
        for (let x = sx + 2.5; x < ex - 1; x += 4.5) {
          g.beginPath(); g.moveTo(x - 1.6, y + 1.6); g.lineTo(x, y); g.lineTo(x + 1.6, y + 1.6); g.stroke();
        }
      }
    }
    g.strokeStyle = ink;
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, ph); g.moveTo(ex, 0); g.lineTo(ex, ph); g.stroke();
  }
  g.restore();

  wobble(g, pw, ph, seed, pw * 0.045);
  g.strokeStyle = ink;
  g.lineWidth = clamp(pw * 0.035, 1.2, 2);
  g.stroke();

  // 日子：左上角一块小圆牌，今天是红的；一号写月份
  const date = new Date(noonOf(d));
  const text = date.getDate() === 1 ? `${date.getMonth() + 1}月` : String(date.getDate());
  const br = clamp(pw * 0.14, 6.5, 10);
  const fs = br * (text.length > 2 ? 0.95 : 1.15);
  g.font = `700 ${fs}px ${SANS}`;
  const tw = Math.max(br * 2, g.measureText(text).width + br * 0.8);
  g.beginPath();
  if (g.roundRect) g.roundRect(2, 2, tw, br * 2, br); else g.rect(2, 2, tw, br * 2);
  g.fillStyle = today ? rgba(pal.red, 1) : rgba(pal.badge, 1);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = ink;
  g.stroke();
  g.fillStyle = today ? 'rgba(255,255,255,1)' : ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 2 + tw / 2, 2 + br + 0.5);
}

/* ---------- 点景 ---------- */

/** 棒棒糖似的树：一根树干，一团圆冠，冠上一圈黄叶纹、中心一点红 */
function folkTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Pal) {
  ctx.strokeStyle = rgba(pal.ink, 1);
  ctx.lineWidth = 1.5;
  ctx.fillStyle = rgba(pal.trunk, 1);
  ctx.fillRect(x - s * 0.04, y - s * 0.45, s * 0.08, s * 0.45);
  ctx.strokeRect(x - s * 0.04, y - s * 0.45, s * 0.08, s * 0.45);
  ctx.fillStyle = rgba(pal.crown, 1);
  ctx.beginPath(); ctx.arc(x, y - s * 0.7, s * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = rgba(pal.yellow, 1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * s * 0.18, y - s * 0.7 + Math.sin(a) * s * 0.18, s * 0.065, s * 0.032, a, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = rgba(pal.red, 1);
  ctx.beginPath(); ctx.arc(x, y - s * 0.7, s * 0.045, 0, Math.PI * 2); ctx.fill();
}

/** 草垛：一个黄圆顶，几道横纹 */
function haystack(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Pal) {
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.5, s * 0.8, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = rgba(pal.ripe, 1);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1.4; ctx.stroke();
  ctx.strokeStyle = rgba(pal.ear, 1); ctx.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    const yy = y - s * 0.2 * k, half = s * 0.5 * Math.sqrt(1 - (0.25 * k) ** 2);
    ctx.beginPath(); ctx.moveTo(x - half * 0.85, yy); ctx.lineTo(x + half * 0.85, yy); ctx.stroke();
  }
}

/** 小水塘：一汪蓝水，几道水纹 */
function pond(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Pal) {
  ctx.beginPath();
  ctx.ellipse(x, y, s, s * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = rgba(mixc(pal.window, [255, 255, 255], 0.25), 1);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1.4; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1;
  for (let k = -1; k <= 1; k++) {
    const yy = y + k * s * 0.2;
    ctx.beginPath();
    for (let t = 0; t <= 4; t++) {
      const xx = x - s * 0.5 + (t * s) / 4, wy = yy + (t % 2 ? -1.2 : 1.2);
      if (t) ctx.lineTo(xx, wy); else ctx.moveTo(xx, wy);
    }
    ctx.stroke();
  }
}

/** 红瓦房：白墙、红瓦（一排排鱼鳞纹）、两扇窗一扇门；夜里窗子亮 */
function house(ctx: CanvasRenderingContext2D, x: number, ground: number, w: number, h: number, pal: Pal, night: number) {
  const ink = rgba(pal.ink, 1);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = ink;
  ctx.fillStyle = rgba(pal.wall, 1);
  ctx.fillRect(x, ground - h, w, h); ctx.strokeRect(x, ground - h, w, h);
  const rh = h * 0.75;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.08, ground - h); ctx.lineTo(x + w * 1.08, ground - h);
  ctx.lineTo(x + w * 0.94, ground - h - rh); ctx.lineTo(x + w * 0.06, ground - h - rh);
  ctx.closePath();
  ctx.fillStyle = rgba(pal.roof, 1); ctx.fill(); ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(pal.roofLine, 1);
  ctx.lineWidth = 1;
  const t = Math.max(3, w * 0.035);
  for (let yy = ground - h - rh + t; yy < ground - h; yy += t * 1.6) {
    for (let xx = x - w * 0.08; xx < x + w * 1.1; xx += t * 2) { ctx.beginPath(); ctx.arc(xx + t, yy, t, 0, Math.PI); ctx.stroke(); }
  }
  ctx.restore();
  ctx.fillStyle = rgba(pal.window, 1);
  ctx.lineWidth = 1.2;
  for (const wx of [x + w * 0.12, x + w * 0.68]) {
    ctx.fillRect(wx, ground - h * 0.8, w * 0.2, h * 0.38); ctx.strokeRect(wx, ground - h * 0.8, w * 0.2, h * 0.38);
    if (night > 0.3) {
      const cx = wx + w * 0.1, cy = ground - h * 0.6, rr = w * 0.3;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, `rgba(255,214,90,${(0.35 * night).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,214,90,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
      ctx.fillStyle = rgba(pal.window, 1);
    }
  }
  ctx.fillStyle = rgba(pal.door, 1);
  ctx.fillRect(x + w * 0.42, ground - h * 0.72, w * 0.16, h * 0.72);
  ctx.strokeRect(x + w * 0.42, ground - h * 0.72, w * 0.16, h * 0.72);
}

/** 圆粮仓：黄身子一道道箍，尖草顶 */
function granary(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, pal: Pal) {
  const ink = rgba(pal.ink, 1);
  const r = s * 0.42, h = s * 0.9;
  ctx.lineWidth = 1.5; ctx.strokeStyle = ink;
  ctx.fillStyle = rgba(pal.ripe, 1);
  ctx.fillRect(x - r, ground - h, r * 2, h); ctx.strokeRect(x - r, ground - h, r * 2, h);
  ctx.strokeStyle = rgba(pal.ear, 1); ctx.lineWidth = 1;
  for (let yy = ground - h + 4; yy < ground; yy += 4) { ctx.beginPath(); ctx.moveTo(x - r, yy); ctx.lineTo(x + r, yy); ctx.stroke(); }
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - r - 5, ground - h); ctx.lineTo(x, ground - h - s * 0.6); ctx.lineTo(x + r + 5, ground - h); ctx.closePath();
  ctx.fillStyle = 'rgba(201,161,91,1)'; ctx.fill(); ctx.stroke();
}

function hen(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Pal, flip = false) {
  const k = flip ? -1 : 1;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.ellipse(x, y - s, s * 1.3, s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = rgba(pal.red, 1);
  ctx.beginPath(); ctx.arc(x + k * s * 1.05, y - s * 1.9, s * 0.4, 0, Math.PI * 2); ctx.fill();
}

/** 字牌：圆角小牌，粗墨边 */
function tag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: RGB, pal: Pal, a = 1) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 7); else ctx.rect(x, y, w, h);
  ctx.fillStyle = rgba(fill, 0.92 * a);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.ink, a);
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/** 农夫：黄斗笠、红褂子、蓝裤子。walk 扛着锄头站着，hoe 弯腰锄地，sit 坐在小凳上 */
function folkFarmer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pose: 'walk' | 'hoe' | 'sit', pal: Pal) {
  const ink = rgba(pal.ink, 1);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const hoe = pose === 'hoe', sit = pose === 'sit';
  const lean = hoe ? 0.22 : 0;
  // 锄头
  ctx.strokeStyle = 'rgba(122,74,30,1)';
  ctx.lineWidth = Math.max(1.4, s * 0.04);
  ctx.beginPath();
  if (hoe) { ctx.moveTo(x - s * 0.02, y - s * 0.56); ctx.lineTo(x + s * 0.44, y - s * 0.02); }
  else if (sit) { ctx.moveTo(x + s * 0.32, y); ctx.lineTo(x + s * 0.2, y - s * 0.75); }
  else { ctx.moveTo(x - s * 0.25, y - s * 0.75); ctx.lineTo(x + s * 0.3, y - s * 0.38); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(154,160,166,1)';
  if (hoe) ctx.fillRect(x + s * 0.38, y - s * 0.06, s * 0.16, s * 0.08);
  else if (!sit) ctx.fillRect(x - s * 0.32, y - s * 0.8, s * 0.1, s * 0.14);
  // 小凳
  if (sit) {
    ctx.fillStyle = 'rgba(122,74,30,1)';
    ctx.fillRect(x - s * 0.2, y - s * 0.28, s * 0.36, s * 0.06);
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(x - s * 0.2, y - s * 0.28, s * 0.36, s * 0.06);
    ctx.strokeStyle = 'rgba(122,74,30,1)'; ctx.lineWidth = Math.max(1.2, s * 0.03);
    ctx.beginPath(); ctx.moveTo(x - s * 0.16, y - s * 0.22); ctx.lineTo(x - s * 0.16, y); ctx.moveTo(x + s * 0.12, y - s * 0.22); ctx.lineTo(x + s * 0.12, y); ctx.stroke();
  }
  // 腿
  ctx.strokeStyle = 'rgba(29,95,204,1)';
  ctx.lineWidth = Math.max(2.2, s * 0.07);
  ctx.beginPath();
  if (sit) { ctx.moveTo(x - s * 0.04, y - s * 0.3); ctx.lineTo(x + s * 0.16, y - s * 0.3); ctx.lineTo(x + s * 0.16, y); }
  else { ctx.moveTo(x - s * 0.06, y - s * 0.32); ctx.lineTo(x - s * 0.15, y); ctx.moveTo(x + s * 0.03, y - s * 0.32); ctx.lineTo(x + s * 0.11, y); }
  ctx.stroke();
  // 身子、头、斗笠
  const by = sit ? y - s * 0.42 : y - s * 0.47;
  ctx.fillStyle = rgba(pal.red, 1);
  ctx.strokeStyle = ink; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.ellipse(x - s * 0.02 + lean * s * 0.2, by, s * 0.13, s * 0.18, lean, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const hx = x + s * 0.02 + lean * s * 0.45, hy = by - s * 0.22 + lean * s * 0.05;
  ctx.fillStyle = 'rgba(242,201,160,1)';
  ctx.beginPath(); ctx.arc(hx, hy, s * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba(pal.yellow, 1);
  ctx.beginPath(); ctx.moveTo(hx - s * 0.22, hy - s * 0.02); ctx.lineTo(hx, hy - s * 0.2); ctx.lineTo(hx + s * 0.22, hy - s * 0.02); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/**
 * 每天翻过的地：日程占着、而且已经过去的时段（到 nowH 为止），换成地里横向的几段（0–1）。
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
  const guess = d * DAY + 12 * HOUR;
  return guess + new Date(guess).getTimezoneOffset() * MINUTE;
}
