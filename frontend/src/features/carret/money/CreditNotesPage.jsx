import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Money, Panel, SearchSelect, Segmented, StatTile,
  Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  MONTHS, MONTH_OPTIONS, approveCreditNotesBulk, blobErrMsg, creditNotesZip, errMsg, listCreditNoteLaptops,
  listCreditNotes, saveBlob, useCustomerOptions, yearOptions,
} from './moneyApi';
import { MoneyChip, Pager, Tiles } from './moneyShared';
import { GenerateCreditNotesDrawer } from './CreditNoteDrawers';

/**
 * Finance → Credit notes (Builder 1, MD2). The old list, laptop view and
 * review screens in one: status tabs with counts and amounts, type / month /
 * year / customer / search filters, a By-note or By-laptop view, bulk approve
 * (a different person from the maker), generate return drafts, the month's
 * PDFs, and a manual note against an issued invoice. In the laptop view each
 * TTSPL opens the asset record (its history), which replaces the old modal.
 */

const TYPES = [
  { value: 'return', label: 'Return' },
  { value: 'repair', label: 'Repair' },
  { value: 'manual', label: 'Manual' },
  { value: 'other', label: 'Other' },
];

export default function CreditNotesPage() {
  const navigate = useNavigate();
  const { hasPermission, user } = usePermission();
  const canCreate = hasPermission('credit_notes', 'create');
  const canApprove = hasPermission('credit_notes', 'edit');
  const customerOptions = useCustomerOptions();
  const me = Number(user?.user_id || user?.id || 0);

  const [tab, setTab] = useState('pending');
  const [view, setView] = useState('notes');
  const [filters, setFilters] = useState({ search: '', type: '', month: '', year: '' });
  const [customerId, setCustomerId] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, rows: [], summary: {}, total: 0, totalPages: 1 });
  const [picked, setPicked] = useState(new Set());
  const [nonce, setNonce] = useState(0);
  const [genOpen, setGenOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const search = useDebouncedValue(filters.search);

  const params = useMemo(() => {
    const p = { page, limit: 50 };
    if (tab !== 'all') p.status = tab;
    if (customerId) p.customer_id = customerId;
    if (filters.type) p.type = filters.type;
    if (filters.month) p.month = filters.month;
    if (filters.year) p.year = filters.year;
    if (search.trim()) p.search = search.trim();
    return p;
  }, [page, tab, customerId, filters.type, filters.month, filters.year, search]);

  useEffect(() => { setPage(1); setPicked(new Set()); }, [tab, view, customerId, filters.type, filters.month, filters.year, search]);

  useEffect(() => {
    let off = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const call = view === 'laptops' ? listCreditNoteLaptops(params) : listCreditNotes(params);
    call
      .then(({ data }) => {
        if (off) return;
        setState((s) => ({
          loading: false,
          rows: view === 'laptops' ? (data.laptops || []) : (data.credit_notes || []),
          summary: view === 'laptops' ? s.summary : (data.summary || {}),
          laptopSummary: view === 'laptops' ? data.summary : null,
          total: data.total || 0,
          totalPages: data.total_pages || 1,
        }));
      })
      .catch((e) => { if (!off) setState((s) => ({ ...s, loading: false, rows: [], error: errMsg(e) })); });
    return () => { off = true; };
  }, [params, view, nonce]);

  const s = state.summary || {};
  const tabs = [
    { key: 'pending', label: 'To approve', count: s.pending_count },
    { key: 'approved', label: 'Approved, not yet on an invoice', count: s.approved_count },
    { key: 'applied', label: 'Applied', count: s.applied_count },
    { key: 'cancelled', label: 'Cancelled', count: s.cancelled_count },
    { key: 'all', label: 'All live' },
  ];

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => { setFilters({ search: '', type: '', month: '', year: '' }); setCustomerId(''); }, []);
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const approveSelected = async () => {
    setBusy('approve');
    try {
      const { data } = await approveCreditNotesBulk([...picked]);
      const sm = data.summary || {};
      const why = (data.results || []).filter((r) => !r.ok).map((r) => r.reason).filter(Boolean);
      if (sm.failed) toast.error(`${sm.approved} approved, ${sm.failed} refused${why[0] ? ` — ${why[0]}` : ''}`);
      else toast.success(`${sm.approved} approved${sm.applied ? `, ${sm.applied} applied to draft invoices` : ''}`);
      setPicked(new Set());
      setNonce((n) => n + 1);
    } catch (e) {
      toast.error(errMsg(e, 'Approve failed'));
    } finally {
      setBusy('');
    }
  };

  const zip = async () => {
    if (!filters.month || !filters.year) { toast.error('Pick a month and year first'); return; }
    setBusy('zip');
    try {
      const { data } = await creditNotesZip({ month: filters.month, year: filters.year });
      saveBlob(data, `Credit-Notes-${MONTHS[Number(filters.month)]}-${filters.year}.zip`, 'application/zip');
    } catch (e) {
      toast.error(await blobErrMsg(e, 'Download failed'));
    } finally {
      setBusy('');
    }
  };

  const noteCols = [
    ...(canApprove && tab === 'pending' ? [{
      key: 'pick',
      header: '',
      width: '36px',
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()} role="presentation">
          <Checkbox
            aria-label={`Select ${r.credit_note_number}`}
            checked={picked.has(r.credit_note_id)}
            disabled={Number(r.created_by) === me}
            title={Number(r.created_by) === me ? 'You raised this note — someone else approves it' : undefined}
            onChange={() => toggle(r.credit_note_id)}
          />
        </span>
      ),
    }] : []),
    { key: 'n', header: 'Credit note', render: (r) => <DocNumber value={r.credit_note_number} />, sub: (r) => (r.credit_note_type || 'other') },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name || `#${r.customer_id}`, sub: (r) => r.reason || null },
    { key: 's', header: 'Status', render: (r) => <MoneyChip status={r.status} /> },
    { key: 'i', header: 'Invoice', render: (r) => (r.invoice_number ? <DocNumber value={r.invoice_number} /> : '—'), sub: (r) => r.return_dc_number || null },
    { key: 'p', header: 'Period', render: (r) => (r.from_date ? <span><DateTime value={r.from_date} /> – <DateTime value={r.to_date} /></span> : '—'), sub: (r) => `${MONTHS[r.billing_month] || ''} ${r.billing_year || ''}` },
    { key: 'd', header: 'Raised', render: (r) => <DateTime value={r.created_at} /> },
    { key: 'a', header: 'Amount', numeric: true, render: (r) => <Money value={r.amount} /> },
  ];

  const laptopCols = [
    {
      key: 't',
      header: 'Laptop',
      render: (r) => (r.ttspl_id
        ? <Link to={`/carret/stock/assets/${encodeURIComponent(r.ttspl_id)}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{r.ttspl_id}</Link>
        : '—'),
      sub: (r) => r.return_dc_number || null,
    },
    { key: 'n', header: 'Credit note', render: (r) => <DocNumber value={r.credit_note_number} /> },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name || `#${r.customer_id}` },
    { key: 's', header: 'Status', render: (r) => <MoneyChip status={r.status} /> },
    { key: 'p', header: 'Period', render: (r) => (r.from_date ? <span><DateTime value={r.from_date} /> – <DateTime value={r.to_date} /></span> : '—') },
    { key: 'q', header: 'Days', numeric: true, render: (r) => r.quantity || '—' },
    { key: 'a', header: 'Amount', numeric: true, render: (r) => <Money value={r.amount} /> },
  ];

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Number, customer, invoice, TTSPL, reason' },
    { key: 'type', label: 'Type', options: TYPES },
    { key: 'month', label: 'Month', options: MONTH_OPTIONS },
    { key: 'year', label: 'Year', options: yearOptions() },
  ]), []);

  return (
    <DeskShell
      title="Credit notes"
      breadcrumb="Finance"
      subtitle="Raised by one person, approved by another; approved notes come off the customer's next draft invoice."
      actions={(
        <div className="flex flex-wrap" style={{ gap: '8px' }}>
          <Button variant="quiet" disabled={busy === 'zip'} onClick={zip}>{busy === 'zip' ? 'Preparing…' : 'Month PDFs (ZIP)'}</Button>
          {canCreate && <Button onClick={() => setGenOpen(true)}>Generate return notes</Button>}
          {canCreate && <Button variant="primary" onClick={() => navigate('/carret/money/credit-notes/new')}>New credit note</Button>}
        </div>
      )}
    >
      <div className="c-stack">
        <Tiles>
          <StatTile label="To approve" value={state.loading && !s.pending_count ? null : s.pending_count ?? 0} delta={<Money value={s.pending_amount} />} />
          <StatTile label="Approved, waiting for a draft" value={s.approved_count ?? 0} delta={<Money value={s.approved_amount} />} />
          <StatTile label="Applied" value={s.applied_count ?? 0} delta={<Money value={s.applied_amount} />} />
        </Tiles>

        <Tabs tabs={tabs} value={tab} onChange={setTab} />

        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={`${state.total} ${view === 'laptops' ? 'laptop line(s)' : 'note(s)'}`}
              right={(
                <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
                  <div style={{ minWidth: '220px' }}>
                    <SearchSelect aria-label="Customer" options={customerOptions} value={customerId} placeholder="Customer: All" onChange={(e) => setCustomerId(e.target.value)} />
                  </div>
                  <Segmented label="View" value={view} onChange={setView} options={[{ value: 'notes', label: 'By note' }, { value: 'laptops', label: 'By laptop' }]} />
                </div>
              )}
            />
          )}
        >
          {canApprove && tab === 'pending' && view === 'notes' && picked.size > 0 && (
            <div className="c-card-b flex items-center" style={{ gap: '8px' }}>
              <span className="font-ui">{picked.size} selected</span>
              <Button variant="primary" disabled={busy === 'approve'} onClick={approveSelected}>{busy === 'approve' ? 'Approving…' : 'Approve selected'}</Button>
              <Button variant="quiet" onClick={() => setPicked(new Set())}>Clear</Button>
            </div>
          )}
          {state.loading && <EmptyState title="Loading…" />}
          {state.error && <EmptyState title="Could not load credit notes" body={state.error} />}
          {!state.loading && !state.error && (
            <>
              <DataTable
                columns={view === 'laptops' ? laptopCols : noteCols}
                rows={state.rows}
                rowKey={(r) => (view === 'laptops' ? r.row_key : r.credit_note_id)}
                onRowClick={(r) => navigate(`/carret/money/credit-notes/${r.credit_note_id}`)}
                empty={<EmptyState title="No credit notes match" />}
              />
              <Pager page={page} totalPages={state.totalPages} onPage={setPage} />
            </>
          )}
        </Panel>
      </div>

      <GenerateCreditNotesDrawer open={genOpen} onClose={() => setGenOpen(false)} onDone={() => { setTab('pending'); setNonce((n) => n + 1); }} />
    </DeskShell>
  );
}
