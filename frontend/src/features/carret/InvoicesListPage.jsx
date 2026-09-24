import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, FilterBar, Panel, StatusChip, DocNumber, DateTime, Money, EmptyState, Button, StatTile,
} from '../../components/carret';
import { useInvoices } from './useMoney';

/**
 * Customer Invoices (Part 6.4).
 *
 * Three columns exist because Part 6.2 made the facts behind them true:
 *
 *   GST       BL7 — an invoice used to carry one number called gst_amount, with
 *             no place of supply and no split, so every inter-state supply was
 *             mis-classified. The column says IGST or CGST+SGST, and says
 *             "not classified" for anything raised before that existed rather
 *             than guessing.
 *   Due       BL9 — invoices had no due date at all, so nothing could be
 *             overdue and the overdue bucket was permanently zero.
 *   Outstanding  grand_total less what the ledger has actually received, which
 *             is the number the old list could not show.
 */

const STATUSES = ['draft', 'sent', 'overdue', 'paid', 'cancelled'];

function GstCell({ row }) {
  if (row.is_intra_state === null || row.is_intra_state === undefined) {
    return <span className="text-ink-3" title="Raised before the split existed">not classified</span>;
  }
  if (row.is_intra_state) {
    return (
      <span title={`Place of supply: ${row.place_of_supply || 'unknown'}`}>
        CGST + SGST <Money value={Number(row.cgst_amount || 0) + Number(row.sgst_amount || 0)} showZero={false} />
      </span>
    );
  }
  return (
    <span title={`Place of supply: ${row.place_of_supply || 'unknown'}`}>
      IGST <Money value={row.igst_amount} showZero={false} />
    </span>
  );
}

export default function InvoicesListPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});

  const { loading, error, rows, total } = useInvoices({
    status: filters.status || undefined,
    search: filters.search || undefined,
    limit: 200,
  });

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => setFilters({}), []);

  const outstanding = useMemo(
    () => rows.reduce((a, r) => {
      const st = String(r.status || '').toLowerCase();
      if (st === 'cancelled' || st === 'draft') return a;
      return a + Math.max(0, Number(r.grand_total || 0) - Number(r.amount_paid || 0));
    }, 0),
    [rows]
  );
  const overdueCount = rows.filter((r) => String(r.status || '').toLowerCase() === 'overdue').length;
  const unclassified = rows.filter((r) => r.is_intra_state === null || r.is_intra_state === undefined).length;

  const columns = useMemo(() => [
    { key: 'invoice_number', header: 'Invoice', render: (r) => <DocNumber value={r.invoice_number} /> },
    { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || `#${r.customer_id}` },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
    { key: 'invoice_date', header: 'Raised', render: (r) => <DateTime value={r.invoice_date} /> },
    {
      key: 'due_date',
      header: 'Due',
      render: (r) => {
        if (!r.due_date) return <span className="text-ink-3">—</span>;
        const overdue = String(r.status || '').toLowerCase() === 'overdue';
        return (
          <span style={{ color: overdue ? 'var(--alert-crit)' : undefined }}>
            <DateTime value={r.due_date} />
          </span>
        );
      },
    },
    { key: 'gst', header: 'GST', render: (r) => <GstCell row={r} /> },
    { key: 'grand_total', header: 'Total', numeric: true, render: (r) => <Money value={r.grand_total} /> },
    {
      key: 'outstanding',
      header: 'Outstanding',
      numeric: true,
      render: (r) => {
        const due = Math.max(0, Number(r.grand_total || 0) - Number(r.amount_paid || 0));
        return due ? <Money value={due} /> : <span className="text-ink-3">settled</span>;
      },
    },
  ], []);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Invoice number or customer' },
    { key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: s })) },
  ]), []);

  return (
    <DeskShell
      title="Customer Invoices"
      breadcrumb="Money"
      subtitle="GST invoices with the CGST/SGST or IGST split, due dates and live outstanding."
    >
      <div style={{ display: 'grid', gap: '16px' }}>
        <div
          style={{
            display: 'grid',
            gap: '12px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <StatTile label="Shown" value={loading ? null : total} />
          <StatTile label="Outstanding" value={loading ? null : <Money value={outstanding} showZero />} />
          <StatTile
            label="Overdue"
            value={loading ? null : overdueCount}
            family={overdueCount ? 'offcycle' : undefined}
          />
          <StatTile
            label="GST not classified"
            value={loading ? null : unclassified}
            delta="raised before the CGST/IGST split"
          />
        </div>

        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={`${total} shown`}
            />
          )}
        >
          {loading && <EmptyState title="Loading…" />}
          {error && <EmptyState title="Could not load invoices" body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.invoice_id}
              onRowClick={(r) => navigate(`/carret/money/invoices/${r.invoice_id}`)}
              empty={(
                <EmptyState
                  title="No invoices match"
                  body="Filters combine, so clearing one at a time will show what is excluding them."
                  action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>}
                />
              )}
            />
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
