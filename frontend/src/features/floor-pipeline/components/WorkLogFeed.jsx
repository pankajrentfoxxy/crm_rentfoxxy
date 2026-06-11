import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function WorkLogFeed({ activities = [], parts = [] }) {
  const items = [
    ...activities.map((a) => ({
      id: `a-${a.activity_id}`,
      at: a.created_at,
      user: a.user_name,
      action: a.action,
      text: a.notes,
      fail: /fail/i.test(a.notes || '')
    })),
    ...parts.map((p) => ({
      id: `p-${p.ticket_part_id || p.part_id}`,
      at: p.created_at,
      user: p.added_by_name,
      action: 'part_added',
      text: `${p.part_name} × ${p.quantity_used} (₹${p.total_part_cost || 0})`
    }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm text-sm">
          <div className="flex justify-between text-xs text-slate-500">
            <span>{item.user || 'System'}</span>
            <span>{item.at ? new Date(item.at).toLocaleString() : ''}</span>
          </div>
          <p className="font-medium text-slate-800 mt-1 capitalize">{item.action?.replace(/_/g, ' ')}</p>
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
