import React, { useMemo, useState } from 'react';
import { relativeTime } from '../leadCrmUtils';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'status', label: 'Status Changes' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'follow', label: 'Follow-ups' },
  { key: 'quotation', label: 'Quotations' },
];

function describeActivity(item) {
  if (item._type === 'remark' || item.remarkId != null) {
    return { text: item.note || '—', kind: 'remarks' };
  }
  const action = item.action || '';
  if (action.includes('status') || item.statusFrom || item.statusTo) {
    const from = item.statusFrom || '—';
    const to = item.statusTo || item.status_to || '—';
    return {
      text: `Status changed from ${from} → ${to}`,
      kind: 'status',
    };
  }
  if (action.includes('follow')) {
    return { text: item.notes || 'Follow-up updated', kind: 'follow' };
  }
  if (action.includes('quotation')) {
    return { text: item.notes || 'Quotation sent', kind: 'quotation' };
  }
  if (action.includes('convert')) {
    return { text: item.notes || 'Converted to customer', kind: 'status' };
  }
  if (action.includes('profile')) {
    return { text: item.notes || 'Profile updated', kind: 'all' };
  }
  if (action.includes('assign')) {
    return { text: item.notes || 'Assignment updated', kind: 'all' };
  }
  return { text: item.notes || action || 'Activity', kind: 'all' };
}

export default function ActivityFeed({ activities = [], remarks = [], assignments = [] }) {
  const [filter, setFilter] = useState('all');

  const items = useMemo(() => {
    const merged = [
      ...activities.map((a) => ({ ...a, _ts: new Date(a.createdAt), _type: 'activity' })),
      ...remarks.map((r) => ({
        ...r,
        _ts: new Date(r.createdAt),
        _type: 'remark',
        note: r.note,
        user: r.userName ? { name: r.userName } : r.user,
      })),
      ...assignments.map((a) => ({
        action: 'assigned',
        notes: `Assigned to user #${a.assignedTo}`,
        user: a.assignedToUser,
        createdAt: a.assignedAt,
        _ts: new Date(a.assignedAt),
        _type: 'assignment',
      })),
    ].sort((a, b) => b._ts - a._ts);

    return merged.filter((item) => {
      if (filter === 'all') return true;
      const { kind } = describeActivity(item);
      if (filter === 'remarks') return item._type === 'remark';
      return kind === filter;
    });
  }, [activities, remarks, assignments, filter]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
        )}
        {items.map((item, idx) => {
          const { text } = describeActivity(item);
          const actor = item.user?.name || item.user_name || 'System';
          return (
            <div key={`${item._type}-${item.activityId || item.remarkId || idx}`}
              className="flex gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/50">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                {actor.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{text}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {actor} · {relativeTime(item.createdAt || item._ts)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
