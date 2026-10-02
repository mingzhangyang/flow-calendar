import { type World, GOAL_HIT } from '../world';
import type { EventView, Frame, Goal } from '../../model/types';
import { addDays, fmtDay, fmtSpan, fmtTime, isAllDay, localHours, startOfDay } from '../../model/time';
import { prepLeft } from '../../model/states';
import { daylightAt } from '../../model/daylight';
import {
  type RGB, PALETTE, SANS, clamp, drawLabel, drawOrb, ellipsePath, hashStr, mixc, mod, rgba, rng, smooth,
} from '../hike/paint';
import { type Sky, celestial, drawSky, nightAt, skyAt } from '../hike/sky';
import {
  type Look, AZURITE, INK, MALACHITE, OCHRE, SHELL_WHITE, SILK, VERMILION, lookAt, pigment,
} from '../hike/look';
import { drawSilk } from '../hike/silk';
import { Sprite } from '../hike/sprites';
import { ART as HIKE_ART } from '../hike/art';
import { ART } from './art';
import { Terrain } from './terrain';

/**
 * 登山世界：侧面看一座山。
 *
 * 横向是时间：你站在左边三成处（“现在”），往右是未来，往左是走过的路。远近都压缩，
 * 离“现在”越远挤得越紧，但永远走不出画面：
 *   x = CX + R · (1 − (1 + Δt/τ)^−P)      Δt 越大越靠近右边缘，永远到不了
 * 所以眼前几个小时铺得开，一个月后的山顶也挤在右上角看得见。
 *
 * 纵向是海拔：做过的事一层层垒起来（见 terrain.ts）。沿着山路一段一段往上垒：
 * 每一段的坡度只看这段时间有多忙（排满的约 45° 是陡坡，白天空闲是缓缓的草甸，夜里往下走一点，落进两座山梁之间的垭口），
 * 不管远近都一样，所以远处挤在一起的日子也看得出哪段陡、哪段缓。
 * 再整体加一道越往右越陡的山势（往左则缓缓下去），远处的路就升进右上角的云里。
 *
 * 每个日程是路边一处营地（山亭），走过之后收起，留下一座石堆。
 * 越远的路藏进云里；山顶插一面旗，是截止日。
 *
 * 回望：拉远看整座山。横向从出发那天到山顶均匀铺开，纵向直接按海拔：
 * 出发点在左下，山顶在右上，一道虚线连起来是“匀速走的原定路线”，
 * 走在虚线上面就是比原定快，下面就是慢。两种看法之间用一小段过渡连起来。
 */
const P = 0.5;
/** 海拔每升 1（忙一小时），画面上升多少（以横向一小时为单位）：1 就是 45° */
const K = 1;
/** 回望的过渡要多久（秒） */
const OV_SEC = 0.8;
/** 回望时，人和营地缩到多大 */
const OV_SCALE = 0.5;

interface Hit { id: string; x: number; y: number; w: number; h: number }

export class ClimbWorld implements World {
  readonly id = 'climb';
  readonly name = '登山';

  private W = 0; private H = 0;
  private insetTop = 0; private insetBottom = 0;
  /** “现在”所在的屏幕位置 */
  private CX = 0; private CY = 0;
  /** 往右、往左各能铺开多远（像素） */
  private R = 0; private L = 0;
  /** 眼前每小时多少像素，以及往右、往左的压缩常数 */
  private sx = 0;
  private tauR = 0; private tauL = 0;
  /** 山势：往右升多高、往左降多低（像素） */
  private rise = 0; private fall = 0;
  /** 远山的山脚 */
  private HZ = 0;
  private T = 0;
  /** 这一帧的山脊：时刻（递增）和对应的屏幕坐标 */
  private rh: number[] = []; private rx: number[] = []; private ry: number[] = [];
  private terrain = new Terrain();
  private hits: Hit[] = [];
  /** 山顶的旗占的地方（连同上面的字），点一下设目标 */
  private summitHit: Hit | null = null;
  /** 出发和山顶的时刻（本地小时） */
  private fromH = 0; private summitH = 0;
  /** 回望：ov 从 0（眼前）走到 1（全貌），e 是缓动后的值；ovT 是上一帧的时刻 */
  private ov = 0; private ovTarget = 0; private ovT = 0; private e = 0;
  /** 回望里写的几句话，也给读屏用 */
  private stats: Stats | null = null;

  private art: {
    walk: Sprite; steep: Sprite; rest: Sprite; companion: Sprite;
    camp: Sprite; cairn: Sprite; flag: Sprite; band: Sprite;
    clouds: Sprite[]; ranges: Sprite[]; hills: Sprite; grass: Sprite[]; pine: Sprite;
  };

  constructor(invalidate: () => void) {
    const s = (a: typeof ART[keyof typeof ART] | typeof HIKE_ART[keyof typeof HIKE_ART]) => new Sprite(a, invalidate);
    this.art = {
      walk: s(ART.climberWalk1),
      // 陡坡上弯腰的那张，最低处是后脚；落地点改在两脚之间
      steep: s({ ...ART.climberSteep1, ax: 0.42 }),
      rest: s(ART.climberRest1),
      companion: s(ART.companion1),
      camp: s(ART.camp1),
      cairn: s(ART.cairn1),
      flag: s(ART.summitFlag1),
      band: s(ART.cloudBand1),
      clouds: [HIKE_ART.cloud1, HIKE_ART.cloud2].map(s),
      ranges: [HIKE_ART.rangeFar, HIKE_ART.rangeMid].map(s),
      hills: s(HIKE_ART.rangeNear),
      grass: [HIKE_ART.grass1, HIKE_ART.grass2, HIKE_ART.grass3].map(s),
      pine: s(HIKE_ART.treePine1),
    };
  }

  resize(w: number, h: number, insets: { top: number; bottom: number }) {
    this.W = w; this.H = h;
    this.insetTop = insets.top; this.insetBottom = insets.bottom;
    this.CX = w * (w > h ? 0.32 : 0.3);
    this.CY = h * 0.6;
    this.R = w - this.CX;
    this.L = this.CX;
    this.sx = clamp(w * 0.13, 44, 96);
    this.tauR = (this.R * P) / this.sx;
    this.tauL = (this.L * P) / this.sx;
    this.rise = h * 0.26;
    this.fall = h * 0.1;
    this.HZ = h * 0.52;
  }

  /* ---------- 坐标 ---------- */

  private xAt(h: number) {
    const dt = h - this.T;
    return dt >= 0
      ? this.CX + this.R * (1 - (1 + dt / this.tauR) ** -P)
      : this.CX - this.L * (1 - (1 - dt / this.tauL) ** -P);
  }

  /**
   * 按此刻的视角把山脊算一遍：从“现在”往两边一段一段垒，见文件开头。
   * 之后摆东西都在这张表上查，不再重算。
   */
  private buildRidge() {
    const { T, CX, CY, R, L, H } = this;
    const fw: number[] = [], bk: number[] = [];
    for (let h = T; h < T + 70 * 24; h += clamp((h - T) * 0.03, 0.05, 6)) fw.push(h);
    // 往回至少 9 天，回望时要从出发那天画起
    const back = Math.max(9 * 24, T - this.fromH + 24);
    for (let h = T - 0.05; h > T - back; h -= clamp((T - h) * 0.03, 0.05, 6)) bk.push(h);
    const hs = [...bk.reverse(), ...fw];
    const i0 = bk.length;
    const xs = hs.map(h => this.xAt(h));
    const alt = hs.map(h => this.terrain.altAt(h));
    // 坡度 × 横向距离，一段一段累加（y 往上是减）
    const ys = new Array<number>(hs.length);
    ys[i0] = 0;
    const climb = (i: number, j: number) => (K * (alt[j] - alt[i]) * (xs[j] - xs[i])) / (hs[j] - hs[i]);
    for (let i = i0 + 1; i < hs.length; i++) ys[i] = ys[i - 1] - climb(i - 1, i);
    for (let i = i0 - 1; i >= 0; i--) ys[i] = ys[i + 1] + climb(i, i + 1);
    for (let i = 0; i < hs.length; i++) {
      const x = xs[i], k = this.scaleAt(hs[i]);
      // 山势：往右越来越陡地升进云里，往左缓缓下去
      const tilt = x >= CX ? -this.rise * ((x - CX) / R) ** 2 : this.fall * ((CX - x) / L) ** 2;
      // 山脊的小起伏，只是笔意，不改坡度的意思
      const wig = k * H * 0.004 * (Math.sin(hs[i] * 1.3) + 0.6 * Math.sin(hs[i] * 3.7 + 1));
      ys[i] = CY + ys[i] + tilt + wig;
      // 再高也不顶到画面上方的按钮：快到顶时平滑地压住
      const top = this.insetTop + H * 0.13, m = H * 0.06;
      if (ys[i] < top + m) ys[i] = top + m * Math.exp((ys[i] - top - m) / m);
    }
    // 回望：往全貌那头挪
    if (this.e > 0) {
      const o = this.ovMap(), e = this.e;
      for (let i = 0; i < hs.length; i++) {
        xs[i] += (o.x(hs[i]) - xs[i]) * e;
        ys[i] += (o.y(alt[i]) - ys[i]) * e;
      }
    }
    this.rh = hs; this.rx = xs; this.ry = ys;
  }

  /** 回望的坐标：出发点在左下，山顶在右上，中间按时间均匀铺开、按海拔升高 */
  private ovMap() {
    const { W, H, fromH: sH } = this;
    // 当天的目标从出发到截止可能只有几个小时；跨度至少按 1 小时算，免得除以零
    const dH = this.summitH, span = Math.max(1, dH - sH);
    const aS = this.terrain.altAt(sH), aD = this.terrain.altAt(dH);
    const x0 = W * 0.12, x1 = W * 0.84;
    const yB = H * 0.74, yT = this.insetTop + H * 0.24;
    const rise = Math.max(1, aD - aS);
    return {
      sH, dH, aS, aD,
      span,
      x: (h: number) => x0 + ((h - sH) / span) * (x1 - x0),
      y: (a: number) => yB - ((a - aS) / rise) * (yB - yT),
    };
  }

  /** 时刻 h 的地面 → 屏幕坐标（在这一帧的山脊上查） */
  private at(h: number): [number, number] {
    const { rh, rx, ry } = this;
    const n = rh.length;
    if (h <= rh[0]) return [rx[0], ry[0]];
    if (h >= rh[n - 1]) return [rx[n - 1], ry[n - 1]];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rh[mid] <= h) lo = mid; else hi = mid;
    }
    const u = (h - rh[lo]) / (rh[hi] - rh[lo]);
    return [rx[lo] + (rx[hi] - rx[lo]) * u, ry[lo] + (ry[hi] - ry[lo]) * u];
  }

  /** 屏幕横坐标 x 处山脊的高度（x 随时刻递增，在表上反查） */
  private groundY(x: number): number {
    const { rx, ry } = this;
    const n = rx.length;
    if (x <= rx[0]) return ry[0];
    if (x >= rx[n - 1]) return ry[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rx[mid] <= x) lo = mid; else hi = mid;
    }
    const u = (x - rx[lo]) / Math.max(1e-6, rx[hi] - rx[lo]);
    return ry[lo] + (ry[hi] - ry[lo]) * u;
  }

  /** 宽 w 的东西立在 x 处：落在脚下最低的那一点，坡上不悬空（高的一边埋进山坡里） */
  private footY(x: number, w: number): number {
    return Math.max(this.groundY(x - w / 2), this.groundY(x), this.groundY(x + w / 2));
  }

  /** 时刻 h 附近的缩放：1 是眼前，越远越小 */
  private scaleAt(h: number) {
    const dt = h - this.T;
    const k = dt >= 0 ? (1 + dt / this.tauR) ** (-P - 1) : (1 - dt / this.tauL) ** (-P - 1);
    const close = clamp(Math.sqrt(k), 0, 1);
    return close + (OV_SCALE - close) * this.e;
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame) {
    const { W, H } = this;
    this.T = localHours(f.view);
    const nowH = localHours(f.now);
    const summit = summitOf(f.now, f.goal);
    this.fromH = localHours(summit.start);
    this.summitH = summit.h;
    this.terrain.update(f.events, f.now, summit.h, this.fromH);
    this.stepOverview();
    this.buildRidge();
    this.stats = this.measure(nowH, summit);

    const hod = mod(this.T, 24);
    const sky = skyAt(hod), night = nightAt(hod);
    const look = lookAt(sky, daylightAt(f.view));

    ctx.fillStyle = rgba(sky.bot, 1);
    ctx.fillRect(0, 0, W, H);
    drawSky(ctx, W, this.HZ, sky, night, celestial(hod, W, H, this.HZ, night));
    this.drawSkyClouds(ctx, look);
    this.drawRanges(ctx, sky, look);

    const ridge = this.ridge();
    this.drawBody(ctx, ridge, sky, look);
    this.drawSurface(ctx, ridge, look);
    this.drawPlants(ctx, look);
    this.drawPast(ctx, ridge, this.at(nowH)[0], sky, look);
    this.drawTrail(ctx, ridge, nowH, look);
    this.drawHills(ctx, sky, look);
    this.drawClouds(ctx, sky, look);
    this.drawDayMarks(ctx, f.now, look);
    drawSilk(ctx, W, H, look);
    this.drawOverview(ctx, nowH, look);
    const reserved = this.drawClimber(ctx, f, nowH, look);
    this.hits = [];
    this.drawCamps(ctx, f.events, look, reserved);
    // 山顶的旗最后画、最后放：压在旁边的日程上面，点到它时也优先
    this.drawSummit(ctx, summit, f.now, look);
    if (this.summitHit) this.hits.push(this.summitHit);
  }

  dragHours(x: number, _y: number, dx: number, dy: number): number {
    // 回望时整座山都在眼前，不用拖
    if (this.ovTarget) return 0;
    // 横着拖：让手指下的那一刻跟着手指走。x = CX + R(1 − u)，u = (1 + Δt/τ)^−P，
    // 所以 dΔt/dx = τ / (R·P) · u^(−1/P − 1)。离边缘太近时封顶，免得一下跳出好几周。
    const right = x >= this.CX;
    const span = right ? this.R : this.L, tau = right ? this.tauR : this.tauL;
    const u = Math.max(0.3, 1 - Math.abs(x - this.CX) / span);
    const perPx = (tau / (span * P)) * u ** (-1 / P - 1);
    // 往左拖把未来拉近；往下拖和远足一样，也是去未来
    return -dx * perPx + dy / this.sx;
  }

  hitTest(x: number, y: number): string | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (Math.abs(x - h.x) <= h.w / 2 && y <= h.y + 8 && y >= h.y - h.h) return h.id;
    }
    return null;
  }

  isAnimating() { return this.ov !== this.ovTarget; }

  setOverview(on: boolean, instant: boolean) {
    this.ovTarget = on ? 1 : 0;
    if (instant) this.ov = this.ovTarget;
    this.ovT = performance.now();
  }

  describe(f: Frame): string {
    let text = f.goal ? `目标：${f.goal.title}，${fmtDay(f.goal.due)}截止。` : '还没有设目标，山顶的旗先插在月底。';
    text += '点山顶的旗可以设目标和截止日，左下角的“回望”可以拉远看整座山。';
    if (this.ovTarget && this.stats) text += `正在回望：${this.stats.from}出发，已爬 ${this.stats.pct}%，${this.stats.pace}。`;
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

  /** 爬了多少、比匀速走的原定路线快还是慢 */
  private measure(nowH: number, summit: Summit): Stats {
    const o = this.ovMap();
    const aN = this.terrain.altAt(nowH);
    const pct = Math.round(clamp((aN - o.aS) / Math.max(1, o.aD - o.aS), 0, 1) * 100);
    const plan = o.aS + (o.aD - o.aS) * clamp((nowH - o.sH) / o.span, 0, 1);
    const diff = Math.round(aN - plan);
    const pace = nowH < o.sH ? '还没出发'
      : nowH > o.dH ? '已经过了截止日'
      : diff === 0 ? '正好走在原定路线上'
      : diff > 0 ? `比原定路线快约 ${diff} 小时` : `比原定路线慢约 ${-diff} 小时`;
    const d = new Date(summit.start);
    return { from: `${d.getMonth() + 1}月${d.getDate()}日`, pct, pace };
  }

  /**
   * 回望时的几笔标注：出发点、匀速走的原定路线（虚线）、左边一道竖线量出已经爬了多高，
   * 人脚下写比原定快还是慢。只在拉远后淡淡出现。
   */
  private drawOverview(ctx: CanvasRenderingContext2D, nowH: number, look: Look) {
    const a = smooth(0.55, 1, this.ov);
    const s = this.stats;
    if (a < 0.01 || !s) return;
    const [sx, sy] = this.at(this.fromH), [dx, dy] = this.at(this.summitH), [nx, ny] = this.at(nowH);
    const ink = rgba(look.mark, 0.75 * a);
    ctx.save();
    ctx.lineCap = 'round';
    // 原定路线：从出发点到山顶的一道虚线
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(dx, dy); ctx.stroke();
    // 量高度：左边一道竖线，从出发的高度到现在的高度，再一道点线引到人脚下
    const bx = Math.max(12, sx - 20);
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(bx, ny); ctx.lineTo(nx - 12, ny); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(bx, sy); ctx.lineTo(bx, ny);
    ctx.moveTo(bx - 4, sy); ctx.lineTo(bx + 4, sy);
    ctx.moveTo(bx - 4, ny); ctx.lineTo(bx + 4, ny);
    ctx.stroke();
    ctx.fillStyle = rgba(look.mark, a);
    ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, Math.PI * 2); ctx.fill();

    ctx.shadowColor = look.halo; ctx.shadowBlur = 6;
    ctx.font = `600 12px ${SANS}`;
    ctx.fillStyle = rgba(look.ink, 0.9 * a);
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    // 竖线顶上两行：爬了多少，比原定快还是慢
    const top = Math.min(ny, sy);
    ctx.fillText(`已爬 ${s.pct}%`, bx - 4, top - 24);
    ctx.font = `500 12px ${SANS}`;
    ctx.fillStyle = rgba(look.ink, 0.75 * a);
    ctx.fillText(s.pace, bx - 4, top - 8);
    ctx.font = `500 11px ${SANS}`;
    ctx.textBaseline = 'top';
    ctx.fillText(`${s.from} 出发`, Math.max(4, sx - 8), sy + 10);
    ctx.restore();
  }

  idleRedrawMs() {
    // 眼前每分钟挪 sx/60 像素；让每次重画只挪半个像素左右
    return clamp((0.5 / (this.sx / 60)) * 60_000, 5_000, 60_000);
  }

  /* ---------- 远山 ---------- */

  /** 山后连绵的远峰：远足的两层远山，钉在屏幕上不动 */
  private drawRanges(ctx: CanvasRenderingContext2D, sky: Sky, look: Look) {
    const { W, H, HZ } = this;
    const [far, mid] = this.art.ranges;
    if (far.ready && mid.ready) {
      ([[far, 0.13, 0.35], [mid, 0.09, 0.2]] as const).forEach(([s, peak, mist]) => {
        const h = Math.max((H * peak) / s.info.peak, W / s.aspect);
        const w = h * s.aspect;
        s.draw(ctx, W / 2 - w / 2, HZ - h, w, h, look, mist, 0.8);
      });
    }
    // 山脚的雾
    const g = ctx.createLinearGradient(0, HZ - H * 0.05, 0, HZ + H * 0.04);
    g.addColorStop(0, rgba(sky.bot, 0));
    g.addColorStop(0.6, rgba(sky.bot, 0.9));
    g.addColorStop(1, rgba(sky.bot, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, HZ - H * 0.05, W, H);
  }

  /* ---------- 山体 ---------- */

  /** 山脊上的采样点：[x, y, 时刻]。近处密、远处疏 */
  private ridge(): [number, number, number][] {
    const { rh, rx, ry, W } = this;
    const n = rh.length;
    // 左头顺着原来的坡（最多 45°）接到画边外，宽屏上山体也铺满
    const x0 = Math.min(-12, rx[0] - 12);
    const slope = clamp((ry[0] - ry[1]) / Math.max(0.01, rx[1] - rx[0]), -1, 1);
    return [
      [x0, ry[0] + slope * (rx[0] - x0), rh[0] - 1],
      ...rh.map((h, i): [number, number, number] => [rx[i], ry[i], h]),
      [Math.max(W + 12, rx[n - 1] + 12), ry[n - 1], rh[n - 1] + 1],
    ];
  }

  private bodyPath(ridge: [number, number, number][]) {
    const { W, H } = this;
    const p = new Path2D();
    p.moveTo(-10, H + 10);
    p.lineTo(-10, ridge[0][1]);
    for (const [x, y] of ridge) p.lineTo(x, y);
    p.lineTo(W + 10, ridge[ridge.length - 1][1]);
    p.lineTo(W + 10, H + 10);
    p.closePath();
    return p;
  }

  /**
   * 山体：《千里江山图》的设色——山脊石青，往下石绿，再往下赭石，最后淡进雾里留白。
   * 颜色沿着山脊走：贴着山脊描几道由宽到窄的色带，哪里是山脊哪里就青绿。
   */
  private drawBody(ctx: CanvasRenderingContext2D, ridge: [number, number, number][], sky: Sky, look: Look) {
    const { W, H } = this;
    const body = this.bodyPath(ridge);
    ctx.fillStyle = rgba(pigment(mixc(SILK, sky.bot, 0.4), look), 1);
    ctx.fill(body);

    const line = new Path2D();
    ridge.forEach(([x, y], i) => (i ? line.lineTo(x, y) : line.moveTo(x, y)));
    ctx.save();
    ctx.clip(body);
    ctx.lineJoin = 'round';
    // 由宽到窄叠很多道淡色：最宽的是赭石，越靠山脊越绿越青，叠出柔和的过渡
    const depth = H * 0.2, N = 22;
    const stops: RGB[] = [mixc(OCHRE, SILK, 0.4), OCHRE, mixc(OCHRE, MALACHITE, 0.6), MALACHITE, mixc(MALACHITE, AZURITE, 0.75)];
    for (let j = 0; j < N; j++) {
      const t = j / (N - 1), u = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(u));
      ctx.strokeStyle = rgba(pigment(mixc(stops[i], stops[i + 1], u - i), look), 0.07 + 0.1 * t);
      ctx.lineWidth = depth * 2 * (1 - t) ** 1.2 + 2;
      ctx.stroke(line);
    }
    ctx.restore();

    // 墨线勾山脊：粗细随笔意变化
    const ink = pigment(INK, look);
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < ridge.length; i++) {
      const [x0, y0, h] = ridge[i - 1], [x1, y1] = ridge[i];
      if (x1 < -5 || x0 > W + 5) continue;
      const k = Math.max(0.35, this.scaleAt(h));
      ctx.strokeStyle = rgba(ink, 0.55 * (0.5 + 0.5 * noise(h * 2, 5)));
      ctx.lineWidth = (0.8 + 1.4 * noise(h * 3.3, 9)) * k;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.restore();
  }

  /** 山前的矮丘：远足的近山（米点皴的矮丘）铺在画面最下面，钉在屏幕上，山脚淡成留白 */
  private drawHills(ctx: CanvasRenderingContext2D, sky: Sky, look: Look) {
    const { W, H } = this;
    const s = this.art.hills;
    if (!s.ready) return;
    // 至少铺满屏宽；窄屏上只露出中间
    const h = Math.max(clamp(H * 0.13, 70, 130), W / s.aspect), w = h * s.aspect;
    const foot = H * 0.985;
    s.draw(ctx, W / 2 - w / 2, foot - h, w, h, look, 0.08, 0.5);
    // 最下面一抹雾
    const g = ctx.createLinearGradient(0, foot - h * 0.25, 0, H);
    g.addColorStop(0, rgba(sky.bot, 0));
    g.addColorStop(1, rgba(pigment(mixc(SILK, sky.bot, 0.4), look), 0.8));
    ctx.fillStyle = g;
    ctx.fillRect(0, foot - h * 0.25, W, H - foot + h * 0.25);
  }

  /** 天上两三朵云，随视角时间缓缓飘 */
  private drawSkyClouds(ctx: CanvasRenderingContext2D, look: Look) {
    const { W, H, T } = this;
    if (!this.art.clouds.every(c => c.ready)) return;
    const r = rng(41);
    for (let i = 0; i < 3; i++) {
      const s = this.art.clouds[i % 2];
      const w = Math.min(W * (0.45 + r() * 0.3), H * 0.45), h = w / s.aspect;
      const span = W + w;
      const x = mod(r() * span + T * (0.012 + r() * 0.015) * W, span) - w;
      const y = H * (0.12 + r() * 0.22);
      s.draw(ctx, x, y - h / 2, w, h, look, 0.08, 0, { alpha: 0.4 + 0.6 * look.daylight, flip: r() < 0.5 });
    }
  }

  /**
   * 山脊表面：排满的时段是岩石（赭石底、石青罩染、斧劈皴），空闲的是草甸（石绿、苔点、小花）。
   * 一格一格钉在时间轴上，跟着拖动走。
   */
  private drawSurface(ctx: CanvasRenderingContext2D, ridge: [number, number, number][], look: Look) {
    const { W, T } = this;
    const meadow = pigment(mixc(MALACHITE, SHELL_WHITE, 0.15), look);
    const rock = pigment(mixc(OCHRE, AZURITE, 0.35), look);
    ctx.save();
    ctx.lineCap = 'round';
    // 一道贴着山脊的颜色带
    for (let i = 1; i < ridge.length; i++) {
      const [x0, y0, h] = ridge[i - 1], [x1, y1] = ridge[i];
      if (x1 < -5 || x0 > W + 5) continue;
      const b = this.terrain.busyAt(h), k = Math.max(0.3, this.scaleAt(h));
      ctx.strokeStyle = rgba(mixc(meadow, rock, smooth(0.2, 0.7, b)), 0.85);
      ctx.lineWidth = 7 * k;
      ctx.beginPath(); ctx.moveTo(x0, y0 + 3 * k); ctx.lineTo(x1, y1 + 3 * k); ctx.stroke();
    }

    // 皴、苔点、小花：每 STEP 小时一格
    const STEP = 0.2;
    const ink = pigment(INK, look);
    const flowers: RGB[] = [pigment(VERMILION, look), pigment(SHELL_WHITE, look)];
    for (let n = Math.floor((T - 9 * 24) / STEP); n * STEP < T + 6 * 24; n++) {
      const h = n * STEP, k = this.scaleAt(h);
      if (k < 0.12) continue;
      const [x, y] = this.at(h);
      if (x < -20 || x > W + 20) continue;
      const r = rng(n * 7 + 11), b = this.terrain.busyAt(h);
      if (b > 0.45) {
        // 斧劈皴：从山脊往左下斜劈几笔，短而硬
        const len = (10 + r() * 12) * k;
        ctx.strokeStyle = rgba(ink, 0.32 * smooth(0.45, 0.8, b));
        ctx.lineWidth = Math.max(0.6, 1.3 * k);
        ctx.beginPath();
        const x0 = x + (r() - 0.5) * 6 * k, y0 = y + (3 + r() * 4) * k;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 - len * 0.45, y0 + len);
        if (r() < 0.6) { ctx.moveTo(x0 + 4 * k, y0 + 2 * k); ctx.lineTo(x0 + 4 * k - len * 0.3, y0 + len * 0.7); }
        ctx.stroke();
      } else if (r() < 0.55) {
        // 苔点：一两点浓墨，贴着山脊
        ctx.fillStyle = rgba(ink, 0.55);
        ctx.beginPath(); ctx.arc(x + (r() - 0.5) * 6 * k, y + (1 + r() * 2) * k, Math.max(0.6, 1.4 * k), 0, Math.PI * 2); ctx.fill();
        if (r() < 0.25 && k > 0.4) {
          ctx.fillStyle = rgba(flowers[r() < 0.5 ? 0 : 1], 0.85);
          ctx.beginPath(); ctx.arc(x + (r() - 0.5) * 8 * k, y - r() * 2 * k, 1.5 * k, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /** 草甸上的草，偶尔一棵松；每半小时一格，只在闲的时候长 */
  private drawPlants(ctx: CanvasRenderingContext2D, look: Look) {
    const { W, H, T } = this;
    if (!this.art.grass.every(s => s.ready) || !this.art.pine.ready || this.e > 0.95) return;
    const fade = 1 - this.e;
    const SLOT = 0.5;
    const tall = clamp(H * 0.075, 44, 72);
    for (let n = Math.floor((T - 7 * 24) / SLOT); n * SLOT < T + 3 * 24; n++) {
      const r = rng(n * 13 + 5);
      const h = n * SLOT + r() * SLOT;
      const k = this.scaleAt(h);
      if (k < 0.15 || this.terrain.busyAt(h) > 0.3) continue;
      const [x, y] = this.at(h);
      if (x < -40 || x > W + 40) continue;
      const v = r();
      if (v < 0.05) this.art.pine.drawSmall(ctx, x, y + 3 * k, tall * 1.1 * k, look, fade, r() < 0.5);
      else if (v < 0.35) this.art.grass[Math.floor(r() * 3)].drawSmall(ctx, x, y + 3 * k, tall * 0.2 * k, look, 0.9 * fade, r() < 0.5);
    }
  }

  /**
   * 走过的路：“现在”往左渐渐淡成绢底，像画到这里收了笔。
   * 只淡山体，走过的路和石堆随后再画，看得清。
   */
  private drawPast(ctx: CanvasRenderingContext2D, ridge: [number, number, number][], CX: number, sky: Sky, look: Look) {
    const { H } = this;
    const blank = pigment(mixc(SILK, sky.bot, 0.5), look);
    ctx.save();
    ctx.clip(this.bodyPath(ridge));
    const g = ctx.createLinearGradient(CX - 20, 0, 0, 0);
    g.addColorStop(0, rgba(blank, 0));
    g.addColorStop(1, rgba(blank, 0.6 * (1 - 0.6 * this.e)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, Math.max(0, CX - 20), H);
    ctx.restore();
  }

  /** 山路：走过的是一道实在的赭石；前面的路是断续的干笔，越远越淡 */
  private drawTrail(ctx: CanvasRenderingContext2D, ridge: [number, number, number][], nowH: number, look: Look) {
    const { W } = this;
    const walked = pigment(mixc(OCHRE, INK, 0.35), look);
    const ahead = pigment(mixc(OCHRE, INK, 0.2), look);
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < ridge.length; i++) {
      const [x0, y0, h0] = ridge[i - 1], [x1, y1, h1] = ridge[i];
      if (x1 < -5 || x0 > W + 5) continue;
      const k = Math.max(0.3, this.scaleAt(h0));
      if (h1 <= nowH) {
        ctx.strokeStyle = rgba(walked, 0.85);
        ctx.lineWidth = 2 * k;
      } else {
        // 每 20 分钟一笔，笔与笔之间留一点空
        if (mod(h0, 1 / 3) > 0.22) continue;
        ctx.strokeStyle = rgba(ahead, 0.6 * smooth(30 * 24, 2, h0 - nowH));
        ctx.lineWidth = 1.5 * k;
      }
      ctx.beginPath(); ctx.moveTo(x0, y0 + 2 * k); ctx.lineTo(x1, y1 + 2 * k); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- 云 ---------- */

  /**
   * 越远的路越藏进云里：云钉在时间轴上，离视角越远越浓，近了就散开。
   * 最远处（右上角）整团压着雾，未来的山都挤在那里。
   */
  private drawClouds(ctx: CanvasRenderingContext2D, sky: Sky, look: Look) {
    const { W, H, T } = this;
    const SLOT = 9;
    const haze = mixc(sky.bot, SHELL_WHITE, 0.25 * look.daylight);
    const artReady = this.art.band.ready && this.art.clouds.every(c => c.ready);
    // 远处一格挤得只剩几个像素时，没必要格格都画：按挤的程度隔一格、隔三格……只留一部分。
    // 留哪些由格子的编号定（能被 2^k 整除的留下），拖动时不会换来换去；快要被省掉的先慢慢淡掉。
    const minGap = W * 0.06;
    for (let n = Math.floor((T + 4) / SLOT); n * SLOT < T + 62 * 24; n++) {
      const r = rng(n * 17 + 900);
      const h = n * SLOT + r() * SLOT;
      const dt = h - T;
      let a = smooth(6, 48, dt) * (1 - 0.85 * this.e);
      if (a < 0.02) continue;
      const [x, y] = this.at(h);
      if (x > W + 60) continue;
      const gap = Math.max(0.01, this.at(n * SLOT + SLOT)[0] - this.at(n * SLOT)[0]);
      const level = Math.log2(minGap / gap);
      if (level > 0) {
        a *= clamp(1 - (level - trailingZeros(n)), 0, 1);
        if (a < 0.02) continue;
      }
      // 软软的一团雾，把山脊吞掉一截
      const rx = W * (0.12 + 0.12 * r()) * (0.6 + 0.4 * a), ry = rx * (0.28 + 0.1 * r());
      const cy = y + (r() - 0.6) * ry;
      ctx.save();
      ctx.translate(x, cy);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, rgba(haze, 0.75 * a));
      g.addColorStop(0.55, rgba(haze, 0.5 * a));
      g.addColorStop(1, rgba(haze, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
      ctx.restore();
      // 上沿用画好的云勾出形状
      if (artReady && r() < 0.7) {
        const s = r() < 0.5 ? this.art.band : this.art.clouds[Math.floor(r() * 2)];
        const w = rx * 2.6, hh = w / s.aspect;
        // 大小一直在变，用预缩好的几级小图画，不为每个尺寸重新着色
        s.drawSmall(ctx, x, cy + hh * 0.25, hh, look, (0.5 + 0.5 * look.daylight) * a, r() < 0.5);
      }
    }
    // 右上角：所有更远的日子都挤在这里，整团压着云
    const g = ctx.createRadialGradient(W, H * 0.16, 0, W, H * 0.16, W * 0.5);
    const far = 1 - 0.8 * this.e;
    g.addColorStop(0, rgba(haze, 0.95 * far));
    g.addColorStop(0.5, rgba(haze, 0.6 * far));
    g.addColorStop(1, rgba(haze, 0));
    ctx.fillStyle = g;
    ctx.fillRect(W * 0.5, 0, W * 0.5, H * 0.66);
  }

  /* ---------- 路标、山顶 ---------- */

  /** 山路上的路标：明天、下周一、下个月（相对真实的今天） */
  private drawDayMarks(ctx: CanvasRenderingContext2D, now: number, look: Look) {
    const { W, CX } = this;
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);
    const d = new Date(today);
    const monday = addDays(today, ((8 - d.getDay()) % 7) || 7);
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const marks: [number, string][] = [[tomorrow, '明天'], [monday, '下周一'], [nextMonth, `${new Date(nextMonth).getMonth() + 1}月`]];
    let lastX = -Infinity;
    ctx.save();
    ctx.font = `500 11px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = look.halo;
    ctx.shadowBlur = 5;
    for (const [ms, text] of marks) {
      if (text === '下周一' && monday === tomorrow) continue;
      const [x, y] = this.at(localHours(ms));
      if (x < CX + 24 || x > W - 14 || x - lastX < 30) continue;
      lastX = x;
      const a = 0.85 * smooth(CX + 24, CX + 60, x) * (1 - this.e);
      if (a < 0.01) continue;
      ctx.fillStyle = rgba(look.mark, a);
      ctx.beginPath(); ctx.arc(x, y + 3, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(text, x, y + 9);
    }
    ctx.restore();
  }

  /** 山顶的旗：截止日。总是露在云上面 */
  private drawSummit(ctx: CanvasRenderingContext2D, summit: Summit, now: number, look: Look) {
    const { W, H } = this;
    this.summitHit = null;
    const [x, y] = this.at(summit.h);
    if (x < -30 || x > W + 30) return;
    const k = Math.max(0.45, this.scaleAt(summit.h));
    const fh = clamp(H * 0.09, 50, 84) * k;
    if (this.art.flag.ready) {
      this.art.flag.drawSmall(ctx, x, y + 2, fh, look, 1, false);
    } else {
      ctx.strokeStyle = rgba(pigment(INK, look), 0.8);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - fh); ctx.stroke();
      ctx.fillStyle = rgba(pigment(VERMILION, look), 1);
      ctx.beginPath(); ctx.moveTo(x, y - fh); ctx.lineTo(x + fh * 0.3, y - fh * 0.9); ctx.lineTo(x, y - fh * 0.8); ctx.fill();
    }
    // 靠右边时字写在旗的左边，也不压住右上角的按钮
    const right = x > W - 90;
    const ly0 = Math.max(this.insetTop + 86, y - fh - 4);
    const lx = right ? x - 10 : x, ly = right ? Math.max(ly0, y - fh * 0.4) : ly0;
    const sub = summitSub(summit, now);
    drawLabel(ctx, lx, ly, summit.label, sub, 0.95, look, right ? 'right' : 'center');
    // 点旗或字都能打开目标
    ctx.font = `600 12px ${SANS}`;
    const tw = Math.max(ctx.measureText(summit.label).width, ctx.measureText(sub).width * 0.9);
    const x0 = Math.min(x - 16, right ? lx - tw : lx - tw / 2), x1 = Math.max(x + 16, right ? lx : lx + tw / 2);
    this.summitHit = { id: GOAL_HIT, x: (x0 + x1) / 2, y: y + 4, w: x1 - x0 + 8, h: y + 4 - (ly - 32) };
  }

  /* ---------- 营地 ---------- */

  /** 营地和石堆。reserved：已经被占掉、标签要避开的地方（爬山的人和他头顶的字） */
  private drawCamps(ctx: CanvasRenderingContext2D, events: EventView[], look: Look, reserved: Box[]) {
    const { W, H, CX, T } = this;
    const campH = clamp(H * 0.05, 34, 52);
    const dark = 1 - look.daylight;
    const line = mixc(pigment(INK, look), mixc(SHELL_WHITE, look.tint, 0.3), dark);
    const shadow = pigment(mixc(OCHRE, INK, 0.6), look);
    const red = mixc(pigment(VERMILION, look), [255, 200, 170], 0.45 * dark);

    type Item = { ev: EventView; h: number; x: number; y: number; k: number };
    const items: Item[] = [];
    for (const ev of events) {
      const s = localHours(ev.start), e = localHours(ev.end);
      // 全天的日程放在那天中午
      const h = isAllDay(ev.start, ev.end) ? s + 12 : s;
      if (e < T - 9 * 24 || h > T + 62 * 24) continue;
      const [x, y] = this.at(h);
      if (x < -40 || x > W + 40) continue;
      items.push({ ev, h, x, y, k: this.scaleAt(h) });
    }
    // 只有几处搭山亭：进行中的，和视角前面最近的两三个，彼此隔开一点；其余的只在路边挂一盏灯
    const pavilions = new Set<EventView>();
    const near = items
      // 进行中的总搭山亭（开始了很久的长会也是）；其余的要在视角前面、画出来够大
      .filter(it => this.e < 0.5 && (it.ev.state === 'live' || (it.ev.state !== 'ended' && it.h >= T - 2 && campH * it.k >= 18)))
      .sort((a, b) => (b.ev.state === 'live' ? 1 : 0) - (a.ev.state === 'live' ? 1 : 0) || a.h - b.h);
    const placed: number[] = [];
    for (const it of near) {
      if (pavilions.size >= 3) break;
      const w = campH * it.k * this.art.camp.aspect;
      if (placed.some(px => Math.abs(px - it.x) < w * 1.3)) continue;
      pavilions.add(it.ev);
      placed.push(it.x);
    }
    // 远的先画，离“现在”近的压在上面
    items.sort((a, b) => Math.abs(b.x - CX) - Math.abs(a.x - CX));

    const labels: [Item, number][] = [];
    for (const it of items) {
      const { ev, x, y, k } = it;
      const raw = colorOf(ev.title);
      const fill = mixc(pigment(raw, look), raw, 0.4 * dark);
      const paint = { fill, pale: SHELL_WHITE, line, lineA: 0.75 - 0.2 * dark, shadow, seed: hashStr(ev.id) };
      const ended = ev.state === 'ended';
      const size = campH * k;

      if (ended) {
        // 走过的营地收起来，留下一座石堆；写了结论的留得深一些，钤一方小朱印
        const ch = Math.max(4, size * 0.6);
        const a = ev.outcome ? 0.95 : 0.6;
        const drawn = this.art.cairn.ready && ch > 6;
        // 落脚点只算一次：石堆、朱印、点击范围和标签都跟着它
        const fy = drawn ? this.footY(x, ch * this.art.cairn.aspect * 0.7) + 1 : y;
        if (drawn) this.art.cairn.drawSmall(ctx, x, fy, ch, look, a, hashStr(ev.id) % 2 === 0);
        else drawOrb(ctx, { x, wy: y, z: 1, r: Math.max(1.3, ch * 0.3) }, paint, a);
        if (ev.outcome && drawn) {
          const q = Math.max(3, ch * 0.22);
          ctx.fillStyle = rgba(red, 0.9);
          ctx.fillRect(x + ch * 0.38, fy - ch * 0.95, q, q);
        }
        this.hits.push({ id: ev.id, x, y: fy, w: Math.max(ch * 1.2, 28), h: Math.max(ch * 1.2, 28) });
        if (k > 0.5) labels.push([it, fy - ch - 4]);
        continue;
      }

      if (!pavilions.has(ev) || !this.art.camp.ready) {
        // 路边一根细竹竿挑一盏灯，灯是日程的颜色；太远了只剩一点颜色，越远越藏进云里
        const a = 0.95 * (1 - 0.7 * smooth(36, 240, it.h - T));
        // 回望时只留一点颜色，不挑竹竿，免得一路插满
        const pole = size * 0.5 * (1 - smooth(0, 0.5, this.e));
        const r = clamp(size * 0.11, 1.3, 4.5);
        if (pole > 6) {
          ctx.strokeStyle = rgba(line, 0.6 * a);
          ctx.lineWidth = 0.9;
          ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x, y - pole); ctx.stroke();
        }
        const top = pole > 6 ? y - pole + r * 1.2 : y;
        const cy = drawOrb(ctx, { x, wy: top, z: 1, r }, paint, a);
        this.hits.push({ id: ev.id, x, y, w: 26, h: Math.max(26, y - cy + r + 8) });
        if (k > 0.5) labels.push([it, cy - r - 4]);
        continue;
      }
      const pw = size * this.art.camp.aspect;
      const py = this.footY(x, pw * 0.8) + 2;
      this.art.camp.drawSmall(ctx, x, py, size, look, 1, false);
      // 檐下挂一盏灯：日程的颜色
      const lr = Math.max(2, size * 0.075);
      const ly = drawOrb(ctx, { x, wy: py - size * 0.42, z: 1, r: lr }, paint, 1);
      if (ev.state === 'live') {
        // 进行中：灯外再勾一圈朱砂
        ctx.strokeStyle = rgba(red, 0.85);
        ctx.lineWidth = clamp(lr * 0.25, 1, 2);
        ctx.beginPath(); ctx.arc(x, ly, lr * 1.6, 0, Math.PI * 2); ctx.stroke();
      }
      this.hits.push({ id: ev.id, x, y: py, w: Math.max(pw * 0.9, 30), h: Math.max(size, 30) });
      // 进行中的那个写在爬山的人头顶，这里不再重复
      if (k > 0.35 && ev.state !== 'live') labels.push([it, py - size - 2]);
    }

    // 标签：离“现在”近的优先，彼此不重叠，也不压住爬山的人
    labels.sort((a, b) => Math.abs(a[0].h - T) - Math.abs(b[0].h - T));
    const taken = [...reserved];
    ctx.font = `600 12px ${SANS}`;
    for (const [it, ly] of labels) {
      const { ev, x } = it;
      const sub = subLabel(ev);
      ctx.font = `600 12px ${SANS}`;
      let half = ctx.measureText(ev.title).width / 2;
      ctx.font = `500 10.5px ${SANS}`;
      half = Math.max(half, ctx.measureText(sub).width / 2) + 4;
      const box: Box = { x0: x - half, x1: x + half, y0: ly - 30, y1: ly + 2 };
      if (box.x0 < 4 || box.x1 > W - 4 || box.y0 < this.insetTop + 52) continue;
      if (taken.some(b => overlaps(b, box))) continue;
      taken.push(box);
      const a = (ev.state === 'ended' ? 0.7 : 1) * (1 - smooth(0, 0.4, this.e));
      if (a < 0.02) break;
      drawLabel(ctx, x, ly, ev.title, sub, a, look);
    }
  }

  /* ---------- 爬山的人 ---------- */

  /** 爬山的人站在“现在”；返回他和头顶文字占掉的地方 */
  private drawClimber(ctx: CanvasRenderingContext2D, f: Frame, nowH: number, look: Look): Box[] {
    const { W, H } = this;
    const [x, y] = this.at(nowH);
    if (x < -40 || x > W + 40 || y > H - this.insetBottom) return [];
    const k = this.scaleAt(nowH);
    const ch = clamp(H * 0.058, 36, 54) * Math.max(0.5, k);
    const live = f.events.find(e => e.state === 'live' && !isAllDay(e.start, e.end));
    const hod = mod(nowH, 24);
    const busy = this.terrain.busyAt(nowH);

    // 开会时，同行的人跟在身后一起走
    if (live && this.art.companion.ready) {
      const [bx] = this.at(nowH - (ch * 0.75) / this.sx);
      const c = this.art.companion;
      c.drawSmall(ctx, bx, this.footY(bx, ch * 0.95 * c.aspect * 0.6) + 2, ch * 0.95, look, 1, false);
    }
    const night = (hod >= 22 || hod < 6) && !live;
    const s = night ? this.art.rest : busy > 0.5 || live ? this.art.steep : this.art.walk;
    if (s.ready) {
      const sh = s === this.art.walk ? ch : ch * 0.85;
      // 两脚叉开，落在脚下最低的地方，坡上不悬空
      s.drawSmall(ctx, x, this.footY(x, sh * s.aspect * 0.6) + 2, sh, look, 1, false);
    } else {
      ctx.fillStyle = rgba(pigment(AZURITE, look), 1);
      ellipsePath(ctx, x, y - ch * 0.4, ch * 0.15, ch * 0.4);
      ctx.fill();
    }

    // 头顶两行字：“现在”和钟点；开着会时换成会的名字和还要准备几项
    const title = live ? `现在 · ${live.title}` : '现在';
    const sub = live ? subLabel(live) : `${fmtDay(f.now)} ${fmtTime(f.now)}`;
    const ty = Math.max(this.insetTop + 84, y - ch - 18);
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
      { x0: x - ch * 0.6, x1: x + ch * 0.45, y0: y - ch, y1: y + 4 },
    ];
  }
}

interface Box { x0: number; x1: number; y0: number; y1: number }
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/* ---------- 山顶 ---------- */

export interface Summit { ms: number; h: number; label: string; goal: boolean; start: number }

interface Stats { from: string; pct: number; pace: string }

/**
 * 山顶：自己设了目标就插在截止日；没设时先放在月底那天傍晚（离月底不到 5 天就放到下个月底）。
 */
export function summitOf(now: number, goal: Goal | null): Summit {
  if (goal) {
    const t = goal.title.length > 14 ? goal.title.slice(0, 13) + '…' : goal.title;
    // 以前设的目标没记出发时刻，就从那个月一号算起
    // 出发时刻照记下的来；只在它晚于截止（数据不对）时压到截止那一刻
    const start = Math.min(goal.start ?? monthStart(now), goal.due);
    return { ms: goal.due, h: localHours(goal.due), label: t, goal: true, start };
  }
  const d = new Date(now);
  let end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 18).getTime();
  // 按本地钟点比，跨夏令时也是整 5 天
  if (localHours(end) - localHours(now) < 5 * 24) end = new Date(d.getFullYear(), d.getMonth() + 2, 0, 18).getTime();
  const e = new Date(end);
  return { ms: end, h: localHours(end), label: `月底 · ${e.getMonth() + 1}月${e.getDate()}日`, goal: false, start: monthStart(now) };
}

function monthStart(ms: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** 旗下第二行：设了目标写日期和还有几天；没设时提示可以点 */
function summitSub(s: Summit, now: number): string {
  const days = Math.round((startOfDay(s.ms) - startOfDay(now)) / 86_400_000);
  const left = days > 0 ? `还有 ${days} 天` : days === 0 ? '就是今天' : `已过 ${-days} 天`;
  if (!s.goal) return `${left} · 点旗设目标`;
  const d = new Date(s.ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${left}`;
}

/** 标签第二行：临近和进行中提醒还要准备几项；记录显示结论的开头 */
export function subLabel(ev: EventView): string {
  if (ev.state === 'ended' && ev.outcome) {
    const line = ev.outcome.split('\n')[0];
    return line.length > 12 ? line.slice(0, 11) + '…' : line;
  }
  const range = fmtSpan(ev.start, ev.end);
  const n = prepLeft(ev);
  if ((ev.state === 'soon' || ev.state === 'live') && n) return `${range} · 还要准备 ${n} 项`;
  return range;
}

export const colorOf = (title: string) => PALETTE[hashStr(title) % PALETTE.length];

/** n 能被 2 整除几次（0 算很多次） */
function trailingZeros(n: number): number {
  if (n === 0) return 32;
  let k = 0;
  for (let m = Math.abs(n); m % 2 === 0; m /= 2) k++;
  return k;
}

/** 一维平滑噪声，0–1 */
function noise(u: number, seed: number): number {
  const i = Math.floor(u), f = u - i;
  const v = (k: number) => {
    let t = Math.imul((k + seed * 7919) ^ 0x9e3779b9, 0x85ebca6b);
    t ^= t >>> 13; t = Math.imul(t, 0xc2b2ae35); t ^= t >>> 16;
    return (t >>> 0) / 4294967296;
  };
  return v(i) + (v(i + 1) - v(i)) * f * f * (3 - 2 * f);
}
