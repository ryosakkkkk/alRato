import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AlRatoAiError, WaitForRoute } from '../ai/errors';
import { actionFor, MAX_LEVEL, requestHelp } from '../ai/help';
import { addCard, deleteCapture, editLabels, editText, retryCapture, setPrivate } from '../core/captures';
import { getCloudConsent, openConsentPrompt, subscribeConsent } from '../core/consent';
import { db } from '../core/db';
import type { Capture, NoteKind, StudyAid, WaitReason } from '../core/types';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { Empty, ReceiptLine, Thumb, TopBar } from './common';
import { useBlobUrl, useDevice } from './hooks';
import { Icon, type IconName } from './Icon';
import { MathText } from './MathText';
import { go, goBack } from './router';
import { Sheet } from './Sheet';

const KINDS: NoteKind[] = ['board', 'formula', 'exercise', 'question', 'other'];

const isConsentWait = (reason: WaitReason | null | undefined): boolean =>
  reason === 'needs_consent' || reason === 'cloud_declined';

function Banner({ tone, icon, title, children }: { tone: string; icon: IconName; title?: string; children?: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role="status">
      <Icon name={icon} size={22} />
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

function StatusBanner({ capture }: { capture: Capture }) {
  const { t } = useI18n();
  switch (capture.status) {
    case 'processing':
      return <Banner tone="busy" icon="spark" title={capture.text ? t('detail.processing') : t('detail.reading')} />;
    case 'queued':
      return (
        <Banner tone="wait" icon="clock" title={t('detail.pending')}>
          <p>
            {capture.waitReason
              ? t(`wait.${capture.waitReason}`)
              : capture.errorCode
                ? t(`error.${capture.errorCode}` as MessageKey)
                : t('detail.queued')}
          </p>
          {isConsentWait(capture.waitReason) && (
            <button className="text-link" onClick={openConsentPrompt}>
              {t('wait.review')}
            </button>
          )}
          {capture.waitReason === 'private_needs_device' && (
            <button className="text-link" onClick={() => setPrivate(capture.id, false)}>
              {t('detail.makeShared')}
            </button>
          )}
        </Banner>
      );
    case 'failed':
      return (
        <Banner tone="fail" icon="alert" title={t('detail.failed')}>
          <p>
            {t(`error.${capture.errorCode ?? 'unknown'}` as MessageKey)} {t('detail.failedSafe')}
          </p>
          <button className="btn btn-small btn-retry" onClick={() => retryCapture(capture.id)}>
            {t('common.retry')}
          </button>
        </Banner>
      );
    case 'needs_review':
      return <Banner tone="wait" icon="edit" title={t('detail.needsReview')} />;
    default:
      return null;
  }
}

function TextPanel({ capture }: { capture: Capture }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [comment, setComment] = useState('');

  function start() {
    setDraft(capture.text);
    setComment(capture.comment);
    setEditing(true);
  }

  async function save() {
    await editText(capture.id, draft.trim(), comment.trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <section className="card stack-s">
        <label className="field">
          <span>{t('detail.text')}</span>
          <textarea value={draft} rows={7} autoFocus onChange={(e) => setDraft(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('detail.comment')}</span>
          <input value={comment} maxLength={200} placeholder={t('capture.contextHint')} onChange={(e) => setComment(e.target.value)} />
        </label>
        <div className="row-end">
          <button className="btn btn-ghost" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={save}>
            {t('common.save')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('detail.text')}</h2>
        <button className="icon-btn" aria-label={t('detail.editText')} title={t('detail.editText')} onClick={start}>
          <Icon name="edit" size={19} />
        </button>
      </div>
      {capture.text ? (
        <MathText text={capture.text} />
      ) : (
        <>
          <p className="muted">{t('detail.textEmpty')}</p>
          <button className="text-link" onClick={start}>
            {t('detail.typeText')}
          </button>
        </>
      )}
      {capture.comment && <p className="comment">“{capture.comment}”</p>}
    </section>
  );
}

function LabelsSheet({ capture, open, onClose }: { capture: Capture; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(capture.title);
  const [subject, setSubject] = useState(capture.subject);
  const [topic, setTopic] = useState(capture.topic);
  const [kind, setKind] = useState<NoteKind>(capture.kind);

  async function save() {
    await editLabels(capture.id, { title: title.trim(), subject: subject.trim(), topic: topic.trim(), kind });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('detail.labels')}>
      <label className="field">
        <span>{t('detail.titleField')}</span>
        <input value={title} maxLength={70} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('detail.subjectField')}</span>
        <input value={subject} maxLength={50} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('detail.topicField')}</span>
        <input value={topic} maxLength={60} onChange={(e) => setTopic(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('detail.kindField')}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="row-end">
        <button className="btn btn-ghost" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary" onClick={save}>
          {t('common.save')}
        </button>
      </div>
    </Sheet>
  );
}

function LinkCard({ link }: { link: NonNullable<StudyAid['link']> }) {
  const { t } = useI18n();
  const note = useLiveQuery(() => db.captures.get(link.captureId), [link.captureId]);
  if (!note) return null;
  return (
    <div className="link-card">
      <h3>
        <Icon name="link" size={20} />
        {t('link.title')}
      </h3>
      <button className="link-note" onClick={() => go(`/note/${note.id}`)}>
        <Thumb capture={note} />
        <span>
          <strong>{note.title}</strong>
          <span className="text-link">
            {t('link.open')} <Icon name="open" size={15} />
          </span>
        </span>
      </button>
      <MathText text={link.why} />
    </div>
  );
}

function AidCard({ aid, isLadder, showLink }: { aid: StudyAid; isLadder: boolean; showLink: boolean }) {
  const { t } = useI18n();
  return (
    <article className="aid">
      <h3>
        <Icon name="spark" size={18} />
        {isLadder ? t(`ladder.${aid.level}` as MessageKey) : t(`action.${aid.action}`)}
      </h3>
      <MathText text={aid.body} />
      {showLink && aid.link && <LinkCard link={aid.link} />}
      <ReceiptLine receipt={aid.receipt} />
    </article>
  );
}

function HelpPanel({ capture }: { capture: Capture }) {
  const { t } = useI18n();
  const device = useDevice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const consent = useSyncExternalStore(subscribeConsent, getCloudConsent);
  const askAgain = useRef<() => void>(() => undefined);
  const aids = useLiveQuery(
    () => db.aids.where('[captureId+revision]').equals([capture.id, capture.revision]).sortBy('level'),
    [capture.id, capture.revision],
  );

  // The student asked for help, then agreed to the cloud: finish what they asked for.
  useEffect(() => {
    if (needsConsent && consent === 'granted') askAgain.current();
  }, [needsConsent, consent]);

  if (!aids) return null;

  const usable = capture.text.trim() && ['ready', 'needs_review', 'failed'].includes(capture.status);
  if (!usable) return null;

  const action = actionFor(capture.kind);
  const isLadder = action === 'hint';
  const nextLevel = aids.length + 1;
  const canAsk = isLadder ? nextLevel <= MAX_LEVEL : aids.length === 0;
  const latest = aids.at(-1);

  async function ask() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNeedsConsent(false);
    try {
      await requestHelp(capture.id, nextLevel);
    } catch (e) {
      if (e instanceof WaitForRoute && isConsentWait(e.reason)) setNeedsConsent(true);
      else if (e instanceof WaitForRoute) setError(t(`wait.${e.reason}`));
      else if (e instanceof AlRatoAiError) setError(t(`error.${e.failure}` as MessageKey));
      else setError(t('error.unknown'));
    } finally {
      setBusy(false);
    }
  }
  askAgain.current = () => void ask();

  const problem = needsConsent ? t(consent === 'declined' ? 'wait.cloud_declined' : 'wait.needs_consent') : error;

  async function practice() {
    if (!latest?.practice) return;
    const card = await addCard(capture.id, latest.practice.question, latest.practice.answer);
    go(`/practice/${card.id}`);
  }

  const askLabel =
    aids.length === 0 ? t(`action.${action}`) : nextLevel === MAX_LEVEL ? t('ladder.reveal') : t('ladder.next');

  // The model can cite the same note on every hint. Show each connection once, on the newest.
  const newestWithLink = new Map<string, string>();
  for (const aid of aids) if (aid.link) newestWithLink.set(aid.link.captureId, aid.id);

  return (
    <section className="stack-s" aria-live="polite">
      {isLadder && aids.length === 0 && <p className="muted center">{t('ladder.intro')}</p>}
      {aids.map((aid) => (
        <AidCard
          key={aid.id}
          aid={aid}
          isLadder={isLadder}
          showLink={Boolean(aid.link) && newestWithLink.get(aid.link!.captureId) === aid.id}
        />
      ))}
      {problem && (
        <p className="form-error" role="alert">
          {problem}{' '}
          {needsConsent && (
            <button className="text-link" onClick={openConsentPrompt}>
              {t('wait.review')}
            </button>
          )}
        </p>
      )}
      {canAsk && (
        <button className={`btn btn-wide ${aids.length === 0 ? 'btn-primary' : 'btn-ghost'}`} onClick={ask} disabled={busy}>
          <Icon name="spark" />
          {busy ? (device.text === 'ready' ? t('detail.thinkingDevice') : t('detail.thinking')) : askLabel}
        </button>
      )}
      {(capture.kind === 'board' || capture.kind === 'other' || capture.kind === 'formula') && aids.length === 0 && (
        // The model may file a problem as a board, or as a formula. One tap fixes it before hints start.
        <button className="text-link center" onClick={() => editLabels(capture.id, { kind: 'exercise' })}>
          {t('detail.asExercise')}
        </button>
      )}
      {latest?.practice && (
        <button className="btn btn-primary btn-wide" onClick={practice}>
          <Icon name="play" />
          {t('practice.button')}
        </button>
      )}
    </section>
  );
}

export function DetailScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const capture = useLiveQuery(async () => (await db.captures.get(id)) ?? null, [id]);
  const photo = useBlobUrl(capture?.image, id);
  const [menu, setMenu] = useState(false);
  const [labels, setLabels] = useState(false);
  const [viewer, setViewer] = useState(false);

  if (capture === undefined) return <div className="skeleton" />;
  if (capture === null) {
    return (
      <div className="stack">
        <TopBar title="" />
        <Empty icon="folder" title={t('detail.notFound')}>
          <button className="btn btn-primary" onClick={() => go('/library')}>
            {t('detail.toLibrary')}
          </button>
        </Empty>
      </div>
    );
  }

  const title = capture.title || t('detail.untitled');

  async function remove() {
    if (!window.confirm(t('detail.deleteConfirm'))) return;
    await deleteCapture(capture!.id);
    goBack('/library');
  }

  return (
    <div className="stack">
      <TopBar
        title={title}
        right={
          <button className="icon-btn" aria-label={t('common.more')} onClick={() => setMenu(true)}>
            <Icon name="more" />
          </button>
        }
      />

      <div className="detail-grid">
        <div className="detail-photo">
          <button className="photo" onClick={() => setViewer(true)}>
            {photo && <img src={photo} alt={t('detail.photoAlt', { title })} />}
          </button>
          <div className="chips">
            {capture.analyzedRevision > 0 && <span className="chip chip-kind">{t(`kind.${capture.kind}`)}</span>}
            {capture.subject && <span className="chip">{capture.subject}</span>}
            {capture.topic && capture.topic !== capture.title && <span className="chip">{capture.topic}</span>}
            {capture.isPrivate && (
              <span className="chip chip-private">
                <Icon name="lock" size={13} /> {t('detail.privateBadge')}
              </span>
            )}
            {capture.isSample && <span className="chip">{t('common.sample')}</span>}
          </div>
        </div>

        <div className="stack">
          <StatusBanner capture={capture} />
          <TextPanel key={capture.revision} capture={capture} />
          <HelpPanel capture={capture} />
          {capture.receipts.length > 0 && (
            <div className="receipts">
              {capture.receipts.slice(-2).map((receipt) => (
                <ReceiptLine key={receipt.at} receipt={receipt} />
              ))}
            </div>
          )}
        </div>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={title}>
        <div className="menu">
          <button
            onClick={() => {
              setMenu(false);
              setLabels(true);
            }}
          >
            <Icon name="edit" />
            {t('detail.labels')}
          </button>
          <button
            onClick={async () => {
              await setPrivate(capture.id, !capture.isPrivate);
              setMenu(false);
            }}
          >
            <Icon name={capture.isPrivate ? 'cloud' : 'lock'} />
            {capture.isPrivate ? t('detail.makeShared') : t('detail.makePrivate')}
          </button>
          <button className="danger" onClick={remove}>
            <Icon name="trash" />
            {t('detail.delete')}
          </button>
        </div>
      </Sheet>

      {labels && <LabelsSheet capture={capture} open={labels} onClose={() => setLabels(false)} />}

      <Sheet open={viewer} onClose={() => setViewer(false)} title={title}>
        {photo && <img className="viewer-img" src={photo} alt={t('detail.photoAlt', { title })} />}
        <div className="row-end">
          <button className="btn btn-ghost" onClick={() => setViewer(false)}>
            {t('common.back')}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
