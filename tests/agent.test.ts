import { describe, expect, it } from 'vitest';
import { checkSolution } from '../src/ai/help';
import { helpPrompt } from '../src/ai/prompts';
import { validateHelp, validateVisual } from '../src/ai/validate';
import { buildProfile } from '../src/core/learner';
import type { Capture, Card, StudyAid } from '../src/core/types';
import { visualModel } from '../src/core/visual';

const note = (id: string, teaches: string[], keys: string[], isPrivate = false) =>
  ({ id, teaches, teachesKeys: keys, topic: teaches[0] ?? '', isPrivate }) as unknown as Capture;
const hint = (captureId: string, level: number) => ({ captureId, level, action: 'hint' }) as unknown as StudyAid;
const card = (captureId: string, lastResult: Card['lastResult']) => ({ captureId, lastResult }) as unknown as Card;

describe('what alRato learns about the student', () => {
  it('marks a concept hard when it needed the full solution and was forgotten', () => {
    const profile = buildProfile(
      [note('a', ['Factorización'], ['factoring']), note('b', ['Ecuaciones lineales'], ['linear equations'])],
      [hint('a', 1), hint('a', 4), hint('b', 1)],
      [card('a', 'needed_help'), card('b', 'remembered')],
    );
    expect(profile.hard).toEqual(['Factorización']);
    expect(profile.easy).toEqual(['Ecuaciones lineales']);
    expect(profile.skills.find((s) => s.key === 'factoring')).toMatchObject({ hintLevel: 4, practiced: 1, remembered: 0 });
  });

  it('knows nothing about notes the student never worked on', () => {
    expect(buildProfile([note('a', ['Límites'], ['limits'])], [], []).skills).toEqual([]);
  });

  it('tells the tutor, in a short line, what is hard and what is known', () => {
    const prompt = helpPrompt({
      action: 'hint',
      level: 2,
      text: 'x^2 = 9',
      comment: '',
      candidates: [],
      previous: [],
      learner: { hard: ['Factorización'], easy: ['Ecuaciones lineales'] },
    });
    expect(prompt).toContain('finds these hard: Factorización');
    expect(prompt).toContain('is comfortable with: Ecuaciones lineales');
  });

  it('gives the solver what the device found when it asks for a correction', () => {
    const prompt = helpPrompt({
      action: 'hint',
      level: 4,
      text: 'x^2 = 9',
      comment: '',
      candidates: [],
      previous: [],
      repair: { feedback: 'x = 2 leaves -5, not 0', attempt: 'x = 2' },
    });
    expect(prompt).toContain('checked on the device and it is wrong');
    expect(prompt).toContain('<earlier>x = 2</earlier>');
  });
});

describe('the picture a solver asks for', () => {
  it('keeps every kind whose formulas the device can read', () => {
    expect(validateVisual({ kind: 'graph', f: 'x^2-4', g: '', a: '', b: '' })).toEqual({ kind: 'graph', f: 'x^2-4' });
    expect(validateVisual({ kind: 'intersection', f: '2x+1', g: 'x^2-2', a: '', b: '' })?.kind).toBe('intersection');
    expect(validateVisual({ kind: 'area', f: 'x^2', g: '', a: '0', b: '2' })).toEqual({ kind: 'area', f: 'x^2', a: 0, b: 2 });
    expect(validateVisual({ kind: 'tangent', f: 'x^3', g: '', a: '1', b: '' })).toEqual({ kind: 'tangent', f: 'x^3', a: 1 });
    expect(validateVisual({ kind: 'unit_circle', f: 'sin', g: '', a: 'pi/6', b: '' })?.a).toBeCloseTo(Math.PI / 6);
    expect(validateVisual({ kind: 'parametric', f: 'cos(t)', g: 'sin(t)', a: '0', b: '2pi' })?.b).toBeCloseTo(2 * Math.PI);
  });

  it('drops anything unsafe or meaningless, never the solution', () => {
    expect(validateVisual({ kind: 'graph', f: 'alert(1)', g: '', a: '', b: '' })).toBeNull();
    expect(validateVisual({ kind: 'area', f: 'x^2', g: '', a: '3', b: '1' })).toBeNull();
    expect(validateVisual({ kind: 'none', f: '', g: '', a: '', b: '' })).toBeNull();
    expect(validateVisual('graph')).toBeNull();
    // A tangent without a point is still worth a graph.
    expect(validateVisual({ kind: 'tangent', f: 'x^3', g: '', a: '', b: '' })).toEqual({ kind: 'graph', f: 'x^3' });
    const out = validateHelp({ help: '1. a\n2. b', source_id: '', connection: '', practice_q: '', practice_a: '', visual: { kind: 'graph', f: 'rm -rf' } }, []);
    expect(out.visual).toBeNull();
    expect(out.body).toBe('1. a\n2. b');
  });

  it('computes what each picture needs on the device', () => {
    const area = visualModel({ kind: 'area', f: 'x^2', a: 0, b: 2 });
    expect(area?.kind === 'area' && area.value).toBeCloseTo(8 / 3, 6);
    const tangent = visualModel({ kind: 'tangent', f: 'x^3', a: 1 });
    expect(tangent?.kind === 'tangent' && tangent.m).toBeCloseTo(3, 4);
    const meet = visualModel({ kind: 'intersection', f: '2x+1', g: 'x^2-2' });
    expect(meet?.kind === 'intersection' && meet.points.map((p) => Math.round(p.x))).toEqual([-1, 3]);
  });
});

describe('the device check of a full solution', () => {
  it('reads the exercise from the note and the answer from the last step', () => {
    const output = { body: '1. Factorizamos: $(x+3)(x-1)=0$\n2. Las soluciones son $x = -3$ y $x = 1$', visual: null, plot: null };
    expect(checkSolution('Resuelve: $x^2+2x-3=0$', output)?.status).toBe('verified');
  });

  it("falls back to the solver's own function when the note has no readable equation", () => {
    const output = { body: '1. Igualamos a cero\n2. Las soluciones son $x = 2$ y $x = -2$', visual: { kind: 'graph' as const, f: 'x^2-4' }, plot: null };
    expect(checkSolution('Halla las raíces de la parábola dibujada en la pizarra', output)?.status).toBe('verified');
  });
});

describe('the captions and ticks of a scene', () => {
  it('sets the solver plain notation as a caption', async () => {
    const { prettyFormula, subscriptNumber, superscriptNumber, niceTicks } = await import('../src/core/visual');
    expect(prettyFormula('x^2+2x-3')).toBe('x² + 2x − 3');
    expect(prettyFormula('sin(3t)')).toBe('sin(3t)');
    expect(prettyFormula('2*pi*x')).toBe('2·π·x');
    expect(`∫${subscriptNumber(0)}${superscriptNumber(2)}`).toBe('∫₀²');
    expect(superscriptNumber(1.5)).toBe('1.5');
    expect(niceTicks(-4.2, 2.3, 6)).toEqual([-4, -2, 0, 2]);
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100]);
  });
});
