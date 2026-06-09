import { useEffect, useState } from 'react';
import { fetchOperationCounts } from '../../../utils/salesManagementApi';

export function useOperationCounts(enabled = true) {
  const [counts, setCounts] = useState({
    quotations: 0,
    sales_orders: 0,
    delivery_challans: 0,
    return_dc: 0,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchOperationCounts()
      .then((data) => {
        if (!cancelled && data?.counts) setCounts(data.counts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [enabled]);

  return { counts };
}
