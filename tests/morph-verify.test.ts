import { describe, expect, it } from 'vitest';
import { mainMath, matchSymbols } from '../src/core/morph';
import { checkAnswers, statedNumbers } from '../src/core/verify';

describe('matchSymbols', () => {
  it('carries the shared symbols from one line to the next, in order', () => {
    // x^2 + 2x - 3 = 0  ->  (x + 3)(x - 1) = 0
    const before = ['x', '2', '+', '2', 'x', '−', '3', '=', '0'];
    const after = ['(', 'x', '+', '3', ')', '(', 'x', '−', '1', ')', '=', '0'];
    const pairs = matchSymbols(before, after);
    for (const [j, i] of pairs) expect(after[j]).toBe(before[i]);
    expect(pairs.get(11)).toBe(8); // the 0 stays the 0
    expect(pairs.get(10)).toBe(7); // and the = stays the =
    expect(pairs.size).toBeGreaterThanOrEqual(5);
  });

  it('matches nothing when nothing is shared', () => {
    expect(matchSymbols(['a'], ['b']).size).toBe(0);
    expect(matchSymbols([], ['b']).size).toBe(0);
  });
});

describe('mainMath', () => {
  it('takes the last math of a step, its result', () => {
    expect(mainMath('Factor: $x^2+2x-3$ becomes $(x+3)(x-1)=0$')).toBe('(x+3)(x-1)=0');
    expect(mainMath('No math here')).toBeNull();
  });
});

describe('checkAnswers', () => {
  it('confirms answers that make the function zero', () => {
    const check = checkAnswers('x^2+2x-3', 'Answer: $x=-3$ or $x=1$');
    expect(check?.values.map((v) => v.x)).toEqual([-3, 1]);
    expect(check?.values.every((v) => v.y === 0)).toBe(true);
  });

  it('reads decimal commas, fractions and the minus sign, and ignores exponents', () => {
    expect(statedNumbers('$x^2 = 4$, so $x = −2$ o $x = 2{,}5$')).toEqual([4, -2, 2.5]);
    expect(checkAnswers('2x-1', 'Respuesta: $x=\\frac{1}{2}$')?.values[0].x).toBe(0.5);
  });

  it('stays quiet when an answer is missing or wrong, instead of guessing', () => {
    expect(checkAnswers('x^2+2x-3', 'Answer: $x=1$')).toBeNull();
    expect(checkAnswers('x^2+2x-3', 'Answer: $x=3$ or $x=1$')).toBeNull();
    expect(checkAnswers('x^2+1', 'No real answers')).toBeNull();
  });
});
