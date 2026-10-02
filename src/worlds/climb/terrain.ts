import type { CalEvent } from '../../model/types';
import { isAllDay, localHours } from '../../model/time';

/**
 * 山的形状：做过（和要做）的事一层层垒起来，就是海拔。
 *
 * 时间轴每 STEP 小时一格：有日程占着的格子是“忙”（1），没有的是“闲”（0）。
 * 忙的时候每小时爬升 1，是陡坡；白天闲着也慢慢往上走一点（BASE），是草甸；
 * 夜里往下走一点（DIP），落到两座山之间的垭口歇脚。所以每一天是一道山梁，忙的日子高而陡。
 * 忙闲先抹平一点（边缘不至于是折角），再累加成海拔。
 * 山顶（截止日）过后，路往下走一段，再接着往上。
 *
 * 只在日程变了、或者过了一天时重算；平时只是查表。
 */
const STEP = 0.05;
/** 白天闲着，每小时爬多少 */
const BASE = 0.18;
/** 夜里每小时往下走多少 */
const DIP = 0.12;
/** 山顶之后往下走多少 */
const DROP = 6;

export class Terrain {
  private h0 = 0;
  private busy = new Float32Array(0);
  private alt = new Float32Array(0);
  private key = '';
  /** 上次算的时候各个日程的开始、结束；和这次逐个比，一点不同就重算 */
  private times: number[] = [];

  /**
   * 按日程和现在算一遍（没变就跳过）。summitH 是山顶的时刻，fromH 是出发的时刻（本地小时）：
   * 平时往回算 9 天；回望要从出发那天画起，出发得更早就算得更早。
   */
  update(events: CalEvent[], now: number, summitH: number, fromH: number) {
    const day0 = Math.floor(localHours(now) / 24);
    const from = Math.min(day0 - 9, Math.floor(fromH / 24) - 1);
    const key = `${day0}|${summitH}|${from}`;
    let same = key === this.key && this.times.length === events.length * 2;
    for (let i = 0; same && i < events.length; i++) {
      same = this.times[2 * i] === events[i].start && this.times[2 * i + 1] === events[i].end;
    }
    if (same) return;
    this.key = key;
    this.times = events.flatMap(e => [e.start, e.end]);

    // 往回 9 天（或到出发前一天）、往前 64 天：比视角能去的范围再多一点
    const h0 = from * 24, h1 = (day0 + 64) * 24;
    const n = Math.round((h1 - h0) / STEP) + 1;
    this.h0 = h0;
    const raw = new Float32Array(n);
    for (const e of events) {
      // 全天日程（节日、假期）不算忙，否则一天就垒起一面悬崖
      if (isAllDay(e.start, e.end)) continue;
      // 一连好几天的（会议、出差）只算白天，夜里不算。
      // 长短按本地钟点算：跨夏令时那天的“9 点到第二天 9 点”只有 23 个小时，也算一整天
      const s = localHours(e.start), en = localHours(e.end);
      const long = en - s >= 24;
      const i0 = Math.max(0, Math.round((s - h0) / STEP));
      const i1 = Math.min(n, Math.round((en - h0) / STEP));
      for (let i = i0; i < i1; i++) {
        const b = long ? daytime(h0 + i * STEP) : 1;
        if (b > raw[i]) raw[i] = b; // 叠在一起的日程只算一次
      }
    }
    const busy = blur(blur(raw, 5), 5);

    const alt = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const h = h0 + i * STEP, b = busy[i];
      const day = daytime(h);
      alt[i] = alt[i - 1] + (b + (1 - b) * (BASE * day - DIP * (1 - day))) * STEP;
    }
    // 山顶之后往下走半天
    for (let i = 0; i < n; i++) alt[i] -= DROP * smooth(summitH, summitH + 12, h0 + i * STEP);
    this.busy = busy;
    this.alt = alt;
  }

  /** 时刻 h 的海拔（范围外按白天的平均坡度往外延） */
  altAt(h: number): number {
    const { alt, h0 } = this;
    const n = alt.length;
    if (!n) return 0;
    const f = (h - h0) / STEP;
    if (f <= 0) return alt[0] + f * STEP * BASE * 0.5;
    if (f >= n - 1) return alt[n - 1] + (f - n + 1) * STEP * BASE * 0.5;
    const i = Math.floor(f), u = f - i;
    return alt[i] * (1 - u) + alt[i + 1] * u;
  }

  /** 时刻 h 有多忙：0 闲，1 排满 */
  busyAt(h: number): number {
    const { busy, h0 } = this;
    const i = Math.round((h - h0) / STEP);
    return i >= 0 && i < busy.length ? busy[i] : 0;
  }
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 白天的程度：7–8 点渐渐起步，20–21 点渐渐停下 */
function daytime(h: number) {
  const x = ((h % 24) + 24) % 24;
  return smooth(7, 8, x) * (1 - smooth(20, 21, x));
}

/** 半径 r 格的滑动平均 */
function blur(a: Float32Array, r: number): Float32Array<ArrayBuffer> {
  const n = a.length, out = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < Math.min(r, n); i++) s += a[i];
  for (let i = 0; i < n; i++) {
    if (i + r < n) s += a[i + r];
    if (i - r - 1 >= 0) s -= a[i - r - 1];
    out[i] = s / (Math.min(n - 1, i + r) - Math.max(0, i - r) + 1);
  }
  return out;
}
