import { useEffect, useState } from 'react';
import { getFinanceCounts } from '../financeOverviewApi';

export function useFinanceCounts(enabled = true) {
  const [counts, setCounts] = useState({ draft_invoices: 0, einvoice_queue: 0 });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    getFinanceCounts()
      .then((res) => {
        if (!cancelled) setCounts(res.data || {});
      })
      .catch(() => {});
    const interval = setInterval(() => {
      getFinanceCounts()
        .then((res) => { if (!cancelled) setCounts(res.data || {}); })
        .catch(() => {});
    }, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled]);

  return { counts };
}
