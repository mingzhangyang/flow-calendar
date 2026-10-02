import type { Frame } from '../model/types';

/**
 * 世界接口。远足、登山、农场、深海各实现一份。
 * 世界只负责“画”和“点中了谁”，不保存日程，也不决定时间怎么走。
 */
export interface World {
  readonly id: string;
  readonly name: string;

  /** 画布尺寸变化。w、h 是 CSS 像素；insets 是系统栏占掉的安全区。 */
  resize(w: number, h: number, insets: { top: number; bottom: number }): void;

  /** 按快照画一帧 */
  draw(ctx: CanvasRenderingContext2D, frame: Frame): void;

  /**
   * 在屏幕上 (x, y) 处拖动 (dx, dy) 像素，视角应该移动多少小时（正数是往未来）。
   * 世界按自己的透视来换算，让手指下的东西跟着手指走。
   */
  dragHours(x: number, y: number, dx: number, dy: number): number;

  /** 屏幕上的一点落在哪个日程上，没有则返回 null */
  hitTest(x: number, y: number): string | null;

  /** 世界自己是否还有动画要播（比如一次过渡），有就继续要下一帧 */
  isAnimating(frame: Frame): boolean;

  /** 静止时多久需要重画一次，才能让时间的流动看起来连续 */
  idleRedrawMs(frame: Frame): number;
}
