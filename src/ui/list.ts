import type { CalEvent } from '../model/types';
import { prepLeft, stateOf } from '../model/states';
import { DAY, MINUTE, fmtDay, fmtSpan, startOfDay } from '../model/time';

/**
 * 普通的列表视图：给读屏软件用，也方便快速查找。
 * “接下来”按时间往后排，“过去”从近到远；搜索时不分过去未来，找标题、备注、准备事项和结论。
 * 点一行打开和画面上一样的详情。
 */
export interface ListDeps {
  events(): CalEvent[];
  openDetail(id: string): void;
  /** 导入一个 .ics 文件，返回给人看的结果 */
  importFile(file: File): Promise<string>;
}

type Tab = 'next' | 'past';

export class ListView {
  private dlg = document.getElementById('list') as HTMLDialogElement;
  private search = this.dlg.querySelector('.search') as HTMLInputElement;
  private body = this.dlg.querySelector('.groups') as HTMLElement;
  private empty = this.dlg.querySelector('.empty') as HTMLElement;
  private tabs = [...this.dlg.querySelectorAll<HTMLButtonElement>('.tabs button')];
  private status = this.dlg.querySelector('.status') as HTMLElement;
  private tab: Tab = 'next';
  private renderedMinute = 0;

  constructor(private deps: ListDeps) {
    this.dlg.querySelector('.close')!.addEventListener('click', () => this.dlg.close());
    this.search.addEventListener('input', () => this.render());
    const file = this.dlg.querySelector('.import-file') as HTMLInputElement;
    const btn = this.dlg.querySelector('.import') as HTMLButtonElement;
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      btn.disabled = true;
      this.say('正在导入…');
      try {
        this.say(await this.deps.importFile(f));
      } finally {
        btn.disabled = false;
        this.render();
      }
    });
    for (const b of this.tabs) b.addEventListener('click', () => this.setTab(b.dataset.tab as Tab));
    this.body.addEventListener('click', e => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (row) this.deps.openDetail(row.dataset.id!);
    });
  }

  get isOpen() { return this.dlg.open; }

  open() {
    this.say('');
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
    // 有鼠标的设备直接聚焦搜索框；手机上不弹出键盘，先停在标题上
    if (matchMedia('(pointer: fine)').matches) this.search.focus();
    else (this.dlg.querySelector('h2') as HTMLElement).focus();
  }

  /** 数据改了，或者分钟变了（状态可能变了），列表开着就重排一遍 */
  refresh(now = Date.now()) {
    if (!this.dlg.open) return;
    const minute = Math.floor(now / MINUTE);
    if (minute === this.renderedMinute) return;
    this.render(now);
  }

  forceRefresh() {
    if (this.dlg.open) this.render();
  }

  private say(text: string) {
    const msg = this.dlg.querySelector('.msg') as HTMLElement;
    msg.textContent = text;
    msg.hidden = !text;
  }

  private setTab(t: Tab) {
    this.tab = t;
    this.render();
  }

  private render(now = Date.now()) {
    this.renderedMinute = Math.floor(now / MINUTE);
    const q = this.search.value.trim().toLowerCase();
    const searching = q.length > 0;
    for (const b of this.tabs) {
      const on = b.dataset.tab === this.tab;
      b.setAttribute('aria-pressed', String(on));
      b.disabled = searching;
    }

    let list = this.deps.events();
    if (searching) {
      list = list.filter(ev => haystack(ev).includes(q));
      // 搜索结果：接下来的在前（由近到远），过去的在后（由近到远）
      const next = list.filter(e => e.end > now).sort((a, b) => a.start - b.start);
      const past = list.filter(e => e.end <= now).sort((a, b) => b.start - a.start);
      list = [...next, ...past];
    } else if (this.tab === 'next') {
      list = list.filter(e => e.end > now).sort((a, b) => a.start - b.start);
    } else {
      list = list.filter(e => e.end <= now).sort((a, b) => b.start - a.start);
    }

    // 按天分组，保持上面排好的顺序
    const groups: { day: number; items: CalEvent[] }[] = [];
    for (const ev of list) {
      const day = startOfDay(ev.start);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(ev); else groups.push({ day, items: [ev] });
    }

    this.body.replaceChildren(...groups.map(g => {
      const sec = document.createElement('section');
      const h = document.createElement('h3');
      h.textContent = dayLabel(g.day, now);
      const ul = document.createElement('ul');
      ul.append(...g.items.map(ev => row(ev, now)));
      sec.append(h, ul);
      return sec;
    }));

    this.empty.hidden = list.length > 0;
    this.empty.textContent = searching ? '没有找到相关的日程。'
      : this.tab === 'next' ? '接下来没有日程。' : '过去还没有日程。';
    // 读屏软件：告诉结果有几条
    this.status.textContent = searching ? `找到 ${list.length} 条` : `${list.length} 条`;
  }
}

function row(ev: CalEvent, now: number): HTMLLIElement {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item';
  b.dataset.id = ev.id;
  const state = stateOf(ev, now);

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtSpan(ev.start, ev.end);
  const main = document.createElement('span');
  main.className = 'main';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = ev.title;
  main.append(title);

  const tags: string[] = [];
  if (state === 'live') tags.push('进行中');
  else if (state === 'soon') tags.push('即将开始');
  const left = prepLeft(ev);
  if (state !== 'ended' && left) tags.push(`还要准备 ${left} 项`);
  if (tags.length) {
    const t = document.createElement('span');
    t.className = 'tag' + (state === 'live' ? ' live' : '');
    t.textContent = tags.join(' · ');
    main.append(t);
  }
  if (ev.outcome) {
    const o = document.createElement('span');
    o.className = 'outcome';
    o.textContent = ev.outcome;
    main.append(o);
  }
  b.append(time, main);
  li.append(b);
  return li;
}

function dayLabel(day: number, now: number): string {
  const d = Math.round((day - startOfDay(now)) / DAY);
  const name = d === 0 ? '今天' : d === 1 ? '明天' : d === -1 ? '昨天' : '';
  return name ? `${name} · ${fmtDay(day)}` : fmtDay(day);
}

function haystack(ev: CalEvent): string {
  return [ev.title, ev.notes, ev.outcome, ...(ev.prep ?? []).map(p => p.text)]
    .filter(Boolean).join('\n').toLowerCase();
}
