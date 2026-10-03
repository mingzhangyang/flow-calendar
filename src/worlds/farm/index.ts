import type { World } from '../world';
import type { EventView, Frame, Kind } from '../../model/types';
import { kindOf } from '../../model/kind';
import { DAY, HOUR, MINUTE, WEEKDAYS, fmtDay, fmtTime, isAllDay, localHours } from '../../model/time';
import { daylightAt } from '../../model/daylight';
import { type RGB, SANS, clamp, mixc, mod, rgba, rng, smooth } from '../hike/paint';
import { subLabel } from '../climb';

/**
 * 农场世界：农民画。把日历铺在地上，从上往下看，拼成一块块彩色的格子。
 *
 * 一天是一长条地，铺满屏宽，一天一行往上排：往上是以后的日子，往下是过去的日子，
 * 一屏五六天；周日和周一之间隔一排小灌木，看得出一周一周。
 * 一块地里横向是这一天的钟点：6 点在左边、22 点在右边，夜里的日程挤在两头。
 *
 * 做过的事留在地里，按类型（kind.ts）是不同的农活，都只算已经过去的时段：
 *   专注 = 耕地：翻成垄，过几天冒芽、长成青苗，两周左右熟成金黄；
 *   学习 = 播种：撒下种子，两周后才冒芽，三周多开出向日葵；
 *   会议 = 赶集：地没动，压出一条车道。会前小旗边停一辆车，准备事项是车上的木箱，勾掉的装好、没勾的还空着一个虚框；
 *            开会时地里支起集市的摊子，农夫站在摊边；会后写了结论，就留一篮带回来的货（几行结论几样货）；
 *   习惯 = 浇果树：地里留一滴水，村子里那棵树（每种习惯一棵）按近两个月浇过几次长大、开花、结果。
 * 没做事的日子，地空着长草开花。还没到的日程是插在地里的小旗（颜色按类型）。
 * 农夫在今天的地里随钟点走，按手上的农活锄地、撒种、提水，夜里回家坐在门口。
 *
 * 画风：户县农民画——大块饱和的平涂、粗墨线、满纹样，不讲透视。
 * 上面一条天（日月、卷云、圆圆的小山），下面一条村子（红瓦房、粮仓、树、鸡），都钉在屏幕上；
 * 田在两者之间上下滑动：视角随时间连续往前挪，一天一行，此刻落在“视角”线（屏高 60%）上。
 * 明暗跟着视角所在的时间：白天和夜里各一套颜色，按白天程度混合；早晚天空染橙红。
 */

/** 地里的一天从几点到几点（铺满一块地的宽） */
const DAY0 = 6, DAY1 = 22;
/** 一屏大约排几天 */
const DAYS_ON_SCREEN = 5.6;

/* ---------- 颜色 ---------- */

interface Pal {
  grass: RGB; dot: RGB; bare: RGB; soil: RGB; furrow: RGB; seed: RGB;
  young: RGB; leaf: RGB; ripen: RGB; ripe: RGB; ear: RGB; fallow: RGB; weed: RGB;
  ink: RGB; badge: RGB; red: RGB; yellow: RGB; hill: RGB; hill2: RGB; hillDot: RGB;
  path: RGB; wall: RGB; roof: RGB; roofLine: RGB; window: RGB; door: RGB; trunk: RGB; crown: RGB;
  water: RGB; rut: RGB;
}
const DAY_PAL: Pal = {
  grass: [47, 163, 74], dot: [126, 211, 106], bare: [244, 195, 142], soil: [140, 52, 23], furrow: [247, 197, 49],
  seed: [255, 244, 218], young: [30, 154, 73], leaf: [155, 227, 111], ripen: [185, 194, 30], ripe: [248, 198, 25],
  ear: [232, 84, 27], fallow: [166, 217, 106], weed: [61, 143, 56], ink: [36, 20, 12], badge: [255, 248, 232],
  red: [227, 38, 30], yellow: [247, 197, 49], hill: [36, 140, 66], hill2: [92, 182, 74], hillDot: [190, 236, 120],
  path: [240, 206, 150], wall: [255, 248, 232], roof: [217, 48, 31], roofLine: [140, 30, 16], window: [42, 79, 158],
  door: [140, 52, 23], trunk: [140, 52, 23], crown: [30, 138, 67],
  water: [60, 140, 224], rut: [176, 128, 78],
};
/** 夜里：还是那几种颜色，整体压暗，窗子亮起来 */
const NIGHT_PAL: Pal = {
  grass: [24, 92, 52], dot: [52, 132, 76], bare: [168, 120, 82], soil: [86, 34, 18], furrow: [196, 150, 52],
  seed: [214, 200, 172], young: [26, 112, 62], leaf: [112, 176, 92], ripen: [140, 146, 40], ripe: [204, 160, 36],
  ear: [196, 86, 40], fallow: [86, 140, 72], weed: [36, 92, 44], ink: [14, 10, 8], badge: [228, 220, 200],
  red: [220, 70, 56], yellow: [246, 212, 96], hill: [22, 78, 52], hill2: [40, 104, 62], hillDot: [80, 146, 88],
  path: [120, 100, 82], wall: [176, 170, 160], roof: [150, 44, 34], roofLine: [90, 24, 16], window: [255, 214, 90],
  door: [86, 34, 18], trunk: [86, 34, 18], crown: [20, 92, 52],
  water: [52, 100, 170], rut: [96, 70, 50],
};
function palAt(daylight: number): Pal {
  const out = {} as Record<keyof Pal, RGB>;
  for (const k of Object.keys(DAY_PAL) as (keyof Pal)[]) out[k] = mixc(NIGHT_PAL[k], DAY_PAL[k], daylight);
  return out;
}
/** 小旗和彩珠的颜色按类型：耕地大红、播种明黄、赶集钴蓝、浇树桃红 */
const FLAG: Record<Kind, RGB> = { focus: [227, 38, 30], learn: [242, 183, 5], meet: [29, 95, 204], habit: [214, 60, 142] };
/** 农活的名字 */
const JOB: Record<Kind, string> = { focus: '耕地', learn: '播种', meet: '赶集', habit: '浇树' };

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
/** 第几天 → 周几（0 是周一）。第 0 天（1970-01-01）是周四 */
const colOf = (d: number) => mod(d + 3, 7);
/** 一块地里，某个钟点在横向的位置（0–1） */
const uIn = (hod: number) => (clamp(hod, DAY0, DAY1) - DAY0) / (DAY1 - DAY0);

/** 一天里某种农活在横向占的几段（0–1，已合并） */
type Spans = [number, number][];
/** 一天里做过的农活，按类型分开 */
type Work = Record<Kind, Spans>;
const NO_WORK: Work = { focus: [], learn: [], meet: [], habit: [] };

/** 耕过的地长到哪一步：0 种子 1 冒芽 2 青苗 3 转黄 4 熟了 */
const stageOf = (age: number) => (age < 1 ? 0 : age < 3 ? 1 : age < 8 ? 2 : age < 15 ? 3 : 4);
/** 播的种长到哪一步：0 种子（两周不见动静）1 冒芽 2 青苗 3 开花 */
const learnStageOf = (age: number) => (age < 14 ? 0 : age < 18 ? 1 : age < 24 ? 2 : 3);

/** 果树：近两个月浇过几次 → 树苗、小树、大树、开花、结果 */
const TREE_AT = [1, 3, 7, 14, 21];
const TREE_NAMES = ['树苗', '小树', '大树', '开花', '结果'];
interface Orchard { title: string; times: number; stage: number }

export class FarmWorld implements World {
  readonly id = 'farm';
  readonly name = '农场';

  private W = 0; private H = 0;
  private insetTop = 0; private insetBottom = 0;
  /** 天那一条的下沿、村子那一条的上沿、“视角”线 */
  private SKY = 0; private VIL = 0; private FY = 0;
  /** 一块地多宽、一行（一天）多高、田的左边、地和地之间上下各让出多少 */
  private PW = 0; private RH = 0; private X0 = 0; private GAP = 0;
  /** 视角所在的天（连续） */
  private vc = 0;
  private hits: Hit[] = [];
  private tilled = new Map<number, Work>();
  /** 每种习惯一棵果树 */
  private orchard: Orchard[] = [];
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
    // 一天一长条，手机上铺满屏宽，桌面上不超过 760，两边是草地
    this.PW = Math.min(w - 32, 760);
    this.X0 = (w - this.PW) / 2;
    this.RH = clamp((this.VIL - this.SKY) / DAYS_ON_SCREEN, 78, 140);
    this.GAP = this.RH * 0.08;
    this.plots.clear();
  }

  /** 地上 v（往上数的天，第 d 天占 d 到 d+1）在屏幕上的高度 */
  private yAt(v: number) { return this.FY - (v - this.vc) * this.RH; }

  /** 第 d 天的日期牌在屏幕上占的地方（标签要让开） */
  private badgeBox(ctx: CanvasRenderingContext2D, d: number, today: number): Box {
    const p = this.plotOf(d);
    ctx.save();
    const { br, tw } = badgeSize(ctx, dayText(d, d === today), p.h);
    ctx.restore();
    return { x0: p.x, x1: p.x + tw + 6, y0: p.y, y1: p.y + br * 2 + 4 };
  }

  /** 第 d 天那块地（不含田埂）：左上角、宽、高 */
  private plotOf(d: number) {
    return { x: this.X0, y: this.yAt(d + 1) + this.GAP, w: this.PW, h: this.RH - 2 * this.GAP };
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame) {
    const { W, H } = this;
    const T = localHours(f.view), nowH = localHours(f.now);
    this.vc = T / 24;
    this.tilled = tillage(f.events, nowH);
    this.orchard = orchardOf(f.events, f.now);
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
    // 农夫最后画，站在小旗和车的前面；他占的地方先量好，标签让开
    const reserved = this.drawFarmer(ctx, f, nowH, live, pal, light, false);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, this.SKY, W, this.VIL - this.SKY); ctx.clip();
    this.drawEvents(ctx, f.events, T, nowH, pal, light, reserved);
    ctx.restore();
    this.drawFarmer(ctx, f, nowH, live, pal, light, true);
  }

  dragHours(_x: number, _y: number, _dx: number, dy: number): number {
    // 平铺不讲透视：往下拖一行就是一天，手指下的地跟着手指走
    return (dy / this.RH) * 24;
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
    const hours = (k: Kind) => {
      let n = 0;
      for (let d = d0; d <= dayOf(nowH); d++) for (const [a, b] of this.tilled.get(d)?.[k] ?? []) n += (b - a) * (DAY1 - DAY0);
      return Math.round(n);
    };
    let text = `一天是一长条地，往上是以后的日子。这周耕地约 ${hours('focus')} 小时，播种约 ${hours('learn')} 小时。`
      + '专注是耕地，两周左右熟成金黄；学习是播种，两周后才发芽；会议是赶集；习惯是浇果树。没做事的日子，地空着长草。';
    const trip = f.events.find(e => e.state !== 'ended' && kindOf(e) === 'meet' && e.prep?.length);
    if (trip) {
      const done = trip.prep!.filter(p => p.done).length, left = trip.prep!.length - done;
      text += `下次赶集：${trip.title}，车上装了 ${done} 样${left ? `，还有 ${left} 样没装` : '，都装好了'}。`;
    }
    if (this.orchard.length) text += `果园里：${this.orchard.map(o => `${o.title}（${TREE_NAMES[o.stage]}）`).join('、')}。`;
    return text;
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

  private visibleDays(): [number, number] {
    // 往上画到天，往下画到画面底边
    return [Math.floor(this.vc + (this.FY - this.H) / this.RH) - 1, Math.ceil(this.vc + (this.FY - this.SKY) / this.RH)];
  }

  private drawPlots(ctx: CanvasRenderingContext2D, nowH: number, pal: Pal, daylight: number) {
    const [d0, d1] = this.visibleDays();
    const today = dayOf(nowH);
    const dpr = ctx.getTransform().a || 1;
    const lightKey = Math.round(daylight * 16);
    for (let d = d0; d <= d1; d++) {
      const { x, y, w: pw, h: ph } = this.plotOf(d);
      const pad = Math.ceil(ph * 0.06);
      // 周一底下（和周日之间）一排小灌木，分开一周一周
      if (colOf(d) === 0) hedge(ctx, x, this.yAt(d), pw, this.GAP, pal);
      const work = d <= today ? this.tilled.get(d) ?? NO_WORK : NO_WORK;
      const age = (nowH - (d + 1) * 24) / 24;
      const when = d === today ? 'today' : d > today ? 'future' : 'past';
      // 长到哪一步、长草的多少都随日子慢慢变，按天取整就够了
      const grow = when === 'past' ? `${stageOf(age)}.${learnStageOf(age)}.${Math.min(7, Math.floor(age))}` : '';
      const key = `${d}|${when}|${grow}|${workKey(work)}|${lightKey}|${Math.round(pw * dpr)}x${Math.round(ph * dpr)}`;
      let c = this.plots.get(key);
      if (c) {
        // 最近用过的放到最后，满了从最久没用的删起
        this.plots.delete(key); this.plots.set(key, c);
      } else {
        c = document.createElement('canvas');
        c.width = Math.ceil((pw + 2 * pad) * dpr); c.height = Math.ceil((ph + 2 * pad) * dpr);
        const g = c.getContext('2d')!;
        g.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr);
        paintPlot(g, pw, ph, d, work, when, age, pal, daylight >= 0.5);
        this.plots.set(key, c);
        // 一块地的画布不小，留够一屏多一点就行
        if (this.plots.size > 40) this.plots.delete(this.plots.keys().next().value!);
      }
      ctx.drawImage(c, x - pad, y - pad, pw + 2 * pad, ph + 2 * pad);
    }
  }

  /** 桌面上田两边空着的草地：棒棒糖似的树、草垛、小水塘，按行钉住，排满（农民画不留空） */
  private drawMargins(ctx: CanvasRenderingContext2D, pal: Pal) {
    const { X0, RH, W } = this;
    if (X0 < 34) return;
    const [w0, w1] = this.visibleDays();
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
    // 粮仓在右头（手机上“新建”按钮压着它也不要紧），房子挨着它，左边整片是果园
    const hx = W - s * 2.25;
    this.house = { x: hx, w: s * 1.15, ground };
    house(ctx, hx, ground, s * 1.15, s * 0.5, pal, 1 - daylight);
    granary(ctx, W - s * 0.5, ground, s * 0.5, pal);
    hen(ctx, hx + s * 1.33, ground - 2, s * 0.08, pal);
    // 从左往右一棵挨一棵：先种习惯的果树（浇得多的在前），剩下的空位种普通的树
    for (let i = 0, x = s * 0.45; x < hx - s * 0.35; i++, x += s * 0.95) {
      const o = this.orchard[i];
      // 空位隔一个种一棵普通的树，不排成一道篱笆
      if (!o) { if ((i - this.orchard.length) % 2 === 0) folkTree(ctx, x, ground, s * 0.95, pal); continue; }
      fruitTree(ctx, x, ground, s * 0.95, o.stage, pal);
      // 树下的土路上写是哪种习惯
      ctx.save();
      ctx.font = `700 10px ${SANS}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = rgba(pal.ink, 1);
      ctx.fillText(o.title.length > 5 ? o.title.slice(0, 4) + '…' : o.title, x, ground + 2);
      ctx.restore();
    }
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

  /**
   * 白天在今天的地里随钟点走（按手上的农活换动作，赶集时站在摊边），夜里回家坐在门口。
   * 返回他和头顶文字占掉的地方；paint 为 false 时只量不画（先量好让标签让开，最后再画到最前面）
   */
  private drawFarmer(ctx: CanvasRenderingContext2D, f: Frame, nowH: number, live: EventView | undefined, pal: Pal, light: boolean, paint: boolean): Box[] {
    const { W, RH } = this;
    const d = dayOf(nowH), hod = nowH - d * 24;
    const home = (hod >= DAY1 || hod < DAY0) && !live;
    let x: number, y: number, s: number;
    /** 头顶的字牌要高过什么：农夫自己，赶集时还有摊子 */
    let head: number;
    if (home) {
      s = clamp((this.H - this.VIL) * 0.55, 34, 60);
      x = this.house.x + this.house.w * 0.78; y = this.house.ground;
      if (paint) folkFarmer(ctx, x, y, s, 'sit', pal);
      head = s;
    } else {
      const p = this.plotOf(d);
      x = p.x + uIn(hod) * p.w;
      y = p.y + p.h * 0.88;
      if (y < this.SKY + 10 || y > this.VIL) return [];
      s = farmerSize(RH);
      const kind = live ? kindOf(live) : null;
      const market = kind === 'meet' && dayOf(localHours(live!.start)) === d;
      // 赶集：站在摊子右边
      if (market) x = stallX(p.x + uIn(localHours(live!.start) - d * 24) * p.w, p.x + p.w, RH) + stallSize(RH) * 0.5;
      const pose = !kind ? 'walk' : ({ focus: 'hoe', learn: 'sow', habit: 'water', meet: 'walk' } as const)[kind];
      if (paint) folkFarmer(ctx, x, y, s, pose, pal);
      head = market ? Math.max(s, stallSize(RH)) : s;
    }
    // 头顶两行字：“现在”和钟点；忙着的时候换成日程的名字和还要准备几项
    const title = live ? `现在 · ${live.title}` : home ? '现在 · 在家歇着' : '现在';
    const sub = live ? `${JOB[kindOf(live)]} · ${subLabel(live)}` : `${fmtDay(f.now)} ${fmtTime(f.now)}`;
    const ty = Math.max(this.SKY + 34, y - head - 6);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = `700 13px ${SANS}`;
    const w1 = ctx.measureText(title).width;
    ctx.font = `500 12px ${SANS}`;
    const w2 = ctx.measureText(sub).width;
    const half = Math.max(w1, w2) / 2 + 6;
    let tx = clamp(x, half + 4, W - half - 4);
    // 别压住今天的日期牌：挨上了就往右让
    const badge = this.badgeBox(ctx, d, d);
    if (!home && ty + 2 > badge.y0 && ty - 34 < badge.y1 && tx - half < badge.x1) tx = Math.min(W - half - 4, badge.x1 + half + 4);
    const boxes = [
      { x0: tx - half, x1: tx + half, y0: ty - 34, y1: ty + 2 },
      { x0: x - s * 0.4, x1: x + s * 0.6, y0: y - s, y1: y + 4 },
    ];
    if (!paint) { ctx.restore(); return boxes; }
    // 农民画里的字写在一块小牌子上
    tag(ctx, tx - half, ty - 33, half * 2, 35, light ? [255, 248, 232] : [40, 30, 60], pal);
    ctx.fillStyle = light ? rgba(pal.red, 1) : 'rgba(255,236,190,1)';
    ctx.font = `700 13px ${SANS}`;
    ctx.fillText(title, tx, ty - 16);
    ctx.font = `500 12px ${SANS}`;
    ctx.fillStyle = light ? rgba(pal.ink, 0.8) : 'rgba(255,236,190,.8)';
    ctx.fillText(sub, tx, ty);
    ctx.restore();
    return boxes;
  }

  /* ---------- 日程 ---------- */

  /**
   * 还没做的日程是插在地里的小旗（按开始的钟点排开，挨得近的错开），进行中的旗外画一圈红；
   * 做完的在地的下半截留一颗彩珠，写了结论的旁边盖一方小红印。
   */
  private drawEvents(ctx: CanvasRenderingContext2D, events: EventView[], T: number, nowH: number, pal: Pal, light: boolean, reserved: Box[]) {
    const { RH, W } = this;
    const [d0, d1] = this.visibleDays();
    type Item = { ev: EventView; h: number; x: number; y: number; top: number; right: number; ph: number };
    const items: Item[] = [];
    const lanes = new Map<string, [number, number][]>();
    for (const ev of events) {
      const sH = localHours(ev.start);
      const allDay = isAllDay(ev.start, ev.end);
      const d = dayOf(sH);
      if (d < d0 || d > d1) continue;
      const { x: px, y: yTop, w: pw, h: ph } = this.plotOf(d);
      const hod = allDay ? 13 : sH - d * 24;
      const u = uIn(hod);
      const ended = ev.state === 'ended';
      const key = `${d}|${ended ? 1 : 0}`;
      const used = lanes.get(key) ?? [];
      let lane = 0;
      // 挨得近：两面旗的横向距离不到一面旗宽
      const near = clamp(ph * 0.3, 9, 22) / pw;
      while (lane < 2 && used.some(([pu, pl]) => pl === lane && Math.abs(pu - u) < near)) lane++;
      used.push([u, lane]);
      lanes.set(key, used);
      const x = px + u * pw;
      const y = ended ? yTop + ph * (0.8 - lane * 0.16) : yTop + ph * (0.62 - lane * 0.2);
      items.push({ ev, h: allDay ? d * 24 + 13 : sH, x, y, top: y, right: px + pw, ph });
    }

    const labels: Item[] = [];
    // 标签不压住日期牌、摊子和车（农夫在 reserved 里）
    const keep: Box[] = [];
    const today = dayOf(nowH);
    for (let d = d0; d <= d1; d++) keep.push(this.badgeBox(ctx, d, today));
    for (const it of items) {
      const { ev, x, y, ph } = it;
      const color = FLAG[kindOf(ev)];
      if (ev.state === 'ended' && kindOf(ev) === 'habit') {
        // 浇过的树：地里那滴水就是它，点水滴打开；写了结论在旁边盖小红印
        const q = dropSize(ph), wy = this.plotOf(dayOf(it.h)).y + ph * 0.6;
        if (ev.outcome) {
          ctx.fillStyle = rgba(pal.red, 1);
          ctx.fillRect(x + q, wy - q * 1.6, q, q);
          ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1; ctx.strokeRect(x + q, wy - q * 1.6, q, q);
        }
        it.top = wy - q * 1.6;
        this.hits.push({ id: ev.id, x, y: wy + q * 1.4, w: 24, h: 26 });
      } else if (ev.state === 'ended' && kindOf(ev) === 'meet' && ev.outcome) {
        // 赶集回来：一篮换回来的货，结论有几行就几样；旁边盖小红印
        const bs = cartSize(RH) * 0.75;
        const goods = Math.min(4, ev.outcome.split('\n').filter(l => l.trim()).length || 1);
        const top = basket(ctx, x, y, bs, goods, pal);
        const q = bs * 0.22;
        ctx.fillStyle = rgba(pal.red, 1);
        ctx.fillRect(x + bs * 0.55, top, q, q);
        ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1; ctx.strokeRect(x + bs * 0.55, top, q, q);
        it.top = top - 2;
        this.hits.push({ id: ev.id, x, y: y + 2, w: Math.max(bs * 1.4, 24), h: Math.max(y - top + 6, 24) });
      } else if (ev.state === 'live' && kindOf(ev) === 'meet') {
        // 正在赶集：支起一个摊子，农夫站在旁边（drawFarmer）
        const ss = stallSize(RH), sx = stallX(x, it.right, RH);
        const top = stall(ctx, sx, y + ph * 0.2, ss, pal);
        keep.push({ x0: sx - ss * 0.5, x1: sx + ss * 0.5, y0: top, y1: y + ph * 0.2 });
        it.top = top - 2;
        this.hits.push({ id: ev.id, x: sx, y: y + ph * 0.2 + 2, w: Math.max(ss, 24), h: Math.max(ss, 26) });
      } else if (ev.state === 'ended') {
        const r = clamp(ph * 0.06, 2, 5);
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
        // 要赶集、有准备事项的：旗边停一辆车，勾掉的箱子装上车，没勾的空着虚框（只画视角附近的）
        const prep = ev.prep ?? [];
        if (kindOf(ev) === 'meet' && prep.length && Math.abs(it.h - T) < 36) {
          const cs = cartSize(RH), done = prep.filter(p => p.done).length;
          // 停在旗的右边：会前农夫总在旗的左边（更早的钟点），不会压在一起；不出这块地
          const cx = Math.min(x + s * 0.6 + cs * 0.55, it.right - cs * 0.55);
          cart(ctx, cx, y, cs, done, prep.length - done, pal);
          keep.push({ x0: cx - cs * 0.6, x1: cx + cs, y0: y - cs * 1.3, y1: y });
          this.hits.push({ id: ev.id, x: cx, y: y + 2, w: Math.max(cs * 1.6, 24), h: Math.max(cs * 1.3, 24) });
        }
      }
      // 只给视角前后一天半里的写字；进行中的写在农夫头顶
      if (ev.state !== 'live' && Math.abs(it.h - T) < 36) labels.push(it);
    }

    // 标签：离视角近的优先，最多三个，彼此不重叠，也不压住农夫
    labels.sort((a, b) => Math.abs(a.h - T) - Math.abs(b.h - T));
    const taken = [...reserved, ...keep];
    let shown = 0;
    for (const it of labels) {
      if (shown >= 3) break;
      const { ev, x } = it;
      const sub = `${JOB[kindOf(ev)]} · ${subLabel(ev)}`;
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
 * 画一块地（原点在地的左上角）。when：以后、今天、过去；age：这一天过去了几天。
 * 做过的农活各占横向几段：先画车道（赶集），再画播种、耕地，最后点上浇树的水滴；
 * 没动过的地，以后的是浅杏色，过去的长草开花。
 */
function paintPlot(
  g: CanvasRenderingContext2D, pw: number, ph: number, d: number, work: Work,
  when: 'future' | 'today' | 'past', age: number, pal: Pal, light: boolean,
) {
  const seed = d * 31 + 7;
  const ink = rgba(pal.ink, 1);
  const past = when === 'past';
  const used = [...work.focus, ...work.learn, ...work.meet];
  const free = (x: number) => !used.some(([a, b]) => x > a * pw - 3 && x < b * pw + 3);
  // 纹样的大小跟着地的高走（一长条地很宽，横向的多少按宽算）
  const k = clamp(ph / 50, 1, 2);
  const wide = pw / ph;
  wobble(g, pw, ph, seed, ph * 0.05);
  g.fillStyle = rgba(past ? pal.fallow : pal.bare, 1);
  g.fill();
  g.save();
  g.clip();
  const r = rng(seed);
  if (past) {
    // 空着的地长草：人字纹越来越密，过两天开几朵小花
    const n = Math.round((4 + 10 * smooth(0, 6, age)) * wide * 0.8);
    g.strokeStyle = rgba(pal.weed, 1);
    g.lineWidth = 1.1 * k;
    const s = ph * 0.05;
    for (let i = 0; i < n; i++) {
      const x = r() * pw, y = ph * 0.22 + r() * ph * 0.74;
      if (!free(x)) continue;
      g.beginPath(); g.moveTo(x - s, y - s * 1.2); g.lineTo(x, y); g.lineTo(x + s, y - s * 1.2); g.stroke();
    }
    if (age > 2) {
      for (let i = 0; i < Math.round(3 * wide * 0.7); i++) {
        const x = r() * pw, y = ph * 0.25 + r() * ph * 0.7;
        if (!free(x)) continue;
        g.fillStyle = i % 2 ? 'rgba(255,255,255,.95)' : light ? 'rgba(240,106,168,1)' : 'rgba(190,96,140,1)';
        g.beginPath(); g.arc(x, y, Math.max(1.2, ph * 0.032), 0, Math.PI * 2); g.fill();
      }
    }
  } else {
    // 还没动的地：底边一排淡淡的点
    g.fillStyle = 'rgba(255,255,255,.4)';
    const dots = Math.max(8, Math.round(pw / 12));
    for (let i = 0; i < dots; i++) { g.beginPath(); g.arc(4 + (i * (pw - 8)) / (dots - 1), ph - 4 * k, 0.9 * k, 0, Math.PI * 2); g.fill(); }
  }

  const rows = 6;
  const rowY = (j: number) => ph * 0.24 + (j * ph * 0.7) / rows;
  const edges = (sx: number, ex: number) => {
    g.strokeStyle = ink;
    g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, ph); g.moveTo(ex, 0); g.lineTo(ex, ph); g.stroke();
  };

  // 赶集：地没动，压出一条土车道，两道车辙
  for (const [a, b] of work.meet) {
    const sx = a * pw, ex = b * pw, w = ex - sx;
    g.fillStyle = rgba(pal.path, 1);
    g.fillRect(sx, 0, w, ph);
    g.strokeStyle = rgba(pal.rut, 1);
    g.lineWidth = 1.2 * k;
    g.setLineDash([3 * k, 2 * k]);
    for (const t of w > 8 * k ? [0.3, 0.7] : [0.5]) { g.beginPath(); g.moveTo(sx + w * t, 0); g.lineTo(sx + w * t, ph); g.stroke(); }
    g.setLineDash([]);
    edges(sx, ex);
  }

  // 播种：撒下白种子；两周后才冒芽，再长成青苗，三周多开出向日葵
  const ls = past ? learnStageOf(age) : 0;
  for (const [a, b] of work.learn) {
    const sx = a * pw, ex = b * pw;
    g.fillStyle = rgba(ls <= 1 ? pal.soil : pal.young, 1);
    g.fillRect(sx, 0, ex - sx, ph);
    for (let j = 0; j < rows; j++) {
      const y = rowY(j);
      if (ls === 0) {
        g.fillStyle = rgba(pal.seed, 1);
        for (let x = sx + 2; x < ex - 1; x += 4 * k) g.fillRect(x, y, 1.4 * k, 1.4 * k);
      } else if (ls <= 2) {
        leaves(g, sx, ex, y, (ls === 1 ? 0.55 : 1) * k, k, pal);
      }
    }
    if (ls === 3) {
      // 向日葵：一圈黄花瓣，棕色的心
      const fr = Math.max(2.4, ph * 0.07);
      for (let j = 0; j < 3; j++) {
        const y = ph * 0.32 + j * ph * 0.24;
        for (let x = sx + fr + 1 + (j % 2) * fr; x < ex - fr * 0.6; x += fr * 2.6) {
          g.fillStyle = rgba(pal.yellow, 1);
          for (let k = 0; k < 8; k++) {
            const t = (k / 8) * Math.PI * 2;
            g.beginPath(); g.ellipse(x + Math.cos(t) * fr * 0.7, y + Math.sin(t) * fr * 0.7, fr * 0.42, fr * 0.2, t, 0, Math.PI * 2); g.fill();
          }
          g.fillStyle = rgba(pal.soil, 1);
          g.beginPath(); g.arc(x, y, fr * 0.42, 0, Math.PI * 2); g.fill();
        }
      }
    }
    edges(sx, ex);
  }

  // 耕地：今天是红土黄垄，撒了种的是白点，过几天冒芽、长成青苗，两周左右熟成金黄
  const st = when === 'today' ? -1 : past ? stageOf(age) : -1;
  for (const [a, b] of work.focus) {
    const sx = a * pw, ex = b * pw;
    const tilled = st <= 0;
    g.fillStyle = rgba(tilled ? pal.soil : st <= 2 ? pal.young : st === 3 ? pal.ripen : pal.ripe, 1);
    g.fillRect(sx, 0, ex - sx, ph);
    for (let j = 0; j < rows; j++) {
      const y = rowY(j);
      if (tilled) {
        const dot = st === 0;
        g.fillStyle = rgba(dot ? pal.seed : pal.furrow, 1);
        for (let x = sx + 2; x < ex - 1; x += 4 * k) g.fillRect(x, y, (dot ? 1.4 : 2.4) * k, (dot ? 1.4 : 1.3) * k);
      } else if (st <= 2) {
        leaves(g, sx, ex, y, (st === 1 ? 0.6 : 1) * k, k, pal);
      } else {
        // 穗子：一排排人字
        g.strokeStyle = rgba(pal.ear, 1);
        g.lineWidth = k;
        const e = 1.6 * k;
        for (let x = sx + 2.5; x < ex - 1; x += 4.5 * k) {
          g.beginPath(); g.moveTo(x - e, y + e); g.lineTo(x, y); g.lineTo(x + e, y + e); g.stroke();
        }
      }
    }
    edges(sx, ex);
  }

  // 浇树：习惯一般很短，不占一条地，只在那个钟点留一滴水
  for (const [a, b] of work.habit) {
    const x = ((a + b) / 2) * pw, y = ph * 0.6, q = dropSize(ph);
    g.fillStyle = rgba(mixc(pal.water, [255, 255, 255], 0.35), 1);
    g.beginPath(); g.ellipse(x, y + q * 1.1, q * 1.1, q * 0.35, 0, 0, Math.PI * 2); g.fill();
    g.beginPath();
    g.moveTo(x, y - q * 1.3);
    g.bezierCurveTo(x + q * 0.9, y - q * 0.2, x + q * 0.7, y + q * 0.7, x, y + q * 0.7);
    g.bezierCurveTo(x - q * 0.7, y + q * 0.7, x - q * 0.9, y - q * 0.2, x, y - q * 1.3);
    g.fillStyle = rgba(pal.water, 1);
    g.fill();
    g.strokeStyle = ink; g.lineWidth = 1; g.stroke();
  }
  g.restore();

  wobble(g, pw, ph, seed, ph * 0.05);
  g.strokeStyle = ink;
  g.lineWidth = clamp(ph * 0.03, 1.4, 2.4);
  g.stroke();

  // 日子：左上角一块小牌子写几月几日周几，今天是红牌、前面加“今天”
  const today = when === 'today';
  const text = dayText(d, today);
  const { br, tw } = badgeSize(g, text, ph);
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

/** 一排成对的叶子（芽和苗）。k：叶子多大；step：间距按多大算 */
function leaves(g: CanvasRenderingContext2D, sx: number, ex: number, y: number, k: number, step: number, pal: Pal) {
  g.fillStyle = rgba(pal.leaf, 1);
  for (let x = sx + 2.5; x < ex - 1; x += 5 * step) {
    g.beginPath();
    g.ellipse(x - 1.2 * k, y, 1.8 * k, 0.9 * k, -0.6, 0, Math.PI * 2);
    g.ellipse(x + 1.2 * k, y, 1.8 * k, 0.9 * k, 0.6, 0, Math.PI * 2);
    g.fill();
  }
}

/** 一天的农活写成一串，做缓存的键 */
function workKey(w: Work): string {
  return (Object.keys(w) as Kind[]).map(k => w[k].map(s => s.map(v => v.toFixed(3)).join('-')).join(',')).join('/');
}

/* ---------- 点景 ---------- */

/** 果树：树苗两片叶子，小树一团小冠，大树满冠，开花点满粉白的花，结果挂满红果 */
function fruitTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, stage: number, pal: Pal) {
  const ink = rgba(pal.ink, 1);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.4;
  // 树下一小圈浇过水的湿土
  ctx.fillStyle = rgba(mixc(pal.path, pal.soil, 0.45), 1);
  ctx.beginPath(); ctx.ellipse(x, y, s * 0.22, s * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  if (stage === 0) {
    ctx.strokeStyle = rgba(pal.trunk, 1); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 0.3); ctx.stroke();
    ctx.fillStyle = rgba(pal.leaf, 1); ctx.strokeStyle = ink; ctx.lineWidth = 1;
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + k * s * 0.07, y - s * 0.3, s * 0.08, s * 0.035, k * -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    return;
  }
  const trunk = stage === 1 ? 0.32 : 0.45, cr = stage === 1 ? 0.18 : 0.3;
  ctx.fillStyle = rgba(pal.trunk, 1);
  ctx.fillRect(x - s * 0.035, y - s * trunk, s * 0.07, s * trunk);
  ctx.strokeRect(x - s * 0.035, y - s * trunk, s * 0.07, s * trunk);
  const cy = y - s * (trunk + cr * 0.8);
  ctx.fillStyle = rgba(pal.young, 1);
  ctx.beginPath(); ctx.arc(x, cy, s * cr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = rgba(pal.leaf, 1);
  const r = rng(Math.round(x));
  for (let i = 0; i < (stage === 1 ? 4 : 9); i++) {
    const t = r() * Math.PI * 2, d = r() * cr * 0.7;
    ctx.beginPath(); ctx.ellipse(x + Math.cos(t) * s * d, cy + Math.sin(t) * s * d, s * 0.05, s * 0.025, t, 0, Math.PI * 2); ctx.fill();
  }
  if (stage >= 3) {
    for (let i = 0; i < 9; i++) {
      const t = (i / 9) * Math.PI * 2 + 0.3, d = (i % 3 === 0 ? 0.25 : 0.62) * cr;
      const fx = x + Math.cos(t) * s * d, fy = cy + Math.sin(t) * s * d;
      if (stage === 3) {
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,1)' : 'rgba(246,150,190,1)';
        ctx.beginPath(); ctx.arc(fx, fy, s * 0.032, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = rgba(pal.red, 1);
        ctx.beginPath(); ctx.arc(fx, fy, s * 0.042, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 0.9; ctx.stroke();
      }
    }
  }
}

/** 棒棒糖似的树：一根树干，一团圆冠，冠上一圈浅绿的叶纹（不开花不结果，和果园的果树分得开） */
function folkTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Pal) {
  ctx.strokeStyle = rgba(pal.ink, 1);
  ctx.lineWidth = 1.5;
  ctx.fillStyle = rgba(pal.trunk, 1);
  ctx.fillRect(x - s * 0.04, y - s * 0.45, s * 0.08, s * 0.45);
  ctx.strokeRect(x - s * 0.04, y - s * 0.45, s * 0.08, s * 0.45);
  ctx.fillStyle = rgba(pal.crown, 1);
  ctx.beginPath(); ctx.arc(x, y - s * 0.7, s * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = rgba(pal.dot, 1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * s * 0.18, y - s * 0.7 + Math.sin(a) * s * 0.18, s * 0.065, s * 0.032, a, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y - s * 0.7, s * 0.05, 0, Math.PI * 2); ctx.fill();
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

/** 日期牌上的字 */
function dayText(d: number, today: boolean): string {
  const date = new Date(noonOf(d));
  return `${today ? '今天 · ' : ''}${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

/** 日期牌的半高和宽（会顺手把字体设好） */
function badgeSize(g: CanvasRenderingContext2D, text: string, ph: number) {
  const br = clamp(ph * 0.1, 7, 10);
  g.font = `700 ${br * 1.15}px ${SANS}`;
  return { br, tw: Math.max(br * 2, g.measureText(text).width + br * 0.8) };
}

/** 浇树留下的那滴水多大 */
const dropSize = (ph: number) => Math.max(3, ph * 0.08);

/** 周一和周日之间的一排小灌木：圆圆的，点几个浅绿点 */
function hedge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, gap: number, pal: Pal) {
  const r = gap * 0.85, n = Math.floor(w / (r * 2.6));
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = rgba(pal.ink, 1);
  for (let i = 0; i < n; i++) {
    const cx = x + (i + 0.5) * (w / n);
    ctx.fillStyle = rgba(pal.crown, 1);
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rgba(pal.dot, 1);
    ctx.beginPath(); ctx.arc(cx - r * 0.3, y - r * 0.25, r * 0.22, 0, Math.PI * 2); ctx.fill();
  }
}

/** 车、摊子的大小（跟着一行的高） */
const cartSize = (rh: number) => clamp(rh * 0.36, 11, 24);
const stallSize = (rh: number) => clamp(rh * 0.85, 24, 56);
/** 地里的农夫多高 */
const farmerSize = (rh: number) => clamp(rh * 0.62, 30, 66);
/** 摊子的中间：开会那个钟点稍靠左；夜里的会挤在地的右头，要给摊子和站在右边的农夫留出地方 */
const stallX = (x: number, right: number, rh: number) => Math.min(x - stallSize(rh) * 0.1, right - stallSize(rh) * 0.5 - farmerSize(rh) * 0.45);

/**
 * 独轮车：木车斗、一个轮子、车把。车斗上码箱子（三只一层）：先是装好的 loaded 只，
 * 后面 waiting 只还没装的只画一个虚框。x 是车斗中间，y 是地面
 */
function cart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, loaded: number, waiting: number, pal: Pal) {
  const ink = rgba(pal.ink, 1);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  // 车把
  ctx.strokeStyle = rgba(pal.trunk, 1); ctx.lineWidth = Math.max(1.4, s * 0.08);
  ctx.beginPath(); ctx.moveTo(x + s * 0.4, y - s * 0.45); ctx.lineTo(x + s * 0.95, y - s * 0.2); ctx.stroke();
  // 轮子
  const wr = s * 0.22;
  ctx.fillStyle = 'rgba(122,74,30,1)'; ctx.strokeStyle = ink; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.arc(x - s * 0.2, y - wr, wr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - s * 0.2 - wr, y - wr); ctx.lineTo(x - s * 0.2 + wr, y - wr); ctx.moveTo(x - s * 0.2, y - 2 * wr); ctx.lineTo(x - s * 0.2, y); ctx.stroke();
  // 车斗
  const bt = y - s * 0.62, bb = y - s * 0.32;
  ctx.fillStyle = 'rgba(196,128,64,1)';
  ctx.beginPath(); ctx.moveTo(x - s * 0.5, bt); ctx.lineTo(x + s * 0.5, bt); ctx.lineTo(x + s * 0.4, bb); ctx.lineTo(x - s * 0.4, bb); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // 箱子
  const q = s * 0.3;
  for (let i = 0; i < Math.min(loaded + waiting, 6); i++) {
    const layer = Math.floor(i / 3), k = i % 3;
    const cx = x - s * 0.45 + k * q * 1.02 + layer * q * 0.5, cy = bt - q * (layer + 1);
    if (i < loaded) crate(ctx, cx, cy, q, pal);
    else {
      ctx.strokeStyle = rgba(pal.ink, 0.8); ctx.lineWidth = 0.9; ctx.setLineDash([1.5, 1.5]);
      ctx.strokeRect(cx, cy, q, q);
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

function crate(ctx: CanvasRenderingContext2D, x: number, y: number, q: number, pal: Pal) {
  ctx.fillStyle = rgba(pal.yellow, 1);
  ctx.fillRect(x, y, q, q);
  ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 0.9;
  ctx.strokeRect(x, y, q, q);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + q, y + q); ctx.moveTo(x + q, y); ctx.lineTo(x, y + q); ctx.stroke();
}

/** 竹篮：编出来的半圆篮子，上面冒出 goods 样货（红果、黄梨、绿菜、紫茄）。返回最高处的 y */
function basket(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, goods: number, pal: Pal): number {
  const ink = rgba(pal.ink, 1);
  const colors: RGB[] = [pal.red, pal.yellow, pal.leaf, [150, 70, 160]];
  const r = s * 0.2;
  for (let i = 0; i < goods; i++) {
    const gx = x + (i - (goods - 1) / 2) * r * 1.5, gy = y - s * 0.5 - (i % 2) * r * 0.5;
    ctx.fillStyle = rgba(colors[i % colors.length], 1);
    ctx.beginPath(); ctx.arc(gx, gy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = 0.9; ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x - s * 0.55, y - s * 0.5);
  ctx.lineTo(x + s * 0.55, y - s * 0.5);
  ctx.quadraticCurveTo(x + s * 0.5, y, x, y);
  ctx.quadraticCurveTo(x - s * 0.5, y, x - s * 0.55, y - s * 0.5);
  ctx.closePath();
  ctx.fillStyle = 'rgba(201,161,91,1)';
  ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(140,96,40,1)'; ctx.lineWidth = 0.8;
  for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(x + k * s * 0.18, y - s * 0.5); ctx.lineTo(x + k * s * 0.12, y); ctx.stroke(); }
  ctx.restore();
  return y - s * 0.5 - r * 1.6;
}

/** 集市的摊子：两根竹竿，红白条的布棚，木桌上摆几样货。x 是摊子中间，y 是地面；返回棚顶的 y */
function stall(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: Pal): number {
  const ink = rgba(pal.ink, 1);
  const w = s * 0.9, top = y - s * 0.95;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(pal.trunk, 1); ctx.lineWidth = Math.max(1.4, s * 0.04);
  ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w / 2, top); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, top); ctx.stroke();
  // 桌子和货
  ctx.fillStyle = 'rgba(196,128,64,1)'; ctx.strokeStyle = ink; ctx.lineWidth = 1.1;
  ctx.fillRect(x - w * 0.45, y - s * 0.38, w * 0.9, s * 0.14); ctx.strokeRect(x - w * 0.45, y - s * 0.38, w * 0.9, s * 0.14);
  const colors: RGB[] = [pal.red, pal.yellow, pal.leaf, pal.water];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = rgba(colors[i], 1);
    ctx.beginPath(); ctx.arc(x - w * 0.33 + i * w * 0.22, y - s * 0.43, s * 0.06, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // 布棚：红白相间，下沿一排扇贝边
  const n = 5, sw = (w * 1.2) / n, bx = x - w * 0.6, bh = s * 0.22;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(bx + i * sw, top);
    ctx.lineTo(bx + (i + 1) * sw, top);
    ctx.lineTo(bx + (i + 1) * sw, top + bh);
    ctx.arc(bx + (i + 0.5) * sw, top + bh, sw / 2, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? 'rgba(255,248,232,1)' : rgba(pal.red, 1);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  return top;
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

/**
 * 农夫：黄斗笠、红褂子、蓝裤子。walk 扛着锄头站着，hoe 弯腰锄地，sow 挎着篮子撒种，
 * water 提一桶水，sit 坐在小凳上
 */
function folkFarmer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pose: 'walk' | 'hoe' | 'sow' | 'water' | 'sit', pal: Pal) {
  const ink = rgba(pal.ink, 1);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const hoe = pose === 'hoe', sit = pose === 'sit';
  const lean = hoe ? 0.22 : 0;
  // 锄头（撒种、提水时手上不拿）
  const tool = pose !== 'sow' && pose !== 'water';
  ctx.strokeStyle = 'rgba(122,74,30,1)';
  ctx.lineWidth = Math.max(1.4, s * 0.04);
  ctx.beginPath();
  if (hoe) { ctx.moveTo(x - s * 0.02, y - s * 0.56); ctx.lineTo(x + s * 0.44, y - s * 0.02); }
  else if (sit) { ctx.moveTo(x + s * 0.32, y); ctx.lineTo(x + s * 0.2, y - s * 0.75); }
  else if (tool) { ctx.moveTo(x - s * 0.25, y - s * 0.75); ctx.lineTo(x + s * 0.3, y - s * 0.38); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(154,160,166,1)';
  if (hoe) ctx.fillRect(x + s * 0.38, y - s * 0.06, s * 0.16, s * 0.08);
  else if (tool && !sit) ctx.fillRect(x - s * 0.32, y - s * 0.8, s * 0.1, s * 0.14);
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

  // 撒种：一只手往前伸，撒出一道白点，腰间挎个篮子
  if (pose === 'sow') {
    ctx.strokeStyle = rgba(pal.red, 1); ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.beginPath(); ctx.moveTo(x + s * 0.05, by - s * 0.08); ctx.lineTo(x + s * 0.3, by - s * 0.14); ctx.stroke();
    ctx.fillStyle = 'rgba(255,248,220,1)';
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      ctx.beginPath(); ctx.arc(x + s * (0.36 + 0.2 * t), by - s * 0.12 + s * 0.5 * t * t, Math.max(1, s * 0.025), 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(201,161,91,1)'; ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x - s * 0.17, by + s * 0.12, s * 0.11, s * 0.07, 0, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // 提水：一只手垂下，提一只木桶，桶里是蓝水
  if (pose === 'water') {
    ctx.strokeStyle = rgba(pal.red, 1); ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.beginPath(); ctx.moveTo(x + s * 0.06, by - s * 0.06); ctx.lineTo(x + s * 0.2, by + s * 0.12); ctx.stroke();
    const bx = x + s * 0.24, bt = by + s * 0.14, bw = s * 0.14, bh = s * 0.14;
    ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(bx, bt, bw * 0.5, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = 'rgba(160,110,60,1)';
    ctx.beginPath(); ctx.moveTo(bx - bw * 0.5, bt); ctx.lineTo(bx + bw * 0.5, bt); ctx.lineTo(bx + bw * 0.4, bt + bh); ctx.lineTo(bx - bw * 0.4, bt + bh); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = rgba(pal.water, 1);
    ctx.beginPath(); ctx.ellipse(bx, bt, bw * 0.45, bw * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/**
 * 每天做过的农活：日程占着、而且已经过去的时段（到 nowH 为止），按类型换成地里横向的几段（0–1）。
 * 同一类型叠在一起的只算一次；全天日程不算；跨午夜的拆到两天里。
 */
function tillage(events: EventView[], nowH: number): Map<number, Work> {
  const raw = new Map<number, Work>();
  for (const ev of events) {
    if (isAllDay(ev.start, ev.end)) continue;
    const s = localHours(ev.start), e = Math.min(localHours(ev.end), nowH);
    if (e <= s) continue;
    const kind = kindOf(ev);
    for (let d = dayOf(s); d * 24 < e; d++) {
      const a = uIn(Math.max(s, d * 24) - d * 24), b = uIn(Math.min(e, (d + 1) * 24) - d * 24);
      // 浇树只留一滴水，再短也要记下；别的农活太短（夜里挤在两头）就不画
      if (b - a < 1e-3 && kind !== 'habit') continue;
      let work = raw.get(d);
      if (!work) raw.set(d, (work = { focus: [], learn: [], meet: [], habit: [] }));
      work[kind].push([a, b]);
    }
  }
  for (const work of raw.values()) {
    for (const k of Object.keys(work) as Kind[]) {
      const list = work[k].sort((p, q) => p[0] - q[0]);
      const merged: Spans = [];
      for (const [a, b] of list) {
        const last = merged[merged.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], b);
        else merged.push([a, b]);
      }
      work[k] = merged;
    }
  }
  return raw;
}

/** 果园：每种习惯（按标题）一棵树，按近两个月做完了几次长大；浇得多的排前面 */
function orchardOf(events: EventView[], now: number): Orchard[] {
  const times = new Map<string, number>();
  for (const ev of events) {
    if (ev.state !== 'ended' || ev.end < now - 60 * DAY || kindOf(ev) !== 'habit') continue;
    const t = ev.title.trim();
    times.set(t, (times.get(t) ?? 0) + 1);
  }
  return [...times].map(([title, n]) => ({ title, times: n, stage: TREE_AT.filter(k => n >= k).length - 1 }))
    .sort((a, b) => b.times - a.times || a.title.localeCompare(b.title));
}

/** 第 d 天的中午（毫秒），用来取日期 */
function noonOf(d: number): number {
  const guess = d * DAY + 12 * HOUR;
  return guess + new Date(guess).getTimezoneOffset() * MINUTE;
}
