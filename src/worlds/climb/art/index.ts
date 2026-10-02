// 由 scripts/prepare-art.mjs 生成，不要手改
import climberWalk1 from './climber-walk-1.webp';
import climberSteep1 from './climber-steep-1.webp';
import climberRest1 from './climber-rest-1.webp';
import companion1 from './companion-1.webp';
import camp1 from './camp-1.webp';
import cairn1 from './cairn-1.webp';
import summitFlag1 from './summit-flag-1.webp';
import cloudBand1 from './cloud-band-1.webp';

/**
 * w、h：图片像素；peak：最高处到山脚（图片底边）的距离，占图片高度的比例（云和精灵图为 0）；
 * ax：落地点（底边上树干、脚的位置）离左边多远，占图片宽度的比例
 */
export interface ArtInfo { url: string; w: number; h: number; peak: number; ax: number }

export const ART = {
  climberWalk1: { url: climberWalk1, w: 160, h: 218, peak: 0.000, ax: 0.504 },
  climberSteep1: { url: climberSteep1, w: 160, h: 169, peak: 0.000, ax: 0.164 },
  climberRest1: { url: climberRest1, w: 192, h: 170, peak: 0.000, ax: 0.497 },
  companion1: { url: companion1, w: 128, h: 206, peak: 0.000, ax: 0.559 },
  camp1: { url: camp1, w: 320, h: 307, peak: 0.000, ax: 0.503 },
  cairn1: { url: cairn1, w: 128, h: 121, peak: 0.000, ax: 0.487 },
  summitFlag1: { url: summitFlag1, w: 160, h: 429, peak: 0.000, ax: 0.462 },
  cloudBand1: { url: cloudBand1, w: 1536, h: 170, peak: 0.000, ax: 0.500 },
} satisfies Record<string, ArtInfo>;
