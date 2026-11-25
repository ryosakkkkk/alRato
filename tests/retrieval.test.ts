import { describe, expect, it } from 'vitest';
import { rankCandidates, searchNotes } from '../src/core/retrieval';
import { BOX_INTERVAL_DAYS, schedule } from '../src/core/srs';
import { conceptKey, normalize } from '../src/core/text';
import { validateHelp, parseJson, validateAnalysis } from '../src/ai/validate';
import { retrievalPool } from '../src/ai/help';
import type { Capture } from '../src/core/types';

const note = (id: string, over: Partial<Capture>) =>
  ({
    id,
    title: '',
    topic: '',
    subject: '',
    text: 'x',
    teaches: [],
    teachesKeys: [],
    needsKeys: [],
    isPrivate: false,
    ...over,
  }) as Capture;

const weighted = note('weighted', {
  title: 'Promedio ponderado',
  subject: 'Matemáticas',
  topic: 'Estadística descriptiva',
  text: 'x̄ = Σ wᵢ xᵢ / Σ wᵢ. Cada valor se multiplica por su peso.',
  teaches: ['promedio ponderado'],
  teachesKeys: ['weighted average', 'expected value'],
});
const bellman = note('bellman', {
  title: 'Ecuación de Bellman',
  subject: 'Aprendizaje por refuerzo',
  topic: 'Ecuación de Bellman',
  text: "V(s) = Σ P(s'|s) [r(s,s') + γ V(s')]",
  teachesKeys: ['bellman equation'],
  needsKeys: ['expected value', 'weighted average', 'probability'],
});
const history = note('history', {
  title: 'Revolución francesa',
  subject: 'Historia',
  topic: 'Siglo XVIII',
  text: 'La toma de la Bastilla ocurrió en 1789.',
  teachesKeys: ['french revolution'],
});

describe('rankCandidates', () => {
  it('connects Bellman to weighted average through prerequisites, with almost no shared words', () => {
    const [top] = rankCandidates(bellman, [bellman, weighted, history]);
    expect(top.captureId).toBe('weighted');
    expect(top.score).toBeGreaterThanOrEqual(5);
  });

  it('never returns the note itself or unrelated notes', () => {
    const ids = rankCandidates(bellman, [bellman, weighted, history]).map((c) => c.captureId);
    expect(ids).not.toContain('bellman');
    expect(ids).not.toContain('history');
  });

  it('returns nothing for an empty library', () => {
    expect(rankCandidates(bellman, [bellman])).toEqual([]);
  });

  it('matches concepts regardless of plural forms', () => {
    expect(conceptKey('Weighted Averages')).toBe(conceptKey('weighted average'));
    expect(conceptKey('probabilities')).toBe(conceptKey('probability'));
  });

  it('caps candidates at three', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      note(`n${i}`, { title: `n${i}`, text: 'valor esperado', teachesKeys: ['expected value'] }),
    );
    expect(rankCandidates(bellman, many)).toHaveLength(3);
  });
});

describe('privacy of retrieval', () => {
  const secret = { ...weighted, id: 'secret', isPrivate: true };

  it('never lets a private note into a prompt that may reach the cloud', () => {
    const pool = retrievalPool(bellman, [bellman, secret, history]);
    expect(pool.map((n) => n.id)).not.toContain('secret');
  });

  it('allows private notes when the current note is itself locked to the device', () => {
    const locked = { ...bellman, isPrivate: true };
    expect(retrievalPool(locked, [locked, secret]).map((n) => n.id)).toContain('secret');
  });
});

describe('searchNotes', () => {
  it('ignores accents and case', () => {
    expect(searchNotes('ecuacion', [bellman, history]).map((n) => n.id)).toEqual(['bellman']);
    expect(searchNotes('BASTILLA', [bellman, history]).map((n) => n.id)).toEqual(['history']);
  });

  it('returns everything for an empty query', () => {
    expect(searchNotes('  ', [bellman, history])).toHaveLength(2);
  });
});

describe('schedule', () => {
  const now = 1_000_000;
  const days = (d: number) => d * 86_400_000;

  it('moves a remembered card to a longer interval', () => {
    expect(schedule({ box: 0, reps: 0 }, 'remembered', now)).toEqual({
      box: 1,
      dueAt: now + days(BOX_INTERVAL_DAYS[1]),
      lastResult: 'remembered',
      reps: 1,
    });
  });

  it('brings a card back tomorrow when the student needed help', () => {
    expect(schedule({ box: 3, reps: 5 }, 'needed_help', now)).toMatchObject({ box: 0, dueAt: now + days(1) });
  });

  it('never exceeds the last box', () => {
    expect(schedule({ box: 4, reps: 9 }, 'remembered', now).box).toBe(4);
  });
});

describe('validators', () => {
  it('drops a citation to a note that was not offered', () => {
    const out = validateHelp(
      { help: 'ok', source_id: 'made-up', connection: 'because', practice_q: 'q', practice_a: 'a' },
      ['weighted'],
    );
    expect(out.link).toBeNull();
    expect(out.body).toBe('ok');
  });

  it('keeps a citation to an offered note', () => {
    const out = validateHelp(
      { help: 'ok', source_id: 'weighted', connection: 'probabilities act as weights', practice_q: '', practice_a: '' },
      ['weighted'],
    );
    expect(out.link).toEqual({ captureId: 'weighted', why: 'probabilities act as weights' });
    expect(out.practice).toBeNull();
  });

  it('parses JSON wrapped in code fences', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('rejects output that is not JSON', () => {
    expect(() => parseJson('sorry, I cannot')).toThrow();
  });

  it('coerces an unknown kind to other', () => {
    const out = validateAnalysis({ kind: 'poem', title: 't', subject: 's', topic: '', teaches: [], teaches_en: ['A'], needs_en: [] });
    expect(out.kind).toBe('other');
    expect(out.topic).toBe('t');
    expect(out.teachesKeys).toEqual(['a']);
  });

  it('normalizes accents', () => {
    expect(normalize('Fórmula ÁÉÍ')).toBe('formula aei');
  });
});
