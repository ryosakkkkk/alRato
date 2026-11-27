import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VisualSpec } from '../core/types';
import { verifySolution } from '../core/verifier';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { CheckLine } from './Agent';
import { MathMorph, writeBoard } from './Board';
import { Icon } from './Icon';
import { MathText } from './MathText';
import { MathVisual } from './Visuals';

interface Example {
  exercise: string;
  steps: { label: MessageKey; math: string }[];
  visual: VisualSpec;
  /** How long the finished board stays before the next example, in milliseconds. */
  hold: number;
}

const EXAMPLES: Example[] = [
  {
    exercise: '$-x^2-2x=-3$',
    steps: [
      { label: 'demo.s1', math: '$x^2+2x-3=0$' },
      { label: 'demo.s2', math: '$(x+3)(x-1)=0$' },
      { label: 'demo.s3', math: '$x=-3 \\quad \\text{·} \\quad x=1$' },
    ],
    visual: { kind: 'graph', f: 'x^2+2x-3' },
    hold: 6200,
  },
  {
    exercise: '$\\int_0^2 x^2\\,dx$',
    steps: [
      { label: 'demo.b1', math: '$\\frac{x^3}{3}$' },
      { label: 'demo.b2', math: '$\\frac{2^3}{3}-\\frac{0^3}{3}$' },
      { label: 'demo.b3', math: '$\\int_0^2 x^2\\,dx=\\frac{8}{3}$' },
    ],
    visual: { kind: 'area', f: 'x^2', a: 0, b: 2 },
    hold: 7000,
  },
  {
    exercise: '$\\sin\\left(\\frac{\\pi}{6}\\right)$',
    steps: [
      { label: 'demo.c1', math: '$\\frac{\\pi}{6}=30^{\\circ}$' },
      { label: 'demo.c2', math: '$\\sin\\theta=y$' },
      { label: 'demo.c3', math: '$\\sin\\left(\\frac{\\pi}{6}\\right)=\\frac{1}{2}$' },
    ],
    visual: { kind: 'unit_circle', f: 'sin', a: Math.PI / 6 },
    hold: 7600,
  },
];
const FINAL_STEP = 2;

/**
 * Fixed examples of the step-by-step solver for the home screen: an equation, an integral and an
 * angle, each written on the same board as the real solutions, drawn with the same pictures and
 * checked by the same arithmetic on the device. They are not answers from a model and not taken
 * from the student's notes, and the card says so.
 */
export function SolveDemo() {
  const { t } = useI18n();
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [example, setExample] = useState(0);
  // How many solution steps are on the board: 0 to 3, then the picture, then the next example.
  const [shown, setShown] = useState(0);
  const board = useRef<HTMLDivElement>(null);
  const current = EXAMPLES[example];

  useEffect(() => {
    if (reduced) return;
    const wait = shown === 0 ? 1600 : shown === FINAL_STEP + 1 ? current.hold : 2000;
    const timer = window.setTimeout(() => {
      if (shown === FINAL_STEP + 1) {
        setExample((n) => (n + 1) % EXAMPLES.length);
        setShown(0);
      } else {
        setShown((n) => n + 1);
      }
    }, wait);
    return () => window.clearTimeout(timer);
  }, [shown, reduced, current.hold]);

  const visible = reduced ? FINAL_STEP + 1 : shown;

  // Each step that just arrived is written now; the ones already on the board stay as they are.
  useLayoutEffect(() => {
    if (board.current) writeBoard(board.current, false);
  }, [visible, example, t]);

  const steps = useMemo(
    () => current.steps.map((step) => ({ label: t(step.label), math: step.math.replace('\\text{·}', `\\text{${t('demo.or')}}`) })),
    [current, t],
  );
  // The stage shows the exercise, then transforms it into each step's equation as the step arrives.
  const stageTex = (visible === 0 ? current.exercise : steps[visible - 1].math).slice(1, -1);
  const check = useMemo(() => verifySolution(current.exercise, steps[FINAL_STEP].math, current.visual.f), [current, steps]);

  return (
    <section className="solve-demo" aria-label={t('demo.kicker')}>
      <div className="solve-head">
        <span className="tile">
          <Icon name="spark" size={16} />
        </span>
        {t('demo.kicker')}
      </div>
      {/* A new example gets a new board, so its writing and its stage start from the beginning. */}
      <div ref={board} key={example} className="solution board">
        <MathMorph tex={stageTex} />
        <ol className="steps">
          <li className="step step-exercise">
            <span className="step-no">
              <Icon name="image" size={16} />
            </span>
            <div className="step-body">
              <span className="demo-label">{t('demo.exercise')}</span>
              <MathText text={current.exercise} words />
            </div>
          </li>
          {steps.slice(0, visible).map((step, i) => (
            <li key={i} className={i === FINAL_STEP ? 'step step-final' : 'step'}>
              <span className="step-no">{i === FINAL_STEP ? <Icon name="check" size={16} /> : i + 1}</span>
              <div className="step-body">
                <MathText text={step.label} words />
                <MathText text={step.math} words />
              </div>
            </li>
          ))}
        </ol>
        {visible > FINAL_STEP && <MathVisual spec={current.visual} delayMs={200} instant={reduced} />}
        {visible > FINAL_STEP && check && <CheckLine check={check} />}
      </div>
      <p className="solve-note">{t('demo.note')}</p>
    </section>
  );
}
