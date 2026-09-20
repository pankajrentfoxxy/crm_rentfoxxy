import React, { useRef, useCallback } from 'react';
import EmptyState from './EmptyState';

/**
 * Replaces ResponsiveTable, which reached 9 of 133 files.
 *
 * Horizontal scroll lives in this container, never on the page body — a table
 * that is too wide is a table problem, and making the whole page scroll
 * sideways to read one column is the thing that breaks every phone layout.
 *
 * columns: [{ key, header, align?, numeric?, width?, render?(row) }]
 */
export default function DataTable({
  columns = [],
  rows = [],
  rowKey = (row, i) => row?.id ?? i,
  onRowClick,
  empty,
  className = '',
}) {
  const bodyRef = useRef(null);

  // Up and down move between rows; Enter opens. Without this a keyboard user
  // has to tab through every cell to reach the next record.
  const onKeyDown = useCallback((e) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
    const items = Array.from(bodyRef.current?.querySelectorAll('[data-row]') || []);
    const idx = items.indexOf(e.target.closest('[data-row]'));
    if (idx < 0) return;
    if (e.key === 'Enter') { onRowClick?.(rows[idx], idx); return; }
    e.preventDefault();
    const next = items[idx + (e.key === 'ArrowDown' ? 1 : -1)];
    next?.focus();
  }, [rows, onRowClick]);

  if (!rows.length) {
    return empty || <EmptyState title="No records found" />;
  }

  return (
    <div className={`w-full overflow-x-auto border border-rule bg-surface ${className}`} style={{ borderRadius: 'var(--d-radius)' }}>
      <table className="w-full border-collapse font-ui" style={{ fontSize: 'var(--d-base)' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="sticky top-0 z-10 bg-surface-2 text-ink-3 font-ui text-left border-b border-rule whitespace-nowrap"
                style={{
                  fontSize: 'var(--d-sm)',
                  fontWeight: 500,
                  padding: 'var(--d-pad-y) var(--d-pad-x)',
                  textAlign: c.align || (c.numeric ? 'right' : 'left'),
                  width: c.width,
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={bodyRef} onKeyDown={onKeyDown}>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              data-row
              tabIndex={0}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              className={`border-b border-rule-2 text-ink-2 ${onRowClick ? 'cursor-pointer hover:bg-surface-2' : ''}`}
              style={{ height: 'var(--d-row)' }}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={c.numeric ? 'tabular-nums font-mono text-ink' : ''}
                  style={{
                    padding: 'var(--d-pad-y) var(--d-pad-x)',
                    textAlign: c.align || (c.numeric ? 'right' : 'left'),
                  }}
                >
                  {c.render ? c.render(row, i) : row?.[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
