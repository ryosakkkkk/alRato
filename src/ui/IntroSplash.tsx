import { useEffect, useState } from 'react';
import { BrandMark } from './Brand';

/** Total length of the intro in milliseconds. The CSS fade ends at the same moment. */
const INTRO_MS = 2200;

/**
 * Plays once per tab session, on the first load. It is decided once per page load, at module
 * evaluation, so React's double render in development cannot use up the flag.
 */
const PLAY_INTRO = decideIntro();

function decideIntro(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    if (window.sessionStorage.getItem('alrato.intro') === '1') return false;
    window.sessionStorage.setItem('alrato.intro', '1');
  } catch {
    // Storage can be blocked. Then the intro plays on every load, which is harmless.
  }
  return true;
}

/** The brand moment at launch. It never blocks a tap: pointer events pass straight through. */
export function IntroSplash() {
  const [visible, setVisible] = useState(PLAY_INTRO);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;
  return (
    <div className="splash" aria-hidden="true">
      <span className="splash-tile">
        <BrandMark size={96} draw />
      </span>
      <p className="splash-word">
        al<span>Rato</span>
      </p>
    </div>
  );
}
