import React from 'react';
import { Loader2 } from 'lucide-react';
import { formatActivityDateTime } from '../leadCrmUtils';

export default function LeadListExpandPanel({ loading, activities = [] }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading activities…
      </div>
    );
  }

  if (!activities.length) {
    return (
      <p className="text-sm text-gray-400 text-center py-8">No activity recorded yet for this lead.</p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Last 5 activities</p>
      {activities.map((item) => (
        <div
          key={item.id}
          className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              {item.type}
            </span>
            <span className="text-[11px] text-gray-400 whitespace-nowrap">
              {formatActivityDateTime(item.createdAt)}
            </span>
          </div>
          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap break-words">{item.description}</p>
          <p className="text-xs text-gray-500 mt-1">{item.performedBy}</p>
        </div>
      ))}
    </div>
  );
}
