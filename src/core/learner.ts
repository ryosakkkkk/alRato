import { db } from './db';
import type { Capture, Card, StudyAid } from './types';

/*
 * What alRato learns about the student. No model is trained or tuned: Gemini arrives already
 * trained by Google. alRato learns the way a good tutor does, by remembering. From the student's
 * own history on this device (how many hints each exercise needed and how practice went) it keeps
 * a picture of which concepts are solid and which are not, and tells the tutor model before every
 * hint. Nothing here leaves the device except those few concept names, and only in a prompt that
 * is allowed to go to the cloud.
 */

export interface ConceptSkill {
  key: string;
  /** The concept in the student's language. */
  label: string;
  notes: number;
  /** The deepest hint level an exercise on this concept needed, 0 when none was asked. */
  hintLevel: number;
  practiced: number;
  remembered: number;
  /** 0 to 1: how well the student seems to know it. */
  mastery: number;
}

export interface LearnerProfile {
  skills: ConceptSkill[];
  /** Concepts that needed the full solution or were forgotten in practice, weakest first. */
  hard: string[];
  /** Concepts the student solved with little help and remembered, strongest first. */
  easy: string[];
}

const MAX_HINT = 4;

/** The pure part, so it can be tested without a database. */
export function buildProfile(captures: Capture[], aids: StudyAid[], cards: Card[]): LearnerProfile {
  const deepest = new Map<string, number>();
  for (const aid of aids) {
    if (aid.action !== 'hint') continue;
    deepest.set(aid.captureId, Math.max(deepest.get(aid.captureId) ?? 0, aid.level));
  }
  const practice = new Map<string, { practiced: number; remembered: number }>();
  for (const card of cards) {
    if (!card.lastResult) continue;
    const entry = practice.get(card.captureId) ?? { practiced: 0, remembered: 0 };
    entry.practiced += 1;
    if (card.lastResult === 'remembered') entry.remembered += 1;
    practice.set(card.captureId, entry);
  }

  const skills = new Map<string, ConceptSkill>();
  for (const note of captures) {
    const keys = note.teachesKeys.length > 0 ? note.teachesKeys : note.topic ? [note.topic.toLowerCase()] : [];
    const labels = note.teaches.length === note.teachesKeys.length ? note.teaches : keys;
    const hints = deepest.get(note.id) ?? 0;
    const tried = practice.get(note.id);
    if (hints === 0 && !tried) continue;
    keys.slice(0, 4).forEach((key, i) => {
      const skill = skills.get(key) ?? { key, label: labels[i] ?? key, notes: 0, hintLevel: 0, practiced: 0, remembered: 0, mastery: 0 };
      skill.notes += 1;
      skill.hintLevel = Math.max(skill.hintLevel, hints);
      skill.practiced += tried?.practiced ?? 0;
      skill.remembered += tried?.remembered ?? 0;
      skills.set(key, skill);
    });
  }

  for (const skill of skills.values()) {
    // Needing only a nudge is a good sign; needing the full solution is not. Practice weighs as much.
    const fromHints = skill.hintLevel > 0 ? 1 - (skill.hintLevel - 1) / (MAX_HINT - 1) : 0.5;
    const fromPractice = skill.practiced > 0 ? skill.remembered / skill.practiced : 0.5;
    skill.mastery = Math.round((0.5 * fromHints + 0.5 * fromPractice) * 100) / 100;
  }
  const list = [...skills.values()].sort((a, b) => a.mastery - b.mastery || b.notes - a.notes);
  return {
    skills: list,
    hard: list.filter((s) => s.mastery < 0.45).map((s) => s.label),
    easy: [...list].reverse().filter((s) => s.mastery >= 0.75).map((s) => s.label),
  };
}

/**
 * The profile behind a hint. A public note, whose prompt may go to the cloud, only ever sees what
 * the student's public notes taught; a private note may use everything.
 */
export async function learnerProfile(options: { includePrivate: boolean; exclude?: string }): Promise<LearnerProfile> {
  const [captures, aids, cards] = await Promise.all([db.captures.toArray(), db.aids.toArray(), db.cards.toArray()]);
  const allowed = captures.filter((c) => c.id !== options.exclude && (options.includePrivate || !c.isPrivate));
  const ids = new Set(allowed.map((c) => c.id));
  return buildProfile(
    allowed,
    aids.filter((a) => ids.has(a.captureId)),
    cards.filter((c) => ids.has(c.captureId)),
  );
}
