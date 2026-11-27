import { describe, expect, it } from 'vitest';
import { splitSolution } from '../src/core/solution';

describe('splitSolution', () => {
  it('keeps the step numbers the model wrote and drops the markers', () => {
    const steps = splitSolution('1. Multiply by -1: $x^2+2x-3=0$\n2) Factor: $(x+3)(x-1)=0$\n3. Answer: $x=1$');
    expect(steps).toEqual([
      { n: 1, text: 'Multiply by -1: $x^2+2x-3=0$' },
      { n: 2, text: 'Factor: $(x+3)(x-1)=0$' },
      { n: 3, text: 'Answer: $x=1$' },
    ]);
  });

  it('reads bullets and plain lines as steps without a number', () => {
    expect(splitSolution('- Isolate $x$\n* Divide by 2\nDone')).toEqual([
      { n: null, text: 'Isolate $x$' },
      { n: null, text: 'Divide by 2' },
      { n: null, text: 'Done' },
    ]);
  });

  it('skips blank lines and empty items', () => {
    expect(splitSolution('\n1.\n\n2. Second\n-\n3. Third\n')).toEqual([
      { n: 2, text: 'Second' },
      { n: 3, text: 'Third' },
    ]);
  });

  it('returns no steps for a single sentence, so the caller shows plain text', () => {
    expect(splitSolution('Only one sentence with $x$.')).toEqual([]);
    expect(splitSolution('')).toEqual([]);
  });

  it('turns a paragraph into one step per sentence, never splitting inside math', () => {
    const prose =
      'First, substitute the values: $2 + 0.9 \\cdot 10$. Next, add the reward: $2+9=11$. Finally, multiply: $0.7 \\cdot 11 = 7.7$. Thus, $V(s)=7.7$.';
    expect(splitSolution(prose).map((s) => s.text)).toEqual([
      'First, substitute the values: $2 + 0.9 \\cdot 10$.',
      'Next, add the reward: $2+9=11$.',
      'Finally, multiply: $0.7 \\cdot 11 = 7.7$.',
      'Thus, $V(s)=7.7$.',
    ]);
  });

  it('pulls a result back inside the math when the model closed it too early', () => {
    expect(splitSolution('1. Multiply $0.9 \\cdot 10 = $ 9\n2. Add $2 + 9 =$11\n3. So $V(s) = $ 7.7.').map((s) => s.text)).toEqual([
      'Multiply $0.9 \\cdot 10 = 9$',
      'Add $2 + 9 = 11$',
      'So $V(s) = 7.7$.',
    ]);
    expect(splitSolution('1. It costs $5 and\n2. then $x = 2$').map((s) => s.text)).toEqual(['It costs $5 and', 'then $x = 2$']);
  });

  it('splits Spanish sentences that start with an accent or an opening mark', () => {
    expect(splitSolution('Primero suma. Ésta es la clave. ¿Ves el patrón?').map((s) => s.text)).toEqual([
      'Primero suma.',
      'Ésta es la clave.',
      '¿Ves el patrón?',
    ]);
  });
});
