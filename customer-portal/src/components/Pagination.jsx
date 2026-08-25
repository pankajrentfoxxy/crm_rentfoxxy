import React from 'react';

export default function Pagination({ pagination, onChange }) {
  if (!pagination) return null;
  const { page = 1, limit = 20, total = 0 } = pagination;
  const totalPages = pagination.totalPages || Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  const btn = 'px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-xs text-slate-500">
        Showing <span className="font-medium text-slate-700">{first}–{last}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
        <button type="button" className={btn} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
