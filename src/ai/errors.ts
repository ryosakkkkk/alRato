import { AIError, AIErrorCode } from 'firebase/ai';
import type { WaitReason } from '../core/types';

export type AiFailure =
  | 'network'
  | 'rate_limited'
  | 'quota_daily'
  | 'app_check'
  | 'config'
  | 'safety'
  | 'invalid_output'
  | 'device_failed'
  | 'privacy_gate'
  | 'stale'
  | 'unknown';

export class AlRatoAiError extends Error {
  constructor(
    public readonly failure: AiFailure,
    message?: string,
    public readonly transient = false,
  ) {
    super(message ?? failure);
    this.name = 'AlRatoAiError';
  }
}

/** The router decided this work must wait. Not a failure. */
export class WaitForRoute extends Error {
  constructor(public readonly reason: WaitReason) {
    super(reason);
    this.name = 'WaitForRoute';
  }
}

/**
 * The API names the quota in its error details, for example
 * "GenerateRequestsPerDayPerProjectPerModel-FreeTier". A per-day quota does not come back
 * within the hour, so retrying it only spends time.
 */
export function isDailyQuota(error: { message: string; customErrorData?: { errorDetails?: unknown } }): boolean {
  const details = JSON.stringify(error.customErrorData?.errorDetails ?? '');
  return /PerDay/.test(details) || /per day/i.test(details) || /per day/i.test(error.message);
}

export function classifyError(error: unknown): AlRatoAiError {
  if (error instanceof AlRatoAiError) return error;

  // Raw Prompt API errors (NotSupportedError, QuotaExceededError, ...) reach us as DOMExceptions.
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    // The SDK's request timeout also surfaces as a DOMException, and it is a network problem.
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return new AlRatoAiError('network', error.message, true);
    }
    return new AlRatoAiError('device_failed', error.name);
  }

  if (error instanceof AIError) {
    const status = error.customErrorData?.status;
    const message = `${error.message} ${JSON.stringify(error.customErrorData?.errorDetails ?? '')}`.toLowerCase();

    if (status === 429 || message.includes('resource_exhausted') || message.includes('quota')) {
      if (isDailyQuota(error)) return new AlRatoAiError('quota_daily', error.message);
      return new AlRatoAiError('rate_limited', error.message, true);
    }
    if (message.includes('app check') || message.includes('appcheck') || message.includes('app-check')) {
      return new AlRatoAiError('app_check', error.message);
    }
    if (status === 401 || status === 403) return new AlRatoAiError('app_check', error.message);
    if (status === 404 || status === 400) return new AlRatoAiError('config', error.message);
    if (status !== undefined && status >= 500) return new AlRatoAiError('network', error.message, true);

    switch (error.code) {
      case AIErrorCode.FETCH_ERROR:
        return new AlRatoAiError('network', error.message, true);
      case AIErrorCode.API_NOT_ENABLED:
      case AIErrorCode.NO_API_KEY:
      case AIErrorCode.NO_APP_ID:
      case AIErrorCode.NO_MODEL:
      case AIErrorCode.NO_PROJECT_ID:
        return new AlRatoAiError('config', error.message);
      case AIErrorCode.RESPONSE_ERROR:
        return new AlRatoAiError('safety', error.message);
      case AIErrorCode.PARSE_FAILED:
        return new AlRatoAiError('invalid_output', error.message);
      case AIErrorCode.UNSUPPORTED:
        return new AlRatoAiError('device_failed', error.message);
      case AIErrorCode.ERROR:
        // The SDK wraps a dropped connection (fetch's TypeError) in this generic code.
        if (/failed to fetch|networkerror|load failed/.test(message)) {
          return new AlRatoAiError('network', error.message, true);
        }
        return new AlRatoAiError('unknown', error.message);
      default:
        return new AlRatoAiError('unknown', error.message);
    }
  }

  if (error instanceof TypeError) return new AlRatoAiError('network', error.message, true);
  return new AlRatoAiError('unknown', error instanceof Error ? error.message : String(error));
}
