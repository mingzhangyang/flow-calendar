import type { World } from '../world';
import type { EventView, Frame } from '../../model/types';
import { addDays, fmtDay, fmtRange, fmtTime, localHours, startOfDay } from '../../model/time';
import {
  type OrbGeom, type RGB, PALETTE, SANS, clamp, drawLabel, drawOrb, ellipsePath, hashStr,
  mixc, mod, rgba, rng, smooth, strokeLine,
} from './paint';
import { type Sky, celestial, drawSky, nightAt, skyAt } from './sky';
import { type Look, OCHRE, INK, lookAt, pigment } from './look';
import { daylightAt } from '../../model/daylight';
import { Scenery } from './scenery';
import { silkPattern } from './silk';

/**
 * 远足世界：沿着一条土路往远处走
 *
 * 透视：离“现在”越远，东西越小、越靠近地平线。
 *   深度 z = 1 + (h - T) / TAU     h 是某个时刻（本地小时），T 是视角所在时刻
 *   屏幕 y = 地平线 + D / z         z = 1 时正好落在“现在”线上
 * TAU 越大，近处的几个小时铺得越开。
 */
const TAU = 3.5;
/** 路的轻微弯曲 */
const bend = (h: number) => 0.22 * Math.sin(h * 0.13);
/** 路的半宽（世界单位） */
const ROAD = 0.5;

/** 一维的平滑噪声：每 1 个单位一个随机值，中间平滑过渡 */
function noise(u: number, seed: number): number {
  const i = Math.floor(u), f = u - i;
  const v = (k: number) => {
    let t = Math.imul((k + seed * 7919) ^ 0x9e3779b9, 0x85ebca6b);
    t ^= t >>> 13; t = Math.imul(t, 0xc2b2ae35); t ^= t >>> 16;
    return (t >>> 0) / 4294967296;
  };
  return v(i) + (v(i + 1) - v(i)) * f * f * (3 - 2 * f);
}

/**
 * 路边：时刻 h 处、side 那一边的路边离路中心多远。
 * 几层快慢不同的起伏叠在一起，左右两边各不相同；钉在时间轴上，同一时刻永远一样。
 */
const edgeOf = (h: number, side: -1 | 1) =>
  ROAD + 0.12 * (noise(h * 0.8, side + 3) - 0.5) + 0.06 * (noise(h * 2.6, side + 7) - 0.5) + 0.025 * (noise(h * 7, side + 11) - 0.5);
/** 路边那一点的横向位置 */
const edgeX = (h: number, side: -1 | 1) => bend(h) + side * edgeOf(h, side);

interface Hit { id: string; x: number; y: number; r: number }

export class HikeWorld implements World {
  readonly id = 'hike';
  readonly name = '远足';

  private W = 0; private H = 0;
  private HZ = 0;   // 地平线
  private NOWY = 0; // “现在”线
  private D = 0;
  private S = 0;    // 横向尺度
  private insetBottom = 0;
  private T = 0;
  private hits: Hit[] = [];
  private scenery: Scenery;

  /** invalidate：世界里有东西变了（比如素材加载好了），需要重画一次 */
  constructor(invalidate: () => void) {
    this.scenery = new Scenery(invalidate);
  }

  resize(w: number, h: number, insets: { top: number; bottom: number }) {
    this.W = w; this.H = h;
    this.insetBottom = insets.bottom;
    this.HZ = h * 0.3;
    this.NOWY = h * 0.7;
    this.D = this.NOWY - this.HZ;
    this.S = Math.min(w * 0.55, h * 0.6); // 宽屏上不让路面和光球过大
    this.scenery.resize(w, h, this.HZ);
  }

  private z(h: number) { return 1 + (h - this.T) / TAU; }

  /** 路面上一点 → 屏幕坐标。X 是横向位置（路中心为 0，两边约 ±ROAD） */
  private project(X: number, h: number): [number, number, number] {
    const z = this.z(h);
    return [this.W / 2 + (X * this.S) / z, this.HZ + this.D / z, z];
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame) {
    const { W, H, HZ } = this;
    this.T = localHours(f.view);
    const hod = mod(this.T, 24);
    const sky = skyAt(hod), night = nightAt(hod);
    const body = celestial(hod, W, H, HZ, night);
    // 世界的明暗跟着“视角所在的时间”：拖到今晚，就是今晚的样子
    const look = lookAt(sky, daylightAt(f.view));

    drawSky(ctx, W, HZ, sky, night, body);
    this.scenery.drawFar(ctx, sky, look, this.T);
    this.drawRoad(ctx, look);
    this.drawRuts(ctx, look);
    this.drawHourLines(ctx, look);
    this.drawBank(ctx, -1, sky, look);
    this.drawBank(ctx, 1, sky, look);
    this.scenery.drawBanks(ctx, (X, h) => this.project(X, h), edgeX, this.T, TAU, look);
    this.drawHaze(ctx, sky);
    this.drawRoadTexture(ctx, look);
    this.drawHorizonMarks(ctx, f.now, look);
    this.drawSilk(ctx, look);
    this.drawEvents(ctx, f.events, night, look);
    this.drawNowLine(ctx, f.now, look);
  }

  dragHours(y: number, dy: number): number {
    // 屏幕 y 处的时刻 h = T + (D / (y - HZ) - 1) * TAU。
    // 让手指下的 h 不变，T 就要变 TAU * D / (y - HZ)² * dy。
    // 越靠近地平线一步走得越远；离地平线太近时封顶，免得手一抖就跳出好几天。
    const fromHz = Math.max(y - this.HZ, this.D * 0.35);
    return (TAU * this.D * dy) / (fromHz * fromHz);
  }

  hitTest(x: number, y: number): string | null {
    // 近处的后画、在上面，所以倒着找
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if ((x - h.x) ** 2 + (y - h.y) ** 2 <= h.r ** 2) return h.id;
    }
    return null;
  }

  isAnimating() { return false; }

  idleRedrawMs() {
    // “现在”线附近每分钟移动的像素数；让每次重画只挪半个像素左右
    const pxPerMinute = this.D / (TAU * 60);
    return clamp((0.5 / pxPerMinute) * 60_000, 5_000, 60_000);
  }

  /* ---------- 路与路边 ---------- */

  /** 路面：整片铺满，两边再由岸上的田野盖住 */
  private drawRoad(ctx: CanvasRenderingContext2D, look: Look) {
    const { W, H, HZ } = this;
    const far = look.roadFar, near = look.roadNear;
    const g = ctx.createLinearGradient(0, HZ, 0, H);
    g.addColorStop(0, rgba(far, 1));
    g.addColorStop(0.45, rgba(mixc(far, near, 0.7), 1));
    g.addColorStop(1, rgba(near, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, HZ, W, H - HZ);
  }

  private polyAcross(ctx: CanvasRenderingContext2D, h: number, c: RGB, a: number) {
    ctx.beginPath();
    const x0 = edgeX(h, -1), x1 = edgeX(h, 1);
    for (let i = 0; i <= 14; i++) {
      const X = x0 + ((x1 - x0) * i) / 14;
      const [x, y] = this.project(X, h);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = rgba(c, a);
    ctx.stroke();
  }

  /** 路面上的横线：近处每小时一条，远处只留每天一条 */
  private drawHourLines(ctx: CanvasRenderingContext2D, look: Look) {
    const { T, D } = this;
    const c = look.line, gain = look.lineGain;
    ctx.lineWidth = 1;
    for (let h = Math.ceil(T - TAU * 0.68); h < T + TAU * 13; h++) {
      const z = this.z(h), gap = D / z - D / (z + 1 / TAU);
      const isMidnight = mod(h, 24) === 0;
      const a = gain * smooth(2.5, 9, gap) * (isMidnight ? 0.4 : 0.1) * smooth(0.32, 0.6, z);
      if (a > 0.005) this.polyAcross(ctx, h, c, a);
    }
    for (let d = Math.ceil((T + TAU * 13) / 24); d * 24 < T + TAU * 260; d++) {
      const h = d * 24, z = this.z(h), gap = D / z - D / (z + 24 / TAU);
      const a = gain * smooth(1, 4, gap) * 0.35;
      if (a > 0.005) this.polyAcross(ctx, h, c, a);
    }
  }

  private drawBank(ctx: CanvasRenderingContext2D, side: -1 | 1, sky: Sky, look: Look) {
    const { W, H, HZ, T } = this;
    const pts: [number, number][] = [];
    // 采样要密一些，路边的小起伏才画得出来
    const hs: number[] = [];
    for (let z = 0.3; z < 300; z *= 1.03) {
      const h = T + (z - 1) * TAU;
      const [x, y] = this.project(edgeX(h, side), h);
      pts.push([x, y]);
      hs.push(h);
    }
    const edge = side < 0 ? -10 : W + 10;
    ctx.beginPath();
    ctx.moveTo(edge, H + 10);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(edge, HZ);
    ctx.closePath();
    const land = look.land, far = mixc(land, sky.bot, 0.6);
    const g = ctx.createLinearGradient(0, HZ, 0, H);
    g.addColorStop(0, rgba(far, 1));
    g.addColorStop(0.25, rgba(land, 1));
    g.addColorStop(1, rgba(mixc(land, [0, 0, 0], look.landShade), 1));
    ctx.fillStyle = g;
    ctx.fill();

    // 路边一道赭石的土边，宽窄不一；再用墨断断续续勾几笔，不描成一条整齐的线
    const ochre = pigment(OCHRE, look), ink = pigment(INK, look);
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (Math.abs(y1 - y0) < 0.05 && Math.abs(x1 - x0) < 0.05) continue;
      const h = hs[i], z = 1 + (h - T) / TAU;
      const k = Math.min(1, 1.6 / Math.sqrt(z)); // 远处的笔画细一些
      ctx.strokeStyle = rgba(ochre, 0.32);
      ctx.lineWidth = (2 + 6 * noise(h * 3, side + 21)) * k;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const ia = 0.45 * smooth(0.35, 0.75, noise(h * 4, side + 31));
      if (ia > 0.02) {
        ctx.strokeStyle = rgba(ink, ia);
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawHaze(ctx: CanvasRenderingContext2D, sky: Sky) {
    const { W, H, HZ } = this;
    const g = ctx.createLinearGradient(0, HZ - H * 0.05, 0, HZ + H * 0.07);
    g.addColorStop(0, rgba(sky.bot, 0));
    g.addColorStop(0.42, rgba(sky.bot, 0.85));
    g.addColorStop(1, rgba(sky.bot, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, HZ - H * 0.05, W, H * 0.12);
  }

  /**
   * 车辙：路中间两道略深的带子，顺着路弯，钉在时间轴上（微微的起伏跟着时刻走）。
   */
  private drawRuts(ctx: CanvasRenderingContext2D, look: Look) {
    const { T } = this;
    for (const off of [-0.16, 0.16]) {
      // 一小段一小段地画，近处（“现在”线以下）和远处都淡掉，免得近处变成两条粗带子
      let prev: [number, number, number, number] | null = null;
      for (let z = 0.45; z < 80; z *= 1.06) {
        const h = T + (z - 1) * TAU;
        const c = bend(h) + off + 0.025 * Math.sin(h * 0.7 + off * 9);
        const w = 0.028 * (1 + 0.25 * Math.sin(h * 1.3 + off * 5));
        const [lx, ly] = this.project(c - w, h), [rx, ry] = this.project(c + w, h);
        if (prev) {
          const a = look.rutAlpha * 0.4 * smooth(0.45, 1.05, z) * smooth(80, 25, z);
          ctx.fillStyle = rgba(look.rut, a);
          ctx.beginPath();
          ctx.moveTo(prev[0], prev[1]); ctx.lineTo(prev[2], prev[3]);
          ctx.lineTo(rx, ry); ctx.lineTo(lx, ly);
          ctx.closePath();
          ctx.fill();
        }
        prev = [lx, ly, rx, ry];
      }
    }
  }

  /**
   * 路面的干笔：一排排短促的横笔，偶尔一颗石子，像土路上的皴擦。
   * 钉在时间轴上，随时间一起往下走；远处排得太密时淡掉，路面留白成雾。
   */
  private drawRoadTexture(ctx: CanvasRenderingContext2D, look: Look) {
    const { T, D } = this;
    const step = 0.13;
    ctx.save();
    ctx.lineWidth = 0.9;
    ctx.lineCap = 'round';
    const pebbles: [number, number, number][] = [];
    for (let k = Math.ceil((T - TAU * 0.65) / step); ; k++) {
      const h = k * step, z = this.z(h);
      const gap = D / z - D / (z + step / TAU);
      if (gap < 2.5) break;
      if (z < 0.35) continue;
      // “现在”线以下离得太近，笔触会变大变呆板，淡掉
      const a = look.rutAlpha * smooth(2.5, 6, gap) * (0.35 + 0.65 * smooth(0.75, 1.05, z));
      const b = bend(h);
      const r = rng(k * 31 + 7);
      ctx.beginPath();
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        // 每一笔长短、位置、起伏都不同，像手画的
        const X = -(ROAD - 0.06) + r() * (ROAD - 0.06) * 2 - 0.05, len = 0.03 + r() * 0.06;
        const p0 = this.project(b + X, h), p1 = this.project(b + X + len, h);
        const c = this.project(b + X + len / 2, h - step * (r() - 0.5) * 0.6);
        ctx.moveTo(p0[0], p0[1]);
        ctx.quadraticCurveTo(c[0], c[1], p1[0], p1[1]);
      }
      ctx.strokeStyle = rgba(look.rut, a);
      ctx.stroke();
      if (r() < 0.1) {
        const [x, y] = this.project(b + (r() - 0.5) * (ROAD - 0.08) * 2, h);
        pebbles.push([x, y, ((0.006 * this.S) / z) * (a / look.rutAlpha)]);
      }
    }
    // 石子：一点淡墨，下沿一笔深一点
    ctx.fillStyle = rgba(look.rut, look.rutAlpha * 0.9);
    for (const [x, y, rr] of pebbles) {
      if (rr < 0.4) continue;
      ellipsePath(ctx, x, y, rr * 1.3, rr * 0.7);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 整幅画盖一层绢的经纬和四角的旧色 */
  private drawSilk(ctx: CanvasRenderingContext2D, look: Look) {
    const { W, H } = this;
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

  /** 地平线附近的路标：明天、下周一、下个月（都相对真实的今天） */
  private drawHorizonMarks(ctx: CanvasRenderingContext2D, now: number, look: Look) {
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);
    const d = new Date(today);
    const toMonday = ((8 - d.getDay()) % 7) || 7;
    const monday = addDays(today, toMonday);
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const marks: [number, string][] = [[tomorrow, '明天'], [monday, '下周一'], [nextMonth, `${new Date(nextMonth).getMonth() + 1}月`]];

    let lastY = Infinity;
    ctx.save();
    ctx.font = `500 11px ${SANS}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = look.halo;
    ctx.shadowBlur = 5;
    for (const [ms, text] of marks) {
      if (ms === tomorrow && monday === tomorrow && text === '下周一') continue;
      const h = localHours(ms);
      const [x, y, z] = this.project(edgeX(h, -1) - 0.07, h);
      if (z < 1.25 || z > 280) continue;
      if (Math.abs(y - lastY) < 13) continue; // 挤在一起就只留前一个
      lastY = y;
      const a = 0.85 * smooth(1.25, 1.6, z);
      ctx.fillStyle = rgba(look.mark, a);
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(text, x - 7, y);
    }
    ctx.restore();
  }

  /* ---------- 日程 ---------- */

  private orb(X: number, h: number, hours: number): OrbGeom | null {
    const z = this.z(h);
    if (z < 0.3 || z > 320) return null;
    const [x, wy] = this.project(X, h);
    const size = 0.045 + 0.035 * Math.min(hours, 3);
    return { x, wy, z, r: Math.min(36, Math.max(1.3, (size * this.S) / z)) };
  }

  private drawEvents(ctx: CanvasRenderingContext2D, events: EventView[], night: number, look: Look) {
    const { T } = this;
    this.hits = [];
    const visible: [EventView, OrbGeom][] = [];
    for (const ev of events) {
      const s = localHours(ev.start), e = localHours(ev.end);
      if (e < T - 3 || s > T + TAU * 320) continue;
      const mid = (s + e) / 2;
      const o = this.orb(bend(mid) + laneOf(ev.id), mid, e - s);
      if (o) visible.push([ev, o]);
    }
    visible.sort((a, b) => b[1].z - a[1].z); // 远的先画

    for (const [ev, o] of visible) {
      let a = smooth(0.32, 0.85, o.z) * (o.z > 30 ? 0.75 : 1);
      const col = colorOf(ev.title);
      const live = ev.state === 'live';
      if (ev.state === 'ended') a *= 0.45;

      if (live && a > 0.05) {
        // 进行中：水面上一圈静止的光环
        ctx.strokeStyle = rgba(look.light ? mixc(col, [0, 0, 0], 0.3) : col, 0.6 * a);
        ctx.lineWidth = 1.2;
        ellipsePath(ctx, o.x, o.wy, o.r * 2, o.r * 0.55);
        ctx.stroke();
      }
      const cy = drawOrb(ctx, o, col, a, { night, glow: live ? 1.6 : 1, rim: look.daylight });

      if (o.z < 2.7 && o.z > 0.72) {
        const la = a * smooth(2.7, 2.1, o.z) * smooth(0.72, 0.95, o.z);
        drawLabel(ctx, o.x, cy - o.r - 6, ev.title, fmtRange(ev.start, ev.end), la, look);
      }
      if (a > 0.15 && o.z < 60) this.hits.push({ id: ev.id, x: o.x, y: cy, r: Math.max(o.r * 1.4, 18) });
    }
  }

  /* ---------- “现在” ---------- */

  private drawNowLine(ctx: CanvasRenderingContext2D, now: number, look: Look) {
    const { W } = this;
    const [, y] = this.project(0, localHours(now));
    if (y < this.HZ || y > this.H - this.insetBottom) return;
    const L = Math.max(16, W * 0.06);
    ctx.strokeStyle = rgba(look.nowGlow, look.light ? 0.22 : 0.14); ctx.lineWidth = 7; strokeLine(ctx, 0, y, W, y);
    ctx.strokeStyle = rgba(look.now, 0.85); ctx.lineWidth = 1.3; strokeLine(ctx, 0, y, W, y);

    ctx.save();
    ctx.shadowColor = look.halo; ctx.shadowBlur = 6;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.font = `600 13px ${SANS}`;
    ctx.fillStyle = rgba(look.now, 1);
    ctx.fillText('现在', L, y - 8);
    const w0 = ctx.measureText('现在').width;
    ctx.font = `500 12px ${SANS}`;
    ctx.fillStyle = rgba(look.now, 0.75);
    ctx.fillText(`${fmtDay(now)} ${fmtTime(now)}`, L + w0 + 8, y - 8);
    ctx.restore();
  }
}

/* 每个日程在路面上的横向位置和颜色，由 id、标题决定，保持稳定 */
const laneOf = (id: string) => ((hashStr(id) % 1000) / 1000 - 0.5) * 0.5;
const colorOf = (title: string) => PALETTE[hashStr(title) % PALETTE.length];
