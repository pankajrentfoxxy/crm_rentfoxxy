import React from 'react';
import { Link } from 'react-router-dom';

/**
 * One column spec drives both the desktop table and the mobile card list, which
 * is the responsive pattern the rest of the portal already uses.
 *
 * columns: [{
 *   key, label, render?(row), className?, mobileHidden?, mobilePrimary?
 * }]
 */
export default function DataTable({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyMessage = 'Nothing to show yet',
  rowLink,
  onRowClick,
}) {
  if (loading) {
    return (
      <div className="bg-white border rounded-xl p-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="bg-white border rounded-xl p-10 text-center text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  const cell = (col, row) => (col.render ? col.render(row) : row[col.key] ?? '—');

  const Wrapper = ({ row, children, className }) => {
    if (rowLink) {
      return (
        <Link to={rowLink(row)} className={className}>
          {children}
        </Link>
      );
    }
    return (
      <div
        className={className}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        role={onRowClick ? 'button' : undefined}
        tabIndex={onRowClick ? 0 : undefined}
        onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
      >
        {children}
      </div>
    );
  };

  const mobileColumns = columns.filter((c) => !c.mobileHidden);
  const primary = mobileColumns.find((c) => c.mobilePrimary) || mobileColumns[0];
  const secondary = mobileColumns.filter((c) => c !== primary);

  return (
    <>
      {/* Mobile: one card per row */}
      <div className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <Wrapper
            key={rowKey(row)}
            row={row}
            className="block bg-white border rounded-2xl p-4 shadow-sm space-y-2"
          >
            <div className="font-semibold text-slate-900">{cell(primary, row)}</div>
            <dl className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs">
              {secondary.map((col) => (
                <div key={col.key} className="min-w-0">
                  <dt className="text-slate-400 uppercase tracking-wide text-[10px]">{col.label}</dt>
                  <dd className="text-slate-700 truncate">{cell(col, row)}</dd>
                </div>
              ))}
            </dl>
          </Wrapper>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block bg-white border rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 font-medium whitespace-nowrap">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clickable = Boolean(rowLink || onRowClick);
              return (
                <tr
                  key={rowKey(row)}
                  className={`border-t border-slate-100 ${clickable ? 'hover:bg-slate-50 cursor-pointer' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col, idx) => (
                    <td key={col.key} className={`px-4 py-3 align-top ${col.className || ''}`}>
                      {idx === 0 && rowLink ? (
                        <Link to={rowLink(row)} className="text-brand font-medium hover:underline">
                          {cell(col, row)}
                        </Link>
                      ) : (
                        cell(col, row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
