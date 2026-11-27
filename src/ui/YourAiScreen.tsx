import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { setupDeviceModel } from '../ai/engine';
import { SYNC_ENABLED_KEY, SYNC_OUTBOX_KEY, type CloudDelete } from '../core/captures';
import { getCloudConsent, openConsentPrompt, setCloudConsent, subscribeConsent } from '../core/consent';
import { db, kvGet } from '../core/db';
import { getPreference, getTheme, setPreference, setTheme, type Theme } from '../core/settings';
import type { Lang, RoutePreference } from '../core/types';
import { isCloudConfigured, isFirebaseConfigured } from '../firebase/app';
import { authState, preloadAuth, signIn, signOutAccount, subscribeAuth, type SignInResult } from '../firebase/auth';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { AgentRolesCard, LearnedCard } from './AgentCards';
import { formatBytes } from './common';
import { useDevice } from './hooks';
import { Icon } from './Icon';
import { LocalModelCard } from './LocalModelCard';
import { go } from './router';

const PREFERENCES: RoutePreference[] = ['balanced', 'local', 'quality'];

type SyncModule = typeof import('../firebase/sync');

const SIGN_IN_ERRORS: Partial<Record<SignInResult, MessageKey>> = {
  network: 'sync.error.network',
  unauthorized_domain: 'sync.error.domain',
  failed: 'sync.error.failed',
};

function SyncPanel({ sync }: { sync: SyncModule }) {
  const { t } = useI18n();
  const auth = useSyncExternalStore(subscribeAuth, authState);
  const status = useSyncExternalStore(sync.subscribeSync, sync.syncStatus);
  const notes = useLiveQuery(() => db.captures.toArray(), []);
  const enabledFor = useLiveQuery(() => kvGet<string | null>(SYNC_ENABLED_KEY, null), []);
  const outbox = useLiveQuery(() => kvGet<CloudDelete[]>(SYNC_OUTBOX_KEY, []), []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);

  const account = auth.phase === 'signed_in' ? auth.account : null;
  const isOn = Boolean(account && enabledFor === account.uid);
  const library = notes ?? [];
  const syncable = library.filter(sync.isSyncable);
  const inSync = syncable.filter((note) => note.syncedAt === note.updatedAt).length;
  const privateNotes = library.filter((note) => note.isPrivate).length;
  const pendingDeletes = (outbox ?? []).filter((entry) => !account || entry.uid === account.uid).length;

  async function run(action: () => Promise<void>, failure: MessageKey) {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await action();
    } catch {
      setProblem(failure);
    } finally {
      setBusy(false);
    }
  }

  async function onSignIn() {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    const result = await signIn();
    setProblem(SIGN_IN_ERRORS[result] ?? null);
    if (result !== 'redirecting') setBusy(false);
  }

  async function toggle(next: boolean) {
    if (next) {
      const toUpload = await sync.countToUpload();
      if (toUpload > 0 && !window.confirm(t('sync.confirm', { n: toUpload }))) return;
    }
    await run(() => (next ? sync.enableSync() : sync.disableSync()), 'sync.error.toggle');
  }

  async function wipeCloud() {
    if (!window.confirm(t('sync.deleteCloudConfirm'))) return;
    await run(async () => {
      await sync.deleteCloudCopy();
      setNotice('sync.deleteCloudDone');
    }, 'sync.deleteCloudFailed');
  }

  return (
    <section className="card stack-s">
      <div className="device-head">
        <span className={`device-dot ${isOn && status.phase === 'synced' ? 'dot-ready' : isOn ? 'dot-downloading' : ''}`} />
        <h2>{t('sync.title')}</h2>
      </div>
      <p>{t('sync.pitch')}</p>
      <p className="muted small">{t('sync.optIn')}</p>

      <div className="toggle-text">
        <strong>
          <Icon name="cloud" size={15} /> {t('sync.leavesTitle')}
        </strong>
        <small>{t('sync.leavesBody')}</small>
      </div>
      <div className="toggle-text">
        <strong>
          <Icon name="lock" size={15} /> {t('sync.staysTitle')}
        </strong>
        <small>{t('sync.staysBody')}</small>
      </div>

      {auth.phase === 'loading' && <p className="muted">{t('sync.loading')}</p>}

      {(auth.phase === 'idle' || auth.phase === 'signed_out') && (
        <>
          <button className="btn btn-primary" onClick={onSignIn} disabled={busy}>
            {busy ? t('sync.signingIn') : t('sync.signIn')}
          </button>
          <p className="muted small">{t('sync.signInHint')}</p>
          {pendingDeletes > 0 && (
            <p className="form-error" role="status">
              {t('sync.pendingDeletes', { n: pendingDeletes })}
            </p>
          )}
        </>
      )}

      {account && (
        <>
          <p className="small">{account.email ? t('sync.signedIn', { account: account.email }) : t('sync.signedInNoEmail')}</p>
          <label className="toggle">
            <input type="checkbox" checked={isOn} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
            <span className="toggle-track" aria-hidden="true" />
            <span className="toggle-text">
              <strong>{t('sync.toggle')}</strong>
              <small>{t('sync.toggleHint')}</small>
            </span>
          </label>

          {status.stoppedElsewhere && !isOn && (
            <p className="form-error" role="status">
              {t('sync.stoppedElsewhere')}
            </p>
          )}

          <p className="muted small" role="status">
            {t(`sync.state.${isOn ? status.phase : 'off'}` as MessageKey)}
          </p>

          {isOn && (
            <dl className="stats">
              <div>
                <dt>{t('sync.statSynced')}</dt>
                <dd>{inSync}</dd>
              </div>
              <div>
                <dt>{t('sync.statWaiting')}</dt>
                <dd>{syncable.length - inSync}</dd>
              </div>
              <div>
                <dt>{t('sync.statPrivate')}</dt>
                <dd>{privateNotes}</dd>
              </div>
            </dl>
          )}
          {isOn && status.tooLarge > 0 && <p className="form-error">{t('sync.tooLarge', { n: status.tooLarge })}</p>}

          <div className="row-end">
            <button className="btn btn-danger" onClick={wipeCloud} disabled={busy}>
              <Icon name="trash" />
              {t('sync.deleteCloud')}
            </button>
            <button className="btn btn-ghost" onClick={() => run(signOutAccount, 'sync.error.failed')} disabled={busy}>
              {t('sync.signOut')}
            </button>
          </div>
        </>
      )}

      {notice && (
        <p className="muted small" role="status">
          {t(notice)}
        </p>
      )}
      {problem && (
        <p className="form-error" role="alert">
          {t(problem)}
        </p>
      )}
    </section>
  );
}

/** The sync code and the Firebase SDKs it needs load only when this card appears. */
function SyncCard() {
  const { t } = useI18n();
  const [sync, setSync] = useState<SyncModule | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    preloadAuth();
    import('../firebase/sync')
      .then((module) => {
        module.initSync();
        if (alive) setSync(module);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (sync) return <SyncPanel sync={sync} />;
  return (
    <section className="card stack-s">
      <h2>{t('sync.title')}</h2>
      <p className="muted">{failed ? t('sync.unavailable') : t('sync.loading')}</p>
    </section>
  );
}

/** The student's standing decision about cloud AI, which they can change at any time. */
function CloudCard() {
  const { t } = useI18n();
  const consent = useSyncExternalStore(subscribeConsent, getCloudConsent);
  return (
    <section className="card stack-s">
      <div className="device-head">
        <span className={`device-dot ${consent === 'granted' ? 'dot-ready' : ''}`} />
        <h2>{t('ai.cloudTitle')}</h2>
      </div>
      <p>{t(`ai.cloud.${consent}`)}</p>
      {consent === 'granted' ? (
        <button className="btn btn-ghost" onClick={() => setCloudConsent('declined')}>
          <Icon name="lock" />
          {t('ai.cloudOff')}
        </button>
      ) : (
        <button className="btn btn-primary" onClick={openConsentPrompt}>
          <Icon name="cloud" />
          {t('ai.cloudReview')}
        </button>
      )}
    </section>
  );
}

export function YourAiScreen() {
  const { t, lang, setLang } = useI18n();
  const device = useDevice();
  const [preference, setPref] = useState<RoutePreference>(getPreference);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const usage = useLiveQuery(() => db.usage.toArray(), []);

  const onDevice = usage?.filter((u) => u.source === 'on_device').length ?? 0;
  const inCloud = usage?.filter((u) => u.source === 'in_cloud').length ?? 0;
  const kept = usage?.reduce((sum, u) => sum + u.bytesKept, 0) ?? 0;
  const total = onDevice + inCloud;

  async function download() {
    setDownloadFailed(false);
    try {
      await setupDeviceModel();
    } catch {
      setDownloadFailed(true);
    }
  }

  function choose(next: RoutePreference) {
    setPreference(next);
    setPref(next);
  }

  async function eraseAll() {
    const syncIsOn = isFirebaseConfigured && Boolean(await kvGet<string | null>(SYNC_ENABLED_KEY, null));
    if (!window.confirm(t(syncIsOn ? 'ai.clearConfirmSync' : 'ai.clearConfirm'))) return;
    if (syncIsOn) {
      const { afterLocalErase } = await import('../firebase/sync');
      await afterLocalErase();
    }
    await Promise.all([db.captures.clear(), db.aids.clear(), db.cards.clear(), db.usage.clear()]);
    go('/');
  }

  return (
    <div className="stack page-narrow">
      <div>
        <h1 className="page-title">{t('ai.title')}</h1>
        <p className="muted">{t('ai.intro')}</p>
      </div>

      <section className="card stack-s">
        <div className="device-head">
          <span className={`device-dot dot-${device.text}`} />
          <h2>{t('ai.deviceTitle')}</h2>
        </div>
        <p>{t(`ai.state.${device.text}` as MessageKey)}</p>
        {device.text === 'downloading' && device.progress !== null && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(device.progress * 100)}>
            <span style={{ width: `${device.progress * 100}%` }} />
          </div>
        )}
        {device.text === 'downloadable' && (
          <button className="btn btn-primary" onClick={download}>
            <Icon name="download" />
            {t('ai.download')}
          </button>
        )}
        {downloadFailed && (
          <p className="form-error" role="alert">
            {t('ai.downloadFailed')}
          </p>
        )}
      </section>

      {/* Without Gemini Nano (phones, and browsers without it), the phone's own model can take the hints. */}
      {device.text !== 'ready' && <LocalModelCard />}

      <AgentRolesCard />
      <LearnedCard />

      {isCloudConfigured && <CloudCard />}

      <section className="stack-s">
        <h2 className="section-title">{t('ai.prefTitle')}</h2>
        <div className="choices" role="radiogroup" aria-label={t('ai.prefTitle')}>
          {PREFERENCES.map((option) => (
            <button key={option} role="radio" aria-checked={preference === option} className={preference === option ? 'choice active' : 'choice'} onClick={() => choose(option)}>
              <strong>{t(`ai.pref.${option}`)}</strong>
              <small>{t(`ai.pref.${option}Hint` as MessageKey)}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="card stack-s">
        <h2>{t('ai.statsTitle')}</h2>
        {total === 0 ? (
          <p className="muted">{t('ai.statEmpty')}</p>
        ) : (
          <>
            <div className="split-bar" aria-hidden="true">
              <span className="split-device" style={{ width: `${(onDevice / total) * 100}%` }} />
              <span className="split-cloud" style={{ width: `${(inCloud / total) * 100}%` }} />
            </div>
            <dl className="stats">
              <div>
                <dt>{t('ai.statDevice')}</dt>
                <dd>{onDevice}</dd>
              </div>
              <div>
                <dt>{t('ai.statCloud')}</dt>
                <dd>{inCloud}</dd>
              </div>
              <div>
                <dt>{t('ai.statKept')}</dt>
                <dd>{formatBytes(kept)}</dd>
              </div>
            </dl>
          </>
        )}
        <p className="muted small">{t('ai.privacy')}</p>
      </section>

      {isFirebaseConfigured && <SyncCard />}

      <section className="card stack-s">
        <h2>{t('ai.languageTitle')}</h2>
        <div className="segmented" role="radiogroup" aria-label={t('ai.languageTitle')}>
          {(['en', 'es'] as Lang[]).map((code) => (
            <button key={code} role="radio" aria-checked={lang === code} className={lang === code ? 'active' : ''} onClick={() => setLang(code)}>
              {code === 'en' ? 'English' : 'Español'}
            </button>
          ))}
        </div>
      </section>

      <section className="card stack-s">
        <h2>{t('ai.themeTitle')}</h2>
        <div className="segmented" role="radiogroup" aria-label={t('ai.themeTitle')}>
          {(['light', 'dark'] as Theme[]).map((option) => (
            <button
              key={option}
              role="radio"
              aria-checked={theme === option}
              className={theme === option ? 'active' : ''}
              onClick={() => {
                setTheme(option);
                setThemeState(option);
              }}
            >
              {option === 'dark' ? t('ai.themeDark') : t('ai.themeLight')}
            </button>
          ))}
        </div>
      </section>

      <section className="card stack-s">
        <h2>{t('ai.dataTitle')}</h2>
        <p className="muted">{t('ai.dataBody')}</p>
        <button className="btn btn-danger" onClick={eraseAll}>
          <Icon name="trash" />
          {t('ai.clear')}
        </button>
      </section>
    </div>
  );
}
