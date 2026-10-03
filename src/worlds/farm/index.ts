import type { World } from '../world';
import type { EventView, Frame, Kind } from '../../model/types';
import { kindOf } from '../../model/kind';
import { DAY, HOUR, MINUTE, fmtTime, isAllDay, localHours } from '../../model/time';
import { daylightAt } from '../../model/daylight';
import { type RGB, SANS, clamp, mixc, mod, rgba, rng, smooth } from '../hike/paint';
import { subLabel } from '../climb';

/**
 * 农场世界：农民画。按种什么来分地，日子留在一垄一垄的庄稼里。
 *
 * 从上往下：一条天；麦田（专注）和菜园（学习）；集市（会议）；果园（习惯）；一条村子。地的位置固定。
 *
 * 麦田、菜园里一垄是一天：最下面（田的前头）一垄是视角所在的那天，往上依次是前一天、再前一天，共 15 垄。
 * 那天这类事做了几小时，这一垄就翻多长（8 小时翻满，多了按比例收）：一个日程一段，
 * 做过的部分按日子长到哪一步画（麦子：今天红土黄垄，昨天白种子，两三天冒芽，一周青苗，两周熟成金黄；
 * 菜园：种子两周不见动静，之后冒芽、长苗，三周多开向日葵），还没做的部分是一段虚框。那天没做事，垄空着长草。
 * 拖动时所有田的垄一起滚，手指下的垄跟着手指走：往上推，以后的日子从田的前头滚上来（只有虚框）；往下拉，看更早的。
 * 田头插两面小旗：这类事接下来的两个日程。
 *
 * 集市：会前集市口停着下一次会的车，准备事项是车上的木箱（勾掉的装好、没勾的空着虚框）；
 * 开会时摊子支起来，农夫站在摊边；会后写了结论，带回的一篮货堆在仓房门口。
 * 果园：每种习惯一棵果树，按近两个月做完几次长大、开花、结果；正在做时农夫提桶站在树边。
 * 村子：房子和粮仓。不忙的时候农夫在门口，夜里坐在门口歇着。
 *
 * 回望：两块田拉长成五周（35 垄），集市和果园淡掉，换成一座大粮仓和这五周的收成。过渡 0.8 秒。
 *
 * 画风：户县农民画——大块饱和的平涂、粗墨线、满纹样，不讲透视；全部用代码画。
 * 明暗跟着视角所在的时间：白天和夜里各一套颜色，按白天程度混合；早晚天空染橙红。
 */

/** 夜里从几点到几点：没有日程时农夫回家坐着 */
const NIGHT0 = 22, NIGHT1 = 6;
/** 一垄翻满是几小时 */
const FULL = 8;
/** 平时、回望时各看几垄 */
const ROWS = 15, OV_ROWS = 35;
/** 回望的过渡要多久（秒） */
const OV_SEC = 0.8;
/** 屏幕矮时：田至少多高（一垄 5 像素），集市、果园最少收到多高 */
const FIELD_MIN = ROWS * 5 + 8, MARKET_MIN = 56, ORCHARD_MIN = 64;
/** 粮仓装满要耕多少小时地（五周、每天两三小时） */
const GRANARY_FULL = 80;

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


/** 能点的东西：x 是中线，y 是下沿 */
interface Hit { id: string; x: number; y: number; w: number; h: number }
/** 种在田里的两类：麦田是专注，菜园是学习 */
type FieldKind = 'focus' | 'learn';
/** 一垄里的一段：一个日程在这天占几小时（叠在前面日程上的部分不算），已经做了几小时 */
interface Seg { ev: EventView; hours: number; done: number }

/** 本地小时数 → 第几天（本地午夜为界） */
const dayOf = (h: number) => Math.floor(h / 24);

/** 麦子长到哪一步：0 种子 1 冒芽 2 青苗 3 转黄 4 熟了（age：那天过去了几天） */
const stageOf = (age: number) => (age < 1 ? 0 : age < 3 ? 1 : age < 8 ? 2 : age < 15 ? 3 : 4);
/** 菜园长到哪一步：0 种子（两周不见动静）1 冒芽 2 青苗 3 开花 */
const learnStageOf = (age: number) => (age < 14 ? 0 : age < 18 ? 1 : age < 24 ? 2 : 3);

/** 果树：近两个月浇过几次 → 树苗、小树、大树、开花、结果 */
const TREE_AT = [1, 3, 7, 14, 21];
const TREE_NAMES = ['树苗', '小树', '大树', '开花', '结果'];
/** 一种习惯一棵树：做完几次、长到哪一步，点树打开哪个日程 */
interface Orchard { title: string; times: number; stage: number; id: string }
/** 回望里的收成：从哪天起，耕地、播种几小时，赶集、浇树几次，粮仓装了几成 */
interface Harvest { from: string; focus: number; learn: number; meets: number; habits: number; fill: number }

export class FarmWorld implements World {
  readonly id = 'farm';
  readonly name = '农场';

  private W = 0; private H = 0;
  private insetTop = 0; private insetBottom = 0;
  /** 天那一条的下沿、村子那一条的上沿 */
  private SKY = 0; private VIL = 0;
  /** 地的左边和总宽（桌面上不超过 760，两边是草地） */
  private X0 = 0; private FW = 0;
  /** 两块田的上下沿、田头那一条有多高、集市和果园各自的上下沿 */
  private fieldTop = 0; private fieldBottom = 0; private headH = 0;
  private mTop = 0; private mBottom = 0; private oTop = 0; private oBottom = 0;
  /** 视角所在的那天（连续，今天是整数），真实的今天 */
  private V = 0; private today = 0;
  /** 每块田每天的那一垄（键：类型|第几天） */
  private segs = new Map<string, Seg[]>();
  private orchard: Orchard[] = [];
  private harvest: Harvest | null = null;
  private hits: Hit[] = [];
  /** 画好的垄：内容、光、尺寸没变就直接贴 */
  private rows = new Map<string, HTMLCanvasElement>();
  private grain: CanvasPattern | null = null;
  private grassTile: { key: string; pattern: CanvasPattern } | null = null;
  /** 回望：ov 从 0（眼前）走到 1（五周），e 是缓动后的值；ovT 是上一帧的时刻 */
  private ov = 0; private ovTarget = 0; private ovT = 0; private e = 0;
  /** 这一帧摆好的东西：农夫要站过去的地方 */
  private stallSpot = { x: 0, y: 0 };
  private treeSpot = new Map<string, number>();
  private orchardGround = 0;
  private house = { x: 0, w: 0, ground: 0 };

  constructor(_invalidate: () => void) { /* 全部用代码画，没有要等的素材 */ }

  resize(w: number, h: number, insets: { top: number; bottom: number }) {
    this.W = w; this.H = h;
    this.insetTop = insets.top; this.insetBottom = insets.bottom;
    let sky = clamp(h * 0.13, 90, 130), vil = clamp(h * 0.09, 60, 90);
    this.FW = Math.min(w - 24, 760);
    this.X0 = (w - this.FW) / 2;
    const room = h - insets.top - insets.bottom - sky - vil;
    this.headH = 26;
    let marketH = clamp(room * 0.2, 96, 140), orchardH = clamp(room * 0.24, 120, 170);
    // 横屏手机、很矮的窗口：先保住田（一垄至少 5 像素），从集市、果园收起，不够再收天和村子
    let need = FIELD_MIN - (room - 4 - marketH - orchardH - this.headH - 38);
    if (need > 0) {
      const slack = marketH - MARKET_MIN + orchardH - ORCHARD_MIN;
      const t = Math.min(1, need / slack);
      marketH -= (marketH - MARKET_MIN) * t; orchardH -= (orchardH - ORCHARD_MIN) * t;
      need -= slack * t;
      const fromSky = clamp(need, 0, sky - 64); sky -= fromSky; need -= fromSky;
      vil -= clamp(need, 0, vil - 56);
    }
    this.SKY = insets.top + sky;
    this.VIL = h - insets.bottom - vil;
    this.oBottom = this.VIL - 4;
    this.oTop = this.oBottom - orchardH;
    this.mBottom = this.oTop;
    this.mTop = this.mBottom - marketH;
    this.fieldTop = this.SKY + 38;
    // 再矮也不让田的上下沿颠倒（那样一垄的高度是零或负的）；挤不下时集市压在田头上
    this.fieldBottom = Math.max(this.mTop - this.headH, this.fieldTop + 8 + ROWS);
    this.rows.clear();
  }

  /** 两块田的左边和宽：麦田在左、宽一些，菜园在右 */
  private fieldRect(kind: FieldKind) {
    const { X0, FW } = this;
    return kind === 'focus' ? { x: X0, w: FW * 0.58 } : { x: X0 + FW * 0.61, w: FW * 0.39 };
  }

  /** 此刻一垄多高（回望时 35 垄挤进同一块田） */
  private rowH() {
    return (this.fieldBottom - this.fieldTop - 8) / (ROWS + (OV_ROWS - ROWS) * this.e);
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame) {
    const T = localHours(f.view), nowH = localHours(f.now);
    this.today = dayOf(nowH);
    // 视角在哪天：今天是整数，拖多少小时就滚多少垄
    this.V = this.today + (T - nowH) / 24;
    this.segs = segments(f.events, nowH);
    this.orchard = orchardOf(f.events, f.now);
    this.stepOverview();
    this.harvest = this.measure(f.events, nowH);
    const hod = mod(T, 24);
    const daylight = daylightAt(f.view);
    const pal = palAt(daylight);
    const light = daylight >= 0.5;
    const live = f.events.find(e => e.state === 'live' && !isAllDay(e.start, e.end));

    this.hits = [];
    this.drawGrass(ctx, pal, daylight);
    this.drawMargins(ctx, pal);
    this.drawField(ctx, 'focus', nowH, pal, daylight, light);
    this.drawField(ctx, 'learn', nowH, pal, daylight, light);
    // 回望时田头的小旗、集市、果园都淡掉
    const fade = 1 - smooth(0, 0.4, this.e);
    if (fade > 0.01) {
      ctx.save();
      ctx.globalAlpha = fade;
      this.drawHeads(ctx, f.events, nowH, pal, light);
      this.drawMarket(ctx, f.events, f.now, live, pal, light);
      this.drawOrchard(ctx, live, pal, light);
      ctx.restore();
    }
    this.drawVillage(ctx, pal, daylight);
    this.drawSky(ctx, hod, daylight, pal);
    this.drawOverview(ctx, pal, light);
    this.drawGrain(ctx);
    if (fade > 0.01) {
      ctx.save();
      ctx.globalAlpha = fade;
      this.drawFarmer(ctx, f, nowH, live, pal, light);
      ctx.restore();
    }
    if (this.ovTarget) this.hits = [];
  }

  dragHours(_x: number, _y: number, _dx: number, dy: number): number {
    // 回望时整块田都在眼前，不用拖
    if (this.ovTarget) return 0;
    // 手指下的垄跟着手指走：往上推一垄就是往后一天
    return (-dy / this.rowH()) * 24;
  }

  hitTest(x: number, y: number): string | null {
    // 先找正好点中的（垄很窄时，相邻的垄、相邻的短日程不会抢）；没有再放宽到至少 16×18、下边多 4
    for (const loose of [false, true]) {
      for (let i = this.hits.length - 1; i >= 0; i--) {
        const h = this.hits[i];
        const w = loose ? Math.max(h.w, 16) : h.w, hh = loose ? Math.max(h.h, 18) : h.h;
        const bottom = h.y - (h.h - hh) / 2 + (loose ? 4 : 0);
        if (Math.abs(x - h.x) <= w / 2 && y <= bottom && y >= bottom - hh - (loose ? 4 : 0)) return h.id;
      }
    }
    return null;
  }

  isAnimating() { return this.ov !== this.ovTarget; }

  setOverview(on: boolean, instant: boolean) {
    this.ovTarget = on ? 1 : 0;
    if (instant) this.ov = this.ovTarget;
    this.ovT = performance.now();
  }

  idleRedrawMs() {
    // 今天那一垄一小时只长几个像素，按分钟重画就够了
    return 60_000;
  }

  describe(f: Frame): string {
    const nowH = localHours(f.now), today = dayOf(nowH);
    const done = (k: FieldKind) => Math.round((this.segs.get(`${k}|${today}`) ?? []).reduce((n, s) => n + s.done, 0) * 10) / 10;
    let text = '农场按种什么分地：麦田是专注，菜园是学习，一垄一天，最下面一垄是'
      + (Math.abs(this.V - today) < 0.5 ? '今天' : '正在看的那天')
      + '；那天做了几小时，这一垄就翻多长，过些天长成庄稼，没做事的日子长草。会议是去集市，习惯是浇果园里的树。'
      + `今天耕地约 ${done('focus')} 小时，播种约 ${done('learn')} 小时。`;
    const trip = f.events.filter(e => (e.state === 'future' || e.state === 'soon') && kindOf(e) === 'meet').sort((a, b) => a.start - b.start)[0];
    if (trip?.prep?.length) {
      const n = trip.prep.filter(p => p.done).length, left = trip.prep.length - n;
      text += `下次赶集：${trip.title}，车上装了 ${n} 样${left ? `，还有 ${left} 样没装` : '，都装好了'}。`;
    }
    if (this.ovTarget && this.harvest) {
      const h = this.harvest;
      text += `正在回望${h.from}到今天：耕地约 ${h.focus} 小时，播种约 ${h.learn} 小时，赶集 ${h.meets} 次，浇树 ${h.habits} 次。`;
    }
    if (this.orchard.length) text += `果园里：${this.orchard.map(o => `${o.title}（${TREE_NAMES[o.stage]}）`).join('、')}。`;
    return text;
  }

  /** 回望的过渡往前走一帧 */
  private stepOverview() {
    const t = performance.now();
    if (this.ov !== this.ovTarget) {
      const d = Math.min(0.1, (t - this.ovT) / 1000) / OV_SEC;
      this.ov = this.ov < this.ovTarget ? Math.min(this.ovTarget, this.ov + d) : Math.max(this.ovTarget, this.ov - d);
    }
    this.ovT = t;
    this.e = this.ov * this.ov * (3 - 2 * this.ov);
  }

  /** 近五周的收成 */
  private measure(events: EventView[], nowH: number): Harvest {
    const today = dayOf(nowH), d0 = today - OV_ROWS + 1;
    const hours = (k: FieldKind) => {
      let n = 0;
      for (let d = d0; d <= today; d++) for (const s of this.segs.get(`${k}|${d}`) ?? []) n += s.done;
      return Math.round(n);
    };
    const count = (k: Kind) => events.filter(e => e.state === 'ended' && kindOf(e) === k && dayOf(localHours(e.start)) >= d0).length;
    const date = new Date(noonOf(d0));
    const focus = hours('focus');
    return {
      from: `${date.getMonth() + 1}月${date.getDate()}日`,
      focus, learn: hours('learn'), meets: count('meet'), habits: count('habit'),
      fill: clamp(focus / GRANARY_FULL, 0, 1),
    };
  }

  /* ---------- 地面 ---------- */

  /** 草地：满地小点，钉在屏幕上 */
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
    ctx.fillStyle = this.grassTile.pattern;
    ctx.fillRect(0, this.SKY, this.W, this.H - this.SKY);
  }

  /** 桌面上地两边空着的草地：棒棒糖似的树、草垛、小水塘，排满（农民画不留空） */
  private drawMargins(ctx: CanvasRenderingContext2D, pal: Pal) {
    const { X0, W } = this;
    if (X0 < 40) return;
    const room = X0 - 16, s = Math.min(90, room * 0.9);
    const cols = Math.max(1, Math.floor(room / (s * 0.9))), rows = Math.floor((this.VIL - this.SKY - 20) / (s * 1.1));
    for (const side of [-1, 1]) {
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const r = rng((side + 2) * 1000 + i * 31 + j * 7);
        const v = r(), k = r(), kind = r();
        if (v > 0.65) continue;
        const cx = (j + 0.3 + 0.4 * k) * (room / cols);
        const x = side < 0 ? 8 + cx : W - 8 - cx;
        const y = this.SKY + 20 + (i + 0.8 + 0.2 * r()) * s * 1.1;
        // 集市那条土路横贯全屏，路上不种东西
        if (y > this.mTop + 20 && y - s < this.mTop + 30 + clamp((this.mBottom - this.mTop) * 0.36, 34, 50)) continue;
        if (kind < 0.6) folkTree(ctx, x, y, s, pal);
        else if (kind < 0.82) haystack(ctx, x, y, s * 0.6, pal);
        else pond(ctx, x, y - s * 0.15, s * 0.42, pal);
      }
    }
  }

  /* ---------- 麦田、菜园 ---------- */

  /**
   * 一块田：最下面一垄是视角所在的那天，往上一垄早一天。每垄画好缓存起来；
   * 回望过渡时先拿 15 垄时的画压扁着贴，到位后换成 35 垄的画。
   */
  private drawField(ctx: CanvasRenderingContext2D, kind: FieldKind, nowH: number, pal: Pal, daylight: number, light: boolean) {
    const { x, w } = this.fieldRect(kind);
    const top = this.fieldTop, bottom = this.fieldBottom;
    const dpr = ctx.getTransform().a || 1;
    // 田的外框：手画似的歪框，田埂是草绿
    ctx.save();
    ctx.translate(x, top);
    wobble(ctx, w, bottom - top, kind === 'focus' ? 11 : 23, 6);
    ctx.fillStyle = rgba(pal.fallow, 1);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 1);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    sign(ctx, x + 8, top - 24, kind === 'focus' ? '麦田 · 专注' : '菜园 · 学习', pal);

    const rh = this.rowH();
    if (!(rh > 0) || !Number.isFinite(rh)) return;
    const baseRh = (bottom - top - 8) / (this.e < 1 ? ROWS : OV_ROWS);
    const front = bottom - 4, rx = x + 6, rw = w - 12;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 3, top + 4, w - 6, bottom - top - 8); ctx.clip();
    const pMax = (bottom - top) / rh + 1;
    for (let d = Math.floor(this.V - pMax); d <= Math.ceil(this.V + 1); d++) {
      const p = this.V - d;
      const yB = front - p * rh, yT = yB - rh;
      if (yB < top || yT > bottom) continue;
      const segs = this.segs.get(`${kind}|${d}`) ?? [];
      const when = d < this.today ? 'past' : d === this.today ? 'today' : 'future';
      const age = (nowH - (d + 1) * 24) / 24;
      const c = this.rowCanvas(kind, d, segs, when, age, rw, baseRh, pal, daylight, dpr);
      ctx.drawImage(c, rx, yT, rw, rh);
      // 点一段打开那个日程（回望时不点）。只算田框里露出来的那截，滚出去的垄不能点
      const vT = Math.max(yT, top + 4), vB = Math.min(yB, bottom - 4);
      if (this.e === 0 && segs.length && vB > vT) {
        const scale = rw / Math.max(FULL, segs.reduce((n, s) => n + s.hours, 0));
        let cx = rx;
        for (const s of segs) {
          const sw = s.hours * scale;
          this.hits.push({ id: s.ev.id, x: cx + sw / 2, y: vB, w: sw, h: vB - vT });
          cx += sw;
        }
      }
    }
    ctx.restore();

    // 垄的右头写日子：今天、昨天、明天、一周前……（垄从左边铺起，右头多半空着）
    const marks: [number, string][] = [[0, '今天'], [-7, '一周前'], [-14, '两周前'], [-21, '三周前'], [-28, '四周前']];
    if (rh >= 14) marks.push([-1, '昨天'], [1, '明天']);
    for (const [r, text] of marks) {
      const p = this.V - (this.today + r);
      const yc = front - (p + 0.5) * rh;
      if (yc < top + 8 || yc > bottom - 6) continue;
      pill(ctx, x + w - 8, yc, text, r === 0, pal, light);
    }
  }

  private rowCanvas(kind: FieldKind, d: number, segs: Seg[], when: 'past' | 'today' | 'future', age: number, w: number, h: number, pal: Pal, daylight: number, dpr: number) {
    const grow = when === 'past' ? `${kind === 'focus' ? stageOf(age) : learnStageOf(age)}.${Math.min(7, Math.floor(age))}` : '';
    const segKey = segs.map(s => `${s.hours.toFixed(2)}/${s.done.toFixed(2)}`).join(',');
    const key = `${kind}|${d}|${when}|${grow}|${segKey}|${Math.round(daylight * 16)}|${Math.round(w * dpr)}x${Math.round(h * dpr)}`;
    let c = this.rows.get(key);
    if (c) {
      // 最近用过的放到最后，满了从最久没用的删起
      this.rows.delete(key); this.rows.set(key, c);
      return c;
    }
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * dpr)); c.height = Math.max(1, Math.ceil(h * dpr));
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintRow(g, w, h, d, kind, segs, when, age, pal);
    this.rows.set(key, c);
    // 两块田平时 30 垄，回望 70 垄，再留一点余地
    if (this.rows.size > 180) this.rows.delete(this.rows.keys().next().value!);
    return c;
  }

  /** 田头两面小旗：这类事接下来的两个日程 */
  private drawHeads(ctx: CanvasRenderingContext2D, events: EventView[], nowH: number, pal: Pal, light: boolean) {
    for (const kind of ['focus', 'learn'] as FieldKind[]) {
      const { x, w } = this.fieldRect(kind);
      const next = events
        .filter(e => (e.state === 'future' || e.state === 'soon') && kindOf(e) === kind)
        .sort((a, b) => a.start - b.start).slice(0, 2);
      const y = this.fieldBottom + this.headH * 0.62;
      next.forEach((ev, i) => {
        const fx = x + 10 + i * (w / 2);
        const fs = 14;
        ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(fx, y + 6); ctx.lineTo(fx, y - fs + 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(fx, y - fs + 4); ctx.lineTo(fx + 9, y - fs + 7); ctx.lineTo(fx, y - fs + 10); ctx.closePath();
        ctx.fillStyle = rgba(FLAG[kind], 1); ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
        const label = fitText(ctx, `${whenText(ev.start, nowH)} ${ev.title}`, w / 2 - 26, `700 11px ${SANS}`);
        small(ctx, fx + 12, y - 2, label, 'left', pal, light);
        ctx.font = `700 11px ${SANS}`;
        const tw = ctx.measureText(label).width;
        this.hits.push({ id: ev.id, x: fx + (tw + 12) / 2, y: y + 8, w: tw + 16, h: 24 });
      });
    }
  }

  /* ---------- 集市 ---------- */

  /**
   * 集市：一条土路，两个摊子。集市口停着下一次会的车，准备事项是车上的木箱；
   * 开会时农夫站在摊边；右头的仓房门口堆着两周来带回的一篮篮货。
   */
  private drawMarket(ctx: CanvasRenderingContext2D, events: EventView[], now: number, live: EventView | undefined, pal: Pal, light: boolean) {
    const { X0, FW, W } = this;
    const top = this.mTop, bottom = this.mBottom;
    sign(ctx, X0 + 8, top + 4, '集市 · 会议', pal);
    const ry = top + clamp((bottom - top) * 0.46, 24, 30), rh = clamp((bottom - top) * 0.36, 20, 50);
    ctx.fillStyle = rgba(pal.path, 1);
    ctx.fillRect(0, ry, W, rh);
    ctx.fillStyle = rgba(pal.ink, 1);
    ctx.fillRect(0, ry - 1, W, 1.6); ctx.fillRect(0, ry + rh, W, 1.6);
    ctx.strokeStyle = rgba(pal.rut, 1); ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]);
    for (const t of [0.35, 0.7]) { ctx.beginPath(); ctx.moveTo(0, ry + rh * t); ctx.lineTo(W, ry + rh * t); ctx.stroke(); }
    ctx.setLineDash([]);
    const ground = ry + rh * 0.78;

    // 两个摊子；开会时农夫站在右边那个旁边
    const ss = clamp(rh * 1.15, 36, 58);
    const s1 = X0 + FW * 0.44, s2 = X0 + FW * 0.6;
    stall(ctx, s1, ground, ss, pal);
    const top2 = stall(ctx, s2, ground, ss, pal);
    this.stallSpot = { x: s2 + ss * 0.62, y: ground + 2 };
    const liveMeet = live && kindOf(live) === 'meet' ? live : null;
    if (liveMeet) this.hits.push({ id: liveMeet.id, x: s2, y: ground + 4, w: ss, h: ground - top2 + 4 });

    // 集市口：下一次会的车（一天半以内的）
    const next = events
      .filter(e => (e.state === 'future' || e.state === 'soon') && kindOf(e) === 'meet' && e.start - now < 36 * HOUR)
      .sort((a, b) => a.start - b.start)[0];
    const below = ry + rh + Math.min(13, bottom - ry - rh - 2);
    if (next) {
      const cs = clamp(rh * 0.62, 18, 30), cx = X0 + 14 + cs * 0.55;
      const prep = next.prep ?? [], n = prep.filter(p => p.done).length;
      cart(ctx, cx, ground, cs, n, prep.length - n, pal);
      const tail = prep.length ? (n < prep.length ? ` · 还差 ${prep.length - n} 样` : ' · 都装好了') : '';
      const label = fitText(ctx, `${whenText(next.start, localHours(now))} ${next.title}${tail}`, FW * 0.55, `700 11px ${SANS}`);
      small(ctx, X0 + 8, below, label, 'left', pal, light);
      this.hits.push({ id: next.id, x: cx, y: ground + 4, w: Math.max(cs * 1.8, 30), h: cs * 1.4 });
    }

    // 仓房：两周来写了结论的会，一篮一篮堆在门口
    const brought = events
      .filter(e => e.state === 'ended' && kindOf(e) === 'meet' && e.outcome && e.end > now - 14 * DAY)
      .sort((a, b) => b.end - a.end);
    const bs = clamp(rh * 1.3, 44, 64), bx = X0 + FW - bs * 0.62;
    barn(ctx, bx, ground, bs, brought.length, pal);
    small(ctx, X0 + FW - 6, below, brought.length ? `两周带回 ${brought.length} 篮` : '会后写了结论，就带回一篮', 'right', pal, light);
    if (brought.length) this.hits.push({ id: brought[0].id, x: bx, y: ground + 4, w: bs, h: bs });
  }

  /* ---------- 果园 ---------- */

  /**
   * 果园：每种习惯一棵树，树下写名字；还没有习惯时写一句提示。
   * 树多了先把树缩小（最小 28）排下；还排不下，最后一个位置写“还有 N 种”，正在做的那棵总留在园里。
   */
  private drawOrchard(ctx: CanvasRenderingContext2D, live: EventView | undefined, pal: Pal, light: boolean) {
    const { X0, FW } = this;
    const signW = sign(ctx, X0 + 8, this.oTop + 4, '果园 · 习惯', pal);
    const ground = this.oBottom - 22;
    this.orchardGround = ground;
    this.treeSpot.clear();
    let s = clamp(this.oBottom - this.oTop - 50, 24, 104);
    if (!this.orchard.length) {
      small(ctx, X0 + FW / 2, ground - s * 0.4, '有了跑步、冥想这样的习惯，这里就种一棵树', 'center', pal, light);
      return;
    }
    // 第一棵树从哪儿起（树梢碰到木牌时，从木牌右边起）；树隔多远（至少 40，好写下两个字的名字），一排能种几棵
    const lead = (size: number) => (ground - size < this.oTop + 26 ? 8 + signW + 6 : 0) + size * 0.5;
    const room = (size: number) => FW - lead(size) - size * 0.35;
    const gap = (size: number) => Math.max(size * 0.95, 40);
    const fits = (size: number) => Math.max(1, Math.floor(room(size) / gap(size)) + 1);
    const n = this.orchard.length;
    // 排不下先缩树，缩到 42（再小，间隔也是 40，不能多种）
    while (s > 42 && fits(s) < n) s -= 1;
    let pitch = gap(s);
    // 矮屏上树小、地宽：把树摊开些，名字能多写几个字
    if (n > 1 && pitch < 64) pitch = clamp(room(s) / (n - 1), pitch, 64);
    let shown = this.orchard;
    if (fits(s) < n) {
      // 右头留出写“还有 N 种”的地方
      ctx.font = `700 11px ${SANS}`;
      const textW = ctx.measureText(`还有 ${n} 种`).width + 4;
      const m = Math.max(1, Math.floor((room(s) + s * 0.05 - textW) / pitch) + 1);
      shown = this.orchard.slice(0, m);
      const liveTitle = live && kindOf(live) === 'habit' ? live.title.trim() : null;
      const liveTree = liveTitle && !shown.some(o => o.title === liveTitle) && this.orchard.find(o => o.title === liveTitle);
      if (liveTree) shown = [...shown.slice(0, -1), liveTree];
    }
    let x = X0 + lead(s);
    for (const o of shown) {
      fruitTree(ctx, x, ground, s, o.stage, pal);
      ctx.font = `700 11px ${SANS}`;
      const name = fitText(ctx, o.title, Math.min(s * 0.9, pitch - 18), `700 11px ${SANS}`);
      const tw = ctx.measureText(name).width + 12;
      tag(ctx, x - tw / 2, ground + 3, tw, 17, light ? [255, 248, 232] : [40, 30, 60], pal);
      ctx.fillStyle = light ? rgba(pal.ink, 1) : 'rgba(255,236,190,1)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(name, x, ground + 12);
      this.treeSpot.set(o.title, x);
      this.hits.push({ id: o.id, x, y: ground + 20, w: Math.min(Math.max(s * 0.7, tw), pitch), h: s + 20 });
      x += pitch;
    }
    if (shown.length < n) small(ctx, x - pitch + s * 0.3 + 4, ground - s * 0.35, `还有 ${n - shown.length} 种`, 'left', pal, light);
  }

  /* ---------- 村子 ---------- */

  /** 下面一条村子：土路、红瓦房、粮仓、两只鸡。左右两头会被“回望”“新建”按钮压住，房子摆在中间 */
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
    const ground = H - this.insetBottom - bh * 0.14;
    const s = clamp(bh * 1.05, 56, 92);
    const hw = s * 1.15, hx = W / 2 - hw * 0.62;
    this.house = { x: hx, w: hw, ground };
    house(ctx, hx, ground, hw, s * 0.48, pal, 1 - daylight);
    granary(ctx, hx + hw + s * 0.42, ground, s * 0.5, pal);
    hen(ctx, hx - s * 0.3, ground - 2, s * 0.08, pal);
    hen(ctx, hx - s * 0.62, ground, s * 0.07, pal, true);
  }

  /* ---------- 回望 ---------- */

  /** 回望时集市和果园那片换成一座大粮仓和这五周的收成 */
  private drawOverview(ctx: CanvasRenderingContext2D, pal: Pal, light: boolean) {
    const a = smooth(0.55, 1, this.ov);
    const h = this.harvest;
    if (a < 0.01 || !h) return;
    const top = this.mTop, bottom = this.oBottom;
    const gs = clamp((bottom - top) * 0.6, 80, 150);
    const total = gs * 0.75 + 16 + 230;
    const gx = (this.W - total) / 2 + gs * 0.35, ground = top + (bottom - top) * 0.5 + gs * 0.45;
    ctx.save();
    ctx.globalAlpha = a;
    bigGranary(ctx, gx, ground, gs, h.fill, pal);
    const tx = gx + gs * 0.4 + 16, ty = ground - gs * 0.55;
    tag(ctx, tx - 10, ty - 24, 240, 72, light ? [255, 248, 232] : [40, 30, 60], pal);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = light ? rgba(pal.red, 1) : 'rgba(255,236,190,1)';
    ctx.font = `700 14px ${SANS}`;
    ctx.fillText(`${h.from}到今天的收成`, tx, ty - 4);
    ctx.fillStyle = light ? rgba(pal.ink, 1) : 'rgba(255,236,190,.9)';
    ctx.font = `500 13px ${SANS}`;
    ctx.fillText(`耕地 ${h.focus} 小时 · 播种 ${h.learn} 小时`, tx, ty + 16);
    ctx.fillText(`赶集 ${h.meets} 次 · 浇树 ${h.habits} 次`, tx, ty + 35);
    ctx.restore();
  }

  /* ---------- 农夫 ---------- */

  /**
   * 农夫在“现在”做的事那里：专注、学习时在今天那一垄翻到的地方，开会在摊边，习惯在那棵树旁；
   * 没有日程时在家门口，夜里坐着歇。头顶一块字牌。
   */
  private drawFarmer(ctx: CanvasRenderingContext2D, f: Frame, nowH: number, live: EventView | undefined, pal: Pal, light: boolean) {
    const { W } = this;
    const hod = mod(nowH, 24);
    const kind = live ? kindOf(live) : null;
    let x: number, y: number, s = 46, pose: 'walk' | 'hoe' | 'sow' | 'water' | 'sit' = 'walk';
    if (kind === 'focus' || kind === 'learn') {
      const { x: fx, w } = this.fieldRect(kind);
      const rh = this.rowH(), front = this.fieldBottom - 4;
      const p = this.V - this.today;
      const segs = this.segs.get(`${kind}|${this.today}`) ?? [];
      const scale = (w - 12) / Math.max(FULL, segs.reduce((n, sg) => n + sg.hours, 0));
      x = fx + 6 + segs.reduce((n, sg) => n + sg.done, 0) * scale;
      y = front - p * rh - 2;
      // 今天那一垄滚出了田，就不画
      if (y < this.fieldTop + 10 || y > this.fieldBottom + 4) return;
      s = clamp(rh * 2.4, 32, 54);
      pose = kind === 'focus' ? 'hoe' : 'sow';
    } else if (kind === 'meet') {
      ({ x, y } = this.stallSpot);
    } else if (kind === 'habit') {
      x = (this.treeSpot.get(live!.title.trim()) ?? this.X0 + 50) + 30;
      y = this.orchardGround;
      pose = 'water';
    } else {
      x = this.house.x + this.house.w * 0.86; y = this.house.ground;
      s = 40;
      if (hod >= NIGHT0 || hod < NIGHT1) pose = 'sit';
    }
    folkFarmer(ctx, x, y, s, pose, pal);

    if (!live) {
      ctx.save();
      // 在家时字牌只写一行，收在村子那一条里（头顶上就是果园树下的名字，不能压住）
      const text = `${pose === 'sit' ? '现在 · 在家歇着' : '现在 · 没有日程'} · ${fmtTime(f.now)}`;
      ctx.font = `700 12px ${SANS}`;
      const half = ctx.measureText(text).width / 2 + 6;
      const tx = clamp(x, half + 4, W - half - 4);
      const bottom = Math.max(y - s - 2, this.VIL + 13);
      tag(ctx, tx - half, bottom - 18, half * 2, 18, light ? [255, 248, 232] : [40, 30, 60], pal);
      ctx.fillStyle = light ? rgba(pal.red, 1) : 'rgba(255,236,190,1)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, tx, bottom - 8.5);
      ctx.restore();
      return;
    }
    const title = `现在 · ${live.title}`;
    const sub = `${JOB[kindOf(live)]} · ${subLabel(live)}`;
    const ty = Math.max(this.SKY + 40, y - s - 8);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = `700 13px ${SANS}`;
    const w1 = ctx.measureText(title).width;
    ctx.font = `500 12px ${SANS}`;
    const w2 = ctx.measureText(sub).width;
    const half = Math.max(w1, w2) / 2 + 6;
    const tx = clamp(x, half + 4, W - half - 4);
    tag(ctx, tx - half, ty - 33, half * 2, 35, light ? [255, 248, 232] : [40, 30, 60], pal);
    ctx.fillStyle = light ? rgba(pal.red, 1) : 'rgba(255,236,190,1)';
    ctx.font = `700 13px ${SANS}`;
    ctx.fillText(title, tx, ty - 16);
    ctx.font = `500 12px ${SANS}`;
    ctx.fillStyle = light ? rgba(pal.ink, 0.8) : 'rgba(255,236,190,.8)';
    ctx.fillText(sub, tx, ty);
    ctx.restore();
  }

  /* ---------- 天、纸纹 ---------- */

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
}

/* ---------- 一垄 ---------- */

/**
 * 画一垄（原点在左上角）：一个日程一段，按小时数从左往右铺（8 小时铺满，多了按比例收）。
 * 做过的部分按日子长到哪一步画纹样，还没做的部分是一段虚框；没铺到的地方，过去的长草，以后的是浅杏色。
 */
function paintRow(
  g: CanvasRenderingContext2D, w: number, h: number, d: number, kind: FieldKind,
  segs: Seg[], when: 'past' | 'today' | 'future', age: number, pal: Pal,
) {
  const ink = rgba(pal.ink, 1);
  const k = clamp(h / 18, 0.6, 1.6);
  const inset = Math.min(1.5, h * 0.12), r = Math.min(3, h * 0.3);
  const body = () => roundRect(g, 0.5, inset, w - 1, h - 2 * inset, r);
  body();
  g.fillStyle = rgba(when === 'past' ? pal.fallow : pal.bare, 1);
  g.fill();
  g.save();
  body();
  g.clip();
  if (when === 'past' && h > 6) {
    // 空着长草：一排人字纹
    const rr = rng(d * 13 + (kind === 'focus' ? 1 : 7));
    g.strokeStyle = rgba(pal.weed, 1);
    g.lineWidth = 0.9 * k;
    for (let i = 0; i < w / 9; i++) {
      const x = rr() * w, y = h * 0.72, q = 2 * k;
      g.beginPath(); g.moveTo(x - q, y - q * 1.4); g.lineTo(x, y); g.lineTo(x + q, y - q * 1.4); g.stroke();
    }
  }
  const scale = w / Math.max(FULL, segs.reduce((n, s) => n + s.hours, 0));
  const st = growth(kind, when, age);
  let cx = 0;
  segs.forEach((s, i) => {
    const sw = s.hours * scale, dw = s.done * scale;
    if (dw > 0.5) {
      g.fillStyle = rgba(BASE[st](pal), 1);
      g.fillRect(cx, 0, dw, h);
      pattern(g, cx, cx + dw, h, st, k, pal);
    }
    if (sw - dw > 0.5) {
      // 还没做：一段虚框
      g.fillStyle = 'rgba(255,255,255,.3)';
      g.fillRect(cx + dw, 0, sw - dw, h);
      g.strokeStyle = ink;
      g.lineWidth = 1;
      g.setLineDash([3, 2]);
      g.strokeRect(cx + dw + 1, inset + 1, sw - dw - 2, h - 2 * inset - 2);
      g.setLineDash([]);
    }
    cx += sw;
    if (i < segs.length - 1 || cx < w - 1) {
      g.strokeStyle = ink; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, h); g.stroke();
    }
  });
  g.restore();
  body();
  g.strokeStyle = ink;
  g.lineWidth = 0.9;
  g.stroke();
}

type Growth = 'till' | 'seed' | 'sprout' | 'young' | 'ripen' | 'ripe' | 'flower';

/** 这一垄做过的部分长到哪一步：麦田按耕地的进度，菜园两周才冒芽 */
function growth(kind: FieldKind, when: 'past' | 'today' | 'future', age: number): Growth {
  if (kind === 'focus') {
    if (when !== 'past') return 'till';
    return (['seed', 'sprout', 'young', 'ripen', 'ripe'] as const)[stageOf(age)];
  }
  if (when !== 'past') return 'seed';
  return (['seed', 'sprout', 'young', 'flower'] as const)[learnStageOf(age)];
}

/** 每一步的底色 */
const BASE: Record<Growth, (p: Pal) => RGB> = {
  till: p => p.soil, seed: p => p.soil, sprout: p => p.young, young: p => p.young,
  ripen: p => p.ripen, ripe: p => p.ripe, flower: p => p.young,
};

/** 每一步的纹样：黄垄、白种子、成对的叶子、橙色人字穗、向日葵 */
function pattern(g: CanvasRenderingContext2D, x0: number, x1: number, h: number, st: Growth, k: number, pal: Pal) {
  const cy = h / 2;
  if (st === 'till') {
    g.fillStyle = rgba(pal.furrow, 1);
    for (let x = x0 + 2; x < x1 - 2; x += 5 * k) g.fillRect(x, cy - 0.8 * k, 3 * k, 1.6 * k);
  } else if (st === 'seed') {
    g.fillStyle = rgba(pal.seed, 1);
    for (let x = x0 + 2; x < x1 - 1; x += 4 * k) g.fillRect(x, cy - 0.7 * k, 1.5 * k, 1.5 * k);
  } else if (st === 'sprout' || st === 'young') {
    leaves(g, x0, x1, cy, (st === 'sprout' ? 0.6 : 1) * k, k, pal);
  } else if (st === 'flower') {
    const fr = Math.max(1.8, h * 0.28);
    for (let x = x0 + fr + 1; x < x1 - fr * 0.6; x += fr * 2.8) {
      g.fillStyle = rgba(pal.yellow, 1);
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * Math.PI * 2;
        g.beginPath(); g.ellipse(x + Math.cos(t) * fr * 0.7, cy + Math.sin(t) * fr * 0.7, fr * 0.42, fr * 0.2, t, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = rgba(pal.soil, 1);
      g.beginPath(); g.arc(x, cy, fr * 0.42, 0, Math.PI * 2); g.fill();
    }
  } else {
    g.strokeStyle = rgba(pal.ear, 1);
    g.lineWidth = k;
    const e = 1.8 * k;
    for (let x = x0 + 3; x < x1 - 1; x += 5 * k) {
      g.beginPath(); g.moveTo(x - e, cy + e); g.lineTo(x, cy - e * 0.5); g.lineTo(x + e, cy + e); g.stroke();
    }
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

/**
 * 每块田每天的那一垄：专注、学习的日程按天拆开（跨午夜的分到两天，全天日程不算），
 * 同一天按开始时间排好，叠在前面日程上的部分不重复算；做了多少按“现在”量。
 */
function segments(events: EventView[], nowH: number): Map<string, Seg[]> {
  const raw = new Map<string, { ev: EventView; a: number; b: number }[]>();
  for (const ev of events) {
    const kind = kindOf(ev);
    if ((kind !== 'focus' && kind !== 'learn') || isAllDay(ev.start, ev.end)) continue;
    const s = localHours(ev.start), e = localHours(ev.end);
    for (let d = dayOf(s); d * 24 < e; d++) {
      const key = `${kind}|${d}`;
      let list = raw.get(key);
      if (!list) raw.set(key, (list = []));
      list.push({ ev, a: Math.max(s, d * 24), b: Math.min(e, (d + 1) * 24) });
    }
  }
  const out = new Map<string, Seg[]>();
  for (const [key, list] of raw) {
    list.sort((p, q) => p.a - q.a);
    let cursor = -Infinity;
    const segs: Seg[] = [];
    for (const { ev, a, b } of list) {
      const from = Math.max(a, cursor);
      const hours = Math.max(0, b - from);
      cursor = Math.max(cursor, b);
      if (hours < 1 / 60) continue;
      segs.push({ ev, hours, done: clamp(nowH - from, 0, hours) });
    }
    if (segs.length) out.set(key, segs);
  }
  return out;
}

/**
 * 果园：每种习惯（按标题）一棵树，按近两个月做完几次长；今天正在做或还要做的也先种一棵树苗。
 * 浇得多的排前面。点树打开最近做的那次，没做过就打开接下来那次。
 */
function orchardOf(events: EventView[], now: number): Orchard[] {
  const trees = new Map<string, { times: number; last?: EventView; next?: EventView }>();
  for (const ev of events) {
    if (kindOf(ev) !== 'habit') continue;
    const t = ev.title.trim();
    if (ev.state === 'ended') {
      if (ev.end < now - 60 * DAY) continue;
      const o = trees.get(t) ?? { times: 0 };
      o.times++;
      if (!o.last || ev.end > o.last.end) o.last = ev;
      trees.set(t, o);
    } else if (ev.start - now < DAY) {
      const o = trees.get(t) ?? { times: 0 };
      if (!o.next || ev.start < o.next.start) o.next = ev;
      trees.set(t, o);
    }
  }
  return [...trees].map(([title, o]) => ({
    title, times: o.times,
    stage: Math.max(0, TREE_AT.filter(k => o.times >= k).length - 1),
    id: (o.last ?? o.next)!.id,
  })).sort((a, b) => b.times - a.times || a.title.localeCompare(b.title));
}

/** 小旗边上写的时间：今天写钟点，明天写“明天”，再远写日期 */
function whenText(ms: number, nowH: number): string {
  const d = dayOf(localHours(ms)) - dayOf(nowH);
  if (d === 0) return fmtTime(ms);
  if (d === 1) return `明天 ${fmtTime(ms)}`;
  const date = new Date(ms);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 太长就截短加省略号 */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, font: string): string {
  ctx.font = font;
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/** 地里的小字：粗一点，外面描一圈底色，压在什么上面都看得清 */
function small(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, align: CanvasTextAlign, pal: Pal, light: boolean) {
  ctx.save();
  ctx.font = `700 11px ${SANS}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = light ? 'rgba(255,248,232,.95)' : 'rgba(40,30,60,.95)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = light ? rgba(pal.ink, 1) : 'rgba(255,236,190,1)';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** 地头的木牌：两根小木桩挑一块牌子 */
function sign(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, pal: Pal) {
  ctx.save();
  ctx.font = `700 12px ${SANS}`;
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = rgba(pal.trunk, 1);
  ctx.fillRect(x + 8, y + 14, 3, 7); ctx.fillRect(x + w - 11, y + 14, 3, 7);
  roundRect(ctx, x, y - 2, w, 18, 4);
  ctx.fillStyle = 'rgba(201,161,91,1)'; ctx.fill();
  ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1.3; ctx.stroke();
  ctx.fillStyle = 'rgba(36,20,12,1)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 7, y + 7.5);
  ctx.restore();
  return w;
}

/** 垄右头的日子小牌（右边对齐到 x）：今天是红的 */
function pill(ctx: CanvasRenderingContext2D, right: number, yc: number, text: string, hot: boolean, pal: Pal, light: boolean) {
  ctx.save();
  ctx.font = `700 10px ${SANS}`;
  const w = ctx.measureText(text).width + 10, x = right - w;
  roundRect(ctx, x, yc - 7, w, 14, 7);
  ctx.fillStyle = hot ? rgba(pal.red, 1) : light ? 'rgba(255,248,232,1)' : 'rgba(40,30,60,1)';
  ctx.fill();
  ctx.strokeStyle = rgba(pal.ink, 1); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = hot ? 'rgba(255,255,255,1)' : light ? rgba(pal.ink, 1) : 'rgba(255,236,190,1)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 5, yc + 0.5);
  ctx.restore();
}

/** 仓房：白墙草顶，门口堆着 n 篮带回来的货（最多画 9 篮，三层） */
function barn(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, n: number, pal: Pal) {
  const ink = rgba(pal.ink, 1);
  const w = s, h = s * 0.55;
  ctx.save();
  ctx.lineWidth = 1.5; ctx.strokeStyle = ink;
  ctx.fillStyle = rgba(pal.wall, 1);
  ctx.fillRect(x - w / 2, y - h, w, h); ctx.strokeRect(x - w / 2, y - h, w, h);
  ctx.beginPath(); ctx.moveTo(x - w / 2 - 6, y - h); ctx.lineTo(x, y - h - s * 0.4); ctx.lineTo(x + w / 2 + 6, y - h); ctx.closePath();
  ctx.fillStyle = 'rgba(201,161,91,1)'; ctx.fill(); ctx.stroke();
  ctx.fillStyle = rgba(pal.door, 1);
  ctx.fillRect(x - w * 0.14, y - h * 0.7, w * 0.28, h * 0.7); ctx.strokeRect(x - w * 0.14, y - h * 0.7, w * 0.28, h * 0.7);
  const bs = s * 0.24;
  const shown = Math.min(n, 9);
  for (let i = 0; i < shown; i++) {
    const row = i < 4 ? 0 : i < 7 ? 1 : 2, k = row === 0 ? i : row === 1 ? i - 4 : i - 7;
    const per = row === 0 ? 4 : row === 1 ? 3 : 2;
    basket(ctx, x + (k - (per - 1) / 2) * bs * 1.05, y - row * bs * 0.62, bs, 2, pal);
  }
  ctx.restore();
}

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

/**
 * 回望里的大粮仓：圆囷、尖草顶，身上开一扇小窗，窗里的谷子从下往上堆到 fill 成。
 * x 是中间，y 是地面，s 是高
 */
function bigGranary(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: number, pal: Pal) {
  const ink = rgba(pal.ink, 1);
  const r = s * 0.32, h = s * 0.62;
  ctx.save();
  ctx.lineWidth = 1.6; ctx.strokeStyle = ink;
  ctx.fillStyle = 'rgba(214,170,98,1)';
  ctx.fillRect(x - r, y - h, r * 2, h); ctx.strokeRect(x - r, y - h, r * 2, h);
  ctx.strokeStyle = 'rgba(150,104,48,1)'; ctx.lineWidth = 1;
  for (let yy = y - h + 5; yy < y; yy += 5) { ctx.beginPath(); ctx.moveTo(x - r, yy); ctx.lineTo(x + r, yy); ctx.stroke(); }
  // 小窗：里面黑，谷子堆到 fill 成
  const ww = r * 0.9, wh = h * 0.62, wx = x - ww / 2, wy = y - h * 0.82;
  ctx.fillStyle = 'rgba(60,40,24,1)';
  ctx.fillRect(wx, wy, ww, wh);
  const gh = wh * fill;
  ctx.fillStyle = rgba(pal.ripe, 1);
  ctx.fillRect(wx, wy + wh - gh, ww, gh);
  ctx.fillStyle = rgba(pal.ear, 1);
  for (let gy = wy + wh - 3; gy > wy + wh - gh + 1; gy -= 4) for (let gx = wx + 2 + ((gy | 0) % 2) * 2; gx < wx + ww - 1; gx += 4) ctx.fillRect(gx, gy, 1.5, 1.5);
  ctx.strokeStyle = ink; ctx.lineWidth = 1.4;
  ctx.strokeRect(wx, wy, ww, wh);
  // 草顶
  ctx.beginPath(); ctx.moveTo(x - r - 8, y - h); ctx.lineTo(x, y - s); ctx.lineTo(x + r + 8, y - h); ctx.closePath();
  ctx.fillStyle = 'rgba(201,161,91,1)'; ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,104,48,1)'; ctx.lineWidth = 1;
  for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x - r - 8 + k * (2 * r + 16) / 5, y - h); ctx.stroke(); }
  ctx.restore();
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

/** 第 d 天的中午（毫秒），用来取日期 */
function noonOf(d: number): number {
  const guess = d * DAY + 12 * HOUR;
  return guess + new Date(guess).getTimezoneOffset() * MINUTE;
}
