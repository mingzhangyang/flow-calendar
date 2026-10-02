import type { World } from '../world';
import type { EventView, Frame } from '../../model/types';
import { addDays, fmtDay, fmtRange, fmtTime, localHours, startOfDay } from '../../model/time';
import {
  type OrbGeom, type RGB, PALETTE, SANS, clamp, drawLabel, drawOrb, ellipsePath, hashStr,
  mixc, mod, rgba, rng, smooth, strokeLine,
} from './paint';
import { type Sky, celestial, drawSky, nightAt, skyAt } from './sky';
import { type Look, lookAt } from './look';
import { daylightAt } from '../../model/daylight';

/**
 * 河流世界
 *
 * 透视：离“现在”越远，东西越小、越靠近地平线。
 *   深度 z = 1 + (h - T) / TAU     h 是某个时刻（本地小时），T 是视角所在时刻
 *   屏幕 y = 地平线 + D / z         z = 1 时正好落在“现在”线上
 * TAU 越大，近处的几个小时铺得越开。
 */
const TAU = 3.5;
/** 河道的轻微弯曲 */
const bend = (h: number) => 0.22 * Math.sin(h * 0.13);

interface Hit { id: string; x: number; y: number; r: number }

export class RiverWorld implements World {
  readonly id = 'river';
  readonly name = '河流';

  private W = 0; private H = 0;
  private HZ = 0;   // 地平线
  private NOWY = 0; // “现在”线
  private D = 0;
  private S = 0;    // 横向尺度
  private insetBottom = 0;
  private T = 0;
  private hits: Hit[] = [];

  resize(w: number, h: number, insets: { top: number; bottom: number }) {
    this.W = w; this.H = h;
    this.insetBottom = insets.bottom;
    this.HZ = h * 0.3;
    this.NOWY = h * 0.7;
    this.D = this.NOWY - this.HZ;
    this.S = Math.min(w * 0.55, h * 0.6); // 宽屏上不让河面和光球过大
  }

  private z(h: number) { return 1 + (h - this.T) / TAU; }

  /** 河面上一点 → 屏幕坐标。X 是横向位置（河中心为 0，两岸约 ±0.85） */
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
    this.drawWater(ctx, look, body);
    this.drawWaterLines(ctx, look);
    this.drawBank(ctx, -1, sky, look);
    this.drawBank(ctx, 1, sky, look);
    this.drawHaze(ctx, sky);
    this.drawStreaks(ctx, look);
    this.drawHorizonMarks(ctx, f.view, look);
    this.drawEvents(ctx, f.events, night, look);
    this.drawNowLine(ctx, f.now, look);
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

  /* ---------- 水与岸 ---------- */

  private drawWater(ctx: CanvasRenderingContext2D, look: Look, body: ReturnType<typeof celestial>) {
    const { W, H, HZ, NOWY } = this;
    const top = look.waterTop, bot = look.waterBot;
    const g = ctx.createLinearGradient(0, HZ, 0, H);
    g.addColorStop(0, rgba(top, 1));
    g.addColorStop(0.45, rgba(mixc(top, bot, 0.7), 1));
    g.addColorStop(1, rgba(bot, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, HZ, W, H - HZ);

    // 太阳或月亮在水里的倒影（固定的碎光，不晃动）
    if (body && body.y < HZ + 4) {
      for (let k = 0; k < 16; k++) {
        const yy = HZ + 5 + k * k * 1.5;
        if (yy > NOWY) break;
        const ww = (34 - k * 1.8) * (1 + 0.35 * Math.sin(k * 1.3));
        if (ww <= 0) break;
        ctx.fillStyle = rgba(body.c, 0.32 * (1 - k / 16) * body.a);
        ctx.fillRect(body.x - ww / 2 + Math.sin(k) * 3, yy, ww, 1.6);
      }
    }
  }

  private polyAcross(ctx: CanvasRenderingContext2D, h: number, c: RGB, a: number) {
    ctx.beginPath();
    for (let i = 0; i <= 14; i++) {
      const X = bend(h) - 0.85 + (1.7 * i) / 14;
      const [x, y] = this.project(X, h);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = rgba(c, a);
    ctx.stroke();
  }

  /** 水面上的横线：近处每小时一条，远处只留每天一条 */
  private drawWaterLines(ctx: CanvasRenderingContext2D, look: Look) {
    const { T, D } = this;
    const c = look.line, gain = look.lineGain;
    ctx.lineWidth = 1;
    for (let h = Math.ceil(T - TAU * 0.68); h < T + TAU * 13; h++) {
      const z = this.z(h), gap = D / z - D / (z + 1 / TAU);
      const isMidnight = mod(h, 24) === 0;
      const a = gain * smooth(2.5, 9, gap) * (isMidnight ? 0.5 : 0.2) * smooth(0.32, 0.6, z);
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
    for (let z = 0.3; z < 300; z *= 1.1) {
      const h = T + (z - 1) * TAU;
      const [x, y] = this.project(bend(h) + side * 0.85, h);
      pts.push([x, y]);
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

    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = rgba(mixc(sky.bot, [255, 255, 255], 0.3), 0.25);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawHaze(ctx: CanvasRenderingContext2D, sky: Sky) {
    const { W, H, HZ } = this;
    const g = ctx.createLinearGradient(0, HZ - H * 0.05, 0, HZ + H * 0.07);
    g.addColorStop(0, rgba(sky.bot, 0));
    g.addColorStop(0.42, rgba(sky.bot, 0.7));
    g.addColorStop(1, rgba(sky.bot, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, HZ - H * 0.05, W, H * 0.12);
  }

  /** 水纹：钉在时间轴上，随时间一起往下漂 */
  private drawStreaks(ctx: CanvasRenderingContext2D, look: Look) {
    const { T } = this;
    const c = look.streak, span = 48;
    for (const s of STREAKS) {
      const h = T - 2.2 + mod(s[1] * span - (T - 2.2), span);
      const z = this.z(h);
      if (z < 0.35) continue;
      const X = bend(h) + s[0];
      const a = 0.28 * smooth(0.5, 1, z) * (1 - smooth(5, 14, z)); // “现在”线以下淡掉，不像雨
      if (a < 0.01) continue;
      const p1 = this.project(X, h), p2 = this.project(X, h - 0.22);
      ctx.strokeStyle = rgba(c, a);
      ctx.lineWidth = Math.max(0.6, 1.4 / z);
      strokeLine(ctx, p1[0], p1[1], p2[0], p2[1]);
    }
  }

  /** 地平线附近的路标：明天、下周一、下个月 */
  private drawHorizonMarks(ctx: CanvasRenderingContext2D, view: number, look: Look) {
    const today = startOfDay(view);
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
      const [x, y, z] = this.project(bend(h) - 0.92, h);
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

/* 每个日程在河面上的横向位置和颜色，由 id、标题决定，保持稳定 */
const laneOf = (id: string) => ((hashStr(id) % 1000) / 1000 - 0.5) * 0.76;
const colorOf = (title: string) => PALETTE[hashStr(title) % PALETTE.length];

const STREAKS: [number, number][] = [];
{
  const r = rng(11);
  for (let i = 0; i < 160; i++) STREAKS.push([r() * 1.6 - 0.8, r()]);
}

