import React from 'react';
import { AlertTriangle } from 'lucide-react';

const EVENT_LABELS = {
  stage_changed: 'Stage changed',
  parts_used: 'Parts used',
  config_updated: 'Config updated',
  qc1_failed: 'QC1 failed',
  qc2_failed: 'QC2 failed',
  qc1_passed: 'QC1 passed',
  qc2_passed: 'QC2 passed',
  assigned: 'Assigned',
  note_added: 'Note added',
  dispatch_qc_snoozed: 'QC reminder snoozed',
};

export default function WorkLogFeed({ activities = [], parts = [], auditLog = [] }) {
  const items = [
    ...activities.map((a) => ({
      id: `a-${a.activity_id}`,
      at: a.created_at,
      user: a.user_name,
      action: a.action,
      text: a.notes,
      fail: /fail/i.test(a.notes || '')
    })),
    ...auditLog.map((e) => ({
      id: `audit-${e.log_id}`,
      at: e.created_at,
      user: e.actor_name_resolved || e.actor_name,
      action: e.event_type,
      text: e.description,
      fail: /fail/i.test(e.event_type || '')
    })),
    ...parts.map((p) => ({
      id: `p-${p.id || p.part_id}`,
      at: p.added_at,
      user: p.added_by_name,
      action: 'parts_used',
      text: `${p.part_name} × ${p.quantity_used} (₹${p.total_part_cost || 0})`
    }))
  ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm text-sm">
          <div className="flex justify-between text-xs text-slate-500">
            <span>{item.user || 'System'}</span>
            <span>{item.at ? new Date(item.at).toLocaleString() : ''}</span>
          </div>
          <p className="font-medium text-slate-800 mt-1">{EVENT_LABELS[item.action] || item.action?.replace(/_/g, ' ')}</p>
          <p className={`mt-1 ${item.fail ? 'text-red-700' : 'text-slate-600'}`}>
            {item.fail ? <AlertTriangle className="w-3.5 h-3.5 inline mr-1" /> : null}
            {item.text}
          </p>
        </li>
      ))}
      {!items.length ? <p className="text-sm text-slate-500">No work log entries yet.</p> : null}
    </ul>
  );
}
