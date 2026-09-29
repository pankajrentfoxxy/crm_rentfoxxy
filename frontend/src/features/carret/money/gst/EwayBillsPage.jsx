import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Input, Money, Notice, Panel, StatTile, StatusChip,
} from '../../../../components/carret';
import { fetchEwayRegister } from './gstApi';
import { errMsg, fmt } from './gstShared';

/**
 * Finance → GST & e-way → E-way bills.
 *
 * E-way bill numbers live on each document — customer challans (incl. demo),
 * vendor repair challans (VRDC), vendor return challans (VRTDC) and scrap
 * challans — so there was no one place to see them. This is that place:
 * read-only, newest first, each row opening its document. Numbers are attached
 * on the document itself (or, for customer challans, in the Invoice & e-way
 * queue); nothing is written from here.
 *
 * "Left without e-way" = the goods are worth ₹50,000 or more, the document has
 * no e-way number, and its status says it has already gone out.
 */

const TYPE_LABEL = {
  dc: 'Customer challan',
  demo_dc: 'Demo challan',
  vrdc: 'Vendor repair challan',
  vrtdc: 'Vendor return challan',
  scrap: 'Scrap challan',
};

const STATE_OPTIONS = [
  { value: 'left_without', label: 'Left without e-way' },
  { value: 'needed', label: 'Needed, not on file' },
  { value: 'on_file', label: 'On file' },
  { value: 'not_needed', label: 'Not needed' },
  { value: 'unknown', label: 'Value not declared' },
];

const VALUE_BASIS = {
  asset: 'laptop value',
  billed: 'billed value',
  declared: 'declared value',
  sale: 'sale value',
};

export function ewayDocPath(r) {
  const n = encodeURIComponent(r.doc_number);
  if (r.doc_type === 'dc' || r.doc_type === 'demo_dc') return `/carret/move/challans/${n}`;
  if (r.doc_type === 'vrtdc') return `/carret/procure/returns/${n}`;
  // Same target the Vendor returns → Repairs tab opens.
  if (r.doc_type === 'vrdc') return `/vendor-management/vendor-repair-dc/${n}`;
  return '/carret/stock/scrap';
}

function EwayCell({ row }) {
  if (row.eway_bill_number) return <DocNumber value={row.eway_bill_number} />;
  if (row.eway_state === 'cancelled') return <span className="text-ink-3">Cancelled</span>;
  if (row.left_without_eway) return <span style={{ color: 'var(--alert-crit)', fontWeight: 600 }}>! Left without e-way</span>;
  if (row.eway_state === 'needed') return <span style={{ color: 'var(--alert-serious)' }}>Needed</span>;
  if (row.eway_state === 'unknown') return <span className="text-ink-3">Value not declared</span>;
  return <span className="text-ink-3">Not needed</span>;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export default function EwayBillsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ from: isoDaysAgo(90), to: new Date().toISOString().slice(0, 10) });
  const [res, setRes] = useState(null);

  const load = useCallback(() => {
    setRes(null);
    fetchEwayRegister({
      type: filters.type || undefined,
      state: filters.state || undefined,
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      limit: 300,
    })
      .then(({ data }) => setRes(data))
      .catch((e) => { toast.error(errMsg(e, 'Could not load e-way bills')); setRes({ rows: [], counts: {}, total: 0 }); });
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(load, filters.search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, filters.search]);

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => setFilters((f) => ({ from: f.from, to: f.to })), []);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Document, party, e-way or order no.' },
    { key: 'type', label: 'Document', options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })) },
    { key: 'state', label: 'E-way', options: STATE_OPTIONS },
  ]), []);

  const columns = useMemo(() => [
    { key: 'doc_number', header: 'Document', render: (r) => <DocNumber value={r.doc_number} />, sub: (r) => TYPE_LABEL[r.doc_type] || r.doc_type },
    { key: 'created_at', header: 'Date', render: (r) => <DateTime value={r.created_at} />, sub: (r) => r.ref_number || null },
    { key: 'party', header: 'Party', render: (r) => r.party || '—' },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status || 'unknown'} /> },
    {
      key: 'value', header: 'Value', numeric: true,
      render: (r) => (r.value != null ? <Money value={r.value} /> : <span className="text-ink-3">—</span>),
      sub: (r) => (r.value_basis ? VALUE_BASIS[r.value_basis] || r.value_basis : null),
    },
    {
      key: 'eway_bill_number', header: 'E-way bill', render: (r) => <EwayCell row={r} />,
      sub: (r) => (r.eway_bill_number && !r.has_document && r.doc_type !== 'scrap' ? 'no document on file' : null),
    },
    {
      key: 'eway_bill_date', header: 'E-way date', render: (r) => (r.eway_bill_date ? <DateTime value={r.eway_bill_date} /> : <span className="text-ink-3">—</span>),
      sub: (r) => (r.eway_valid_till ? `valid till ${new Date(r.eway_valid_till).toLocaleDateString('en-IN')}` : null),
    },
    { key: 'vehicle_number', header: 'Vehicle', render: (r) => (r.vehicle_number ? <span className="font-mono">{r.vehicle_number}</span> : <span className="text-ink-3">—</span>) },
  ], []);

  const counts = res?.counts || {};
  const loading = res === null;

  return (
    <DeskShell
      title="E-way bills"
      breadcrumb="Finance · GST & e-way"
      subtitle="Every e-way bill across customer, demo, vendor repair, vendor return and scrap challans — and every document that should have had one."
    >
      <div className="c-stack">
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <StatTile label="E-way on file" value={loading ? null : counts.on_file ?? 0} />
          <StatTile label="Needed, not on file" value={loading ? null : counts.needed ?? 0} family={counts.needed ? 'offcycle' : undefined} />
          <StatTile
            label="Left without e-way"
            value={loading ? null : counts.left_without ?? 0}
            family={counts.left_without ? 'offcycle' : undefined}
            delta={`worth ${fmt(res?.threshold || 50000)} or more`}
          />
          <StatTile label="Value not declared" value={loading ? null : counts.unknown ?? 0} delta="vendor challans with no price" />
        </div>

        {!loading && counts.left_without > 0 && !filters.state && (
          <Notice
            tone="crit"
            title={`${counts.left_without} ${counts.left_without === 1 ? 'document has' : 'documents have'} gone out without an e-way bill`}
            action={<Button onClick={() => onFilter('state', 'left_without')}>Show them</Button>}
          >
            Each is worth {fmt(res?.threshold || 50000)} or more and its status says it has left. Attach the number on the document, or check the value.
          </Notice>
        )}
        {res?.truncated && <Notice tone="warn">Only the newest 2,000 documents in this period are counted — narrow the dates.</Notice>}

        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={loading ? '' : `${res.rows.length} of ${res.total}`}
              right={(
                <div className="flex items-center" style={{ gap: '6px' }}>
                  <label className="sr-only" htmlFor="ewb-from">From</label>
                  <Input id="ewb-from" type="date" value={filters.from || ''} onChange={(e) => onFilter('from', e.target.value)} style={{ width: 'auto' }} />
                  <span className="text-ink-3">to</span>
                  <label className="sr-only" htmlFor="ewb-to">To</label>
                  <Input id="ewb-to" type="date" value={filters.to || ''} onChange={(e) => onFilter('to', e.target.value)} style={{ width: 'auto' }} />
                </div>
              )}
            />
          )}
        >
          {loading ? <EmptyState title="Loading…" body="Valuing the documents in this period." /> : (
            <DataTable
              columns={columns}
              rows={res.rows}
              rowKey={(r) => `${r.doc_type}:${r.doc_number}`}
              onRowClick={(r) => navigate(ewayDocPath(r))}
              empty={<EmptyState title="No documents match" body="Filters combine; widen the dates or clear one filter at a time." />}
            />
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}
