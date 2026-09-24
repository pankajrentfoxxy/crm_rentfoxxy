import React, { useRef, useCallback } from 'react';
import EmptyState from './EmptyState';

/**
 * Replaces ResponsiveTable, which reached 9 of 133 files.
 *
 * Horizontal scroll lives in this container, never on the page body — a table
 * that is too wide is a table problem, and making the whole page scroll
 * sideways to read one column is the thing that breaks every phone layout.
 *
 * The first column is the row's name and reads in full ink; the rest read one
 * step quieter so the eye lands on what the row IS before what it holds.
 *
 * columns: [{ key, header, align?, numeric?, width?, render?(row), sub?(row) }]
 * `sub` renders a second, monospace line under the value (a code under a name).
 * Inside a <Panel> the table drops its own frame and sits under the toolbar.
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
    <div className={`c-table-wrap ${className}`}>
      <table className="c-table font-ui">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ textAlign: c.align || (c.numeric ? 'right' : 'left'), width: c.width }}
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
              className={onRowClick ? 'is-click' : ''}
            >
              {columns.map((c, ci) => {
                const sub = c.sub?.(row, i);
                return (
                  <td
                    key={c.key}
                    className={[
                      ci === 0 ? 'is-primary' : '',
                      c.numeric ? 'is-num font-mono' : '',
                    ].join(' ').trim() || undefined}
                    style={c.align ? { textAlign: c.align } : undefined}
                  >
                    {c.render ? c.render(row, i) : row?.[c.key] ?? '—'}
                    {sub ? <span className="c-sub">{sub}</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
