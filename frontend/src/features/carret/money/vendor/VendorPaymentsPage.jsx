import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Money, Notice, Panel, StatTile,
} from '../../../../components/carret';
import { monthLabel, useBillableVendors, useVendorPayments } from './vendorMoneyApi';

/**
 * Finance → Vendors → Vendor payments.
 *
 * The payment ledger (payment_records, party_type 'vendor') already existed;
 * this is its first list across bills. A payment is recorded on the bill
 * itself (Vendor bill → Record payment), where the bill is locked and the
 * amount capped at what is still owed — so this page only reads.
 */
const PERIODS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function daysAgo(n) {
  return new Date(Date.now() + 5.5 * 3600 * 1000 - Number(n) * 86400000).toISOString().slice(0, 10);
}

export default function VendorPaymentsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({});
  const search = useDebounced(filters.search || '');
  const { vendors } = useBillableVendors();
  const { loading, error, rows, total, totalAmount } = useVendorPayments({
    search, vendor_id: filters.vendor_id, from: filters.period ? daysAgo(filters.period) : undefined, limit: 200,
  });

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => setFilters({}), []);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Bill number, vendor or reference' },
    { key: 'vendor_id', label: 'Vendor', options: vendors.map((v) => ({ value: String(v.vendor_id), label: v.vendor_name || `#${v.vendor_id}` })) },
    { key: 'period', label: 'Paid', options: PERIODS },
  ]), [vendors]);

  const columns = useMemo(() => [
    { key: 'd', header: 'Paid on', render: (p) => <DateTime value={p.payment_date} />, sub: (p) => (p.recorded_by_name ? `by ${p.recorded_by_name}` : null) },
    { key: 'v', header: 'Vendor', render: (p) => p.vendor_name || `#${p.vendor_id}` },
    { key: 'b', header: 'Bill', render: (p) => <DocNumber value={p.bill_number || '—'} />, sub: (p) => monthLabel(p.bill_month, p.bill_year) },
    { key: 'm', header: 'Method', render: (p) => (p.method || '—').toUpperCase() },
    { key: 'r', header: 'Reference', render: (p) => p.reference || '—', sub: (p) => p.notes || null },
    { key: 'a', header: 'Amount', numeric: true, render: (p) => <Money value={p.amount} /> },
  ], []);

  return (
    <DeskShell title="Vendor Payments" breadcrumb="Finance / Vendors" subtitle="Money paid to vendors against their bills.">
      <div className="c-stack">
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <StatTile label="Payments" value={loading ? null : total} />
          <StatTile label="Paid" value={loading ? null : <Money value={totalAmount} />} />
        </div>
        <Notice tone="info" title="To record a payment, open the bill">
          Payments are taken only on an approved bill and never for more than is still owed.
          <span style={{ marginLeft: '8px' }}><Button variant="quiet" onClick={() => navigate('/carret/money/vendor-bills')}>Vendor bills</Button></span>
        </Notice>
        <Panel
          toolbar={<FilterBar filters={filterDefs} values={filters} onChange={onFilter} onClear={onClear} count={loading ? '…' : `${total} shown`} />}
        >
          {loading && <EmptyState title="Loading…" />}
          {error && <EmptyState title="Could not load vendor payments" body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(p) => p.payment_id}
              onRowClick={(p) => p.bill_id && navigate(`/carret/money/vendor-bills/${p.bill_id}`)}
              empty={<EmptyState title="No vendor payments yet" body="Payments recorded on a vendor bill appear here." />}
            />
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
