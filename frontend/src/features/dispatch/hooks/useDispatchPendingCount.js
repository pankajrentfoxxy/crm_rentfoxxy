import { useDispatchRealtime } from '../DispatchRealtimeProvider';

export function useDispatchPendingCount(enabled = true) {
  const { count, enabled: rtEnabled, loadInitial } = useDispatchRealtime();
  return {
    count: enabled && rtEnabled ? count : 0,
    refresh: loadInitial,
  };
}

export default useDispatchPendingCount;
