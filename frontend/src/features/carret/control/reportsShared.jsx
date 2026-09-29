import React from 'react';
import toast from 'react-hot-toast';
import {
  Button, DataTable, DateTime, EmptyState, KeyValue, Money, Section, StatTile,
} from '../../../components/carret';

/**
 * Rendering for Control → Reports. A report (reportsCatalog.js) turns its API
 * response into plain "blocks" — stat groups and tables — and these components
 * draw them, so fourteen reports share one look and every table can be saved
 * as CSV. Nothing here fetches; drills are specs the page opens in a drawer.
 */

export const humanise = (s) => String(s || '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .replace(/^\w/, (c) => c.toUpperCase());

const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const looksDate = (k) => /(_date|_at|^date$|^created$)/.test(k);

/** Columns from the first rows' scalar fields, when a block names none. */
export function autoColumns(rows) {
  const keys = [];
  (rows || []).slice(0, 20).forEach((r) => {
    Object.keys(r || {}).forEach((k) => {
      if (!keys.includes(k) && isScalar(r[k])) keys.push(k);
    });
  });
  return keys.map((k) => ({ key: k, label: humanise(k), kind: looksDate(k) ? 'date' : undefined }));
}

export function formatPlain(value, kind) {
  if (value === null || value === undefined || value === '') return '';
  if (kind === 'money') return Number(value || 0).toFixed(2);
  if (kind === 'date') return String(value).slice(0, 10);
  return String(value);
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadBlob(data, fileName, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(rows, columns, name) {
  const cols = columns?.length ? columns : autoColumns(rows);
  const lines = [cols.map((c) => csvCell(c.label)).join(',')];
  (rows || []).forEach((r) => {
    lines.push(cols.map((c) => csvCell(formatPlain(c.value ? c.value(r) : r?.[c.key], c.kind))).join(','));
  });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(`﻿${lines.join('\n')}`, `${name || 'report'}_${date}.csv`, 'text/csv;charset=utf-8');
}

/** Collect every page of a paginated endpoint (for CSV). fetchPage(page) → { rows, totalPages }. */
export async function fetchAllPages(fetchPage, maxPages = 60) {
  const out = [];
  let page = 1;
  let total = 1;
  do {
    // eslint-disable-next-line no-await-in-loop
    const { rows, totalPages } = await fetchPage(page);
    out.push(...(rows || []));
    total = Math.min(maxPages, Number(totalPages) || 1);
    page += 1;
  } while (page <= total);
  return out;
}

export function ReportCell({ row, col, onDrill }) {
  const raw = col.value ? col.value(row) : row?.[col.key];
  let shown;
  if (raw === null || raw === undefined || raw === '') shown = '—';
  else if (col.kind === 'money') shown = <Money value={raw} />;
  else if (col.kind === 'date') shown = <DateTime value={raw} />;
  else if (col.kind === 'pct') shown = `${Number(raw).toFixed(1)}%`;
  else if (typeof raw === 'boolean') shown = raw ? 'Yes' : 'No';
  else shown = String(raw);
  const drill = col.drill && onDrill ? col.drill(row) : null;
  if (drill && raw !== 0 && raw !== '0' && shown !== '—') {
    return (
      <button type="button" className="c-link bg-transparent border-0 cursor-pointer" style={{ padding: 0, color: 'var(--accent)', font: 'inherit' }} onClick={(e) => { e.stopPropagation(); onDrill(drill); }}>
        {shown}
      </button>
    );
  }
  return shown;
}

export function ReportTable({ rows, columns, onDrill, onRow, rowKey, emptyTitle = 'Nothing in this range' }) {
  const cols = (columns?.length ? columns : autoColumns(rows)).map((c) => ({
    key: c.key,
    header: c.label,
    numeric: ['money', 'num', 'pct'].includes(c.kind),
    render: (r) => <ReportCell row={r} col={c} onDrill={onDrill} />,
  }));
  return (
    <DataTable
      columns={cols}
      rows={rows || []}
      rowKey={rowKey || ((r, i) => i)}
      onRowClick={onRow ? (r) => { const d = onRow(r); if (d && onDrill) onDrill(d); } : undefined}
      empty={<EmptyState title={emptyTitle} />}
    />
  );
}

function StatsBlock({ block, onDrill }) {
  return (
    <Section title={block.title}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        {block.items.map((it) => {
          const v = it.value;
          const shown = v === null || v === undefined ? null
            : it.kind === 'money' ? <Money value={v} />
              : it.kind === 'pct' ? `${Number(v).toFixed(1)}%`
                : Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-IN') : String(v);
          const tile = <StatTile label={it.label} value={shown} />;
          if (it.drill && onDrill && Number(v) > 0) {
            return (
              <button key={it.label} type="button" className="bg-transparent border-0 cursor-pointer" style={{ padding: 0, textAlign: 'left', font: 'inherit', color: 'inherit' }} onClick={() => onDrill(it.drill)} title="Show the list">
                {tile}
              </button>
            );
          }
          return <React.Fragment key={it.label}>{tile}</React.Fragment>;
        })}
      </div>
    </Section>
  );
}

function TableBlock({ block, onDrill, onPage }) {
  const pg = block.pagination;
  return (
    <Section
      title={block.title}
      actions={(
        <Button
          variant="quiet"
          disabled={!(block.rows || []).length && !block.csvAll}
          onClick={async () => {
            try {
              const rows = block.csvAll ? await block.csvAll() : block.rows;
              downloadCsv(rows, block.columns, block.csv || block.title);
            } catch (e) { toast.error(e?.response?.data?.message || 'Download failed'); }
          }}
        >
          CSV
        </Button>
      )}
    >
      <div className="c-stack">
        {block.note && <p className="text-ink-3">{block.note}</p>}
        <ReportTable rows={block.rows} columns={block.columns} onDrill={onDrill} onRow={block.onRow} />
        {pg && (pg.totalPages || 1) > 1 && (
          <div className="flex items-center" style={{ gap: '8px' }}>
            <Button variant="quiet" disabled={pg.page <= 1} onClick={() => onPage(pg.page - 1)}>Previous</Button>
            <span className="text-ink-3">Page {pg.page} of {pg.totalPages} · {pg.total} rows</span>
            <Button variant="quiet" disabled={pg.page >= pg.totalPages} onClick={() => onPage(pg.page + 1)}>Next</Button>
          </div>
        )}
      </div>
    </Section>
  );
}

export function ReportBlocks({ blocks, onDrill, onPage }) {
  return (
    <div className="c-stack">
      {(blocks || []).filter(Boolean).map((b) => (b.kind === 'stats'
        ? <StatsBlock key={b.title} block={b} onDrill={onDrill} />
        : <TableBlock key={b.title} block={b} onDrill={onDrill} onPage={onPage} />))}
    </div>
  );
}

/** A single record (e.g. one QC attempt): scalars as label/value, objects and lists as tables. */
export function RecordView({ record }) {
  if (!record) return null;
  const scalars = Object.entries(record).filter(([, v]) => isScalar(v));
  const objects = Object.entries(record).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  const lists = Object.entries(record).filter(([, v]) => Array.isArray(v) && v.length);
  return (
    <div className="c-stack">
      <KeyValue cols={2} items={scalars.map(([k, v]) => ({ label: humanise(k), value: v === null ? null : String(v) }))} />
      {objects.map(([k, v]) => (
        <Section key={k} title={humanise(k)}>
          <ReportTable rows={Object.entries(v).map(([name, val]) => ({ item: humanise(name), value: isScalar(val) ? val : JSON.stringify(val) }))} columns={[{ key: 'item', label: 'Item' }, { key: 'value', label: 'Value' }]} />
        </Section>
      ))}
      {lists.map(([k, v]) => (
        <Section key={k} title={humanise(k)}>
          {isScalar(v[0]) ? <p>{v.join(', ')}</p> : <ReportTable rows={v} />}
        </Section>
      ))}
    </div>
  );
}
