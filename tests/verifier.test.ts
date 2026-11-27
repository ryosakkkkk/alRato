import { describe, expect, it } from 'vitest';
import { evaluateConstant, compileExpression } from '../src/core/plot';
import { explicitAnswers, repairFeedback, verifySolution } from '../src/core/verifier';

describe('the LaTeX the device can read', () => {
  it('evaluates constants written in LaTeX', () => {
    expect(evaluateConstant('\\frac{1}{2}')).toBe(0.5);
    expect(evaluateConstant('-\\frac{3}{2}')).toBe(-1.5);
    expect(evaluateConstant('\\frac{\\pi}{6}')).toBeCloseTo(Math.PI / 6);
    expect(evaluateConstant('2\\sqrt{3}')).toBeCloseTo(2 * Math.sqrt(3));
    expect(evaluateConstant('0,5')).toBe(0.5);
    expect(evaluateConstant('x+1')).toBeNull();
  });

  it('reads nested fractions, roots, absolute values and a second variable', () => {
    expect(compileExpression('\\frac{x^{2}}{2} + \\frac{3x}{4}')!(2)).toBe(3.5);
    expect(compileExpression('\\sqrt{\\frac{x}{4}}')!(16)).toBe(2);
    expect(compileExpression('|x - 3|')!(1)).toBe(2);
    expect(compileExpression('\\operatorname{sen}(x)')!(Math.PI / 2)).toBeCloseTo(1);
    expect(compileExpression('cos(t) + t', { variable: 't' })!(0)).toBe(1);
  });
});

describe('explicitAnswers', () => {
  it('reads x = value, subscripts, sets and ±', () => {
    expect(explicitAnswers('Las soluciones son $x = 1$ y $x = -3$.')).toEqual([1, -3]);
    expect(explicitAnswers('$x_1 = 1, \\quad x_2 = -3$')).toEqual([1, -3]);
    expect(explicitAnswers('$S = \\{1, -3\\}$')).toEqual([1, -3]);
    expect(explicitAnswers('$x = \\frac{-2 \\pm 4}{2}$')).toEqual([1, -3]);
    expect(explicitAnswers('$x = 0,5$')).toEqual([0.5]);
    expect(explicitAnswers('$x \\approx 1.414$ o $x \\approx -1.414$')).toEqual([1.414, -1.414]);
  });

  it('ignores numbers that are not answers for x', () => {
    expect(explicitAnswers('La ecuación tiene 2 soluciones reales.')).toEqual([]);
    expect(explicitAnswers('$f(1) = 0$')).toEqual([]);
    expect(explicitAnswers('$\\Delta = 16$')).toEqual([]);
  });
});

describe('verifySolution: equations', () => {
  const note = 'Resuelve: $-x^2-2x=-3$';

  it('confirms answers that make the equation true', () => {
    const check = verifySolution(note, 'Las soluciones son $x = 1$ y $x = -3$.');
    expect(check?.kind).toBe('equation');
    expect(check?.status).toBe('verified');
    if (check?.kind === 'equation') expect(check.values.map((v) => v.x)).toEqual([1, -3]);
  });

  it('flags an answer that does not, and says how to fix it', () => {
    const check = verifySolution(note, '$x = 2$ y $x = -3$');
    expect(check?.status).toBe('mismatch');
    const feedback = repairFeedback(check!);
    expect(feedback).toContain('x = 2 leaves');
    expect(feedback).toContain('x ≈ 1');
  });

  it('accepts rounded irrational answers and an answer that discards a root', () => {
    expect(verifySolution('Resuelve $x^2 = 2$', '$x \\approx 1.414$ o $x \\approx -1.414$')?.status).toBe('verified');
    expect(verifySolution('Resuelve $x^2 = 9$, donde x es el lado de un cuadrado.', '$x = 3$')?.status).toBe('verified');
    expect(verifySolution('Resolver $2x - 1 = 0$', '$x = \\frac{1}{2}$')?.status).toBe('verified');
  });

  it('uses the function the model named only when the note has no readable equation', () => {
    expect(verifySolution('Halla las raíces de la parábola de la figura', '$x = 1$ y $x = -3$', 'x^2+2x-3')?.status).toBe(
      'verified',
    );
    expect(verifySolution('Explica la figura', '$x = 1$', 'x^2+2x-3')).toBeNull();
  });
});

describe('verifySolution: calculus', () => {
  it('compares a derivative with the slope of the function', () => {
    const note = 'Deriva $f(x) = x^3 + 2x$';
    expect(verifySolution(note, "$f'(x) = 3x^2 + 2$")?.status).toBe('verified');
    const wrong = verifySolution(note, "$f'(x) = 3x^2 + 2x$");
    expect(wrong?.status).toBe('mismatch');
    expect(repairFeedback(wrong!)).toContain('derivative');
  });

  it('checks a derivative at a point', () => {
    const note = "Halla $f'(2)$ si $f(x) = x^3$";
    expect(verifySolution(note, "$f'(2) = 12$")).toMatchObject({ kind: 'derivative_at', status: 'verified' });
    expect(verifySolution(note, "$f'(2) = 6$")?.status).toBe('mismatch');
  });

  it('integrates numerically to check a definite integral', () => {
    const note = 'Calcula $\\int_0^2 x^2\\,dx$';
    expect(verifySolution(note, '$\\int_0^2 x^2\\,dx = \\frac{8}{3} \\approx 2.67$')?.status).toBe('verified');
    expect(verifySolution(note, '$\\int_0^2 x^2\\,dx = 3$')?.status).toBe('mismatch');
    expect(verifySolution('Calcula $\\int_{0}^{\\pi} \\sin(x)\\, dx$', 'El resultado es $2$')?.status).toBe('verified');
  });

  it('differentiates an antiderivative to check it', () => {
    const note = 'Integra $\\int 2x \\, dx$';
    expect(verifySolution(note, '$x^2 + C$')?.status).toBe('verified');
    expect(verifySolution(note, '$2x^2 + C$')?.status).toBe('mismatch');
  });
});

describe('verifySolution: systems and plain calculations', () => {
  it('reads a system of two functions as the points where they meet', () => {
    const note = 'Resuelve el sistema $y = 2x + 1$, $y = x^2 - 2$';
    expect(verifySolution(note, 'Las soluciones son $x = 3$ y $x = -1$')?.status).toBe('verified');
    expect(verifySolution(note, '$x = 3$ y $x = 1$')?.status).toBe('mismatch');
    expect(verifySolution('Resuelve $\\begin{cases} y = 2x + 1 \\\\ y = x^2 - 2 \\end{cases}$', '$x = 3$ o $x = -1$')?.status).toBe(
      'verified',
    );
  });

  it('evaluates both sides of a final calculation with no unknown', () => {
    expect(verifySolution('Calcula el seno de pi/6', 'Resultado: $\\sin\\left(\\frac{\\pi}{6}\\right) = \\frac{1}{2}$')).toMatchObject({
      kind: 'arithmetic',
      status: 'verified',
    });
    expect(verifySolution('Calcula', '$0.7 \\cdot 11 = 7.7$')?.status).toBe('verified');
    expect(verifySolution('Calcula', '$2^{10} = 1000$')?.status).toBe('mismatch');
    expect(verifySolution('Calcula', '$\\sqrt{2} \\approx 1.41$')?.status).toBe('verified');
    expect(verifySolution('Calcula', '$3 = 3$')).toBeNull();
  });
});

describe('verifySolution stays quiet when it cannot tell', () => {
  it('says nothing about notes without a checkable task', () => {
    expect(verifySolution('Explica la regla de la cadena con un ejemplo.', 'La regla dice que...')).toBeNull();
    expect(verifySolution("Exercise: compute V(s) if P = 0.7, r = 2, γ = 0.9, V(s') = 10", '$V(s) = 7.7$')).toBeNull();
    expect(verifySolution('Resuelve $x^2 + 1 = 0$', 'No tiene soluciones reales.')).toBeNull();
  });
});
