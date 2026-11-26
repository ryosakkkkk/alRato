import { appCheckPausedUntil } from '../ai/appcheck';
import { generate } from '../ai/engine';
import { AlRatoAiError, classifyError, WaitForRoute } from '../ai/errors';
import { analyzePrompt, analyzeSystem, readPrompt, readSystem } from '../ai/prompts';
import { ANALYZE_SCHEMA, READ_SCHEMA } from '../ai/schemas';
import { validateAnalysis, validateRead } from '../ai/validate';
import { db, isPublicNow } from './db';
import { getLang } from './settings';
import type { Capture, Receipt } from './types';

export const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 4_000;
/** A note waiting for the daily allowance is checked again this often. Both resets fall inside one interval. */
const QUOTA_RECHECK_MS = 15 * 60_000;

let running = false;
let rerun = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

const QUEUE_LOCK = 'alrato.queue';

/**
 * One tab at a time works the queue. A second tab waits for the first, and a closed tab releases the
 * lock automatically. Without Web Locks, each tab works alone, as it did before.
 */
function withQueueLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request(QUEUE_LOCK, work) : work();
}

/** Wakes the queue. Safe to call at any time and from anywhere. */
export function kickQueue(): void {
  void drain();
}

async function drain(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    await withQueueLock(async () => {
      // Holding the lock means no other tab is working, so anything still "processing" is orphaned.
      await requeueInterrupted();
      do {
        rerun = false;
        const now = Date.now();
        const queued = await db.captures.where('status').equals('queued').sortBy('createdAt');
        for (const capture of queued) {
          if (capture.nextAttemptAt <= now) await processCapture(capture.id);
        }
      } while (rerun);
    });
  } finally {
    running = false;
  }
  await armRetryTimer();
}

async function armRetryTimer(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer);
  const queued = await db.captures.where('status').equals('queued').toArray();
  const delays: number[] = [];
  const future = queued.filter((c) => !c.waitReason && c.nextAttemptAt > Date.now());
  if (future.length > 0) delays.push(Math.min(...future.map((c) => c.nextAttemptAt)) - Date.now());
  // A note waiting for the daily allowance wakes up by itself, even while the tab stays open.
  if (queued.some((c) => c.waitReason === 'cloud_cap_no_model')) delays.push(QUOTA_RECHECK_MS);
  // A pause after an App Check refusal ends at a known time, so the queue wakes exactly then.
  if (queued.some((c) => c.waitReason === 'app_check_paused')) {
    const until = appCheckPausedUntil();
    if (until) delays.push(Math.max(60_000, until - Date.now()));
  }
  if (delays.length === 0) return;
  retryTimer = setTimeout(kickQueue, Math.max(250, Math.min(...delays)));
}

/** A note still marked "processing" was left by a tab that closed mid-work. Call only while holding the lock. */
async function requeueInterrupted(): Promise<void> {
  await db.captures.where('status').equals('processing').modify({ status: 'queued' });
}

/** Captures left in `processing` by a closed tab go back to the queue on startup. */
export async function recoverInterrupted(): Promise<void> {
  await withQueueLock(requeueInterrupted);
}

/**
 * Runs after every model call, because the student may have edited the note or marked it
 * private while the model was working. A changed privacy choice discards the answer and
 * sends the note back to the queue, so its next step follows the new rule.
 */
async function stillCurrent(id: string, capture: Capture): Promise<boolean> {
  const latest = await db.captures.get(id);
  if (!latest || latest.revision !== capture.revision || latest.status !== 'processing') return false;
  if (latest.isPrivate === capture.isPrivate) return true;
  await db.captures.update(id, { status: 'queued', waitReason: null, errorCode: null, nextAttemptAt: 0 });
  rerun = true;
  return false;
}

async function processCapture(id: string): Promise<void> {
  const capture = await db.captures.get(id);
  if (!capture || capture.status !== 'queued') return;
  const { revision } = capture;
  await db.captures.update(id, { status: 'processing', waitReason: null, errorCode: null });

  try {
    let { text, legibility } = capture;
    const receipts: Receipt[] = [...capture.receipts];

    if (!text.trim()) {
      const read = await generate({
        task: 'read',
        system: readSystem(),
        prompt: readPrompt(capture.comment),
        image: capture.image,
        schema: READ_SCHEMA,
        parse: validateRead,
        isPrivate: capture.isPrivate,
        stillPublic: () => isPublicNow(id),
        maxOutputTokens: 1500,
      });
      if (!(await stillCurrent(id, capture))) return;
      text = read.data.text;
      legibility = read.data.legibility;
      receipts.push(read.receipt);
      // Saved right away, so the student keeps the transcription if organizing fails. The revision and the
      // privacy are checked in the same transaction, so a student edit that lands now is never overwritten.
      const saved = await db.transaction('rw', db.captures, async () => {
        const latest = await db.captures.get(id);
        if (!latest || latest.revision !== revision || latest.status !== 'processing') return false;
        if (latest.isPrivate !== capture.isPrivate) {
          await db.captures.update(id, { status: 'queued', waitReason: null, errorCode: null, nextAttemptAt: 0 });
          rerun = true;
          return false;
        }
        await db.captures.update(id, { text, textBy: 'ai', legibility, receipts, updatedAt: Date.now() });
        return true;
      });
      if (!saved) return;
    }

    const analysis = await generate({
      task: 'analyze',
      system: analyzeSystem(getLang()),
      prompt: analyzePrompt(text, capture.comment),
      schema: ANALYZE_SCHEMA,
      parse: validateAnalysis,
      isPrivate: capture.isPrivate,
      stillPublic: () => isPublicNow(id),
      maxOutputTokens: 500,
    });
    if (!(await stillCurrent(id, capture))) return;
    receipts.push(analysis.receipt);

    await db.transaction('rw', db.captures, async () => {
      const latest = await db.captures.get(id);
      if (!latest || latest.revision !== revision || latest.status !== 'processing') return;
      if (latest.isPrivate !== capture.isPrivate) {
        await db.captures.update(id, { status: 'queued', waitReason: null, errorCode: null, nextAttemptAt: 0 });
        rerun = true;
        return;
      }
      const a = analysis.data;
      const lowQuality = a.needsReview || legibility === 'low';
      await db.captures.update(id, {
        kind: latest.locked.kind ? latest.kind : a.kind,
        title: latest.locked.title ? latest.title : a.title,
        subject: latest.locked.subject ? latest.subject : a.subject,
        topic: latest.locked.topic ? latest.topic : a.topic,
        teaches: a.teaches,
        teachesKeys: a.teachesKeys,
        needsKeys: a.needsKeys,
        analyzedRevision: revision,
        status: lowQuality ? 'needs_review' : 'ready',
        waitReason: null,
        errorCode: null,
        attempts: 0,
        nextAttemptAt: 0,
        receipts: receipts.slice(-8),
        updatedAt: Date.now(),
      });
    });
  } catch (error) {
    await handleFailure(id, revision, capture, error);
  }
}

async function handleFailure(id: string, revision: number, capture: Capture, error: unknown): Promise<void> {
  const latest = await db.captures.get(id);
  if (!latest || latest.revision !== revision) return;

  if (error instanceof WaitForRoute) {
    await db.captures.update(id, { status: 'queued', waitReason: error.reason, nextAttemptAt: 0 });
    return;
  }

  // The note became private while its cloud call was being prepared. The next attempt follows the new rule.
  if (error instanceof AlRatoAiError && error.failure === 'stale') {
    await db.captures.update(id, { status: 'queued', waitReason: null, errorCode: null, nextAttemptAt: 0 });
    rerun = true;
    return;
  }

  const failure = error instanceof AlRatoAiError ? error : classifyError(error);
  const attempts = capture.attempts + 1;

  if (failure.transient && attempts < MAX_ATTEMPTS) {
    await db.captures.update(id, {
      status: 'queued',
      attempts,
      errorCode: failure.failure,
      nextAttemptAt: Date.now() + BASE_BACKOFF_MS * 2 ** (attempts - 1),
    });
    return;
  }
  await db.captures.update(id, { status: 'failed', attempts, errorCode: failure.failure });
}
