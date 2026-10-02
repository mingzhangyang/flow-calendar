import { type RGB, mixc } from './paint';
import type { Sky } from './sky';

/**
 * 河流世界在某个时刻的配色。
 * 水和岸随白天程度连续变化；文字颜色在白天过半时整体切换一次，
 * 保证任何时候都看得清。
 */
export interface Look {
  daylight: number;
  light: boolean;
  waterTop: RGB; waterBot: RGB;
  land: RGB; landShade: number;
  line: RGB; lineGain: number;
  streak: RGB;
  ink: RGB; inkSoft: number; halo: string;
  now: RGB; nowGlow: RGB;
  mark: RGB;
}

const DEEP: RGB = [6, 16, 24];
const WHITE: RGB = [255, 255, 255];

export function lookAt(sky: Sky, daylight: number): Look {
  const d = daylight;
  const light = d >= 0.5;

  const nightTop = mixc(sky.bot, DEEP, 0.35), nightBot = mixc(sky.top, DEEP, 0.82);
  const dayTop = mixc(sky.bot, WHITE, 0.3), dayBot = mixc(sky.top, [176, 206, 220], 0.7);

  const nightLand = mixc([14, 24, 22], sky.top, 0.18), dayLand = mixc([138, 164, 142], sky.top, 0.1);

  return {
    daylight: d,
    light,
    waterTop: mixc(nightTop, dayTop, d),
    waterBot: mixc(nightBot, dayBot, d),
    land: mixc(nightLand, dayLand, d),
    landShade: 0.4 - 0.25 * d,
    line: mixc(mixc(sky.bot, WHITE, 0.35), [38, 72, 92], d),
    lineGain: 1 + 0.3 * d,
    streak: mixc(mixc(sky.bot, WHITE, 0.5), [52, 90, 112], d),
    ink: light ? [22, 38, 50] : [255, 255, 255],
    inkSoft: light ? 0.7 : 0.72,
    halo: light ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.6)',
    now: light ? [92, 50, 8] : [255, 240, 215],
    nowGlow: light ? [196, 128, 40] : [255, 236, 205],
    mark: light ? [70, 60, 40] : [255, 243, 224],
  };
}
