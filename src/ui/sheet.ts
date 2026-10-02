import type { CalEvent } from '../model/types';
import { stateOf } from '../model/states';
import { DAY, HOUR, MINUTE, fmtDay, fmtTime, startOfDay } from '../model/time';
import { type Store, newId } from '../data/store';

/**
 * 日程的详情和编辑表单，放在同一个 <dialog> 里。
 * 手机上从底部升起，桌面上居中。所有用户输入的文字都用 textContent 写入。
 */
export interface SheetDeps {
  store: Store;
  find(id: string): CalEvent | undefined;
  /** 数据改了：重新读取并重画 */
  changed(): Promise<void>;
}

export class Sheet {
  private dlg = document.getElementById('sheet') as HTMLDialogElement;
  private detail = this.dlg.querySelector('.detail') as HTMLElement;
  private form = this.dlg.querySelector('.form') as HTMLFormElement;
  private delBtn = this.detail.querySelector('.del') as HTMLButtonElement;
  private error = this.form.querySelector('.error') as HTMLElement;
  /** 正在看或正在改的日程；新建时为 null */
  private current: CalEvent | null = null;
  private confirming = false;

  constructor(private deps: SheetDeps) {
    this.detail.querySelector('.close')!.addEventListener('click', () => this.dlg.close());
    this.detail.querySelector('.edit')!.addEventListener('click', () => this.current && this.showForm(this.current));
    this.delBtn.addEventListener('click', () => this.remove());
    this.form.querySelector('.cancel')!.addEventListener('click', () => {
      // 改到一半取消：回到详情；新建时取消就关掉
      if (this.current) this.showDetail(this.current); else this.dlg.close();
    });
    this.form.addEventListener('submit', e => { e.preventDefault(); this.save(); });
    // 点面板外面的暗处关掉
    this.dlg.addEventListener('click', e => { if (e.target === this.dlg) this.dlg.close(); });
  }

  get isOpen() { return this.dlg.open; }

  openDetail(id: string) {
    const ev = this.deps.find(id);
    if (!ev) return;
    this.showDetail(ev);
    this.open();
    (this.detail.querySelector('.edit') as HTMLElement).focus();
  }

  /** 新建：默认放在 at 之后最近的半点，长一小时 */
  openNew(at: number) {
    const start = Math.ceil(at / (30 * MINUTE)) * 30 * MINUTE;
    this.current = null;
    this.showForm({ id: '', title: '', start, end: start + HOUR });
    this.open();
  }

  private open() {
    if (!this.dlg.open) this.dlg.showModal();
  }

  private showDetail(ev: CalEvent) {
    this.current = ev;
    this.confirming = false;
    this.delBtn.textContent = '删除';
    this.delBtn.classList.remove('danger');
    this.form.hidden = true;
    this.detail.hidden = false;
    this.dlg.setAttribute('aria-label', `日程：${ev.title}`);
    this.text('.detail .title', ev.title);
    this.text('.detail .when', fmtWhen(ev.start, ev.end));
    this.text('.detail .state', stateText(ev, Date.now()));
    const notes = this.dlg.querySelector('.detail .notes') as HTMLElement;
    notes.textContent = ev.notes ?? '';
    notes.hidden = !ev.notes;
  }

  private showForm(ev: CalEvent) {
    const f = this.form.elements as unknown as Record<'title' | 'date' | 'start' | 'end' | 'notes', HTMLInputElement>;
    f.title.value = ev.title;
    f.date.value = dateValue(ev.start);
    f.start.value = timeValue(ev.start);
    f.end.value = timeValue(ev.end);
    f.notes.value = ev.notes ?? '';
    this.error.textContent = '';
    this.text('.form-title', ev.id ? '编辑日程' : '新建日程');
    this.dlg.setAttribute('aria-label', ev.id ? '编辑日程' : '新建日程');
    this.detail.hidden = true;
    this.form.hidden = false;
    f.title.focus();
  }

  private async save() {
    const f = this.form.elements as unknown as Record<'title' | 'date' | 'start' | 'end' | 'notes', HTMLInputElement>;
    const title = f.title.value.trim();
    const start = parseLocal(f.date.value, f.start.value);
    const end = parseLocal(f.date.value, f.end.value);
    let problem = '';
    if (!title) problem = '请填写标题。';
    else if (start === null || end === null) problem = '请填写日期和时间。';
    else if (end <= start) problem = '结束时间要晚于开始时间。';
    if (problem) {
      this.error.textContent = problem;
      (problem.includes('标题') ? f.title : problem.includes('结束') ? f.end : f.date).focus();
      return;
    }
    const notes = f.notes.value.trim();
    const ev: CalEvent = { id: this.current?.id || newId(), title, start: start!, end: end! };
    if (notes) ev.notes = notes;
    try {
      await this.deps.store.put(ev);
    } catch {
      this.error.textContent = '保存失败，请再试一次。';
      return;
    }
    await this.deps.changed();
    this.showDetail(ev);
    (this.detail.querySelector('.edit') as HTMLElement).focus();
  }

  /** 删除要点两次：第一次变成“确定删除” */
  private async remove() {
    if (!this.current) return;
    if (!this.confirming) {
      this.confirming = true;
      this.delBtn.textContent = '确定删除';
      this.delBtn.classList.add('danger');
      return;
    }
    await this.deps.store.remove(this.current.id);
    this.current = null;
    this.dlg.close();
    await this.deps.changed();
  }

  private text(sel: string, s: string) {
    (this.dlg.querySelector(sel) as HTMLElement).textContent = s;
  }
}

/* ---------- 文字 ---------- */

function fmtWhen(start: number, end: number): string {
  if (startOfDay(start) === startOfDay(end - 1)) return `${fmtDay(start)}  ${fmtTime(start)}–${fmtTime(end)}`;
  return `${fmtDay(start)} ${fmtTime(start)} – ${fmtDay(end)} ${fmtTime(end)}`;
}

function span(ms: number): string {
  const m = Math.max(1, Math.round(ms / MINUTE));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} 小时 ${r} 分钟` : `${h} 小时`;
}

function stateText(ev: CalEvent, now: number): string {
  switch (stateOf(ev, now)) {
    case 'live': return `进行中，还剩 ${span(ev.end - now)}`;
    case 'ended': return '已结束';
    case 'soon': return `${span(ev.start - now)}后开始`;
    case 'future': {
      const days = Math.round((startOfDay(ev.start) - startOfDay(now)) / DAY);
      if (days === 0) return `今天，${span(ev.start - now)}后开始`;
      if (days === 1) return '明天';
      if (days === 2) return '后天';
      return `${days} 天后`;
    }
  }
}

/* ---------- 表单里的日期和时间（本地时间） ---------- */

const pad = (n: number) => String(n).padStart(2, '0');

function dateValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeValue(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocal(date: string, time: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), tm = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!dm || !tm) return null;
  return new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]).getTime();
}
