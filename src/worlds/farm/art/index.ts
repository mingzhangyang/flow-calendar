// 由 scripts/prepare-art.mjs 生成，不要手改
import farmerWalk1 from './farmer-walk-1.webp';
import farmerHoe1 from './farmer-hoe-1.webp';
import plotBare from './plot-bare.webp';
import plotTilled from './plot-tilled.webp';

/**
 * w、h：图片像素；peak：最高处到山脚（图片底边）的距离，占图片高度的比例（云和精灵图为 0）；
 * ax：落地点（底边上树干、脚的位置）离左边多远，占图片宽度的比例
 */
export interface ArtInfo { url: string; w: number; h: number; peak: number; ax: number }

export const ART = {
  farmerWalk1: { url: farmerWalk1, w: 160, h: 186, peak: 0.000, ax: 0.596 },
  farmerHoe1: { url: farmerHoe1, w: 192, h: 150, peak: 0.000, ax: 0.576 },
  plotBare: { url: plotBare, w: 256, h: 256, peak: 0.000, ax: 0.500 },
  plotTilled: { url: plotTilled, w: 256, h: 256, peak: 0.000, ax: 0.500 },
} satisfies Record<string, ArtInfo>;
