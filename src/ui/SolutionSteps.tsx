import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mainMath } from '../core/morph';
import { splitSolution } from '../core/solution';
import { useI18n } from '../i18n';
import { AnswerCheckLine, FunctionGraph, MathMorph, writeBoard } from './Board';
import { Icon } from './Icon';
import { MathText } from './MathText';

/**
 * A worked solution on a dark board, in the style of animated math videos. At the top, the main
 * equation transforms from one step to the next; below, each step is written symbol by symbol. When
 * the model named the function behind the exercise, its graph is drawn last with the answers marked,
 * and this device checks those answers by itself. An answer without steps is shown as plain text, so
 * a model that ignores the format is still readable.
 */
export const SolutionSteps = memo(function SolutionSteps({ text, plot = null }: { text: string; plot?: string | null }) {
  const { t } = useI18n();
  const lines = useMemo(() => splitSolution(text), [text]);
  const equations = useMemo(() => lines.map((line) => mainMath(line.text)), [lines]);
  const [run, setRun] = useState(0);
  const [showAll, setShowAll] = useState(false);
  // The step whose equation is on the stage; -1 before the first one is written.
  const [stage, setStage] = useState(-1);
  const [starts, setStarts] = useState<number[]>([]);
  const board = useRef<HTMLDivElement>(null);

  // Before the first paint, so nothing flashes fully written and then disappears.
  useLayoutEffect(() => {
    if (!board.current) return;
    setStarts(writeBoard(board.current, true).starts);
  }, [run, lines]);

  // The stage follows the writing: each step's equation arrives when that step starts.
  useEffect(() => {
    const lastWithMath = equations.reduce((found, eq, i) => (eq ? i : found), -1);
    if (showAll || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setStage(lastWithMath);
      return;
    }
    setStage(-1);
    const timers = starts.flatMap((start, i) =>
      equations[i] ? [window.setTimeout(() => setStage(i), start * 1000 + 150)] : [],
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [starts, equations, showAll]);

  if (lines.length === 0) return <MathText text={text} />;

  const last = lines.length - 1;
  const onStage = stage >= 0 ? equations[stage] : null;

  function replay() {
    setShowAll(false);
    setRun((n) => n + 1);
  }

  return (
    // Changing `run` remounts the board, which starts the writing again.
    <div ref={board} className={showAll ? 'solution board shown' : 'solution board'} key={run}>
      {equations.some(Boolean) && (onStage ? <MathMorph tex={onStage} /> : <div className="morph" aria-hidden="true" />)}
      <ol className="steps" aria-label={t('solution.label')}>
        {lines.map((line, i) => (
          <li key={i} className={i === last ? 'step step-final' : 'step'}>
            {/* Numbered here, in order: a model's own numbers can repeat or skip around an introduction. */}
            <span className="step-no">{i === last ? <Icon name="check" size={16} /> : i + 1}</span>
            <div className="step-body">
              <MathText text={line.text} words />
            </div>
          </li>
        ))}
      </ol>
      {plot && <FunctionGraph source={plot} label={t('solution.graph', { f: plot })} />}
      {plot && <AnswerCheckLine plot={plot} finalLine={lines[last].text} />}
      <div className="solution-bar">
        <span className="solution-progress" aria-hidden="true" />
        <div className="solution-actions">
          <button className="text-link" onClick={replay}>
            <Icon name="replay" size={16} />
            {t('solution.replay')}
          </button>
          <button className="text-link" onClick={() => setShowAll(true)} disabled={showAll}>
            {t('solution.showAll')}
          </button>
        </div>
      </div>
    </div>
  );
});
