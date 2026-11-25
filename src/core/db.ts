import Dexie, { type Table } from 'dexie';
import type { Capture, Card, StudyAid, UsageEvent } from './types';

/** Everything the student owns lives here, on the device. Firestore sync is opt-in. */
class AlRatoDB extends Dexie {
  captures!: Table<Capture, string>;
  aids!: Table<StudyAid, string>;
  cards!: Table<Card, string>;
  usage!: Table<UsageEvent, number>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('alrato');
    this.version(1).stores({
      captures: 'id, status, createdAt, updatedAt, subject, nextAttemptAt',
      aids: 'id, captureId, [captureId+revision], createdAt',
      cards: 'id, captureId, dueAt',
      usage: '++id, at, source, task',
      kv: 'key',
    });
  }
}

export const db = new AlRatoDB();

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export const newId = (): string => crypto.randomUUID();
