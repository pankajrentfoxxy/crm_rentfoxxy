import React from 'react';

export default function CustomerAssetActivityFeed({ activity = [], loading = false }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 text-sm text-gray-400">
        Loading activity…
      </div>
    );
  }

  if (!activity.length) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 text-sm text-gray-400">
        No asset edit activity recorded yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-800">Asset edit activity</h3>
        <p className="text-xs text-gray-500 mt-0.5">Recent changes to specs, DC, delivery date, and rates</p>
      </div>
      <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
        {activity.map((item) => (
          <li key={item.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
              <span>{new Date(item.created_at).toLocaleString('en-IN')}</span>
              <span>·</span>
              <span>{item.actor_name || 'System'}</span>
              {item.ttspl_id ? (
                <>
                  <span>·</span>
                  <span className="font-mono text-blue-700">{item.ttspl_id}</span>
                </>
              ) : null}
            </div>
            <p className="mt-1 text-gray-800">{item.description}</p>
            {Array.isArray(item.changes) && item.changes.length ? (
              <ul className="mt-2 space-y-1 text-xs text-gray-600">
                {item.changes.map((ch) => (
                  <li key={`${item.id}-${ch.field}`}>
                    <span className="font-medium text-gray-700">{ch.label || ch.field}:</span>{' '}
                    {ch.old_value ?? '—'} → <strong>{ch.new_value ?? '—'}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
