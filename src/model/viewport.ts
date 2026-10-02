import { HOUR } from './time';

/** 视角能去多远：往回 7 天，往前 60 天 */
const MIN_H = -7 * 24;
const MAX_H = 60 * 24;
/** 松手后的滑行：速度按这个时间常数衰减，滑行距离 = 速度 × TAU_GLIDE */
const TAU_GLIDE = 0.35;
/** 停稳后先停留这么久，让人看清楚，再开始回到“现在” */
const HOLD_MS = 2500;
/** 回到“现在”的弹簧（临界阻尼，不会冲过头）。越大回得越快 */
const OMEGA = 2.6;

type Mode = 'rest' | 'drag' | 'glide' | 'hold' | 'return';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/**
 * 视角：你正在看哪个时间。
 *
 * 一次拖动的一生：
 *   拖动（drag）→ 松手后顺势滑一段（glide）→ 停下来留一会儿（hold）
 *   → 慢慢回到“现在”（return）→ 静止（rest）
 * 任何时候再碰一下，都会打断回程，从头开始。
 *
 * 时间参数 t 都是 performance.now()，和“现在”的钟点无关。
 */
export class Viewport {
  /** 视角相对现在的偏移，小时。正数是未来，负数是过去。 */
  private offsetH = 0;
  /** 小时 / 秒 */
  private vel = 0;
  private mode: Mode = 'rest';
  private holdUntil = 0;
  private lastT = 0;
  private samples: [number, number][] = [];
  /** 减少动态：不滑行、不缓动，直接到位 */
  reducedMotion = false;

  viewTime(now: number): number {
    return now + this.offsetH * HOUR;
  }

  /** 视角是否偏离了“现在” */
  get away(): boolean {
    return Math.abs(this.offsetH) > 0.25;
  }

  /** 是否需要逐帧重画 */
  isMoving(): boolean {
    return this.mode === 'drag' || this.mode === 'glide' || this.mode === 'return';
  }

  /** 静止时，多久之后需要醒来（停留结束、开始回程）；不需要则为 Infinity */
  wakeIn(t: number): number {
    return this.mode === 'hold' ? Math.max(0, this.holdUntil - t) : Infinity;
  }

  /* ---------- 输入 ---------- */

  grab(t: number) {
    this.mode = 'drag';
    this.vel = 0;
    this.samples = [[t, this.offsetH]];
  }

  /** 拖动中，视角移动 dh 小时 */
  dragBy(dh: number, t: number) {
    if (this.mode !== 'drag') this.grab(t);
    this.offsetH = clamp(this.offsetH + dh, MIN_H, MAX_H);
    this.samples.push([t, this.offsetH]);
    while (this.samples.length > 2 && t - this.samples[0][0] > 100) this.samples.shift();
  }

  release(t: number) {
    if (this.mode !== 'drag') return;
    const [t0, h0] = this.samples[0];
    const [t1, h1] = this.samples[this.samples.length - 1];
    // 松手前停顿了一下，就不滑行
    const fresh = t - t1 < 80 && t1 - t0 > 10;
    this.vel = fresh && !this.reducedMotion ? clamp(((h1 - h0) / (t1 - t0)) * 1000, -96, 96) : 0;
    this.lastT = t;
    if (this.vel) this.mode = 'glide';
    else this.settle(t);
  }

  /** 滚轮：直接移动，然后重新计时停留 */
  scrollBy(dh: number, t: number) {
    this.offsetH = clamp(this.offsetH + dh, MIN_H, MAX_H);
    this.vel = 0;
    this.settle(t);
  }

  /** 键盘：平滑地移动 dh 小时 */
  nudge(dh: number, t: number) {
    if (this.reducedMotion) return this.scrollBy(dh, t);
    // 滑行能走的距离正好是 速度 × TAU_GLIDE；接着上一次没走完的继续
    const pending = this.mode === 'glide' ? this.vel * TAU_GLIDE : 0;
    const target = clamp(this.offsetH + pending + dh, MIN_H, MAX_H);
    this.vel = (target - this.offsetH) / TAU_GLIDE;
    this.lastT = t;
    this.mode = 'glide';
  }

  /** 立刻开始回到“现在”，跳过停留 */
  home(t: number) {
    if (this.mode === 'rest') return;
    this.vel = 0;
    this.lastT = t;
    this.mode = 'return';
    if (this.reducedMotion) this.update(t);
  }

  /* ---------- 推进 ---------- */

  update(t: number) {
    const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;

    if (this.mode === 'glide') {
      const k = Math.exp(-dt / TAU_GLIDE);
      const next = this.offsetH + this.vel * TAU_GLIDE * (1 - k);
      this.offsetH = clamp(next, MIN_H, MAX_H);
      this.vel *= k;
      if (next !== this.offsetH || Math.abs(this.vel) < 0.05) this.settle(t);
    } else if (this.mode === 'hold' && t >= this.holdUntil) {
      this.mode = 'return';
      this.vel = 0;
    }

    if (this.mode === 'return') {
      if (this.reducedMotion) {
        this.offsetH = 0;
      } else {
        // 小步积分，帧率低时也稳定
        for (let left = dt; left > 0; left -= 1 / 240) {
          const h = Math.min(left, 1 / 240);
          this.vel += (-OMEGA * OMEGA * this.offsetH - 2 * OMEGA * this.vel) * h;
          this.offsetH += this.vel * h;
        }
      }
      if (Math.abs(this.offsetH) < 0.002 && Math.abs(this.vel) < 0.02) {
        this.offsetH = 0;
        this.vel = 0;
        this.mode = 'rest';
      }
    }
  }

  /** 停稳：离开了“现在”就先停留，否则直接静止 */
  private settle(t: number) {
    this.vel = 0;
    this.lastT = t;
    if (this.offsetH === 0) {
      this.mode = 'rest';
    } else {
      this.mode = 'hold';
      this.holdUntil = t + HOLD_MS;
    }
  }
}
