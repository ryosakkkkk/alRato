import { useId, useMemo, type CSSProperties } from 'react';
import { compileFunction, frameFunction } from '../core/plot';
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
 * Returns when the last step finishes, in seconds.
 */
export function writeBoard(board: HTMLElement, fromStart: boolean): number {
  let t = 0;
  for (const step of board.querySelectorAll<HTMLElement>('.step')) {
    if (!fromStart && step.dataset.written) continue;
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
  return t;
}

const W = 300;
const H = 160;

/**
 * Draws a function of x on the board once the solution is written, and marks where it crosses
 * zero: for an equation, those points are its answers.
 */
export function FunctionGraph({ source, label }: { source: string; label: string }) {
  const { lang } = useI18n();
  const gradient = `curve-${useId().replace(/:/g, '')}`;

  const model = useMemo(() => {
    const fn = compileFunction(source);
    if (!fn) return null;
    const frame = frameFunction(fn);
    const span = frame.y1 - frame.y0;
    const px = (x: number) => ((x - frame.x0) / (frame.x1 - frame.x0)) * W;
    const py = (y: number) => ((frame.y1 - y) / span) * H;

    let d = '';
    let pen = false;
    let prev: number | null = null;
    for (let k = 0; k <= 240; k += 1) {
      const x = frame.x0 + ((frame.x1 - frame.x0) * k) / 240;
      const y = fn(x);
      if (!Number.isFinite(y)) {
        pen = false;
        prev = null;
        continue;
      }
      // A jump across the whole window is an asymptote: lift the pen instead of drawing a wall.
      if (prev !== null && Math.abs(y - prev) > span) pen = false;
      const cy = Math.max(-H, Math.min(2 * H, py(y)));
      d += `${pen ? 'L' : 'M'}${px(x).toFixed(1)} ${cy.toFixed(1)} `;
      pen = true;
      prev = y;
    }

    const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 });
    const axisY = frame.y0 <= 0 && frame.y1 >= 0 ? py(0) : null;
    return {
      d,
      axisY,
      axisX: frame.x0 <= 0 && frame.x1 >= 0 ? px(0) : null,
      roots: frame.roots.map((r) => ({
        x: px(r),
        y: py(0),
        label: number.format(Math.abs(r) < 1e-9 ? 0 : r).replace('-', '−'),
        below: py(0) + 24 <= H,
      })),
    };
  }, [source, lang]);

  if (!model) return null;
  return (
    <svg className="graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="0.5" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      {model.axisY !== null && <line className="axis" x1={0} y1={model.axisY} x2={W} y2={model.axisY} />}
      {model.axisX !== null && <line className="axis" x1={model.axisX} y1={0} x2={model.axisX} y2={H} />}
      <path className="curve" d={model.d} pathLength={1} stroke={`url(#${gradient})`} />
      {model.roots.map((root, i) => (
        <g key={i} className="root" style={{ '--i': i } as CSSProperties}>
          <circle cx={root.x} cy={root.y} r={5.5} />
          <text x={root.x} y={root.below ? root.y + 20 : root.y - 12}>
            {root.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
