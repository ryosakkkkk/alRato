import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { splitSolution } from '../core/solution';
import { useI18n } from '../i18n';
import { FunctionGraph, writeBoard } from './Board';
import { Icon } from './Icon';
import { MathText } from './MathText';

/**
 * A worked solution written on a dark board, symbol by symbol and step by step, like the math
 * videos. When the model named the function behind the exercise, its graph is drawn last with the
 * answers marked. An answer without steps is shown as plain text, so a model that ignores the
 * format is still readable.
 */
export const SolutionSteps = memo(function SolutionSteps({ text, plot = null }: { text: string; plot?: string | null }) {
  const { t } = useI18n();
  const lines = useMemo(() => splitSolution(text), [text]);
  const [run, setRun] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const board = useRef<HTMLDivElement>(null);

  // Before the first paint, so nothing flashes fully written and then disappears.
  useLayoutEffect(() => {
    if (board.current) writeBoard(board.current, true);
  }, [run, lines]);

  if (lines.length === 0) return <MathText text={text} />;

  const last = lines.length - 1;

  function replay() {
    setShowAll(false);
    setRun((n) => n + 1);
  }

  return (
    // Changing `run` remounts the board, which starts the writing again.
    <div ref={board} className={showAll ? 'solution board shown' : 'solution board'} key={run}>
      <ol className="steps" aria-label={t('solution.label')}>
        {lines.map((line, i) => (
          <li key={i} className={i === last ? 'step step-final' : 'step'}>
            <span className="step-no">{i === last ? <Icon name="check" size={16} /> : (line.n ?? i + 1)}</span>
            <div className="step-body">
              <MathText text={line.text} words />
            </div>
          </li>
        ))}
      </ol>
      {plot && <FunctionGraph source={plot} label={t('solution.graph', { f: plot })} />}
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
