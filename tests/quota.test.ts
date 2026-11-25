import { AIError, AIErrorCode } from 'firebase/ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { classifyError, isDailyQuota } from '../src/ai/errors';
import { allModelsExhausted, isModelExhausted, markModelExhausted, nextPacificMidnight } from '../src/ai/quota';

const DAILY = [
  {
    '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
    violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
  },
];

const PER_MINUTE = [
  {
    '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
    violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '15' }],
  },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '38s' },
];

describe('nextPacificMidnight', () => {
  it('finds midnight in standard time (UTC-8)', () => {
    expect(nextPacificMidnight(Date.parse('2026-11-25T12:00:00Z'))).toBe(Date.parse('2026-11-26T08:00:00Z'));
  });

  it('finds midnight in daylight time (UTC-7)', () => {
    expect(nextPacificMidnight(Date.parse('2026-07-10T12:00:00Z'))).toBe(Date.parse('2026-07-11T07:00:00Z'));
  });

  it('counts the minute before midnight as the same day', () => {
    // 07:59 UTC is 23:59 in Pacific standard time on the 25th, so the reset is one minute away.
    expect(nextPacificMidnight(Date.parse('2026-11-26T07:59:00Z'))).toBe(Date.parse('2026-11-26T08:00:00Z'));
  });
});

describe('daily quota errors', () => {
  it('recognizes a per-day quota from the API error details', () => {
    const error = new AIError(AIErrorCode.FETCH_ERROR, 'Error fetching', { status: 429, errorDetails: DAILY as never });
    expect(isDailyQuota(error)).toBe(true);
    expect(classifyError(error)).toMatchObject({ failure: 'quota_daily', transient: false });
  });

  it('keeps a per-minute quota retryable', () => {
    const error = new AIError(AIErrorCode.FETCH_ERROR, 'Error fetching', {
      status: 429,
      errorDetails: PER_MINUTE as never,
    });
    expect(isDailyQuota(error)).toBe(false);
    expect(classifyError(error)).toMatchObject({ failure: 'rate_limited', transient: true });
  });
});

describe('the exhausted-model memory', () => {
  beforeEach(() => localStorage.clear());

  it('remembers a model until the Pacific midnight, then forgets it', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    markModelExhausted('gemini-3.5-flash-lite', now);
    expect(isModelExhausted('gemini-3.5-flash-lite', now + 60_000)).toBe(true);
    expect(isModelExhausted('gemini-3.5-flash-lite', Date.parse('2026-11-26T08:00:01Z'))).toBe(false);
  });

  it('counts the chain as exhausted only when every model is out', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    markModelExhausted('a', now);
    expect(allModelsExhausted(['a', 'b'], now)).toBe(false);
    markModelExhausted('b', now);
    expect(allModelsExhausted(['a', 'b'], now)).toBe(true);
    expect(allModelsExhausted([], now)).toBe(false);
  });
});
