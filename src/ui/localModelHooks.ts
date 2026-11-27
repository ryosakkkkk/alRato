import { useEffect, useSyncExternalStore } from 'react';
import { checkLocalModel, localStatus, subscribeLocal, type LocalStatus } from '../ai/localModel';

/** The phone's local model, kept current. The first use checks whether this device has WebGPU. */
export function useLocalModel(): LocalStatus {
  const status = useSyncExternalStore(subscribeLocal, localStatus);
  useEffect(() => {
    void checkLocalModel();
  }, []);
  return status;
}
