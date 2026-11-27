import { useState } from 'react';
import { downloadLocalModel, removeLocalModel } from '../ai/localModel';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { useLocalModel } from './localModelHooks';

/**
 * The phone's own model: shown when Gemini Nano is not there. Nothing is downloaded until the
 * student picks a model and presses the button that names its size.
 */
export function LocalModelCard() {
  const { t } = useI18n();
  const local = useLocalModel();
  const [choice, setChoice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const picked = local.options.find((m) => m.id === choice) ?? local.options[0];

  async function download() {
    if (!picked) return;
    setFailed(false);
    try {
      await downloadLocalModel(picked.id);
    } catch {
      setFailed(true);
    }
  }

  const ready = local.state === 'ready';
  // A phone gets the phone wording; a computer without Gemini Nano can run the same model.
  const title = window.matchMedia?.('(pointer: coarse)').matches ? t('local.title') : t('local.titleDevice');
  return (
    <section className="card stack-s">
      <div className="device-head">
        <span className={`device-dot ${ready ? 'dot-ready' : local.state === 'downloading' ? 'dot-downloading' : ''}`} />
        <h2>{title}</h2>
      </div>
      <p>{t('local.why')}</p>

      {local.state === 'checking' && <p className="muted">{t('local.checking')}</p>}
      {local.state === 'unsupported' && <p className="muted">{t('local.unsupported')}</p>}

      {(local.state === 'available' || local.state === 'failed') && picked && (
        <>
          <div className="choices" role="radiogroup" aria-label={t('local.pick')}>
            {local.options.map((option) => (
              <button
                key={option.id}
                role="radio"
                aria-checked={picked.id === option.id}
                className={picked.id === option.id ? 'choice active' : 'choice'}
                onClick={() => setChoice(option.id)}
              >
                <strong>{option.label}</strong>
                <small>{t('local.size', { size: option.sizeMB, maker: option.maker })}</small>
              </button>
            ))}
          </div>
          <p className="muted small">{t('local.wifi')}</p>
          <button className="btn btn-primary" onClick={download}>
            <Icon name="download" />
            {t('local.download', { size: picked.sizeMB })}
          </button>
        </>
      )}

      {local.state === 'downloading' && (
        <>
          <p>{t('local.downloading', { p: Math.round((local.progress ?? 0) * 100) })}</p>
          <div
            className="progress"
            role="progressbar"
            aria-label={title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((local.progress ?? 0) * 100)}
          >
            <span style={{ width: `${(local.progress ?? 0) * 100}%` }} />
          </div>
        </>
      )}

      {ready && (
        <>
          <p>{t('local.ready', { model: local.label })}</p>
          <button className="btn btn-ghost" onClick={() => void removeLocalModel()}>
            <Icon name="trash" />
            {t('local.remove')}
          </button>
        </>
      )}

      {(failed || local.state === 'failed') && (
        <p className="form-error" role="alert">
          {t('local.failed')}
        </p>
      )}
    </section>
  );
}
