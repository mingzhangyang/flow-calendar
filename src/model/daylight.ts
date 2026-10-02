import { localHours } from './time';

/**
 * 白天的程度：0 是夜里，1 是白天，黎明和黄昏之间平滑过渡。
 *   5:30–7:00   天渐渐亮
 *   17:45–19:15 天渐渐暗
 * 世界的配色和界面的明暗都看它，保证两边一致。
 */
export function daylightAt(ms: number): number {
  const h = ((localHours(ms) % 24) + 24) % 24;
  const ramp = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return ramp(5.5, 7, h) * (1 - ramp(17.75, 19.25, h));
}

export type Theme = 'light' | 'dark';

/** 白天过半算浅色，大约 6:15 变浅、18:30 变深 */
export function themeAt(ms: number): Theme {
  return daylightAt(ms) >= 0.5 ? 'light' : 'dark';
}
