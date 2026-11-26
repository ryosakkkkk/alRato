import { db, isPublicNow, newId } from '../core/db';
import { MAX_CANDIDATES, rankCandidates } from '../core/retrieval';
import { getLang } from '../core/settings';
import type { Capture, HelpAction, NoteKind, StudyAid } from '../core/types';
import { generate } from './engine';
import { AlRatoAiError } from './errors';
import { helpPrompt, helpSystem, helpWordLimit, PROMPT_VERSION } from './prompts';
import { HELP_SCHEMA } from './schemas';
import { validateHelp } from './validate';

export const MAX_LEVEL = 4;

export function actionFor(kind: NoteKind): HelpAction {
  switch (kind) {
    case 'board':
      return 'key_ideas';
    case 'exercise':
      return 'hint';
    case 'question':
      return 'answer';
    default:
      return 'explain';
  }
}

/** Only a private note, which is locked to the device, may read other private notes. */
export function retrievalPool(current: Pick<Capture, 'isPrivate'>, library: Capture[]): Capture[] {
  return current.isPrivate ? library : library.filter((note) => !note.isPrivate);
}

/**
 * The hints already given at earlier levels. A hint written while the note was private may have drawn
 * on other private notes, so a note that is public now never sends those hints back to the cloud.
 */
export function earlierHints(note: Pick<Capture, 'isPrivate'>, earlier: StudyAid[], level: number): string[] {
  return earlier
    .filter((aid) => aid.level < level)
    .filter((aid) => note.isPrivate || aid.madeWhilePrivate === false)
    .map((aid) => aid.body);
}

const inFlight = new Map<string, Promise<StudyAid>>();

/** A double tap, or a second tab, must not pay for the same hint twice. */
export function requestHelp(captureId: string, level: number): Promise<StudyAid> {
  const key = `${captureId}:${level}`;
  const running = inFlight.get(key);
  if (running) return running;
  const work = runHelp(captureId, level).finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}

async function runHelp(captureId: string, level: number): Promise<StudyAid> {
  const capture = await db.captures.get(captureId);
  if (!capture) throw new AlRatoAiError('stale');

  const action = actionFor(capture.kind);
  const revision = capture.revision;
  const earlier = await db.aids.where('[captureId+revision]').equals([captureId, revision]).sortBy('level');
  const existing = earlier.find((a) => a.level === level);
  if (existing) return existing;
  const previous = earlierHints(capture, earlier, level);

  const library = await db.captures.toArray();
  const candidates = rankCandidates(capture, retrievalPool(capture, library), MAX_CANDIDATES);

  const words = helpWordLimit(action, level);
  const { data, receipt } = await generate({
    task: 'help',
    system: helpSystem(getLang(), words),
    prompt: helpPrompt({ action, level, text: capture.text, comment: capture.comment, candidates, previous }),
    schema: HELP_SCHEMA,
    parse: (raw) =>
      validateHelp(
        raw,
        candidates.map((c) => c.captureId),
      ),
    isPrivate: capture.isPrivate,
    stillPublic: () => isPublicNow(captureId),
    maxOutputTokens: Math.max(500, words * 5),
    deepReasoning: action === 'hint' && level >= MAX_LEVEL,
  });

  // The student may have edited, deleted or locked the note while the model was thinking.
  const latest = await db.captures.get(captureId);
  if (!latest || latest.revision !== revision || latest.isPrivate !== capture.isPrivate) {
    throw new AlRatoAiError('stale');
  }

  const aid: StudyAid = {
    id: newId(),
    captureId,
    revision,
    action,
    level,
    body: data.body,
    link: data.link,
    practice: data.practice,
    // A graph shows where the answers are, so only the full solution may draw one.
    plot: level >= MAX_LEVEL ? data.plot : null,
    receipt,
    promptVersion: PROMPT_VERSION,
    createdAt: Date.now(),
    madeWhilePrivate: capture.isPrivate,
  };
  await db.aids.add(aid);
  return aid;
}
