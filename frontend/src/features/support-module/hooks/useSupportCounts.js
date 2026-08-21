import { useEffect, useState } from 'react';
import api from '../../../utils/api';

export function useSupportCounts(enabled = true) {
  const [counts, setCounts] = useState({ open_tickets: 0 });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = () => api.get('/support/badges')
      .then((res) => {
        if (!cancelled) {
          const badges = res.data?.badges || {};
          setCounts({
            open_tickets: badges.open_tickets ?? badges.my_open ?? 0,
            support_requests: badges.support_requests ?? 0,
            support_part_requests: badges.support_part_requests ?? 0,
          });
        }
      })
      .catch(() => {});
    load();
    const interval = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled]);

  return { counts };
}
