import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Input, Panel, StatusChip,
} from '../../../components/carret';
import { fetchPartChallansRegister } from './serveApi';
import { errMsg } from './serveShared';

/**
 * Parts desk → Challans & DCs → "All challans": every technician part challan,
 * Part DC to a customer and old-part return DC (RPDC), open and closed, newest
 * first. The sections above it on the tab are the open work; this is the book.
 * Backend: GET /support-parts/challans-register (warehouse section, paged ≤ 200).
 * A row opens the same record page the open lists open.
 */
const PAGE_SIZE = 50;
const TYPE_OPTIONS = [
  { value: 'technician_challan', label: 'Technician challan' },
  { value: 'part_dc', label: 'Part DC to customer' },
  { value: 'return_dc', label: 'Old-part return DC' },
];
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));
// The document's own status value → the chip tone it borrows and the words shown.
const STATUS = {
  draft: { chip: 'pending', label: 'Waiting for signature' },
  issued: { chip: 'issued', label: 'Issued' },
  partially_returned: { chip: 'partial', label: 'Part returned' },
  fully_returned: { chip: 'closed', label: 'All returned' },
  processing: { chip: 'pending', label: 'Courier not added' },
  in_transit: { chip: 'dispatched', label: 'In transit' },
  delivered: { chip: 'delivered', label: 'Delivered / received' },
};
const STATUS_OPTIONS = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));
const statusChip = (r) => {
  const s = STATUS[r.status];
  const label = r.type === 'return_dc' && r.status === 'delivered' ? 'Received' : s?.label;
  return <StatusChip status={s?.chip || r.status} label={label} />;
};

export const partRecordPath = (r) => (r.type === 'technician_challan'
  ? `/carret/serve/parts-challans/${r.challan_id}`
  : `/carret/serve/${r.type === 'part_dc' ? 'part-dcs' : 'part-return-dcs'}/${encodeURIComponent(r.dc_number)}`);

const COLUMNS = [
  { key: 'n', header: 'Number', render: (r) => <DocNumber value={r.number} />, sub: (r) => TYPE_LABEL[r.type] || r.type },
  { key: 'd', header: 'Date', render: (r) => <DateTime value={r.doc_date} /> },
  { key: 'c', header: 'Customer', render: (r) => r.customer_name || '—', sub: (r) => [r.ticket_number, r.ttspl_id].filter(Boolean).join(' · ') || null },
  {
    key: 't',
    header: 'Technician',
    render: (r) => r.technician_name || '—',
    sub: (r) => (r.type === 'technician_challan' ? null : (r.ship_by === 'by_hand' ? 'By hand' : [r.courier_name, r.awb_number].filter(Boolean).join(' · ') || null)),
  },
  { key: 'p', header: 'Parts', numeric: true, render: (r) => r.parts_count },
  { key: 's', header: 'Status', render: statusChip },
];

const EMPTY_FILTERS = { type: '', status: '', search: '', from: '', to: '' };

export default function PartChallansRegister() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, rows: [], total: 0, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const params = {
      type: filters.type || undefined,
      status: filters.status || undefined,
      search: filters.search.trim() || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    };
    // Debounce typing in the search box; other filters load at once.
    const t = setTimeout(() => {
      fetchPartChallansRegister(params)
        .then(({ data }) => { if (!cancelled) setState({ loading: false, rows: data?.rows || [], total: data?.total || 0, error: null }); })
        .catch((e) => { if (!cancelled) setState({ loading: false, rows: [], total: 0, error: errMsg(e, 'Could not load the register.') }); });
    }, filters.search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [filters, page]);

  const set = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  const filterDefs = useMemo(() => [
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Number, customer, technician, ticket, TTSPL' },
    { key: 'type', label: 'Type', options: TYPE_OPTIONS },
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
  ], []);

  return (
    <Panel
      title="All challans"
      toolbar={(
        <FilterBar
          filters={filterDefs}
          values={filters}
          onChange={set}
          onClear={() => { setFilters(EMPTY_FILTERS); setPage(1); }}
          count={`${state.total} ${state.total === 1 ? 'document' : 'documents'}`}
          right={(
            <span className="c-parts-register-dates">
              <Input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(e) => set('from', e.target.value)} />
              <span className="text-ink-3">to</span>
              <Input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} />
            </span>
          )}
        />
      )}
    >
      {state.loading && !state.rows.length && <EmptyState title="Loading…" />}
      {state.error && <EmptyState title="Could not load the register" body={state.error} />}
      {!state.error && !(state.loading && !state.rows.length) && (
        <DataTable
          columns={COLUMNS}
          rows={state.rows}
          rowKey={(r) => `${r.type}:${r.number}`}
          onRowClick={(r) => navigate(partRecordPath(r))}
          empty={<EmptyState title="No challans match" />}
        />
      )}
      {pages > 1 && (
        <div className="c-toolbar c-parts-register-pager">
          <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="font-ui text-ink-3">Page {page} of {pages}</span>
          <Button variant="quiet" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </Panel>
  );
}
