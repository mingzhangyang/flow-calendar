import { type RGB, ellipsePath, mixc, mod, rgba, rng, smooth } from './paint';
import type { Sky } from './sky';
import type { Look } from './look';

/**
 * 河两岸的水墨景物：远山、白云、树、草、小溪、牛羊。
 *
 * 远山在无穷远处，钉在屏幕上不动；白云随时间缓缓往一边飘。
 * 岸上的东西钉在时间轴上，和日程一样顺水漂来，拖动时一起移动。
 * 每样东西的位置和样子都由它所在的时间段决定，同一时刻永远长一个样。
 */

/** 岸上每隔多少小时放一处景物 */
const SLOT = 0.5;
/** 比这更远的景物不画（已经挤在地平线的雾里） */
const FAR_Z = 40;

type Project = (X: number, h: number) => [number, number, number];

/** 墨色：白天是浓墨，夜里换成被月光照到的淡灰，免得在黑岸上看不见 */
function inkOf(look: Look): RGB {
  return mixc(mixc(look.land, [150, 165, 178], 0.3), [34, 42, 40], look.daylight);
}

export class Scenery {
  private W = 0; private HZ = 0;
  private S = 0;
  /** 三层远山的轮廓高度（像素），每 3 像素一个采样，从远到近 */
  private ridges: Float32Array[] = [];
  /** 河流尽头的雪山：轮廓高度和峰高 */
  private peak: Float32Array = new Float32Array(0);
  private peakH = 0;
  private clouds: { u: number; v: number; w: number; speed: number; puffs: [number, number, number][] }[] = [];

  resize(W: number, H: number, HZ: number) {
    this.W = W; this.HZ = HZ;
    this.S = Math.min(W * 0.55, H * 0.6);
    this.ridges = [0, 1, 2].map(i => makeRidge(W, H, i));
    this.peakH = H * 0.145;
    this.peak = makePeak(W, H, this.peakH);

    const r = rng(29);
    this.clouds = [];
    for (let i = 0; i < 5; i++) {
      const puffs: [number, number, number][] = [];
      const n = 4 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) puffs.push([(k / (n - 1)) - 0.5 + (r() - 0.5) * 0.12, (r() - 0.5) * 0.5, 0.35 + r() * 0.45]);
      this.clouds.push({ u: r(), v: 0.08 + r() * 0.5, w: Math.min(W * (0.22 + r() * 0.22), H * 0.3), speed: 0.012 + r() * 0.02, puffs });
    }
  }

  /* ---------- 天上：远山与白云 ---------- */

  drawFar(ctx: CanvasRenderingContext2D, sky: Sky, night: number, T: number) {
    this.drawClouds(ctx, sky, night, T);
    this.drawMountains(ctx, sky, night);
  }

  private drawMountains(ctx: CanvasRenderingContext2D, sky: Sky, night: number) {
    const { W, HZ } = this;
    const dark = mixc([52, 64, 70], [5, 8, 16], night);
    this.drawSnowPeak(ctx, sky, night, dark);
    const strength = [0.28, 0.45, 0.62];
    this.ridges.forEach((ridge, i) => {
      const c = mixc(sky.bot, dark, strength[i]);
      let top = HZ;
      for (const v of ridge) top = Math.min(top, HZ - v);

      ctx.beginPath();
      ctx.moveTo(0, HZ + 2);
      for (let k = 0; k < ridge.length; k++) ctx.lineTo(k * 3, HZ - ridge[k]);
      ctx.lineTo(W, HZ + 2);
      ctx.closePath();
      // 墨色在山脊最浓，往下淡进雾里
      const g = ctx.createLinearGradient(0, top, 0, HZ);
      // 不透明，免得星星和太阳从山后透出来
      g.addColorStop(0, rgba(c, 1));
      g.addColorStop(0.55, rgba(mixc(c, sky.bot, 0.3), 1));
      g.addColorStop(1, rgba(mixc(c, sky.bot, 0.9), 1));
      ctx.fillStyle = g;
      ctx.fill();

      // 山脊一笔淡墨
      ctx.beginPath();
      for (let k = 0; k < ridge.length; k++) {
        if (k) ctx.lineTo(k * 3, HZ - ridge[k]); else ctx.moveTo(0, HZ - ridge[k]);
      }
      ctx.strokeStyle = rgba(mixc(c, dark, 0.5), 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  /** 路的尽头，最远处的一座雪山 */
  private drawSnowPeak(ctx: CanvasRenderingContext2D, sky: Sky, night: number, dark: RGB) {
    const { W, HZ, peak, peakH } = this;
    const cx = W / 2, top = HZ - peakH;
    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(0, HZ + 2);
      for (let k = 0; k < peak.length; k++) ctx.lineTo(k * 3, HZ - peak[k]);
      ctx.lineTo(W, HZ + 2);
      ctx.closePath();
    };

    // 山体：很远，所以只比天色深一点
    const body = mixc(sky.bot, dark, 0.32);
    const g = ctx.createLinearGradient(0, top, 0, HZ);
    g.addColorStop(0, rgba(body, 1));
    g.addColorStop(1, rgba(mixc(body, sky.bot, 0.85), 1));
    outline();
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    outline();
    ctx.clip();

    // 积雪：白天雪白，早晚被霞光染暖，夜里是月光下的淡灰
    const snow = mixc(mixc([250, 251, 253], sky.bot, 0.22), mixc(sky.bot, [190, 200, 225], 0.4), night);
    const line = (x: number) => {
      // 雪线参差，沟里的雪舌往下伸
      const n = Math.sin(x * 0.07) * 0.03 + Math.sin(x * 0.19 + 1) * 0.015;
      const tongue = Math.max(0, Math.sin(x * 0.055 + 0.6)) ** 6 * 0.16;
      return HZ - peakH * (0.56 - n - tongue);
    };
    ctx.beginPath();
    ctx.moveTo(0, top - 2);
    ctx.lineTo(W, top - 2);
    for (let x = W; x >= 0; x -= 3) ctx.lineTo(x, line(x));
    ctx.closePath();
    ctx.fillStyle = rgba(snow, 0.96);
    ctx.fill();

    // 背光的一面：右侧淡淡一层墨
    const sh = ctx.createLinearGradient(cx - peakH * 0.2, 0, cx + peakH * 1.4, 0);
    sh.addColorStop(0, rgba(dark, 0));
    sh.addColorStop(0.25, rgba(dark, 0.16 - 0.08 * night));
    sh.addColorStop(1, rgba(dark, 0.04));
    ctx.fillStyle = sh;
    ctx.fillRect(cx - peakH * 0.2, top - 2, peakH * 3, peakH + 4);

    // 山脊上几笔皴擦，从峰顶往下
    ctx.strokeStyle = rgba(dark, 0.14);
    ctx.lineWidth = 1;
    for (const [dx, len] of [[-0.25, 0.3], [0.18, 0.38], [0.42, 0.26], [-0.55, 0.22]]) {
      const x0 = cx + dx * peakH * 0.6;
      const y0 = HZ - peak[Math.round(x0 / 3)] + 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + dx * peakH * 0.3, y0 + peakH * len * 0.5, x0 + dx * peakH * 0.5, y0 + peakH * len);
      ctx.stroke();
    }
    ctx.restore();

    // 山的轮廓一笔淡墨，免得雪顶和浅色的天空混在一起
    ctx.beginPath();
    for (let k = 0; k < peak.length; k++) {
      if (peak[k] < peakH * 0.15) continue;
      const x = k * 3, y = HZ - peak[k];
      if (k && peak[k - 1] >= peakH * 0.15) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = rgba(mixc(body, dark, 0.6), 0.45);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawClouds(ctx: CanvasRenderingContext2D, sky: Sky, night: number, T: number) {
    const { W, HZ } = this;
    const col = mixc(mixc([250, 248, 242], sky.bot, 0.25), mixc(sky.bot, [120, 130, 160], 0.4), night);
    const alpha = 0.6 - 0.3 * night;
    for (const cl of this.clouds) {
      const span = W + cl.w * 2;
      const cx = mod(cl.u * span + T * cl.speed * W, span) - cl.w;
      const cy = cl.v * HZ;
      for (const [px, py, pr] of cl.puffs) {
        const x = cx + px * cl.w, y = cy + py * cl.w * 0.12, r = pr * cl.w * 0.4;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, 0.32);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, rgba(col, alpha * 0.55));
        g.addColorStop(0.6, rgba(col, alpha * 0.3));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }
    }
  }

  /* ---------- 岸上：树、草、小溪、牛羊 ---------- */

  drawBanks(ctx: CanvasRenderingContext2D, project: Project, bend: (h: number) => number, T: number, tau: number, look: Look) {
    const ink = inkOf(look);
    const grass = mixc(look.land, ink, 0.55);
    const wash = mixc(look.land, ink, 0.3);
    const water = mixc(look.waterTop, [255, 255, 255], 0.12 * look.daylight);
    const wool = mixc(mixc(look.land, [200, 210, 220], 0.35), [246, 242, 230], look.daylight);
    const items: [number, () => void][] = [];

    const k0 = Math.floor((T - tau * 0.7 - 2) / SLOT), k1 = Math.ceil((T + tau * (FAR_Z - 1)) / SLOT);
    for (let k = k0; k <= k1; k++) {
      for (const side of [-1, 1] as const) {
        const r = rng(k * 2 + (side > 0 ? 1 : 0) + 7_000_000);
        const h0 = k * SLOT + r() * SLOT;
        const fade = (z: number) => smooth(FAR_Z, FAR_Z * 0.45, z);
        /** 岸上一点：离河边 d（世界单位）、时刻 h */
        const at = (d: number, h: number) => project(bend(h) + side * (0.88 + d), h);

        // 小溪：从远处的田野蜿蜒流进河里
        if (r() < 0.05) {
          const len = 1.5 + r() * 2.5, reach = 1.2 + r() * 1.3, wig = r() * 6, amp = 0.12 + r() * 0.15;
          // 河道中线（离河边距离 d，时刻 h），再往两边各让出半个溪宽，投影成一条带子
          const mid: [number, number, number][] = [];
          for (let i = 0; i <= 32; i++) {
            const u = i / 32;
            const d = -0.05 + u * reach + amp * Math.sin(u * 7 + wig) * u;
            const h = h0 + u * len + 0.3 * Math.sin(u * 4.3 + wig * 1.7) * u;
            mid.push([d, h, 0.028 * (1 - 0.65 * u)]); // 越往上游越窄
          }
          const left: [number, number, number][] = [], right: [number, number, number][] = [];
          for (let i = 0; i < mid.length; i++) {
            const a = mid[Math.max(0, i - 1)], b = mid[Math.min(mid.length - 1, i + 1)];
            // 屏幕之外的世界里，1 小时大约等于 0.3 个横向单位，按这个比例求法线
            let tx = b[0] - a[0], th = (b[1] - a[1]) * 0.3;
            const n = Math.hypot(tx, th) || 1; tx /= n; th /= n;
            const [d, h, w] = mid[i];
            left.push(at(d - th * w, h + (tx * w) / 0.3));
            right.push(at(d + th * w, h - (tx * w) / 0.3));
          }
          const zNear = Math.min(...left.map(p => p[2]), ...right.map(p => p[2]));
          if (zNear > 0.3) items.push([left[0][2] + 0.001, () => stream(ctx, left, right, ink, water, fade)]);
        }

        // 草地的淡墨晕染
        if (r() < 0.55) {
          const [x, y, z] = at(0.1 + r() * 1.3, h0 + r() * SLOT);
          const s = this.scale(z);
          if (s && z < FAR_Z) items.push([z + 0.002, () => {
            ctx.fillStyle = rgba(wash, 0.16 * fade(z));
            ellipsePath(ctx, x, y, 0.22 * s, 0.03 * s);
            ctx.fill();
          }]);
        }

        const kind = r();
        const seed = Math.floor(r() * 1e9);
        if (kind < 0.32) {
          // 一到三棵树
          const n = 1 + Math.floor(r() * 3), d = 0.08 + r() * 1.2;
          for (let i = 0; i < n; i++) {
            const [x, y, z] = at(d + i * (0.07 + r() * 0.1), h0 + (r() - 0.5) * 0.25);
            const s = this.scale(z);
            if (s && z < FAR_Z && s * 0.2 > 2) items.push([z, () => tree(ctx, x, y, s, ink, fade(z), rng(seed + i))]);
          }
        } else if (kind < 0.58) {
          // 一丛丛草
          const n = 2 + Math.floor(r() * 4);
          for (let i = 0; i < n; i++) {
            const [x, y, z] = at(0.03 + r() * 1.1, h0 + r() * SLOT);
            const s = this.scale(z);
            if (s && z < FAR_Z * 0.5 && s * 0.04 > 1.5) items.push([z, () => tuft(ctx, x, y, s, grass, fade(z), rng(seed + i))]);
          }
        } else if (kind < 0.65) {
          // 一两头牛
          const n = 1 + Math.floor(r() * 2), d = 0.2 + r() * 0.9;
          for (let i = 0; i < n; i++) {
            const [x, y, z] = at(d + i * 0.12, h0 + i * 0.15);
            const s = this.scale(z);
            if (s && z < FAR_Z * 0.6 && s * 0.07 > 3) items.push([z, () => cow(ctx, x, y, s, ink, fade(z), rng(seed + i))]);
          }
        } else if (kind < 0.73) {
          // 一小群羊
          const n = 2 + Math.floor(r() * 4), d = 0.2 + r() * 0.9;
          for (let i = 0; i < n; i++) {
            const [x, y, z] = at(d + (r() - 0.5) * 0.25, h0 + (r() - 0.5) * 0.35);
            const s = this.scale(z);
            if (s && z < FAR_Z * 0.6 && s * 0.05 > 2.5) items.push([z, () => sheep(ctx, x, y, s, ink, wool, fade(z), rng(seed + i))]);
          }
        }
      }
    }

    items.sort((a, b) => b[0] - a[0]); // 远的先画
    ctx.save();
    ctx.lineCap = 'round';
    for (const [, paint] of items) paint();
    ctx.restore();
  }

  /** 深度 z 处，一个世界单位有多少像素；太近（在“现在”线后面很远）就不画 */
  private scale(z: number): number {
    if (z < 0.3) return 0;
    return this.S / z;
  }
}

/* ---------- 远山的轮廓 ---------- */

/** 雪山：一座尖峰带两个肩，左右不对称 */
function makePeak(W: number, H: number, ph: number): Float32Array {
  const n = Math.ceil(W / 3) + 1;
  const out = new Float32Array(n);
  const cx = W / 2;
  const parts: [number, number, number][] = [
    [0, 1, H * 0.1],
    [-H * 0.1, 0.66, H * 0.09],
    [H * 0.085, 0.72, H * 0.07],
    [H * 0.2, 0.38, H * 0.1],
  ];
  for (let k = 0; k < n; k++) {
    const x = k * 3;
    let v = 0;
    for (const [dx, f, w] of parts) v = Math.max(v, ph * f * Math.exp(-((Math.abs(x - cx - dx) / w) ** 1.25)));
    v += Math.sin(x * 0.23) * 0.6 + Math.sin(x * 0.09) * 1.2;
    out[k] = Math.max(0, v);
  }
  return out;
}

function makeRidge(W: number, H: number, layer: number): Float32Array {
  const r = rng(101 + layer * 17);
  const n = Math.ceil(W / 3) + 1;
  const out = new Float32Array(n);
  // 远的层更高更淡，近的层更矮；中间留出河流远去的山口
  const maxH = H * [0.12, 0.085, 0.05][layer];
  const peaks: [number, number, number][] = [];
  for (let x = -H * 0.2; x < W + H * 0.2; x += H * (0.07 + r() * 0.1)) {
    const gap = 1 - 0.55 * Math.exp(-(((x - W / 2) / (W * 0.18)) ** 2));
    peaks.push([x, maxH * (0.45 + r() * 0.55) * gap, H * (0.05 + r() * 0.06)]);
  }
  for (let k = 0; k < n; k++) {
    const x = k * 3;
    let v = 0;
    for (const [cx, ph, pw] of peaks) {
      const t = (x - cx) / pw;
      v = Math.max(v, ph / (1 + t * t) ** 1.4);
    }
    // 细小的起伏，像笔锋
    v += Math.sin(x * 0.11 + layer) * 0.8 + Math.sin(x * 0.037 + layer * 2) * 1.6;
    out[k] = Math.max(0, v);
  }
  return out;
}

/* ---------- 水墨笔触 ---------- */

function stream(
  ctx: CanvasRenderingContext2D, left: [number, number, number][], right: [number, number, number][],
  ink: RGB, water: RGB, fade: (z: number) => number,
) {
  // 离“现在”线太近的一段会变得很粗，淡掉
  const a = fade(left[left.length - 1][2]) * smooth(0.7, 1.3, left[0][2]);
  if (a < 0.02) return;
  ctx.beginPath();
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = rgba(water, 0.75 * a);
  ctx.fill();
  // 两岸各一道淡墨
  ctx.strokeStyle = rgba(ink, 0.22 * a);
  ctx.lineWidth = 0.8;
  for (const side of [left, right]) {
    ctx.beginPath();
    side.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: RGB, a: number, r: () => number) {
  const ht = (0.16 + r() * 0.14) * s;
  const lean = (r() - 0.5) * 0.3 * ht;
  const tx = x + lean, ty = y - ht * 0.82;

  ctx.strokeStyle = rgba(ink, 0.8 * a);
  ctx.lineWidth = Math.max(0.6, 0.011 * s);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - lean * 0.4, y - ht * 0.45, tx, ty);
  ctx.stroke();

  if (r() < 0.5) {
    // 松：一层层横着的墨块
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const cy = y - ht * (0.42 + 0.55 * u);
      const cx = x + lean * ((y - cy) / (ht * 0.82)) + (r() - 0.5) * ht * 0.08;
      const rx = ht * (0.3 - 0.17 * u) * (0.8 + r() * 0.4);
      // 每一层用几笔短促的墨点叠出来，边缘参差
      const dabs = 3 + Math.floor(r() * 3);
      for (let j = 0; j < dabs; j++) {
        const ox = ((j / (dabs - 1)) - 0.5) * rx * 1.4 + (r() - 0.5) * rx * 0.3;
        const rr = rx * (0.3 + r() * 0.25) * (1 - Math.abs(ox) / (rx * 1.6));
        ctx.fillStyle = rgba(ink, (0.22 + r() * 0.25) * a);
        ellipsePath(ctx, cx + ox, cy + (r() - 0.5) * rx * 0.12 + Math.abs(ox) * 0.12, rr * 1.3, rr * 0.5);
        ctx.fill();
      }
    }
  } else {
    // 阔叶树：几团叠起来的淡墨
    const n = 5 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2, d = r() * ht * 0.2;
      ctx.fillStyle = rgba(ink, (0.16 + r() * 0.18) * a);
      ctx.beginPath();
      ctx.arc(tx + Math.cos(ang) * d * 1.3, ty + Math.sin(ang) * d * 0.8, ht * (0.12 + r() * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 点苔
  const dots = 3 + Math.floor(r() * 4);
  ctx.fillStyle = rgba(ink, 0.7 * a);
  for (let i = 0; i < dots; i++) {
    ctx.beginPath();
    ctx.arc(tx + (r() - 0.5) * ht * 0.5, ty + (r() - 0.3) * ht * 0.35, Math.max(0.4, 0.006 * s), 0, Math.PI * 2);
    ctx.fill();
  }
}

function tuft(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, c: RGB, a: number, r: () => number) {
  const n = 4 + Math.floor(r() * 4);
  ctx.strokeStyle = rgba(c, 0.6 * a);
  ctx.lineWidth = Math.max(0.5, 0.004 * s);
  for (let i = 0; i < n; i++) {
    const ang = (r() - 0.5) * 1.3, len = (0.025 + r() * 0.03) * s;
    const ex = x + Math.sin(ang) * len, ey = y - Math.cos(ang) * len;
    ctx.beginPath();
    ctx.moveTo(x + (r() - 0.5) * 0.01 * s, y);
    ctx.quadraticCurveTo(x + Math.sin(ang) * len * 0.3, y - len * 0.6, ex, ey);
    ctx.stroke();
  }
}

function cow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: RGB, a: number, r: () => number) {
  const dir = r() < 0.5 ? -1 : 1;
  const bw = 0.036 * s, bh = 0.016 * s, by = y - 0.03 * s;
  ctx.strokeStyle = rgba(ink, 0.8 * a);
  ctx.lineWidth = Math.max(0.5, 0.005 * s);
  for (const lx of [-0.7, -0.45, 0.45, 0.7]) {
    ctx.beginPath(); ctx.moveTo(x + lx * bw, by); ctx.lineTo(x + lx * bw, y); ctx.stroke();
  }
  ctx.fillStyle = rgba(ink, 0.82 * a);
  ellipsePath(ctx, x, by, bw, bh); ctx.fill();
  // 低头吃草或抬着头
  const grazing = r() < 0.6;
  const hx = x + dir * bw * 1.1, hy = grazing ? y - 0.008 * s : by - bh * 0.6;
  ctx.beginPath(); ctx.moveTo(x + dir * bw * 0.7, by - bh * 0.3); ctx.lineTo(hx, hy); ctx.stroke();
  ellipsePath(ctx, hx, hy, 0.009 * s, 0.006 * s); ctx.fill();
  ctx.lineWidth = Math.max(0.4, 0.003 * s);
  ctx.beginPath(); ctx.moveTo(x - dir * bw, by - bh * 0.2); ctx.lineTo(x - dir * bw * 1.25, by + bh * 1.1); ctx.stroke();
}

function sheep(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: RGB, wool: RGB, a: number, r: () => number) {
  const dir = r() < 0.5 ? -1 : 1;
  const bw = 0.02 * s, by = y - 0.018 * s;
  ctx.strokeStyle = rgba(ink, 0.7 * a);
  ctx.lineWidth = Math.max(0.5, 0.004 * s);
  for (const lx of [-0.5, 0.5]) {
    ctx.beginPath(); ctx.moveTo(x + lx * bw, by); ctx.lineTo(x + lx * bw, y); ctx.stroke();
  }
  // 几团白色的毛，外面一圈淡墨
  ctx.fillStyle = rgba(wool, 0.95 * a);
  ctx.beginPath();
  for (const [ox, oy, rr] of [[-0.5, 0.1, 0.55], [0, -0.2, 0.65], [0.5, 0.1, 0.55]]) {
    ctx.moveTo(x + ox * bw + rr * bw * 0.7, by + oy * bw);
    ctx.arc(x + ox * bw, by + oy * bw, rr * bw * 0.7, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.strokeStyle = rgba(ink, 0.35 * a);
  ctx.lineWidth = Math.max(0.4, 0.002 * s);
  ctx.stroke();
  ctx.fillStyle = rgba(ink, 0.85 * a);
  ellipsePath(ctx, x + dir * bw * 1.05, by - bw * 0.15, bw * 0.28, bw * 0.2);
  ctx.fill();
}

