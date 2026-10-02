import type { Goal } from '../model/types';
import { DAY, startOfDay } from '../model/time';
import type { Store } from '../data/store';

/** 截止日最远能设到多少天以后（和视角能去的范围一样） */
const MAX_DAYS = 60;
/** 截止在那天傍晚 */
const DUE_HOUR = 18;

export interface GoalDeps {
  store: Store;
  /** 目标改了：重新读取并重画 */
  changed(goal: Goal | null): void;
}

/**
 * 登山的目标：一句话和一个截止日。点山顶的旗打开。
 * 和日程的详情共用一套样式（手机上从底部升起，桌面上居中）。
 */
export class GoalForm {
  private dlg = document.getElementById('goal') as HTMLDialogElement;
  private form = this.dlg.querySelector('form') as HTMLFormElement;
  private title = this.form.elements.namedItem('title') as HTMLInputElement;
  private date = this.form.elements.namedItem('date') as HTMLInputElement;
  private error = this.form.querySelector('.error') as HTMLElement;
  private clearBtn = this.form.querySelector('.clear') as HTMLButtonElement;

  constructor(private deps: GoalDeps) {
    this.form.addEventListener('submit', e => { e.preventDefault(); this.save(); });
    this.form.addEventListener('input', () => { this.error.textContent = ''; });
    this.form.querySelector('.cancel')!.addEventListener('click', () => this.dlg.close());
    this.clearBtn.addEventListener('click', () => this.clear());
    this.dlg.addEventListener('click', e => { if (e.target === this.dlg) this.dlg.close(); });
  }

  get isOpen() { return this.dlg.open; }

  /** 打开表单。没设目标时，截止日先填 fallbackDue（旗现在插的那天） */
  open(goal: Goal | null, fallbackDue: number) {
    this.error.textContent = '';
    this.title.value = goal?.title ?? '';
    this.date.value = toDateInput(goal?.due ?? fallbackDue);
    const today = startOfDay(Date.now());
    this.date.min = toDateInput(today);
    this.date.max = toDateInput(today + MAX_DAYS * DAY);
    this.clearBtn.hidden = !goal;
    if (!this.dlg.open) this.dlg.showModal();
    this.title.focus();
  }

  private async save() {
    const title = this.title.value.trim();
    const day = fromDateInput(this.date.value);
    const today = startOfDay(Date.now());
    let problem = '';
    if (!title) problem = '写一句目标，比如“新版上线”。';
    else if (day === null) problem = '选一个截止日。';
    else if (day < today) problem = '截止日不能早于今天。';
    else if (day > today + MAX_DAYS * DAY + DAY / 2) problem = `截止日最远设到 ${MAX_DAYS} 天以后。`;
    if (problem) {
      this.error.textContent = problem;
      (title ? this.date : this.title).focus();
      return;
    }
    const due = new Date(day!);
    due.setHours(DUE_HOUR, 0, 0, 0);
    const goal: Goal = { title, due: due.getTime() };
    await this.deps.store.setGoal(goal);
    this.dlg.close();
    this.deps.changed(goal);
  }

  private async clear() {
    await this.deps.store.setGoal(null);
    this.dlg.close();
    this.deps.changed(null);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
}
