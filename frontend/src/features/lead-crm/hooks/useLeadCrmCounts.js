import { useEffect, useState } from 'react';
import { getFollowUps, getLeads } from '../leadCrmApi';

export function useLeadCrmCounts(enabled = true) {
  const [counts, setCounts] = useState({ active_leads: 0, followups_today: 0 });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [leadsRes, fuRes] = await Promise.all([
          getLeads(),
          getFollowUps(),
        ]);
        if (cancelled) return;
        const leads = leadsRes.data?.leads || [];
        const active = leads.filter((l) => !['Gone', 'Rejected'].includes(l.status)).length;
        const today = (fuRes.data?.today || []).length;
        setCounts({ active_leads: active, followups_today: today });
      } catch {
        if (!cancelled) setCounts({ active_leads: 0, followups_today: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return { counts };
}
