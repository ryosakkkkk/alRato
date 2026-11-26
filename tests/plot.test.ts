import { describe, expect, it } from 'vitest';
import { validateHelp } from '../src/ai/validate';
import { compileFunction, frameFunction } from '../src/core/plot';

const at = (source: string, x: number) => compileFunction(source)!(x);

describe('compileFunction', () => {
  it('reads polynomials with implicit products', () => {
    expect(at('x^2+2x-3', 1)).toBe(0);
    expect(at('(x+3)(x-1)', 2)).toBe(5);
    expect(at('2x^2', 3)).toBe(18);
    expect(at('3(x+1)', 1)).toBe(6);
  });

  it('gives a leading minus the usual meaning', () => {
    expect(at('-x^2', 2)).toBe(-4);
    expect(at('-x^2-2x+3', 1)).toBe(0);
  });

  it('turns an equation or a y = form into one expression', () => {
    expect(at('x^2+2x=3', 1)).toBe(0);
    expect(at('y = 2x + 1', -0.5)).toBe(0);
    expect(at('f(x)=x−4', 4)).toBe(0);
  });

  it('knows a few functions and constants', () => {
    expect(at('sin(x)', 0)).toBe(0);
    expect(at('sqrt(x)+1', 4)).toBe(3);
    expect(at('2pi x', 1)).toBeCloseTo(2 * Math.PI);
    expect(at('e^x', 0)).toBe(1);
  });

  it('accepts light LaTeX and decimal commas', () => {
    expect(at('$x^{2}-0,5$', 1)).toBe(0.5);
    expect(at('2\\cdot x', 3)).toBe(6);
  });

  it('refuses anything it cannot draw safely', () => {
    for (const bad of ['', 'alert(1)', 'x;1', 'window', '3+4', '(x+1', 'x=1=2', 'a'.repeat(90) + 'x']) {
      expect(compileFunction(bad), bad).toBeNull();
    }
  });
});

describe('the plot field of a full solution', () => {
  const answer = (plot: unknown) =>
    validateHelp({ help: '1. a\n2. b', source_id: '', connection: '', practice_q: '', practice_a: '', plot }, []);

  it('keeps a function it can draw', () => {
    expect(answer('x^2+2x-3').plot).toBe('x^2+2x-3');
  });

  it('drops anything else without losing the solution', () => {
    for (const bad of ['', 'console.log(x)', 42, null, undefined]) {
      const out = answer(bad);
      expect(out.plot).toBeNull();
      expect(out.body).toBe('1. a\n2. b');
    }
  });
});

describe('frameFunction', () => {
  it('finds the answers and frames them with room around', () => {
    const frame = frameFunction(compileFunction('x^2+2x-3')!);
    expect(frame.roots.map((r) => Number(r.toFixed(3)))).toEqual([-3, 1]);
    expect(frame.x0).toBeLessThan(-3);
    expect(frame.x1).toBeGreaterThan(1);
    expect(frame.y0).toBeLessThan(-4);
    expect(frame.y1).toBeGreaterThan(0);
  });

  it('does not take a pole for an answer', () => {
    expect(frameFunction(compileFunction('1/x')!).roots).toEqual([]);
  });

  it('uses a default window when there are no answers', () => {
    const frame = frameFunction(compileFunction('x^2+1')!);
    expect(frame.roots).toEqual([]);
    expect([frame.x0, frame.x1]).toEqual([-5, 5]);
  });
});
