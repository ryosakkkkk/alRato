import type { Card, ReviewResult } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Leitner-style intervals in days. These are starting values, not a claim of optimality. */
export const BOX_INTERVAL_DAYS = [1, 3, 7, 16, 35];

export function schedule(
  card: Pick<Card, 'box' | 'reps'>,
  result: ReviewResult,
  now: number,
): Pick<Card, 'box' | 'dueAt' | 'lastResult' | 'reps'> {
  const box = result === 'remembered' ? Math.min(card.box + 1, BOX_INTERVAL_DAYS.length - 1) : 0;
  return { box, dueAt: now + BOX_INTERVAL_DAYS[box] * DAY_MS, lastResult: result, reps: card.reps + 1 };
}

export const isDue = (card: Pick<Card, 'dueAt'>, now: number): boolean => card.dueAt <= now;
