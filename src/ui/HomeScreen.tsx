import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../core/db';
import { addBellmanSample, loadSampleLibrary } from '../core/samples';
import { useI18n } from '../i18n';
import { BrandMark } from './Brand';
import { EngineBadge, NoteRow } from './common';
import { Icon } from './Icon';
import { go } from './router';
import { SolveDemo } from './SolveDemo';

export function HomeScreen() {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const captures = useLiveQuery(() => db.captures.orderBy('createdAt').reverse().toArray(), []);
  const due = useLiveQuery(() => db.cards.where('dueAt').belowOrEqual(Date.now()).toArray(), []);

  if (!captures) return <div className="skeleton" />;

  // "Snap it now. Understand it" breaks after its first sentence, in any language.
  const tagline = t('home.tagline').split(/(?<=\.)\s+/);
  const byId = new Map(captures.map((c) => [c.id, c]));
  const dueCards = (due ?? []).filter((card) => byId.has(card.captureId));
  const waiting = captures.filter((c) => c.status === 'queued' || c.status === 'processing').length;
  const onlySeededNotes = captures.length > 0 && captures.every((c) => c.id.startsWith('sample-'));
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'home.morning' : hour < 19 ? 'home.afternoon' : 'home.evening');

  async function tryDemo() {
    setBusy(true);
    try {
      await loadSampleLibrary(lang);
    } finally {
      setBusy(false);
    }
  }

  async function addBoard() {
    setBusy(true);
    try {
      go(`/note/${await addBellmanSample(lang)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack home">
      <header className="home-head">
        <h1 className="wordmark wordmark-lg">
          <BrandMark size={56} />
          <span className="wordmark-text">
            al<span className="rato">Rato</span>
          </span>
        </h1>
        <div className="home-engine">
          <EngineBadge />
        </div>
      </header>

      {captures.length > 0 && <h2 className="display-title">{greeting}</h2>}

      {captures.length === 0 && (
        <section className="hero">
          <h2>
            {tagline.slice(0, -1).join(' ')}
            <br />
            {tagline.at(-1)} <em>{t('home.taglineEnd')}</em>
          </h2>
          <p>{t('home.pitch')}</p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => go('/capture')}>
              <Icon name="camera" />
              {t('home.capture')}
            </button>
            <button className="btn btn-ghost" onClick={tryDemo} disabled={busy}>
              <Icon name="spark" />
              {t('home.tryDemo')}
            </button>
          </div>
          <SolveDemo />
          <ol className="how">
            <li>{t('home.how1')}</li>
            <li>{t('home.how2')}</li>
            <li>{t('home.how3')}</li>
          </ol>
          <p className="hero-note">{t('home.meaning')}</p>
        </section>
      )}

      {onlySeededNotes && (
        <section className="callout">
          <p>{t('home.demoNext')}</p>
          <button className="btn btn-primary" onClick={addBoard} disabled={busy}>
            <Icon name="spark" />
            {t('home.demoAdd')}
          </button>
        </section>
      )}

      {waiting > 0 && (
        <button className="waiting" onClick={() => go('/library')}>
          <Icon name="clock" size={18} />
          {waiting === 1 ? t('home.waitingOne') : t('home.waitingMany', { n: waiting })}
        </button>
      )}

      {dueCards.length > 0 && (
        <section className="stack-s">
          <h2 className="section-title">{t('home.toReview')}</h2>
          {dueCards.slice(0, 3).map((card) => (
            <button key={card.id} className="review-row" onClick={() => go(`/practice/${card.id}`)}>
              <span className="review-icon">
                <Icon name="book" />
              </span>
              <span className="note-row-body">
                <strong>{byId.get(card.captureId)?.title}</strong>
                <span className="note-row-meta">
                  <span className="tag tag-due">{t('home.reviewDue')}</span>
                </span>
              </span>
              <Icon name="next" size={20} />
            </button>
          ))}
        </section>
      )}

      {captures.length > 0 && (
        <section className="stack-s">
          <h2 className="section-title">{t('home.latest')}</h2>
          <div className="note-grid featured">
            {captures.slice(0, 5).map((capture) => (
              <NoteRow key={capture.id} capture={capture} />
            ))}
          </div>
        </section>
      )}

      {captures.length > 0 && (
        <button className="btn btn-primary btn-wide" onClick={() => go('/capture')}>
          <Icon name="camera" />
          {t('home.capture')}
        </button>
      )}
    </div>
  );
}
