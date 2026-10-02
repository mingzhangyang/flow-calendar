import type { CalEvent, EventState, EventView } from './types';
import { MINUTE } from './time';

/** 开始前多久算“临近” */
export const SOON_WINDOW = 60 * MINUTE;

export function stateOf(ev: CalEvent, now: number): EventState {
  if (now >= ev.end) return 'ended';
  if (now >= ev.start) return 'live';
  if (ev.start - now <= SOON_WINDOW) return 'soon';
  return 'future';
}

export function withStates(events: CalEvent[], now: number): EventView[] {
  return events.map(ev => ({ ...ev, state: stateOf(ev, now) }));
}

/** 下一次有日程改变状态的时刻，用来安排重绘 */
export function nextStateChange(events: CalEvent[], now: number): number {
  let next = Infinity;
  for (const ev of events) {
    for (const t of [ev.start - SOON_WINDOW, ev.start, ev.end]) {
      if (t > now && t < next) next = t;
    }
  }
  return next;
}

/** 还没做完的准备事项有几项 */
export function prepLeft(ev: CalEvent): number {
  return ev.prep?.filter(p => !p.done).length ?? 0;
}
