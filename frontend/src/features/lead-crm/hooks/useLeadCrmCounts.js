import { useCallback, useEffect, useState } from 'react';
import { getFollowUps, getLeads } from '../leadCrmApi';

export const LEAD_CRM_COUNTS_EVENT = 'lead-crm-counts-refresh';

export function refreshLeadCrmCounts() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LEAD_CRM_COUNTS_EVENT));
  }
}

export function useLeadCrmCounts(enabled = true) {
  const [counts, setCounts] = useState({ active_leads: 0, followups_today: 0 });
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const [leadsRes, fuRes] = await Promise.all([
        getLeads(),
        getFollowUps(),
      ]);
      const leads = leadsRes.data?.leads || [];
      const active = leads.filter((l) => !['Gone', 'Rejected'].includes(l.status)).length;
      const today = (fuRes.data?.today || []).length;
      setCounts({ active_leads: active, followups_today: today });
    } catch {
      setCounts({ active_leads: 0, followups_today: 0 });
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onRefresh = () => setTick((t) => t + 1);
    window.addEventListener(LEAD_CRM_COUNTS_EVENT, onRefresh);
    return () => window.removeEventListener(LEAD_CRM_COUNTS_EVENT, onRefresh);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, load, tick]);

  return { counts, refresh: load };
}
