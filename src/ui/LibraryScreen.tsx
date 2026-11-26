import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../core/db';
import { searchNotes } from '../core/retrieval';
import type { Capture, NoteKind } from '../core/types';
import { useI18n } from '../i18n';
import { Empty, NoteRow } from './common';
import { Icon } from './Icon';
import { go } from './router';

const KIND_ORDER: NoteKind[] = ['exercise', 'formula', 'board', 'question', 'other'];

export function LibraryScreen() {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<NoteKind | 'all'>('all');
  const captures = useLiveQuery(() => db.captures.orderBy('createdAt').reverse().toArray(), []);

  // Only the kinds the student actually has become filters.
  const kinds = useMemo(() => KIND_ORDER.filter((k) => (captures ?? []).some((c) => c.kind === k)), [captures]);
  const activeKind = kind !== 'all' && kinds.includes(kind) ? kind : 'all';

  const groups = useMemo(() => {
    const unsorted = t('library.unsorted');
    const bySubject = new Map<string, Capture[]>();
    for (const capture of searchNotes(query, captures ?? [])) {
      if (activeKind !== 'all' && capture.kind !== activeKind) continue;
      const subject = capture.subject || unsorted;
      bySubject.set(subject, [...(bySubject.get(subject) ?? []), capture]);
    }
    return [...bySubject.entries()].sort(([a], [b]) => {
      if (a === unsorted) return 1;
      if (b === unsorted) return -1;
      return a.localeCompare(b, lang);
    });
  }, [captures, query, activeKind, lang, t]);

  if (!captures) return <div className="skeleton" />;

  return (
    <div className="stack page-narrow">
      <h1 className="page-title">{t('library.title')}</h1>

      <label className="search">
        <Icon name="search" size={20} />
        <input
          type="search"
          value={query}
          placeholder={t('library.search')}
          aria-label={t('library.search')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {kinds.length > 1 && (
        <div className="filters" role="radiogroup" aria-label={t('library.filter')}>
          {(['all', ...kinds] as const).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={activeKind === k}
              className={activeKind === k ? 'filter active' : 'filter'}
              onClick={() => setKind(k)}
            >
              {k === 'all' ? t('library.all') : t(`filter.${k}`)}
            </button>
          ))}
        </div>
      )}

      {captures.length === 0 && (
        <Empty icon="folder" title={t('library.empty')}>
          <button className="btn btn-primary" onClick={() => go('/capture')}>
            <Icon name="camera" />
            {t('nav.capture')}
          </button>
        </Empty>
      )}

      {captures.length > 0 && groups.length === 0 && (
        <Empty icon="search" title={t('library.noResults', { q: query })}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setQuery('');
              setKind('all');
            }}
          >
            {t('library.clear')}
          </button>
        </Empty>
      )}

      {groups.map(([subject, notes]) => (
        <section key={subject} className="stack-s">
          <h2 className="group-title">
            <Icon name="folder" size={20} />
            {subject}
          </h2>
          <div className="note-grid">
            {notes.map((note) => (
              <NoteRow key={note.id} capture={note} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
