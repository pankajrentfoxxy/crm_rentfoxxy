import { useCallback, useEffect, useState } from 'react';
import { fetchInventoryListCounts } from '../inventoryManagementApi';
import { INVENTORY_COUNTS_INVALIDATE } from '../inventoryCountsEvents';

export function useInventoryListCounts(enabled = true) {
  const [counts, setCounts] = useState(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const { data } = await fetchInventoryListCounts();
      if (data.success) setCounts(data.counts || {});
    } catch {
      setCounts(null);
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onInvalidate = () => load();
    window.addEventListener(INVENTORY_COUNTS_INVALIDATE, onInvalidate);
    return () => window.removeEventListener(INVENTORY_COUNTS_INVALIDATE, onInvalidate);
  }, [load]);

  return { counts, reload: load };
}
