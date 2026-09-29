import React, { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, DateTime, DocNumber, Drawer, Panel, EmptyState, Button, FilterBar, Money, Segmented, StatTile,
} from '../../components/carret';
import { useAgeing, useStatement, runOverdueSweep } from './useMoney';
import { MoneyChip, Tiles } from './money/moneyShared';

/**
 * Ageing & Outstanding (Part 6.4).
 *
 * This screen could not have been built before Part 6.2, because the two facts
 * it rests on did not exist. Invoices had no due date, so there was nothing to
 * be overdue against; and nothing ever moved an invoice from sent to overdue
 * (BL9), so the overdue figure on the old finance screen was permanently zero.
 *
 * The buckets are the standard five. The one that matters is 90+: money that
 * old is usually money in dispute or money gone, and until now nothing in this
 * system could tell you it existed.
 *
 * A customer row opens their statement of account (every invoice, approved
 * credit note and payment with a running balance) and links to their invoices.
 */

const BUCKETS = [
  { key: 'not_due', label: 'Not due' },
  { key: 'days_1_30', label: '1–30 days' },
  { key: 'days_31_60', label: '31–60' },
  { key: 'days_61_90', label: '61–90' },
  { key: 'days_90_plus', label: '90+' },
];

const ENTRY_LABEL = { invoice: 'Invoice', credit_note: 'Credit note', payment: 'Payment' };

/**
 * One customer's statement. The API runs the balance from the customer's first
 * entry, so the opening balance is nil and the closing balance is what they owe
 * on paper — it can differ from the ageing figure, which counts only issued,
 * unpaid invoices (drafts are in the statement, not in ageing).
 */
function StatementDrawer({ customer, onClose }) {
  const customerId = customer?.customer_id;
  const { loading, error, entries, closingBalance } = useStatement(customerId);
  const [kind, setKind] = useState('all');

  const sums = useMemo(() => entries.reduce((a, e) => {
    a[e.entry_type] = (a[e.entry_type] || 0) + (e.entry_type === 'invoice' ? e.debit : e.credit);
    a.count[e.entry_type] = (a.count[e.entry_type] || 0) + 1;
    return a;
  }, { count: {} }), [entries]);
  const shown = useMemo(() => (kind === 'all' ? entries : entries.filter((e) => e.entry_type === kind)), [entries, kind]);

  const cols = [
    { key: 'd', header: 'Date', render: (e) => <DateTime value={e.entry_date} /> },
    {
      key: 'r',
      header: 'Entry',
      render: (e) => (e.reference ? <DocNumber value={e.reference} /> : '—'),
      sub: (e) => ENTRY_LABEL[e.entry_type] || e.entry_type,
    },
    { key: 's', header: 'Status', render: (e) => (e.entry_type === 'payment' ? <span className="text-ink-3">received</span> : <MoneyChip status={e.status} />) },
    { key: 'dr', header: 'Debit', numeric: true, render: (e) => <Money value={e.debit} showZero={false} /> },
    { key: 'cr', header: 'Credit', numeric: true, render: (e) => <Money value={e.credit} showZero={false} /> },
    { key: 'b', header: 'Balance', numeric: true, render: (e) => <Money value={e.balance} /> },
  ];

  return (
    <Drawer
      open={Boolean(customer)}
      onClose={onClose}
      width="56rem"
      title={`Statement — ${customer?.customer_name || `#${customerId || ''}`}`}
      footer={customerId ? (
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Link className="c-btn c-btn--primary" to={`/carret/money/invoices?customer=${customerId}`}>Open their invoices</Link>
          <Link className="c-btn c-btn--quiet" to={`/carret/sell/customers/${customerId}`}>Customer record</Link>
        </div>
      ) : null}
    >
      <div className="c-stack">
        <Tiles>
          <StatTile label="Opening balance" value={loading ? null : <Money value={0} showZero />} delta="from the first entry" />
          <StatTile label="Invoiced" value={loading ? null : <Money value={sums.invoice || 0} showZero />} delta={`${sums.count.invoice || 0} invoice(s)`} />
          <StatTile label="Received" value={loading ? null : <Money value={sums.payment || 0} showZero />} delta={`${sums.count.payment || 0} payment(s)`} />
          <StatTile label="Credited" value={loading ? null : <Money value={sums.credit_note || 0} showZero />} delta={`${sums.count.credit_note || 0} credit note(s)`} />
          <StatTile
            label="Closing balance"
            value={loading ? null : <Money value={closingBalance} showZero />}
            family={Number(closingBalance) > 0 ? 'offcycle' : undefined}
            delta={customer ? <span>Ageing says <Money value={customer.outstanding} /></span> : undefined}
          />
        </Tiles>
        <Segmented
          label="Show"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: `All ${entries.length}` },
            { value: 'invoice', label: `Invoices ${sums.count.invoice || 0}` },
            { value: 'payment', label: `Payments ${sums.count.payment || 0}` },
            { value: 'credit_note', label: `Credit notes ${sums.count.credit_note || 0}` },
          ]}
        />
        {loading && <EmptyState title="Loading…" />}
        {error && <EmptyState title="Could not load the statement" body={error} />}
        {!loading && !error && (
          <DataTable
            columns={cols}
            rows={shown}
            rowKey={(e, i) => `${e.entry_type}-${e.reference || ''}-${e.entry_date}-${i}`}
            empty={<EmptyState title="Nothing on this statement" body="Cancelled invoices and credit notes awaiting approval are left out." />}
          />
        )}
      </div>
    </Drawer>
  );
}

export default function AgeingPage() {
  const { loading, error, rows, totals, refresh } = useAgeing({});
  const [sweeping, setSweeping] = useState(false);
  const [sweepNote, setSweepNote] = useState('');
  const [filters, setFilters] = useState({ search: '' });
  const [open, setOpen] = useState(null);

  const shownRows = useMemo(() => {
    const words = String(filters.search || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((r) => {
      const hay = `${r.customer_name || ''} #${r.customer_id}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, filters.search]);
  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => setFilters({ search: '' }), []);

  const onSweep = useCallback(async () => {
    setSweeping(true);
    setSweepNote('');
    try {
      const { data } = await runOverdueSweep();
      setSweepNote(data?.message || 'Sweep complete');
      refresh();
    } catch (err) {
      setSweepNote(err?.response?.data?.message || 'Sweep failed');
    } finally {
      setSweeping(false);
    }
  }, [refresh]);

  const columns = useMemo(() => [
    { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || `#${r.customer_id}` },
    { key: 'invoice_count', header: 'Invoices', numeric: true },
    ...BUCKETS.map((b) => ({
      key: b.key,
      header: b.label,
      numeric: true,
      render: (r) => {
        const v = Number(r[b.key] || 0);
        if (!v) return <span className="text-ink-3">—</span>;
        const severe = b.key === 'days_90_plus';
        const warn = b.key === 'days_61_90';
        return (
          <span style={{ color: severe ? 'var(--alert-crit)' : warn ? 'var(--alert-serious)' : undefined }}>
            <Money value={v} showZero={false} />
          </span>
        );
      },
    })),
    {
      key: 'outstanding',
      header: 'Outstanding',
      numeric: true,
      render: (r) => <strong><Money value={r.outstanding} /></strong>,
    },
    {
      key: 'invoices',
      header: '',
      align: 'right',
      render: (r) => (
        <span className="c-row-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
          <Link className="c-btn c-btn--quiet" to={`/carret/money/invoices?customer=${r.customer_id}`}>Invoices</Link>
        </span>
      ),
    },
  ], []);

  return (
    <DeskShell
      title="Ageing & Outstanding"
      breadcrumb="Finance"
      subtitle="What each customer owes, bucketed by how long it has been due."
      actions={(
        <Button variant="secondary" onClick={onSweep} disabled={sweeping}>
          {sweeping ? 'Running…' : 'Run overdue sweep'}
        </Button>
      )}
    >
      <div className="c-stack">
        <Tiles>
          <StatTile
            label="Total outstanding"
            value={loading ? null : <Money value={totals.outstanding || 0} />}
          />
          {BUCKETS.map((b) => (
            <StatTile
              key={b.key}
              label={b.label}
              value={loading ? null : <Money value={totals[b.key] || 0} showZero />}
              family={b.key === 'days_90_plus' && Number(totals[b.key] || 0) > 0 ? 'offcycle' : undefined}
            />
          ))}
        </Tiles>

        {sweepNote ? (
          <p className="font-ui text-ink-2 m-0" style={{ fontSize: 'var(--d-sm)' }}>{sweepNote}</p>
        ) : null}

        <Panel
          title="Outstanding by customer"
          toolbar={(
            <FilterBar
              filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'Customer name' }]}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={loading ? '…' : `${shownRows.length} customer(s)`}
            />
          )}
        >
          {loading && <EmptyState title="Loading…" />}
          {error && <EmptyState title="Could not load ageing" body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={shownRows}
              rowKey={(r) => r.customer_id}
              onRowClick={(r) => setOpen(r)}
              empty={filters.search ? <EmptyState title="No customer matches" action={<Button variant="quiet" onClick={onClear}>Clear search</Button>} /> : (
                <EmptyState
                  title="Nothing outstanding"
                  body={
                    'Only issued invoices age. An invoice still in draft has not been sent to '
                    + 'anybody, so it is not owed — and drafts are excluded here deliberately.'
                  }
                />
              )}
            />
          )}
        </Panel>
      </div>

      <StatementDrawer customer={open} onClose={() => setOpen(null)} />
    </DeskShell>
  );
}
