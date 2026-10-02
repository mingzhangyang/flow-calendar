import type { CalEvent } from './types';
import { HOUR, MINUTE, addDays, startOfDay } from './time';

/**
 * 示例日程。第 3 步接入真实数据后删除。
 * 用当天日期做种子，同一天里刷新页面看到的是同一批。
 */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORK = ['设计讨论', '客户电话', '代码评审', '1:1', '周会', '面试', '写文档', '组会', '整理数据'];
const REST = ['爬山', '读书', '跑步', '去超市', '看电影'];

export function demoEvents(now: number): CalEvent[] {
  const today = startOfDay(now);
  const r = rng(Math.floor(today / 1000));
  const out: CalEvent[] = [];
  const push = (dayStart: number, hour: number, hours: number, title: string) => {
    const start = dayStart + hour * HOUR;
    out.push({ id: `demo-${out.length}`, title, start, end: start + hours * HOUR });
  };

  // 刚好在“现在”附近的三件事，保证打开时能看到进行中、临近和稍远的日程
  const half = 30 * MINUTE;
  const nextHalf = Math.ceil(now / half) * half;
  const near: CalEvent[] = [
    { id: 'demo-live', title: '专注写作', start: nextHalf - 50 * MINUTE, end: nextHalf + 10 * MINUTE },
    { id: 'demo-soon', title: '回邮件', start: nextHalf + 30 * MINUTE, end: nextHalf + 60 * MINUTE },
    { id: 'demo-later', title: '散步', start: nextHalf + 3 * HOUR, end: nextHalf + 3.5 * HOUR },
  ];

  for (let day = -3; day <= 40; day++) {
    const d0 = addDays(today, day);
    const wd = new Date(d0).getDay();
    if (wd === 0 || wd === 6) {
      if (r() < 0.6) push(d0, r() < 0.5 ? 10 : 15, 1.5, REST[Math.floor(r() * REST.length)]);
      continue;
    }
    push(d0, 9.5, 0.5, '站会');
    const want = 1 + Math.floor(r() * 3);
    let busyUntil = 10, count = 0;
    for (const st of [10.5, 11, 13, 14, 15, 16, 17]) {
      if (count >= want) break;
      if (st < busyUntil || r() > 0.5) continue;
      const len = [0.5, 1, 1, 1.5][Math.floor(r() * 4)];
      push(d0, st, len, WORK[Math.floor(r() * WORK.length)]);
      busyUntil = st + len;
      count++;
    }
  }

  // 去掉和“附近三件事”撞车的
  const free = out.filter(ev => !near.some(n => ev.start < n.end + 15 * MINUTE && n.start - 15 * MINUTE < ev.end));
  return [...free, ...near].sort((a, b) => a.start - b.start);
}
