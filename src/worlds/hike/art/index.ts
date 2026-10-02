// 由 scripts/prepare-art.mjs 生成，不要手改
import rangeFar from './range-far.webp';
import rangeMid from './range-mid.webp';
import rangeNear from './range-near.webp';
import peak1 from './peak-1.webp';
import cloud1 from './cloud-1.webp';
import cloud2 from './cloud-2.webp';
import treeBroad1 from './tree-broad-1.webp';
import treePine1 from './tree-pine-1.webp';
import treeWillow1 from './tree-willow-1.webp';
import grass1 from './grass-1.webp';
import grass2 from './grass-2.webp';
import grass3 from './grass-3.webp';
import buffalo1 from './buffalo-1.webp';
import buffalo2 from './buffalo-2.webp';
import sheep1 from './sheep-1.webp';

/**
 * w、h：图片像素；peak：最高处到山脚（图片底边）的距离，占图片高度的比例（云和精灵图为 0）；
 * ax：落地点（底边上树干、脚的位置）离左边多远，占图片宽度的比例
 */
export interface ArtInfo { url: string; w: number; h: number; peak: number; ax: number }

export const ART = {
  rangeFar: { url: rangeFar, w: 3072, h: 252, peak: 0.976, ax: 0.500 },
  rangeMid: { url: rangeMid, w: 3072, h: 265, peak: 0.977, ax: 0.500 },
  rangeNear: { url: rangeNear, w: 3072, h: 300, peak: 0.980, ax: 0.500 },
  peak1: { url: peak1, w: 1024, h: 359, peak: 0.986, ax: 0.500 },
  cloud1: { url: cloud1, w: 1024, h: 123, peak: 0.000, ax: 0.500 },
  cloud2: { url: cloud2, w: 1024, h: 123, peak: 0.000, ax: 0.500 },
  treeBroad1: { url: treeBroad1, w: 512, h: 525, peak: 0.000, ax: 0.519 },
  treePine1: { url: treePine1, w: 512, h: 537, peak: 0.000, ax: 0.584 },
  treeWillow1: { url: treeWillow1, w: 512, h: 573, peak: 0.000, ax: 0.494 },
  grass1: { url: grass1, w: 192, h: 186, peak: 0.000, ax: 0.537 },
  grass2: { url: grass2, w: 192, h: 264, peak: 0.000, ax: 0.514 },
  grass3: { url: grass3, w: 192, h: 123, peak: 0.000, ax: 0.481 },
  buffalo1: { url: buffalo1, w: 256, h: 144, peak: 0.000, ax: 0.423 },
  buffalo2: { url: buffalo2, w: 256, h: 156, peak: 0.000, ax: 0.570 },
  sheep1: { url: sheep1, w: 192, h: 122, peak: 0.000, ax: 0.523 },
} satisfies Record<string, ArtInfo>;
