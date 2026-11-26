import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { getCloudConsent, subscribeConsent } from '../core/consent';
import { isCloudConfigured } from '../firebase/app';
import type { Capture, Receipt } from '../core/types';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { useBlobUrl, useDevice, useOnline } from './hooks';
import { BrandMark } from './Brand';
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

/** Each section has its own colour in the sidebar, so the menu reads at a glance. */
const NAV: { path: string; label: MessageKey; icon: IconName; tone: 'indigo' | 'cyan' | 'amber' | 'fuchsia' }[] = [
  { path: '/', label: 'nav.home', icon: 'home', tone: 'indigo' },
  { path: '/capture', label: 'nav.capture', icon: 'camera', tone: 'cyan' },
  { path: '/library', label: 'nav.library', icon: 'folder', tone: 'amber' },
  { path: '/ai', label: 'nav.ai', icon: 'chip', tone: 'fuchsia' },
];

/** The phone tab bar keeps three tabs; the camera is its own round button beside them. */
const TABS = NAV.filter((item) => item.path !== '/capture');

function isActive(current: string, path: string) {
  return path === '/' ? current === '/' : current.startsWith(path);
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const path = usePath();
  const activeTab = TABS.findIndex((item) => isActive(path, item.path));
  return (
    <div className="shell">
      <div className="aurora" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <aside className="rail">
        <button className="wordmark" onClick={() => go('/')}>
          <BrandMark size={34} />
          <span className="wordmark-text">
            al<span className="rato">Rato</span>
          </span>
        </button>
        <nav aria-label={t('nav.main')}>
          {NAV.map((item) => (
            <button key={item.path} className={isActive(path, item.path) ? 'active' : ''} onClick={() => go(item.path)}>
              <span className={`nav-tile nav-${item.tone}`}>
                <Icon name={item.icon} size={18} />
              </span>
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
        <div className="tabbar-pill">
          {/* The glass lens slides to the active tab. */}
          <span
            className={activeTab < 0 ? 'tabbar-lens off' : 'tabbar-lens'}
            style={{ '--i': Math.max(activeTab, 0) } as CSSProperties}
            aria-hidden="true"
          />
          {TABS.map((item) => (
            <button key={item.path} className={isActive(path, item.path) ? 'active' : ''} onClick={() => go(item.path)}>
              <Icon name={item.icon} size={24} />
              <span>{t(item.label)}</span>
            </button>
          ))}
        </div>
        <button
          className={isActive(path, '/capture') ? 'tabbar-action active' : 'tabbar-action'}
          aria-label={t('nav.capture')}
          onClick={() => go('/capture')}
        >
          <Icon name="camera" size={26} />
        </button>
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
    <button className={`note-row tone-${capture.kind}`} onClick={() => go(`/note/${capture.id}`)}>
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

/** Corner brackets and a sweeping line over a photo: the note is being read. Decorative only. */
export function Scanner({ className = '' }: { className?: string }) {
  return (
    <span className={`scan ${className}`.trim()} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <b />
    </span>
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
