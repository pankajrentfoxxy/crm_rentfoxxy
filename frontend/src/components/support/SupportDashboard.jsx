import React, { useEffect, useState } from 'react';
import api from '../../utils/api';
import SupportTicketsView from './SupportTicketsView';

export default function SupportDashboard() {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.get('/support/dashboard').then((r) => setSummary(r.data.summary || null)).catch(() => setSummary(null));
  }, []);

  const resolvedDelta = (summary?.resolved_today || 0) - (summary?.resolved_yesterday || 0);

  return (
    <div className="space-y-5">
      <div className="support-stat-grid">
        <div className="support-stat-card">
          <div className="text-2xl font-semibold">{summary?.open_total ?? '—'}</div>
          <div className="text-sm text-slate-600 mt-1">Total open</div>
          <div className="text-xs text-slate-500 mt-2">{summary?.unassigned_tickets || 0} unassigned</div>
        </div>
        <div className="support-stat-card">
          <div className="text-2xl font-semibold">{summary?.overdue_total ?? '—'}</div>
          <div className="text-sm text-slate-600 mt-1">Overdue (&gt;48h)</div>
          {(summary?.overdue_total || 0) > 0 && <div className="text-xs text-red-700 mt-2">Needs attention</div>}
        </div>
        <div className="support-stat-card">
          <div className="text-2xl font-semibold">{summary?.resolved_today ?? '—'}</div>
          <div className="text-sm text-slate-600 mt-1">Resolved today</div>
          <div className="text-xs text-slate-500 mt-2">
            {resolvedDelta === 0 ? '—' : `${resolvedDelta > 0 ? '↑' : '↓'} ${Math.abs(resolvedDelta)} vs yesterday`}
          </div>
        </div>
        <div className="support-stat-card">
          <div className="text-2xl font-semibold">{summary?.pending_pickups ?? '—'}</div>
          <div className="text-sm text-slate-600 mt-1">Pending pickups</div>
          <div className="text-xs text-slate-500 mt-2">{summary?.pending_pickups || 0} within 72h window</div>
        </div>
      </div>

      <SupportTicketsView view="active" splitSections showFilters />
    </div>
  );
}
