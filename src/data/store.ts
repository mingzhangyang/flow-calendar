import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CalEvent, Goal } from '../model/types';

/**
 * 日程存在本机的 IndexedDB 里。
 * 打不开数据库时（隐私模式、被禁用）退回到只存在内存里，`persistent` 为 false，
 * 界面据此提醒“关掉页面后不会保留”。
 */
interface Schema extends DBSchema {
  events: { key: string; value: CalEvent; indexes: { start: number } };
  /** 零散的设置，比如登山的目标（键 'goal'） */
  meta: { key: string; value: unknown };
}

export interface Store {
  readonly persistent: boolean;
  all(): Promise<CalEvent[]>;
  put(ev: CalEvent): Promise<void>;
  remove(id: string): Promise<void>;
  /** 导入：同一个 id 的覆盖，但保留已经写下的准备事项和结论。返回新加了几条、更新了几条 */
  importMany(evs: CalEvent[]): Promise<{ added: number; updated: number }>;
  /** 登山的目标；没设时为 null */
  goal(): Promise<Goal | null>;
  setGoal(g: Goal | null): Promise<void>;
}

function merge(ev: CalEvent, old: CalEvent | undefined): CalEvent {
  if (!old) return ev;
  const next = { ...ev };
  if (old.prep) next.prep = old.prep;
  if (old.outcome) next.outcome = old.outcome;
  return next;
}

export async function openStore(): Promise<Store> {
  try {
    const db = await openDB<Schema>('flow-calendar', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) db.createObjectStore('events', { keyPath: 'id' }).createIndex('start', 'start');
        if (oldVersion < 2) db.createObjectStore('meta');
      },
    });
    return idbStore(db);
  } catch {
    return memoryStore();
  }
}

function idbStore(db: IDBPDatabase<Schema>): Store {
  return {
    persistent: true,
    all: () => db.getAllFromIndex('events', 'start'),
    put: async ev => { await db.put('events', ev); },
    remove: id => db.delete('events', id),
    async importMany(evs) {
      const tx = db.transaction('events', 'readwrite');
      let added = 0, updated = 0;
      for (const ev of evs) {
        const old = await tx.store.get(ev.id);
        if (old) updated++; else added++;
        await tx.store.put(merge(ev, old));
      }
      await tx.done;
      return { added, updated };
    },
    goal: async () => asGoal(await db.get('meta', 'goal')),
    setGoal: async g => { if (g) await db.put('meta', g, 'goal'); else await db.delete('meta', 'goal'); },
  };
}

function memoryStore(): Store {
  const map = new Map<string, CalEvent>();
  let goal: Goal | null = null;
  return {
    persistent: false,
    all: async () => [...map.values()].sort((a, b) => a.start - b.start),
    put: async ev => { map.set(ev.id, ev); },
    remove: async id => { map.delete(id); },
    async importMany(evs) {
      let added = 0, updated = 0;
      for (const ev of evs) {
        const old = map.get(ev.id);
        if (old) updated++; else added++;
        map.set(ev.id, merge(ev, old));
      }
      return { added, updated };
    },
    goal: async () => goal,
    setGoal: async g => { goal = g; },
  };
}

/** 读出来的东西不一定是完整的目标（比如手改过），不像就当没设 */
function asGoal(v: unknown): Goal | null {
  const g = v as Goal | undefined;
  return g && typeof g.title === 'string' && typeof g.due === 'number' && Number.isFinite(g.due) ? g : null;
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
