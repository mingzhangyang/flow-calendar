import ICAL from 'ical.js';
import type { CalEvent } from '../model/types';
import { DAY } from '../model/time';

/**
 * 读 .ics 文件（Google 日历、苹果日历、Outlook 导出的都行），换成日程。
 *
 * - 文件里带的时区（VTIMEZONE）先登记，时间按各自的时区换算；没有时区的按本地时间。
 * - 重复日程（RRULE）展开成一次次的日程，只展开往回 30 天到往后一年；
 *   跳过的日期（EXDATE）不要，单独改过的那一次（RECURRENCE-ID）用改过的样子，取消的不要。
 * - 全天日程：从当天零点到第二天零点。
 * - id 由 UID 和这一次的开始时间决定，同一个文件再导入一次只会覆盖，不会重复。
 */
export interface IcsResult {
  events: CalEvent[];
  /** 重复日程有几个（展开前） */
  recurring: number;
  /** 超出上限没导入的次数 */
  dropped: number;
}

const BACK = 30 * DAY;
const AHEAD = 365 * DAY;
/** 一个重复日程最多展开多少次；整个文件最多多少条 */
const PER_SERIES = 1000;
const TOTAL = 5000;

export function parseIcs(text: string, now = Date.now()): IcsResult {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  // 同一个 UID 的：一个主日程，加上若干“单独改过的那一次”
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const comp of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(comp);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid || `noid-${masters.size}`, ev);
  }
  for (const ex of exceptions) {
    const m = masters.get(ex.uid);
    if (m) m.relateException(ex);
    else masters.set(`${ex.uid}-${ex.startDate}`, ex); // 主日程不在文件里，就当普通日程
  }

  const out: CalEvent[] = [];
  let recurring = 0, dropped = 0;
  const from = now - BACK, to = now + AHEAD;

  for (const [uid, ev] of masters) {
    if (cancelled(ev.component)) continue;
    if (!ev.isRecurring()) {
      const e = toEvent(uid, ev, ev.startDate, ev.endDate);
      if (e) out.push(e);
      continue;
    }
    recurring++;
    const it = ev.iterator();
    let n = 0;
    // 从第一次开始数，跳过窗口之前的；数到窗口之后就停
    for (let guard = 0, t = it.next(); t && guard < 50_000; t = it.next(), guard++) {
      const d = ev.getOccurrenceDetails(t);
      const start = toMs(d.startDate);
      if (start > to) break;
      if (toMs(d.endDate) < from) continue;
      if (cancelled(d.item.component)) continue;
      if (n >= PER_SERIES) { dropped++; continue; }
      const e = toEvent(uid, d.item, d.startDate, d.endDate, d.recurrenceId);
      if (e) { out.push(e); n++; }
    }
  }

  if (out.length > TOTAL) {
    dropped += out.length - TOTAL;
    // 留下离现在最近的
    out.sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now));
    out.length = TOTAL;
  }
  return { events: out.sort((a, b) => a.start - b.start), recurring, dropped };
}

function cancelled(comp: ICAL.Component): boolean {
  return String(comp.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
}

function toMs(t: ICAL.Time): number {
  // 全天：本地的那一天零点；其他：按时区换成真正的时刻（没有时区的当作本地时间）
  return t.isDate ? new Date(t.year, t.month - 1, t.day).getTime() : t.toJSDate().getTime();
}

function toEvent(
  uid: string, item: ICAL.Event, startT: ICAL.Time, endT: ICAL.Time | null, recurrenceId?: ICAL.Time,
): CalEvent | null {
  if (!startT) return null;
  const start = toMs(startT);
  let end = endT ? toMs(endT) : start;
  if (end <= start) end = startT.isDate ? start + DAY : start + 30 * 60_000; // 没写结束：全天算一天，其他算半小时
  // 全天日程的结束是“第二天零点”，跨夏令时也按日历算
  if (startT.isDate && endT?.isDate) end = toMs(endT);

  const key = recurrenceId ? toMs(recurrenceId) : start;
  const ev: CalEvent = {
    id: `ics:${uid}:${key}`,
    title: (item.summary || '').trim() || '（没有标题）',
    start, end,
  };
  const notes = [
    item.location ? `地点：${item.location.trim()}` : '',
    clean(item.description),
  ].filter(Boolean).join('\n\n');
  if (notes) ev.notes = notes.slice(0, 2000);
  return ev;
}

/** 有的导出在描述里带 HTML（Google 日历常见），换成纯文字 */
function clean(s: string | null | undefined): string {
  if (!s) return '';
  if (!/<[a-z][\s\S]*>/i.test(s)) return s.trim();
  const doc = new DOMParser().parseFromString(s.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
  return (doc.body.textContent ?? '').trim();
}
