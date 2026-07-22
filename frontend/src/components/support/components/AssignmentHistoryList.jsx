import React from 'react';

function actionLabel(action) {
  if (action === 'return_pickup_assignee_changed') return 'Pickup assignee changed';
  if (action === 'return_pickup_assigned') return 'Pickup assigned';
  if (action === 'technician_reassigned') return 'Technician reassigned';
  if (action === 'technician_assigned') return 'Technician assigned';
  return String(action || '').replace(/_/g, ' ');
}

export default function AssignmentHistoryList({ rows = [], compact = false }) {
  if (!rows.length) return null;

  return (
    <div className={compact ? 'space-y-2' : 'border rounded-lg p-3 space-y-2 bg-slate-50/80'}>
      {!compact && (
        <h3 className="text-sm font-semibold text-gray-800">Assignment History</h3>
      )}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="text-xs text-gray-600 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
            <p className="text-gray-800">
              <strong>{row.previous_assignee || '—'}</strong>
              {' → '}
              <strong>{row.new_assignee || '—'}</strong>
            </p>
            <p className="text-gray-400 mt-0.5">
              {row.changed_at ? new Date(row.changed_at).toLocaleString() : '—'}
              {row.changed_by ? ` · ${row.changed_by}` : ''}
              {row.reason ? ` · ${row.reason}` : ''}
            </p>
            {!compact && row.return_dc_number && (
              <p className="text-gray-400 font-mono mt-0.5">{row.return_dc_number}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export { actionLabel };
