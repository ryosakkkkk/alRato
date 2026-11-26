import { describe, expect, it } from 'vitest';
import { parseJson, repairLatex, validateHelp } from '../src/ai/validate';

describe('LaTeX written into JSON with single backslashes', () => {
  it('keeps an answer whose LaTeX has no valid JSON escape, such as \\gamma', () => {
    const raw = '{"help": "Use $\\gamma V(s\')$ and $\\sum_i w_i$", "source_id": ""}';
    expect(parseJson(raw).help).toBe("Use $\\gamma V(s')$ and $\\sum_i w_i$");
  });

  it('turns control characters from \\rho, \\theta, \\beta and \\frac back into commands', () => {
    const parsed = parseJson('{"help": "$\\rho + \\theta + \\beta + \\frac{1}{2}$"}');
    expect(validateHelp({ ...parsed, source_id: '', connection: '', practice_q: '', practice_a: '' }, []).body).toBe(
      '$\\rho + \\theta + \\beta + \\frac{1}{2}$',
    );
  });

  it('restores \\nu inside inline math but keeps real line breaks', () => {
    expect(repairLatex('Step one: $\nu + 1$\nStep two')).toBe('Step one: $\\nu + 1$\nStep two');
    expect(repairLatex('1. First\n2. Second')).toBe('1. First\n2. Second');
    expect(repairLatex('Costs $10\nnext line')).toBe('Costs $10\nnext line');
  });

  it('leaves correctly escaped LaTeX alone, whatever letter follows the backslash', () => {
    const text = 'Note: $V(s) = \\sum P \\cdot (r + \\gamma V) \\quad \\text{ok}$\nNext line';
    expect(parseJson(JSON.stringify({ text })).text).toBe(text);
  });

  it('leaves correct output alone', () => {
    const parsed = parseJson('{"help": "1. $\\\\rho = 2$\\n2. Done"}');
    expect(parsed.help).toBe('1. $\\rho = 2$\n2. Done');
    expect(repairLatex(parsed.help as string)).toBe('1. $\\rho = 2$\n2. Done');
  });
});
