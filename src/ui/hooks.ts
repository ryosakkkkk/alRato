import { useEffect, useState, useSyncExternalStore } from 'react';
import { deviceStatus, subscribeDevice, type DeviceStatus } from '../ai/device';

/** Object URL for a stored image. Keyed by id so re-reads of the row do not flicker. */
export function useBlobUrl(blob: Blob | undefined, key: string): string | undefined {
  const [url, setUrl] = useState<string>();
  const size = blob?.size;
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);
  return url;
}

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

export const useDevice = (): DeviceStatus => useSyncExternalStore(subscribeDevice, deviceStatus);
