import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { rateCard } from '../core/captures';
import { db } from '../core/db';
import type { ReviewResult } from '../core/types';
import { useI18n } from '../i18n';
import { Empty, TopBar } from './common';
import { Icon } from './Icon';
import { MathText } from './MathText';
import { go } from './router';

export function PracticeScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const card = useLiveQuery(async () => (await db.cards.get(id)) ?? null, [id]);
  const note = useLiveQuery(async () => (card ? ((await db.captures.get(card.captureId)) ?? null) : null), [card?.captureId]);
  const [attempt, setAttempt] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [nextInDays, setNextInDays] = useState<number | null>(null);

  if (card === undefined) return <div className="skeleton" />;

  if (done) {
    return (
      <div className="stack">
        <TopBar title={t('practice.title')} />
        <Empty icon="check" title={t('practice.done')}>
          <p className="muted">
            {nextInDays === null
              ? t('practice.doneBody')
              : nextInDays === 1
                ? t('practice.nextOne')
                : t('practice.nextMany', { n: nextInDays })}
          </p>
          <button className="btn btn-primary" onClick={() => go('/')}>
            {t('practice.home')}
          </button>
        </Empty>
      </div>
    );
  }

  if (card === null) {
    return (
      <div className="stack">
        <TopBar title={t('practice.title')} />
        <Empty icon="book" title={t('practice.missing')}>
          <button className="btn btn-primary" onClick={() => go('/')}>
            {t('practice.home')}
          </button>
        </Empty>
      </div>
    );
  }

  async function rate(result: ReviewResult) {
    const days = await rateCard(id, result);
    const next = await db.cards
      .where('dueAt')
      .belowOrEqual(Date.now())
      .filter((c) => c.id !== id)
      .first();
    if (next) {
      go(`/practice/${next.id}`);
    } else {
      setNextInDays(days);
      setDone(true);
    }
  }

  return (
    <div className="stack practice">
      <TopBar title={revealed ? t('practice.result') : t('practice.title')} />

      <div className="question">
        <MathText text={card.question} />
      </div>

      {!revealed ? (
        <>
          <label className="field">
            <span className="sr-only">{t('practice.placeholder')}</span>
            <input value={attempt} placeholder={t('practice.placeholder')} autoFocus onChange={(e) => setAttempt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setRevealed(true)} />
          </label>
          <button className="btn btn-primary btn-wide" onClick={() => setRevealed(true)}>
            {t('practice.reveal')}
          </button>
        </>
      ) : (
        <>
          <div className="answer">
            <Icon name="check" size={26} />
            <MathText text={card.answer} />
          </div>
          {attempt.trim() && (
            <p className="muted center">
              {t('practice.yours')}: {attempt}
            </p>
          )}
          <button className="btn btn-primary btn-wide" onClick={() => rate('remembered')}>
            {t('practice.remembered')}
          </button>
          <button className="btn btn-ghost btn-wide" onClick={() => rate('needed_help')}>
            {t('practice.neededHelp')}
          </button>
        </>
      )}

      {note && (
        <button className="text-link center" onClick={() => go(`/note/${note.id}`)}>
          {t('practice.source')}: {note.title}
        </button>
      )}
    </div>
  );
}
