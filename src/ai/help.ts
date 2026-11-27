import { db, isPublicNow, newId } from '../core/db';
import { learnerProfile } from '../core/learner';
import { MAX_CANDIDATES, rankCandidates } from '../core/retrieval';
import { getLang } from '../core/settings';
import { splitSolution } from '../core/solution';
import type { Capture, HelpAction, NoteKind, Receipt, StudyAid } from '../core/types';
import { repairFeedback, verifySolution, type SolutionCheck } from '../core/verifier';
import { generate, type GenerateResult } from './engine';
import { AlRatoAiError } from './errors';
import { helpPrompt, helpSystem, helpWordLimit, PROMPT_VERSION } from './prompts';
import { HELP_SCHEMA } from './schemas';
import { validateHelp, type HelpOutput } from './validate';

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

/** The device's check of a full solution: the exercise comes from the note, the answer from the last line. */
export function checkSolution(noteText: string, output: Pick<HelpOutput, 'body' | 'visual' | 'plot'>): SolutionCheck | null {
  const lines = splitSolution(output.body);
  const finalLine = lines.at(-1)?.text ?? output.body;
  const visual = output.visual;
  const modelEquation =
    visual?.kind === 'graph' ? visual.f : visual?.kind === 'intersection' && visual.g ? `(${visual.f})-(${visual.g})` : output.plot;
  return verifySolution(noteText, finalLine, modelEquation);
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

/**
 * alRato's small agent. Each step is done by whatever is best at it:
 *  - memory (the device): what this student's history says, from their own notes and practice;
 *  - tutor or solver (a model): hints on the device when it can, a full solution from the strongest
 *    cloud model, as the router decides;
 *  - verifier (the device, no model): puts the final answer back into the exercise;
 *  - corrector (the solver again): only when the verifier proved the answer wrong, once.
 * The drawing is then done on the device from the solver's description.
 */
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
  const profile = await learnerProfile({ includePrivate: capture.isPrivate, exclude: captureId });
  const learner = { hard: profile.hard.slice(0, 3), easy: profile.easy.slice(0, 2) };

  const isSolution = action === 'hint' && level >= MAX_LEVEL;
  const words = helpWordLimit(action, level);
  const ask = (repair?: { feedback: string; attempt: string }): Promise<GenerateResult<HelpOutput>> =>
    generate({
      task: 'help',
      system: helpSystem(getLang(), words),
      prompt: helpPrompt({ action, level, text: capture.text, comment: capture.comment, candidates, previous, learner, repair }),
      schema: HELP_SCHEMA,
      parse: (raw) =>
        validateHelp(
          raw,
          candidates.map((c) => c.captureId),
        ),
      isPrivate: capture.isPrivate,
      stillPublic: () => isPublicNow(captureId),
      maxOutputTokens: Math.max(500, words * 5 + (isSolution ? 160 : 0)),
      deepReasoning: isSolution,
    });

  let { data, receipt } = await ask();
  const attempts: Receipt[] = [receipt];
  let check = isSolution ? checkSolution(capture.text, data) : null;
  let repaired = false;

  if (check?.status === 'mismatch') {
    // The device proved the answer wrong. The solver gets one chance to fix it, told exactly what failed.
    try {
      const second = await ask({ feedback: repairFeedback(check), attempt: data.body });
      data = second.data;
      receipt = second.receipt;
      attempts.push(second.receipt);
      check = checkSolution(capture.text, data);
      repaired = true;
    } catch {
      // The correction could not run. The first solution stays, with the device's warning on it.
    }
  }

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
    // A picture shows where the answers are, so only the full solution may draw one.
    plot: isSolution ? data.plot : null,
    visual: isSolution ? data.visual : null,
    plan: isSolution ? data.plan : '',
    check: isSolution ? check : undefined,
    repaired,
    attempts,
    memory: [...learner.hard, ...learner.easy],
    receipt,
    promptVersion: PROMPT_VERSION,
    createdAt: Date.now(),
    madeWhilePrivate: capture.isPrivate,
  };
  await db.aids.add(aid);
  return aid;
}
