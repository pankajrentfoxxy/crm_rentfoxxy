import { useEffect, useState } from 'react';
import { fetchDeliveryRegisterCounts } from '../../../utils/deliveryRegisterApi';

export function useDeliveryRegisterCounts(enabled = true) {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    fetchDeliveryRegisterCounts()
      .then((data) => {
        if (!cancelled && data.success) setCounts(data.counts || {});
      })
      .catch(() => {
        if (!cancelled) setCounts({});
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return counts;
}
