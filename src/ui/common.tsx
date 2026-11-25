import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { getCloudConsent, subscribeConsent } from '../core/consent';
import { isCloudConfigured } from '../firebase/app';
import type { Capture, Receipt } from '../core/types';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { useBlobUrl, useDevice, useOnline } from './hooks';
import { Icon, type IconName } from './Icon';
import { go, goBack, usePath } from './router';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function EngineBadge() {
  const { t } = useI18n();
  const device = useDevice();
  const online = useOnline();
  const consent = useSyncExternalStore(subscribeConsent, getCloudConsent);
  let tone = 'cloud';
  let icon: IconName = 'cloud';
  let label: string = t('engine.cloud');

  if (device.text === 'ready') {
    tone = 'device';
    icon = 'device';
    label = t('engine.ready');
  } else if (device.text === 'downloading') {
    tone = 'pending';
    icon = 'download';
    label = `${t('engine.downloading')}${device.progress !== null ? ` ${Math.round(device.progress * 100)}%` : ''}`;
  } else if (!online) {
    tone = 'pending';
    icon = 'offline';
    label = t('engine.offline');
  } else if (!isCloudConfigured) {
    tone = 'pending';
    icon = 'alert';
    label = t('engine.none');
  } else if (consent === 'declined') {
    tone = 'pending';
    icon = 'lock';
    label = t('engine.cloudOff');
  }
  return (
    <button className={`engine engine-${tone}`} onClick={() => go('/ai')}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
}

const NAV: { path: string; label: MessageKey; icon: IconName }[] = [
  { path: '/', label: 'nav.home', icon: 'home' },
  { path: '/capture', label: 'nav.capture', icon: 'camera' },
  { path: '/library', label: 'nav.library', icon: 'folder' },
  { path: '/ai', label: 'nav.ai', icon: 'chip' },
];

function isActive(current: string, path: string) {
  return path === '/' ? current === '/' : current.startsWith(path);
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const path = usePath();
  return (
    <div className="shell">
      <aside className="rail">
        <button className="wordmark" onClick={() => go('/')}>
          al<span>Rato</span>
        </button>
        <nav aria-label={t('nav.main')}>
          {NAV.map((item) => (
            <button key={item.path} className={isActive(path, item.path) ? 'active' : ''} onClick={() => go(item.path)}>
              <Icon name={item.icon} />
              {t(item.label)}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <EngineBadge />
        </div>
      </aside>
      <main className="main">{children}</main>
      <nav className="tabbar" aria-label={t('nav.main')}>
        {NAV.map((item) => (
          <button key={item.path} className={isActive(path, item.path) ? 'active' : ''} onClick={() => go(item.path)}>
            <Icon name={item.icon} size={24} />
            <span>{t(item.label)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function TopBar({ title, right }: { title: string; right?: ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="topbar">
      <button className="icon-btn" aria-label={t('common.back')} onClick={() => goBack()}>
        <Icon name="back" />
      </button>
      <h1>{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

export function Thumb({ capture }: { capture: Pick<Capture, 'id' | 'thumb' | 'title'> }) {
  const url = useBlobUrl(capture.thumb, capture.id);
  return <div className="thumb">{url && <img src={url} alt="" loading="lazy" />}</div>;
}

export function NoteRow({ capture }: { capture: Capture }) {
  const { t } = useI18n();
  const waiting = capture.status === 'queued' || capture.status === 'processing';
  return (
    <button className="note-row" onClick={() => go(`/note/${capture.id}`)}>
      <Thumb capture={capture} />
      <span className="note-row-body">
        <strong>{capture.title || t('detail.untitled')}</strong>
        <span className="note-row-meta">
          {capture.isPrivate && (
            <span className="tag tag-private">
              <Icon name="lock" size={13} />
              {t('detail.privateBadge')}
            </span>
          )}
          {waiting && <span className="tag tag-wait">{t('detail.pending')}</span>}
          {capture.status === 'failed' && <span className="tag tag-fail">{t('detail.failed')}</span>}
          {!waiting && capture.status !== 'failed' && <span className="tag">{t(`kind.${capture.kind}`)}</span>}
        </span>
      </span>
      <Icon name="next" size={20} />
    </button>
  );
}

/** Proof of where an answer ran. The source comes from the SDK response. */
export function ReceiptLine({ receipt }: { receipt: Receipt }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const onDevice = receipt.source === 'on_device';
  return (
    <div className={`receipt ${onDevice ? 'receipt-device' : 'receipt-cloud'}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} title={t('receipt.why')}>
        <Icon name={onDevice ? 'check' : 'cloud'} size={15} />
        <strong>{onDevice ? t('receipt.device') : t('receipt.cloud')}</strong>
        <span>
          {onDevice
            ? t('receipt.nothingSent')
            : `${t('receipt.sent', { size: formatBytes(receipt.bytesSent) })} · ${receipt.imageSent ? t('receipt.photoSent') : t('receipt.textOnly')}`}
          {' · '}
          {formatSeconds(receipt.latencyMs)}
        </span>
      </button>
      {open && (
        <p>
          {t(`reason.${receipt.reason}`)} <code>{receipt.model}</code>
        </p>
      )}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={34} />
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}
