/**
 * Free-tier quotas of the Gemini Developer API are counted per Google Cloud project,
 * so every student of the hosted app shares them. A daily quota resets at midnight in
 * Pacific time. When a model has used its daily quota, this device stops asking that
 * model until the reset, instead of spending a request on an answer that is known to fail.
 */

const KEY = 'alrato.cloudQuotaOut.v1';
const PACIFIC = 'America/Los_Angeles';

/** Pacific wall-clock time for an instant, expressed as if it were UTC milliseconds. */
function pacificWallClock(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
}

/** The next midnight in Pacific time, as epoch milliseconds. Handles daylight saving time. */
export function nextPacificMidnight(now: number = Date.now()): number {
  const wall = new Date(pacificWallClock(now));
  const midnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
  let instant = midnightWall;
  for (let round = 0; round < 2; round += 1) {
    instant = midnightWall - (pacificWallClock(instant) - instant);
  }
  return instant;
}

function readTable(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Remembers that this model has no free requests left today. */
export function markModelExhausted(model: string, now: number = Date.now()): void {
  const table = readTable();
  for (const [name, until] of Object.entries(table)) {
    if (until <= now) delete table[name];
  }
  table[model] = nextPacificMidnight(now);
  localStorage.setItem(KEY, JSON.stringify(table));
}

export function isModelExhausted(model: string, now: number = Date.now()): boolean {
  const until = readTable()[model];
  return typeof until === 'number' && until > now;
}

/** True only when every model of the chain is out for today. */
export function allModelsExhausted(models: string[], now: number = Date.now()): boolean {
  return models.length > 0 && models.every((model) => isModelExhausted(model, now));
}
