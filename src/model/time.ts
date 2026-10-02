export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 把时间戳换成“本地小时数”：一条连续的数轴，整数正好落在本地整点，
 * 能被 24 整除的地方就是本地午夜。世界用它摆放东西。
 */
export function localHours(ms: number): number {
  const offset = new Date(ms).getTimezoneOffset();
  return (ms - offset * MINUTE) / HOUR;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
}

export function fmtRange(start: number, end: number): string {
  return `${fmtTime(start)}–${fmtTime(end)}`;
}

export function fmtDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
}
