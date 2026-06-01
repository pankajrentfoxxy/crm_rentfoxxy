import { useCallback, useEffect, useState } from 'react';
import { fetchQcStatusCounts } from '../qcManagementApi';

export function useQcStatusCounts(enabled = true) {
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { data } = await fetchQcStatusCounts();
      if (data.success) setCounts(data.counts || {});
    } catch {
      setCounts(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  return { counts, loading, reload: load };
}
