const STOP_WORDS = new Set(
  (
    'the a an and or of to in on for with by is are be this that these those it its as at from into we you your ' +
    'if then than so not no can will has have had was were which what when where how why each all any more most ' +
    'el la los las un una unos unas y o u de del al en con por para es son ser este esta estos estas ese esa eso ' +
    'lo le les se su sus que como cuando donde cual cuales si no mas muy ya hay fue era tu mi nos sin sobre entre'
  ).split(' '),
);

/** Lowercases and removes accents so "Fórmula" and "formula" compare equal. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Light plural stripping that works acceptably for both English and Spanish. */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length >= 7 && /[dnrz]es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  const words = normalize(text).match(/[a-z0-9]+/g) ?? [];
  return words.filter((w) => w.length > 1 && !STOP_WORDS.has(w)).map(stem);
}

/** Canonical form of a concept phrase, used as a matching key. */
export function conceptKey(phrase: string): string {
  return tokenize(phrase).join(' ');
}

export function uniqueKeys(phrases: string[]): string[] {
  return [...new Set(phrases.map(conceptKey).filter(Boolean))];
}

export function clip(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, lastBreak > maxChars * 0.6 ? lastBreak : maxChars).trimEnd()}…`;
}
