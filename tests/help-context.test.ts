import { describe, expect, it } from 'vitest';
import { earlierHints } from '../src/ai/help';
import type { StudyAid } from '../src/core/types';

/** Only the fields that earlierHints reads are filled in. */
const aid = (level: number, body: string, madeWhilePrivate?: boolean) =>
  ({ level, body, madeWhilePrivate }) as StudyAid;

const earlier = [
  aid(1, 'written while private', true),
  aid(2, 'written while public', false),
  aid(3, 'written before the flag existed'),
];

describe('earlierHints', () => {
  it('leaves out hints written while the note was private, once the note is public', () => {
    expect(earlierHints({ isPrivate: false }, earlier, 4)).toEqual(['written while public']);
  });

  it('keeps every earlier level for a note that is still private', () => {
    expect(earlierHints({ isPrivate: true }, earlier, 4)).toEqual([
      'written while private',
      'written while public',
      'written before the flag existed',
    ]);
  });

  it('only returns the levels below the one requested', () => {
    expect(earlierHints({ isPrivate: false }, earlier, 2)).toEqual([]);
  });
});
