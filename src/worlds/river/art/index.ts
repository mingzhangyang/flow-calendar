// 由 scripts/prepare-art.mjs 生成，不要手改
import rangeFar from './range-far.webp';
import rangeMid from './range-mid.webp';
import rangeNear from './range-near.webp';
import peak1 from './peak-1.webp';
import cloud1 from './cloud-1.webp';
import cloud2 from './cloud-2.webp';

/** w、h：图片像素；peak：最高处到山脚（图片底边）的距离，占图片高度的比例（云为 0） */
export interface ArtInfo { url: string; w: number; h: number; peak: number }

export const ART = {
  rangeFar: { url: rangeFar, w: 3072, h: 252, peak: 0.976 },
  rangeMid: { url: rangeMid, w: 3072, h: 265, peak: 0.977 },
  rangeNear: { url: rangeNear, w: 3072, h: 300, peak: 0.980 },
  peak1: { url: peak1, w: 1024, h: 359, peak: 0.986 },
  cloud1: { url: cloud1, w: 1024, h: 123, peak: 0.000 },
  cloud2: { url: cloud2, w: 1024, h: 123, peak: 0.000 },
} satisfies Record<string, ArtInfo>;
