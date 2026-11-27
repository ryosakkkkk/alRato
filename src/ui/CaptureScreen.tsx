import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addCapture } from '../core/captures';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { go, goBack } from './router';

/*
 * The camera opens full screen, like a math-scanning app: the live picture, a frame to aim with
 * and one big shutter. The first time, the permission is asked right here, with a word on why.
 * Only what is inside the frame is kept, so the reading step sees the exercise and not the room.
 */

type CameraState = 'checking' | 'asking' | 'starting' | 'live' | 'denied' | 'none';
type Mode = 'exercise' | 'board';
type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** The frame, as fractions of the camera area. */
interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PRESETS: Record<Mode, Frame> = {
  exercise: { x: 0.07, y: 0.27, w: 0.86, h: 0.19 },
  board: { x: 0.04, y: 0.13, w: 0.92, h: 0.52 },
};
const MIN_W = 0.24;
const MIN_H = 0.08;
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
/** A little margin around the frame helps the reading step with symbols on its edge. */
const MARGIN = 0.025;
const MAX_SIDE = 2400;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type Permission = PermissionState | 'unknown';

async function cameraPermission(): Promise<Permission> {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    return status?.state ?? 'unknown';
  } catch {
    // Some browsers cannot be asked about the camera. getUserMedia still asks the student.
    return 'unknown';
  }
}

/** Copies what the frame shows out of the video, at the camera's own resolution. */
function cropToFrame(video: HTMLVideoElement, frameBox: DOMRect): Promise<Blob | null> {
  const box = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  // The video fills its box with object-fit: cover, so part of the picture is outside the box.
  const scale = Math.max(box.width / vw, box.height / vh);
  const offsetX = (box.width - vw * scale) / 2;
  const offsetY = (box.height - vh * scale) / 2;
  const toSource = (x: number, y: number) => ({
    x: clamp((x - box.left - offsetX) / scale, 0, vw),
    y: clamp((y - box.top - offsetY) / scale, 0, vh),
  });
  const start = toSource(frameBox.left - box.width * MARGIN, frameBox.top - box.height * MARGIN);
  const end = toSource(frameBox.right + box.width * MARGIN, frameBox.bottom + box.height * MARGIN);
  let sx = start.x;
  let sy = start.y;
  let sw = end.x - start.x;
  let sh = end.y - start.y;
  if (sw < 32 || sh < 32) {
    sx = 0;
    sy = 0;
    sw = vw;
    sh = vh;
  }
  const ratio = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * ratio);
  canvas.height = Math.round(sh * ratio);
  canvas.getContext('2d')?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

export function CaptureScreen() {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Each attempt to open the camera has a number; a newer attempt makes older ones stale. */
  const attempt = useRef(0);
  const pausedRef = useRef(false);
  const cameraRef = useRef<CameraState>('checking');
  const dragRef = useRef<Corner | null>(null);

  const [camera, setCameraState] = useState<CameraState>('checking');
  const [prompting, setPrompting] = useState(false);
  const [mode, setMode] = useState<Mode>('exercise');
  const [frame, setFrame] = useState<Frame>(PRESETS.exercise);
  const [dragging, setDragging] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torch, setTorch] = useState(false);
  const [flash, setFlash] = useState(0);
  const [comment, setComment] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const setCamera = useCallback((next: CameraState) => {
    cameraRef.current = next;
    setCameraState(next);
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setTorch(false);
    setTorchAvailable(false);
  }, []);

  const openCamera = useCallback(async () => {
    const run = ++attempt.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('none');
      return;
    }
    const permission = await cameraPermission();
    if (run !== attempt.current) return;
    if (permission === 'denied') {
      setCamera('denied');
      return;
    }
    // Granted: the picture is on its way. Otherwise the browser is asking right now, over this screen.
    setCamera(permission === 'granted' ? 'starting' : 'asking');
    setPrompting(permission !== 'granted');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (run !== attempt.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorchAvailable(Boolean(capabilities?.torch));
      setCamera('live');
    } catch (error) {
      if (run !== attempt.current) return;
      const name = (error as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        // Closing the prompt is not a refusal: the browser lets us ask again.
        setCamera((await cameraPermission()) === 'prompt' ? 'asking' : 'denied');
      } else {
        setCamera('none');
      }
    } finally {
      if (run === attempt.current) setPrompting(false);
    }
  }, [setCamera]);

  useEffect(() => {
    void openCamera();

    // A permission turned on in the site settings while this screen is open starts the camera.
    let status: PermissionStatus | undefined;
    let gone = false;
    const onPermission = () => {
      if (status?.state === 'granted' && cameraRef.current === 'denied') void openCamera();
      if (status?.state === 'denied' && cameraRef.current !== 'denied') {
        attempt.current += 1;
        stopStream();
        setCamera('denied');
      }
    };
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((result) => {
        if (gone) return;
        status = result;
        status.addEventListener('change', onPermission);
      })
      .catch(() => undefined);

    // The camera is let go while the app is in the background, and comes back with it.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (streamRef.current) {
          attempt.current += 1;
          stopStream();
          pausedRef.current = true;
        }
      } else if (pausedRef.current) {
        pausedRef.current = false;
        void openCamera();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      gone = true;
      attempt.current += 1;
      status?.removeEventListener('change', onPermission);
      document.removeEventListener('visibilitychange', onVisibility);
      stopStream();
    };
  }, [openCamera, stopStream, setCamera]);

  async function save(blob: Blob) {
    setBusy(true);
    setFailed(false);
    try {
      go(`/note/${await addCapture(blob, { comment: comment.trim(), isPrivate })}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  async function shoot() {
    const video = videoRef.current;
    const frameBox = frameRef.current?.getBoundingClientRect();
    if (!video?.videoWidth || !frameBox || busy) return;
    setFlash((n) => n + 1);
    navigator.vibrate?.(12);
    const blob = await cropToFrame(video, frameBox);
    if (blob) await save(blob);
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void save(file);
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  function chooseMode(next: Mode) {
    setMode(next);
    setFrame(PRESETS[next]);
  }

  function onCornerDown(corner: Corner, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = corner;
    setDragging(true);
  }

  function onCornerMove(event: ReactPointerEvent<HTMLSpanElement>) {
    const corner = dragRef.current;
    const box = stageRef.current?.getBoundingClientRect();
    if (!corner || !box) return;
    const px = clamp((event.clientX - box.left) / box.width, 0.02, 0.98);
    const py = clamp((event.clientY - box.top) / box.height, 0.06, 0.9);
    setFrame((current) => {
      let left = current.x;
      let top = current.y;
      let right = current.x + current.w;
      let bottom = current.y + current.h;
      if (corner === 'tl' || corner === 'bl') left = Math.min(px, right - MIN_W);
      else right = Math.max(px, left + MIN_W);
      if (corner === 'tl' || corner === 'tr') top = Math.min(py, bottom - MIN_H);
      else bottom = Math.max(py, top + MIN_H);
      return { x: left, y: top, w: right - left, h: bottom - top };
    });
  }

  function onCornerUp() {
    dragRef.current = null;
    setDragging(false);
  }

  const live = camera === 'live';
  const pickPhoto = () => fileRef.current?.click();
  const hintBelow = frame.y + frame.h < 0.7;

  return (
    <div className="stack capture cam-screen">
      <h1 className="sr-only">{t('capture.title')}</h1>

      <section className="cam" aria-label={t('capture.title')}>
        <div ref={stageRef} className="cam-stage">
          <video ref={videoRef} className={live ? 'cam-video' : 'cam-video hidden'} playsInline muted />

          {live && (
            <div
              ref={frameRef}
              className={dragging ? 'cam-frame dragging' : 'cam-frame'}
              style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%` }}
            >
              <b className="cam-sweep" aria-hidden="true" />
              {CORNERS.map((corner) => (
                <span
                  key={corner}
                  className={`cam-corner ${corner}`}
                  aria-hidden="true"
                  onPointerDown={(event) => onCornerDown(corner, event)}
                  onPointerMove={onCornerMove}
                  onPointerUp={onCornerUp}
                  onPointerCancel={onCornerUp}
                />
              ))}
            </div>
          )}
          {live && hintBelow && !dragging && (
            <p className="cam-hint" style={{ top: `${(frame.y + frame.h) * 100}%` }}>
              {mode === 'exercise' ? t('capture.hintExercise') : t('capture.hintBoard')}
            </p>
          )}

          {(camera === 'checking' || camera === 'starting') && (
            <div className="cam-panel">
              <p className="cam-status">
                <span className="cam-spinner" aria-hidden="true" />
                {t('capture.starting')}
              </p>
            </div>
          )}

          {camera === 'asking' && (
            <div className="cam-panel">
              <div className="cam-card">
                <span className="cam-tile">
                  <Icon name="camera" size={30} />
                </span>
                <h2>{t('capture.askTitle')}</h2>
                <p>{t('capture.askBody')}</p>
                <button className="btn btn-primary" onClick={() => void openCamera()} disabled={prompting}>
                  {prompting ? t('capture.askWaiting') : t('capture.askButton')}
                </button>
                <button className="text-link" onClick={pickPhoto} disabled={busy}>
                  <Icon name="image" size={18} />
                  {t('capture.gallery')}
                </button>
              </div>
            </div>
          )}

          {(camera === 'denied' || camera === 'none') && (
            <div className="cam-panel">
              <div className="cam-card">
                <span className="cam-tile cam-tile-off">
                  <Icon name={camera === 'denied' ? 'lock' : 'image'} size={30} />
                </span>
                <p className="cam-lead">{camera === 'denied' ? t('capture.denied') : t('capture.noCamera')}</p>
                {camera === 'denied' && <p>{t('capture.deniedHow')}</p>}
                <button className="btn btn-primary btn-wide" onClick={pickPhoto} disabled={busy}>
                  <Icon name="image" />
                  {busy ? t('capture.saving') : t('capture.gallery')}
                </button>
                {camera === 'denied' && (
                  <button className="text-link" onClick={() => void openCamera()}>
                    <Icon name="replay" size={18} />
                    {t('common.retry')}
                  </button>
                )}
              </div>
            </div>
          )}

          {flash > 0 && <span key={flash} className="cam-flash" aria-hidden="true" />}
          {busy && (
            <div className="cam-panel cam-panel-busy">
              <p className="cam-status">
                <span className="cam-spinner" aria-hidden="true" />
                {t('capture.saving')}
              </p>
            </div>
          )}
        </div>

        <header className="cam-top">
          <button className="cam-icon" aria-label={t('capture.close')} onClick={() => goBack()}>
            <Icon name="x" />
          </button>
          <div className="cam-modes" role="radiogroup" aria-label={t('capture.modes')}>
            {(['exercise', 'board'] as Mode[]).map((option) => (
              <button key={option} role="radio" aria-checked={mode === option} onClick={() => chooseMode(option)}>
                {option === 'exercise' ? t('capture.modeExercise') : t('capture.modeBoard')}
              </button>
            ))}
          </div>
          {torchAvailable ? (
            <button
              className="cam-icon"
              aria-label={torch ? t('capture.torchOff') : t('capture.torchOn')}
              aria-pressed={torch}
              onClick={() => void toggleTorch()}
            >
              <Icon name="bolt" />
            </button>
          ) : (
            <span className="cam-icon-spacer" />
          )}
        </header>

        <footer className="cam-bottom">
          {failed && (
            <p className="cam-toast" role="alert">
              {t('capture.failed')}
            </p>
          )}
          {contextOpen && (
            <input
              className="cam-input"
              value={comment}
              maxLength={200}
              autoFocus
              aria-label={t('capture.contextLabel')}
              placeholder={t('capture.contextHint')}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
          <div className="cam-extras">
            <label className="toggle cam-chip" title={t('capture.privateHint')}>
              <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
              <span className="toggle-track" aria-hidden="true" />
              <span className="toggle-text">
                <strong>
                  <Icon name="lock" size={14} /> {t('capture.private')}
                </strong>
              </span>
            </label>
            <button
              className={contextOpen || comment ? 'cam-chip active' : 'cam-chip'}
              aria-expanded={contextOpen}
              onClick={() => setContextOpen(!contextOpen)}
            >
              <Icon name="edit" size={15} />
              {t('capture.context')}
            </button>
          </div>
          <div className="cam-controls">
            <button className="round-btn" aria-label={t('capture.gallery')} title={t('capture.gallery')} onClick={pickPhoto} disabled={busy}>
              <Icon name="image" size={24} />
            </button>
            <button className="shutter" aria-label={t('capture.shutter')} onClick={() => void shoot()} disabled={!live || busy} />
            <button className="round-btn" aria-label={t('capture.history')} title={t('capture.history')} onClick={() => go('/library')}>
              <Icon name="clock" size={24} />
            </button>
          </div>
        </footer>
      </section>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  );
}
