import { PRIMARY, cardStyle, TABLE_HEADER_BG, TABLE_HEADER_TEXT, TABLE_HEADER_BORDER } from './theme';

const tdBase = { padding: '12px 16px', fontSize: 13 };

export function TableContainer({ children, toolbar, title }) {
  return (
    <div style={{ ...cardStyle, overflow: 'hidden' }}>
      {(toolbar || title) && (
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', gap: 12
        }}>
          {title && (
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</h3>
          )}
          {toolbar}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  );
}

export function Table({ columns, children, minWidth }) {
  return (
    <table style={{ width: '100%', minWidth: minWidth || undefined, borderCollapse: 'collapse', fontSize: 13 }}>
      {columns?.length > 0 && (
        <thead>
          <tr style={{ background: TABLE_HEADER_BG }}>
            {columns.map((col, i) => (
              <th key={i} style={{
                padding: '12px 16px', textAlign: col.align || 'left', fontWeight: 600,
                color: TABLE_HEADER_TEXT, fontSize: 12, whiteSpace: 'nowrap',
                borderBottom: `1px solid ${TABLE_HEADER_BORDER}`
              }}>
                {typeof col === 'string' ? col : col.label}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>{children}</tbody>
    </table>
  );
}

export function TableRow({ children, onClick, style }) {
  const defaultBg = style?.background || '';
  return (
    <tr
      style={{ borderBottom: '1px solid #f8fafc', transition: 'background .15s', cursor: onClick ? 'pointer' : undefined, ...style }}
      onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.background = '#f0f7ff'; }}
      onMouseLeave={e => { e.currentTarget.style.background = defaultBg; }}
    >
      {children}
    </tr>
  );
}

export function TableCell({
  children, align = 'left', bold, muted, small, nowrap, colSpan, style
}) {
  return (
    <td colSpan={colSpan} style={{
      ...tdBase,
      textAlign: align,
      color: muted ? '#64748b' : '#0f172a',
      fontWeight: bold ? (bold === true ? 600 : bold) : 400,
      fontSize: small ? 12 : 13,
      whiteSpace: nowrap ? 'nowrap' : undefined,
      ...style
    }}>
      {children}
    </td>
  );
}

export function TableEmpty({ colSpan, message = 'No data found.' }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ ...tdBase, textAlign: 'center', color: '#94a3b8', padding: '32px 16px' }}>
        {message}
      </td>
    </tr>
  );
}

export function Pagination({ current = 1, total = 0, pageSize = 10, onChange, pageSizeOptions }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);

  const pages = [];
  const maxVisible = 5;
  let startPage = Math.max(1, current - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage + 1 < maxVisible) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }
  for (let p = startPage; p <= endPage; p++) pages.push(p);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 20px', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap', gap: 10, width: '100%'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {pageSizeOptions && (
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            Rows{' '}
            <select
              value={pageSize}
              onChange={e => pageSizeOptions.onChange(Number(e.target.value))}
              style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 4px', fontSize: 12, color: '#475569' }}
            >
              {pageSizeOptions.options.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </span>
        )}
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {total === 0 ? 'No results' : `Showing ${start}–${end} of ${total}`}
        </span>
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexShrink: 0 }}>
          <PaginationBtn disabled={current <= 1} onClick={() => onChange?.(current - 1)}>‹</PaginationBtn>
          {pages.map(p => (
            <PaginationBtn key={p} active={p === current} onClick={() => onChange?.(p)}>{p}</PaginationBtn>
          ))}
          <PaginationBtn disabled={current >= totalPages} onClick={() => onChange?.(current + 1)}>›</PaginationBtn>
        </div>
      )}
    </div>
  );
}

function PaginationBtn({ children, active, onClick, disabled }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        minWidth: 30, height: 30, borderRadius: 8,
        border: active ? 'none' : '1px solid #e2e8f0',
        background: active ? PRIMARY : '#fff',
        color: active ? '#fff' : disabled ? '#cbd5e1' : '#475569',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12, fontWeight: 500, padding: '0 6px'
      }}
    >
      {children}
    </button>
  );
}

/** Convenience wrapper: columns + data rows via renderRow */
export function DataTable({
  columns,
  data = [],
  renderRow,
  toolbar,
  title,
  minWidth,
  emptyMessage = 'No data found.',
  pagination,
}) {
  return (
    <TableContainer toolbar={toolbar} title={title}>
      <Table columns={columns} minWidth={minWidth}>
        {data.length === 0 ? (
          <TableEmpty colSpan={columns.length} message={emptyMessage} />
        ) : (
          data.map((item, i) => renderRow(item, i))
        )}
      </Table>
      {pagination && <Pagination {...pagination} />}
    </TableContainer>
  );
}
