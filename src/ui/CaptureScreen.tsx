import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { addCapture } from '../core/captures';
import { useI18n } from '../i18n';
import { Scanner, TopBar } from './common';
import { Icon } from './Icon';
import { go } from './router';

type CameraState = 'starting' | 'live' | 'denied' | 'none';

export function CaptureScreen() {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [comment, setComment] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera('none');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCamera('live');
      } catch (error) {
        setCamera((error as DOMException).name === 'NotAllowedError' ? 'denied' : 'none');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function save(blob: Blob) {
    setBusy(true);
    setFailed(false);
    try {
      go(`/note/${await addCapture(blob, { comment, isPrivate })}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  async function shoot() {
    const video = videoRef.current;
    if (!video?.videoWidth || busy) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (blob) await save(blob);
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void save(file);
  }

  const notice =
    camera === 'denied' ? t('capture.denied') : camera === 'none' ? t('capture.noCamera') : camera === 'starting' ? t('capture.starting') : null;

  return (
    <div className="stack capture">
      <TopBar title={t('capture.title')} />

      <div className="viewfinder">
        <video ref={videoRef} playsInline muted className={camera === 'live' ? '' : 'hidden'} />
        {camera === 'live' && <Scanner className="scan-camera" />}
        {notice && (
          <div className="viewfinder-note">
            <Icon name={camera === 'starting' ? 'camera' : 'image'} size={34} />
            <p>{notice}</p>
          </div>
        )}
        <div className="capture-controls">
          <button className="round-btn" aria-label={t('capture.gallery')} title={t('capture.gallery')} onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="image" size={26} />
          </button>
          <button className="shutter" aria-label={t('capture.shutter')} onClick={shoot} disabled={camera !== 'live' || busy} />
          <span className="round-spacer" />
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

      {camera !== 'live' && (
        <button className="btn btn-primary btn-wide" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="image" />
          {busy ? t('capture.saving') : t('capture.gallery')}
        </button>
      )}
      {failed && (
        <p className="form-error" role="alert">
          {t('capture.failed')}
        </p>
      )}

      <label className="field">
        <span>{t('capture.context')}</span>
        <input value={comment} maxLength={200} placeholder={t('capture.contextHint')} onChange={(e) => setComment(e.target.value)} />
      </label>

      <label className="toggle">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
        <span className="toggle-track" aria-hidden="true" />
        <span className="toggle-text">
          <strong>
            <Icon name="lock" size={15} /> {t('capture.private')}
          </strong>
          <small>{t('capture.privateHint')}</small>
        </span>
      </label>
    </div>
  );
}
