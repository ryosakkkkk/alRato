import { useSyncExternalStore } from 'react';
import { closeConsentPrompt, isConsentPromptOpen, setCloudConsent, subscribeConsent } from '../core/consent';
import { kickQueue } from '../core/queue';
import type { Lang } from '../core/types';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const TERMS_URL = 'https://ai.google.dev/gemini-api/terms';

// The legal wording lives in one place so it can be reviewed as a unit.
const COPY: Record<Lang, { title: string; points: string[]; terms: string; agree: string; decline: string }> = {
  en: {
    title: 'Before alRato uses cloud AI',
    points: [
      'When this device cannot do the work, your photo and text go to Google’s Gemini API.',
      'alRato uses the free tier: Google may use what you send to improve its products, and people may read it. Do not photograph personal or sensitive information, or other people.',
      'You must be 18 or older. Cloud AI is not offered in the European Economic Area, the UK or Switzerland.',
      'Notes you mark as private never use the cloud.',
    ],
    terms: 'Read the Gemini API terms',
    agree: 'I am 18+ and I agree',
    decline: 'Keep everything on this device',
  },
  es: {
    title: 'Antes de usar la IA en la nube',
    points: [
      'Cuando este dispositivo no pueda hacer el trabajo, tu foto y tu texto irán a la API de Gemini de Google.',
      'alRato usa el plan gratuito: Google puede usar lo que envíes para mejorar sus productos, y hay personas que pueden leerlo. No fotografíes información personal o sensible, ni a otras personas.',
      'Debes tener 18 años o más. La IA en la nube no se ofrece en el Espacio Económico Europeo, Reino Unido ni Suiza.',
      'Los apuntes que marques como privados nunca usan la nube.',
    ],
    terms: 'Leer las condiciones de la API de Gemini',
    agree: 'Tengo 18+ y acepto',
    decline: 'Dejar todo en este dispositivo',
  },
};

export function CloudConsent() {
  const { lang } = useI18n();
  const open = useSyncExternalStore(subscribeConsent, isConsentPromptOpen);
  const copy = COPY[lang];

  function decide(value: 'granted' | 'declined') {
    setCloudConsent(value);
    kickQueue();
  }

  return (
    <Sheet open={open} onClose={closeConsentPrompt} title={copy.title}>
      <ul className="consent-points">
        {copy.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <a className="text-link" href={TERMS_URL} target="_blank" rel="noreferrer">
        {copy.terms} <Icon name="open" size={15} />
      </a>
      <div className="stack-s">
        <button className="btn btn-primary btn-wide" onClick={() => decide('granted')}>
          {copy.agree}
        </button>
        <button className="btn btn-ghost btn-wide" onClick={() => decide('declined')}>
          <Icon name="lock" />
          {copy.decline}
        </button>
      </div>
    </Sheet>
  );
}
