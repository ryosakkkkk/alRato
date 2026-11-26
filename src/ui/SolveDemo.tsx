import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { AnswerCheckLine, FunctionGraph, MathMorph, writeBoard } from './Board';
import { Icon } from './Icon';
import { MathText } from './MathText';

const EXERCISE = '$-x^2-2x=-3$';
const FUNCTION = 'x^2+2x-3';
const FINAL_STEP = 2;

/**
 * A fixed example of the step-by-step solver for the home screen, written on the same board as the
 * real solutions and ending with the same graph. It is not an answer from the model and not taken
 * from the student's notes, and it says so.
 */
export function SolveDemo() {
  const { t } = useI18n();
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  // How many solution steps are on the board: 0 to 3, then the graph, then the example starts again.
  const [shown, setShown] = useState(0);
  const board = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) return;
    const wait = shown === 0 ? 1600 : shown === FINAL_STEP + 1 ? 6200 : 2000;
    const timer = window.setTimeout(() => setShown((n) => (n === FINAL_STEP + 1 ? 0 : n + 1)), wait);
    return () => window.clearTimeout(timer);
  }, [shown, reduced]);

  const visible = reduced ? FINAL_STEP + 1 : shown;

  // Each step that just arrived is written now; the ones already on the board stay as they are.
  useLayoutEffect(() => {
    if (board.current) writeBoard(board.current, false);
  }, [visible, t]);

  const steps = [
    { label: t('demo.s1'), math: '$x^2+2x-3=0$' },
    { label: t('demo.s2'), math: '$(x+3)(x-1)=0$' },
    { label: t('demo.s3'), math: `$x=-3 \\quad \\text{${t('demo.or')}} \\quad x=1$` },
  ];
  // The stage shows the exercise, then transforms it into each step's equation as the step arrives.
  const stageTex = (visible === 0 ? EXERCISE : steps[visible - 1].math).slice(1, -1);

  return (
    <section className="solve-demo" aria-label={t('demo.kicker')}>
      <div className="solve-head">
        <span className="tile">
          <Icon name="spark" size={16} />
        </span>
        {t('demo.kicker')}
      </div>
      <div ref={board} className="solution board">
        <MathMorph tex={stageTex} />
        <ol className="steps">
          <li className="step step-exercise">
            <span className="step-no">
              <Icon name="image" size={16} />
            </span>
            <div className="step-body">
              <span className="demo-label">{t('demo.exercise')}</span>
              <MathText text={EXERCISE} words />
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
        {visible > FINAL_STEP && <FunctionGraph source={FUNCTION} label={t('demo.graph')} />}
        {visible > FINAL_STEP && <AnswerCheckLine plot={FUNCTION} finalLine={steps[FINAL_STEP].math} />}
      </div>
      <p className="solve-note">{t('demo.note')}</p>
    </section>
  );
}
