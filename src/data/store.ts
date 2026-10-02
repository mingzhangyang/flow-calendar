import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CalEvent } from '../model/types';

/**
 * 日程存在本机的 IndexedDB 里。
 * 打不开数据库时（隐私模式、被禁用）退回到只存在内存里，`persistent` 为 false，
 * 界面据此提醒“关掉页面后不会保留”。
 */
interface Schema extends DBSchema {
  events: { key: string; value: CalEvent; indexes: { start: number } };
}

export interface Store {
  readonly persistent: boolean;
  all(): Promise<CalEvent[]>;
  put(ev: CalEvent): Promise<void>;
  remove(id: string): Promise<void>;
  /** 导入：同一个 id 的覆盖，但保留已经写下的准备事项和结论。返回新加了几条、更新了几条 */
  importMany(evs: CalEvent[]): Promise<{ added: number; updated: number }>;
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
    const db = await openDB<Schema>('flow-calendar', 1, {
      upgrade(db) {
        db.createObjectStore('events', { keyPath: 'id' }).createIndex('start', 'start');
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
  };
}

function memoryStore(): Store {
  const map = new Map<string, CalEvent>();
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
  };
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
