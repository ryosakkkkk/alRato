import katex from 'katex';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { matchSymbols } from '../core/morph';
import { checkAnswers } from '../core/verify';
import { useI18n } from '../i18n';

/** Seconds per written word or math symbol, and the pause between two steps. */
const GLYPH_S = 0.045;
const STEP_GAP_S = 0.35;

/** The pieces of a step that appear one by one: plain words and KaTeX's smallest visible symbols. */
function glyphsOf(root: Element | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('.w, .katex-html span')].filter(
    (el) => el.classList.contains('w') || (el.childElementCount === 0 && (el.textContent ?? '').trim() !== ''),
  );
}

/**
 * Times the writing on a board, like a teacher at the blackboard: each symbol of a step appears in
 * order, then the next step starts. With `fromStart` every step is timed from zero (a full solution);
 * otherwise only steps not written yet start now (the home example, where steps arrive one by one).
 * Returns when each step starts and when the last one finishes, in seconds.
 */
export function writeBoard(board: HTMLElement, fromStart: boolean): { starts: number[]; total: number } {
  let t = 0;
  const starts: number[] = [];
  for (const step of board.querySelectorAll<HTMLElement>('.step')) {
    if (!fromStart && step.dataset.written) continue;
    starts.push(t);
    const glyphs = glyphsOf(step.querySelector('.step-body'));
    glyphs.forEach((glyph, k) => {
      glyph.classList.add('glyph');
      glyph.style.setProperty('--k', String(k));
    });
    const length = 0.3 + glyphs.length * GLYPH_S;
    step.style.setProperty('--d', `${t}s`);
    step.style.setProperty('--e', `${t + length}s`);
    step.dataset.written = '1';
    if (fromStart) t += length + STEP_GAP_S;
  }
  board.style.setProperty('--total', `${t}s`);
  return { starts, total: t };
}

/** KaTeX's smallest visible pieces: the symbols that move, appear or fade in a transformation. */
function mathSymbols(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.katex-html span')].filter(
    (el) => el.childElementCount === 0 && (el.textContent ?? '').trim() !== '',
  );
}

interface SymbolBox {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
}

/**
 * The equation at the top of the board, transformed from one step to the next like the math videos:
 * a symbol that stays glides to its new place, a new symbol is written in colour, and a symbol that
 * leaves fades away. The step list below carries the same math as text, so this stage is decorative
 * for screen readers.
 */
export function MathMorph({ tex }: { tex: string }) {
  const host = useRef<HTMLDivElement>(null);
  const previous = useRef<SymbolBox[] | null>(null);

  useLayoutEffect(() => {
    const stage = host.current;
    const math = stage?.querySelector('.morph-math');
    if (!stage || !math) return;
    stage.querySelectorAll('.morph-ghost').forEach((ghost) => ghost.remove());
    math.innerHTML = katex.renderToString(tex, { displayMode: true, throwOnError: false, trust: false, strict: 'ignore' });

    const origin = stage.getBoundingClientRect();
    const symbols = mathSymbols(math);
    symbols.forEach((el) => el.classList.add('msym'));
    const now = symbols.map((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { el, text: (el.textContent ?? '').trim(), x: r.left - origin.left, y: r.top - origin.top, font: style.font, color: style.color };
    });
    const before = previous.current;
    previous.current = now.map(({ text, x, y, font, color }) => ({ text, x, y, font, color }));
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof symbols[0]?.animate !== 'function') return;

    if (!before) {
      now.forEach((s, k) =>
        s.el.animate(
          [
            { opacity: 0, transform: 'translateY(8px)', filter: 'blur(3px)' },
            { opacity: 1, transform: 'none', filter: 'none' },
          ],
          { duration: 420, delay: 70 * k, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' },
        ),
      );
      return;
    }

    const pairs = matchSymbols(
      before.map((b) => b.text),
      now.map((n) => n.text),
    );
    const stayed = new Set(pairs.values());
    let fresh = 0;
    now.forEach((s, j) => {
      const i = pairs.get(j);
      if (i !== undefined) {
        const from = before[i];
        s.el.animate([{ transform: `translate(${from.x - s.x}px, ${from.y - s.y}px)` }, { transform: 'none' }], {
          duration: 800,
          easing: 'cubic-bezier(0.65, 0, 0.25, 1)',
          fill: 'both',
        });
      } else {
        s.el.animate(
          [
            { opacity: 0, transform: 'translateY(10px) scale(0.8)', color: '#f472b6' },
            { opacity: 1, transform: 'none', color: '#f472b6', offset: 0.55 },
            { opacity: 1, transform: 'none', color: s.color },
          ],
          { duration: 1200, delay: 420 + 70 * fresh, easing: 'ease-out', fill: 'both' },
        );
        fresh += 1;
      }
    });
    before.forEach((b, i) => {
      if (stayed.has(i)) return;
      const ghost = document.createElement('span');
      ghost.className = 'morph-ghost';
      ghost.textContent = b.text;
      ghost.style.cssText = `left:${b.x}px;top:${b.y}px;font:${b.font};color:${b.color}`;
      stage.appendChild(ghost);
      ghost
        .animate(
          [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(-12px) scale(0.7)', color: '#22d3ee' },
          ],
          { duration: 520, easing: 'ease-in', fill: 'forwards' },
        )
        .finished.then(() => ghost.remove())
        .catch(() => undefined);
    });
  }, [tex]);

  return (
    <div ref={host} className="morph" aria-hidden="true">
      <div className="morph-math" />
    </div>
  );
}

/**
 * The device's half of the hybrid solution: it puts each stated answer into the function and shows
 * the result. Shown only when every zero of the function is among the answers.
 */
export function AnswerCheckLine({ plot, finalLine }: { plot: string; finalLine: string }) {
  const { t, lang } = useI18n();
  const check = useMemo(() => checkAnswers(plot, finalLine), [plot, finalLine]);
  if (!check) return null;
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 3 });
  const show = (v: number) => number.format(Math.abs(v) < 1e-9 ? 0 : v).replace('-', '−');
  const values = check.values.map((v) => `f(${show(v.x)}) = ${show(v.y)}`).join('  ·  ');
  return (
    <p className="answer-check">
      <span className="answer-check-mark" aria-hidden="true">
        ✓
      </span>
      <span>
        <strong>{t('solution.checked')}</strong> {values}
      </span>
    </p>
  );
}
