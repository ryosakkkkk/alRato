import { db, kvGet, kvSet, newId } from './db';
import { prepareImage } from './image';
import { kickQueue } from './queue';
import type { Capture, Card, NoteKind, StudyAid } from './types';
import { BOX_INTERVAL_DAYS, schedule } from './srs';
import type { ReviewResult } from './types';

/** `Capture.syncedAt` above zero is the version known to be in the cloud. These are the other states. */
export const SYNC_ATTEMPTED = 0;
export const SYNC_REMOVED = -1;

export const SYNC_OWNER_KEY = 'sync.owner';
export const SYNC_ENABLED_KEY = 'sync.enabledFor';
export const SYNC_OUTBOX_KEY = 'sync.outbox';

/** A promise to delete one cloud copy from one account. */
export interface CloudDelete {
  id: string;
  uid: string;
}

/**
 * Runs inside the same transaction as the local change, so closing the tab or
 * being offline cannot lose the promise to delete the cloud copy.
 */
async function queueCloudDelete(note: Capture): Promise<void> {
  if (note.syncedAt === undefined || note.syncedAt === SYNC_REMOVED) return;
  const uid = await kvGet<string | null>(SYNC_OWNER_KEY, null);
  if (!uid) return;
  const outbox = await kvGet<CloudDelete[]>(SYNC_OUTBOX_KEY, []);
  if (outbox.some((entry) => entry.id === note.id && entry.uid === uid)) return;
  await kvSet(SYNC_OUTBOX_KEY, [...outbox, { id: note.id, uid }]);
}

async function cancelCloudDelete(id: string): Promise<void> {
  const outbox = await kvGet<CloudDelete[]>(SYNC_OUTBOX_KEY, []);
  if (outbox.some((entry) => entry.id === id)) {
    await kvSet(SYNC_OUTBOX_KEY, outbox.filter((entry) => entry.id !== id));
  }
}

export function blankCapture(
  fields: Pick<Capture, 'image' | 'thumb'> & Partial<Capture>,
): Capture {
  const now = Date.now();
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    comment: '',
    text: '',
    textBy: 'none',
    legibility: null,
    kind: 'other',
    title: '',
    subject: '',
    topic: '',
    teaches: [],
    teachesKeys: [],
    needsKeys: [],
    status: 'queued',
    waitReason: null,
    errorCode: null,
    attempts: 0,
    nextAttemptAt: 0,
    revision: 1,
    analyzedRevision: 0,
    locked: {},
    isPrivate: false,
    isSample: false,
    receipts: [],
    ...fields,
  };
}

/** Saves the photo first and returns immediately. AI work happens later in the queue. */
export async function addCapture(
  source: Blob,
  options: { comment?: string; isPrivate?: boolean } = {},
): Promise<string> {
  const { image, thumb } = await prepareImage(source);
  const capture = blankCapture({
    image,
    thumb,
    comment: options.comment?.trim() ?? '',
    isPrivate: Boolean(options.isPrivate),
  });
  await db.captures.add(capture);
  kickQueue();
  return capture.id;
}

/** A student edit starts a new revision, which invalidates any answer still in flight. */
export async function editText(id: string, text: string, comment?: string): Promise<void> {
  await db.captures
    .where('id')
    .equals(id)
    .modify((c) => {
      const nextComment = comment ?? c.comment;
      if (c.text === text && c.comment === nextComment) return;
      c.text = text;
      c.comment = nextComment;
      c.textBy = text.trim() ? 'student' : 'none';
      c.revision += 1;
      c.status = 'queued';
      c.waitReason = null;
      c.errorCode = null;
      c.attempts = 0;
      c.nextAttemptAt = 0;
      c.updatedAt = Date.now();
    });
  kickQueue();
}

export async function editLabels(
  id: string,
  labels: Partial<Pick<Capture, 'title' | 'subject' | 'topic'>> & { kind?: NoteKind },
): Promise<void> {
  await db.captures
    .where('id')
    .equals(id)
    .modify((c) => {
      for (const key of ['title', 'subject', 'topic', 'kind'] as const) {
        const value = labels[key];
        if (value !== undefined && value !== c[key]) {
          (c as unknown as Record<string, unknown>)[key] = value;
          c.locked = { ...c.locked, [key]: true };
        }
      }
      c.updatedAt = Date.now();
    });
}

/** Making a synced note private also promises to delete its cloud copy. */
export async function setPrivate(id: string, isPrivate: boolean): Promise<void> {
  await db.transaction('rw', db.captures, db.kv, async () => {
    const note = await db.captures.get(id);
    await db.captures.update(id, { isPrivate, updatedAt: Date.now(), waitReason: null });
    if (!note) return;
    if (isPrivate) await queueCloudDelete(note);
    else await cancelCloudDelete(id);
  });
  kickQueue();
}

export async function retryCapture(id: string): Promise<void> {
  await db.captures.update(id, {
    status: 'queued',
    attempts: 0,
    nextAttemptAt: 0,
    errorCode: null,
    waitReason: null,
  });
  kickQueue();
}

/** Removes a note and every link that pointed to it. Call inside a transaction. */
export async function removeNoteRows(id: string, database: Pick<typeof db, 'captures' | 'aids' | 'cards'> = db): Promise<void> {
  await database.captures.delete(id);
  await database.aids.where('captureId').equals(id).delete();
  await database.cards.where('captureId').equals(id).delete();
  await database.aids
    .filter((aid) => aid.link?.captureId === id)
    .modify((aid: StudyAid) => {
      aid.link = null;
    });
}

/** Deleting a note also deletes its cloud copy, now or as soon as it can. */
export async function deleteCapture(id: string): Promise<void> {
  await db.transaction('rw', db.captures, db.aids, db.cards, db.kv, async () => {
    const note = await db.captures.get(id);
    await removeNoteRows(id);
    if (note) await queueCloudDelete(note);
  });
}

export async function addCard(captureId: string, question: string, answer: string): Promise<Card> {
  const existing = await db.cards
    .where('captureId')
    .equals(captureId)
    .filter((c) => c.question === question)
    .first();
  if (existing) return existing;
  const now = Date.now();
  const card: Card = {
    id: newId(),
    captureId,
    question,
    answer,
    box: 0,
    dueAt: now,
    lastResult: null,
    reps: 0,
    createdAt: now,
  };
  await db.cards.add(card);
  return card;
}

/** Reschedules the card and returns how many days until it comes back. */
export async function rateCard(id: string, result: ReviewResult): Promise<number | null> {
  const card = await db.cards.get(id);
  if (!card) return null;
  const next = schedule(card, result, Date.now());
  await db.cards.update(id, next);
  return BOX_INTERVAL_DAYS[next.box];
}
