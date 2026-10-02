import { type RGB, mixc } from './paint';
import type { Sky } from './sky';

/**
 * 河流世界在某个时刻的配色：绢本青绿山水。
 *
 * 底子是绢，山水用矿物颜料：石青、石绿、赭石，勾勒用墨，点睛用朱砂。
 * 钟点只改变“光”：清晨黄昏给绢染上暖色，夜里像在灯下看画，整体压暗，
 * 颜料本身不变。文字颜色在白天过半时整体切换一次，保证任何时候都看得清。
 */

/** 颜料 */
export const SILK: RGB = [228, 214, 182];
export const AZURITE: RGB = [52, 104, 150];   // 石青
export const MALACHITE: RGB = [62, 138, 112]; // 石绿
export const OCHRE: RGB = [172, 118, 66];     // 赭石
export const INK: RGB = [48, 40, 32];         // 墨（偏暖）
export const VERMILION: RGB = [196, 64, 40];  // 朱砂
export const SHELL_WHITE: RGB = [246, 241, 228]; // 蛤粉

/** 夜里各通道保留的亮度：整体压暗、略偏青，颜料的色相不变 */
const NIGHT_KEEP: RGB = [0.36, 0.4, 0.5];

export interface Look {
  daylight: number;
  light: boolean;
  /** 天色（绢在此刻光线下的颜色），用来给颜料染一点环境光 */
  tint: RGB;
  waterTop: RGB; waterBot: RGB;
  land: RGB; landShade: number;
  line: RGB; lineGain: number;
  ripple: RGB; rippleAlpha: number;
  ink: RGB; inkSoft: number; halo: string;
  now: RGB; nowGlow: RGB;
  mark: RGB;
}

/**
 * 颜料在此刻光线下的样子：先染一点天色，再按夜的程度压暗。
 * mist 表示被雾吞掉多少（远处的东西更淡、更接近绢色）。
 */
export function pigment(c: RGB, look: Look, mist = 0): RGB {
  const lit = mixc(mixc(c, look.tint, 0.12), look.tint, mist);
  // 雾本身就是天色（夜里已经暗了），所以被雾吞掉的部分少压暗一些
  const k = (1 - look.daylight) * (1 - mist);
  const dark: RGB = [lit[0] * NIGHT_KEEP[0], lit[1] * NIGHT_KEEP[1], lit[2] * NIGHT_KEEP[2]];
  return mixc(lit, dark, k);
}

export function lookAt(sky: Sky, daylight: number): Look {
  const d = daylight;
  const light = d >= 0.5;
  const base = { daylight: d, light, tint: sky.bot } as Look;

  return {
    ...base,
    // 水：远处淡进绢色的雾里，近处是淡淡的青绿
    waterTop: pigment(mixc(SILK, [196, 214, 196], 0.5), base, 0.35),
    waterBot: pigment(mixc([150, 186, 176], AZURITE, 0.22), base),
    land: pigment(mixc(MALACHITE, OCHRE, 0.32), base),
    landShade: 0.22 - 0.1 * d,
    line: pigment(mixc(INK, AZURITE, 0.4), base),
    lineGain: 0.55 + 0.25 * d,
    ripple: light ? mixc(AZURITE, INK, 0.35) : mixc(sky.bot, [210, 220, 214], 0.5),
    rippleAlpha: light ? 0.32 : 0.22,
    ink: light ? INK : [246, 238, 222],
    inkSoft: light ? 0.72 : 0.72,
    halo: light ? 'rgba(244,236,214,.92)' : 'rgba(20,18,22,.6)',
    now: light ? [150, 44, 24] : [255, 232, 204],
    nowGlow: light ? VERMILION : [255, 214, 170],
    mark: light ? [96, 70, 40] : [246, 232, 210],
  };
}
