import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../core/db';
import { addBellmanSample, loadSampleLibrary } from '../core/samples';
import { useI18n } from '../i18n';
import { EngineBadge, NoteRow } from './common';
import { Icon } from './Icon';
import { go } from './router';

function Leaves() {
  return (
    <svg className="leaves" viewBox="0 0 160 120" aria-hidden="true">
      <path d="M158 6C118 14 86 34 60 70" fill="none" stroke="#6f7f55" strokeWidth="2" />
      <path d="M128 20c-4-13-16-18-30-16 2 13 14 21 30 16Z" fill="#7d9163" />
      <path d="M106 34c8-12 22-13 34-8-6 12-20 16-34 8Z" fill="#94a677" />
      <path d="M92 44c-6-12-18-15-31-11 4 13 17 19 31 11Z" fill="#6f8558" />
      <path d="M76 58c9-10 22-9 33-2-8 11-22 13-33 2Z" fill="#8a9d6d" />
      <path d="M62 68c-8-10-20-11-31-5 6 11 20 14 31 5Z" fill="#7d9163" />
    </svg>
  );
}

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
      <Leaves />
      <header className="home-head">
        <h1 className="wordmark wordmark-lg">
          al<span>Rato</span>
        </h1>
        <div className="home-engine">
          <EngineBadge />
        </div>
      </header>

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
          {captures.slice(0, 5).map((capture) => (
            <NoteRow key={capture.id} capture={capture} />
          ))}
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
