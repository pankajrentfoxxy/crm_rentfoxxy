import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, FilterBar, Money, Panel, SearchSelect, Select, StatTile, Tabs,
} from '../../components/carret';
import { usePermission } from '../../hooks/usePermission';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import {
  MONTHS, MONTH_OPTIONS, blobErrMsg, errMsg, invoicePdf, invoicesExcel, invoicesZip, listCoverage, listInvoices,
  saveBlob, useCustomerOptions, yearOptions,
} from './money/moneyApi';
import { MoneyChip, Pager, Tiles, outstandingOf } from './money/moneyShared';
import { GenerateInvoicesDrawer, MarkPaidDrawer } from './money/InvoiceDrawers';

/**
 * Finance → Customer invoices (Builder 1). Replaces the old list's jobs:
 * status tabs with counts, customer / month / year / search filters, the
 * month's coverage (customers with laptops but no invoice), generate for
 * chosen customers or all, the month's PDFs as a ZIP and the billed-serials
 * Excel. Each row opens the invoice record (send, payments, credit, cancel),
 * and carries the two things done most without opening it: the invoice PDF
 * and Mark paid (the record page's drawer and gating). ?customer=<id> opens
 * the list filtered to one customer (Ageing links here).
 *
 * GST column: CGST+SGST or IGST from the place of supply (BL7) — "not
 * classified" only for invoices raised before the split existed.
 */

const TABS = ['all', 'draft', 'sent', 'overdue', 'partially_paid', 'paid', 'cancelled'];
const PAGE_SIZES = [25, 50, 100, 200].map((n) => ({ value: String(n), label: `${n} per page` }));
const TAB_LABEL = { all: 'All', draft: 'Draft', sent: 'Sent', overdue: 'Overdue', partially_paid: 'Part paid', paid: 'Paid', cancelled: 'Cancelled' };

function GstCell({ row }) {
  if (row.is_intra_state === null || row.is_intra_state === undefined) {
    return <span className="text-ink-3" title="Raised before the split existed">not classified</span>;
  }
  if (row.is_intra_state) {
    return <span title={`Place of supply: ${row.place_of_supply || 'unknown'}`}>CGST + SGST</span>;
  }
  return <span title={`Place of supply: ${row.place_of_supply || 'unknown'}`}>IGST</span>;
}

function CoverageStrip({ month, year, refreshKey, onGenerate, canCreate }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!month || !year) { setData(null); return undefined; }
    let off = false;
    listCoverage({ month, year }).then(({ data: d }) => { if (!off) setData(d); }).catch(() => { if (!off) setData(null); });
    return () => { off = true; };
  }, [month, year, refreshKey]);
  if (!data) return null;
  const pending = (data.customers || []).filter((c) => c.bucket === 'pending');
  return (
    <Panel
      title={`Coverage — ${MONTHS[Number(month)]} ${year}`}
      actions={canCreate && pending.length ? (
        <Button variant="primary" onClick={() => onGenerate(pending.map((c) => c.customer_id))}>
          Generate for {pending.length} without an invoice
        </Button>
      ) : null}
    >
      <div className="c-card-b">
        <Tiles>
          <StatTile label="Customers with laptops" value={data.counts?.with_assets ?? 0} delta={`${data.counts?.laptops ?? 0} laptops`} />
          <StatTile label="Invoiced" value={data.counts?.invoiced ?? 0} />
          <StatTile label="No invoice yet" value={data.counts?.pending ?? 0} family={data.counts?.pending ? 'offcycle' : undefined} />
        </Tiles>
        {pending.length > 0 && (
          <p className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)', marginTop: '10px' }}>
            Not invoiced: {pending.slice(0, 12).map((c) => c.customer_name).join(', ')}{pending.length > 12 ? ` and ${pending.length - 12} more` : ''}
          </p>
        )}
      </div>
    </Panel>
  );
}

export default function InvoicesListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('customer_billing', 'create');
  const canEdit = hasPermission('customer_billing', 'edit');
  const customerOptions = useCustomerOptions();

  const [tab, setTab] = useState('all');
  const [filters, setFilters] = useState({ search: '', month: '', year: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('50');
  const [paying, setPaying] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(null);
  const [state, setState] = useState({ loading: true, rows: [], summary: {}, total: 0, totalPages: 1 });
  const [nonce, setNonce] = useState(0);
  const [gen, setGen] = useState(null);
  const [busy, setBusy] = useState('');
  const search = useDebouncedValue(filters.search);

  // The customer filter lives in the URL, so a link (Ageing) can open it and
  // Back returns to it.
  const customerId = searchParams.get('customer') || '';
  const setCustomerId = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('customer', id); else next.delete('customer');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const params = useMemo(() => {
    const p = { page, limit: Number(pageSize) };
    if (tab !== 'all') p.status = tab;
    if (customerId) p.customer_id = customerId;
    if (filters.month) p.month = filters.month;
    if (filters.year) p.year = filters.year;
    if (search.trim()) p.search = search.trim();
    return p;
  }, [tab, customerId, filters.month, filters.year, search, page, pageSize]);

  useEffect(() => { setPage(1); }, [tab, customerId, filters.month, filters.year, search, pageSize]);

  useEffect(() => {
    let off = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    listInvoices(params)
      .then(({ data }) => {
        if (off) return;
        setState({
          loading: false, rows: data.invoices || [], summary: data.summary || {}, total: data.total || 0, totalPages: data.total_pages || 1,
        });
      })
      .catch((e) => { if (!off) setState({ loading: false, rows: [], summary: {}, total: 0, totalPages: 1, error: errMsg(e) }); });
    return () => { off = true; };
  }, [params, nonce]);

  const s = state.summary;
  const tabs = TABS.map((k) => ({
    key: k,
    label: TAB_LABEL[k],
    count: k === 'all' ? s.total_count : (k === 'partially_paid' || k === 'cancelled' ? undefined : s[`${k}_count`]),
  }));

  const onFilter = useCallback((k, v) => setFilters((f) => ({ ...f, [k]: v })), []);
  const onClear = useCallback(() => { setFilters({ search: '', month: '', year: '' }); setCustomerId(''); }, [setCustomerId]);

  const rowPdf = useCallback(async (r) => {
    setPdfBusy(r.invoice_id);
    try {
      const { data } = await invoicePdf(r.invoice_id, 'tax_invoice');
      saveBlob(data, `${r.invoice_number}.pdf`.replace(/\//g, '-'), 'application/pdf');
    } catch (e) {
      toast.error(await blobErrMsg(e, 'PDF download failed'));
    } finally {
      setPdfBusy(null);
    }
  }, []);

  const download = async (kind) => {
    if (kind === 'zip' && (!filters.month || !filters.year)) { toast.error('Pick a month and year first'); return; }
    setBusy(kind);
    try {
      if (kind === 'zip') {
        const { data } = await invoicesZip({ month: filters.month, year: filters.year, format: 'laptop_details' });
        saveBlob(data, `Laptop-Rental-Documents-${MONTHS[Number(filters.month)]}-${filters.year}.zip`, 'application/zip');
      } else {
        const rest = { ...params };
        delete rest.page;
        delete rest.limit;
        const { data } = await invoicesExcel(rest);
        saveBlob(data, `invoice_billing_serials_${filters.month || 'all'}_${filters.year || 'years'}.xlsx`);
      }
    } catch (e) {
      toast.error(await blobErrMsg(e, 'Download failed'));
    } finally {
      setBusy('');
    }
  };

  const columns = useMemo(() => [
    { key: 'invoice_number', header: 'Invoice', render: (r) => <DocNumber value={r.invoice_number} />, sub: (r) => `${MONTHS[r.invoice_month] || ''} ${r.invoice_year || ''}` },
    { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || `#${r.customer_id}`, sub: (r) => `${r.laptop_count || 0} laptop(s)` },
    { key: 'status', header: 'Status', render: (r) => <MoneyChip status={r.status} /> },
    { key: 'invoice_date', header: 'Raised', render: (r) => <DateTime value={r.invoice_date} /> },
    {
      key: 'due_date',
      header: 'Due',
      render: (r) => (r.due_date ? (
        <span style={{ color: String(r.status).toLowerCase() === 'overdue' ? 'var(--alert-crit)' : undefined }}><DateTime value={r.due_date} /></span>
      ) : <span className="text-ink-3">—</span>),
    },
    { key: 'gst', header: 'GST', render: (r) => <GstCell row={r} /> },
    { key: 'grand_total', header: 'Total', numeric: true, render: (r) => <Money value={r.grand_total} /> },
    {
      key: 'outstanding',
      header: 'Outstanding',
      numeric: true,
      render: (r) => {
        const st = String(r.status || '').toLowerCase();
        if (st === 'cancelled') return <span className="text-ink-3">cancelled</span>;
        if (st === 'draft') return <span className="text-ink-3">not issued</span>;
        const due = outstandingOf(r);
        return due ? <Money value={due} /> : <span className="text-ink-3">settled</span>;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        const st = String(r.status || '').toLowerCase();
        const payable = canEdit && ['sent', 'overdue', 'partially_paid'].includes(st) && outstandingOf(r) > 0;
        // A row opens the record; its buttons must not (click or Enter).
        return (
          <span className="c-row-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
            <Button variant="quiet" disabled={pdfBusy === r.invoice_id} onClick={() => rowPdf(r)}>{pdfBusy === r.invoice_id ? 'PDF…' : 'PDF'}</Button>
            {payable && <Button variant="quiet" onClick={() => setPaying(r)}>Mark paid</Button>}
          </span>
        );
      },
    },
  ], [canEdit, pdfBusy, rowPdf]);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Invoice number, customer or IRN' },
    { key: 'month', label: 'Month', options: MONTH_OPTIONS },
    { key: 'year', label: 'Year', options: yearOptions() },
  ]), []);

  return (
    <DeskShell
      title="Customer invoices"
      breadcrumb="Finance"
      subtitle="Rental invoices: generate, send, record payments, credit and cancel."
      actions={(
        <div className="flex flex-wrap" style={{ gap: '8px' }}>
          <Button variant="quiet" disabled={busy === 'xlsx'} onClick={() => download('xlsx')}>{busy === 'xlsx' ? 'Exporting…' : 'Billed laptops (Excel)'}</Button>
          <Button variant="quiet" disabled={busy === 'zip'} onClick={() => download('zip')}>{busy === 'zip' ? 'Preparing…' : 'Month PDFs (ZIP)'}</Button>
          {canCreate && <Button variant="primary" onClick={() => setGen({ month: filters.month, year: filters.year })}>Generate invoices</Button>}
        </div>
      )}
    >
      <div className="c-stack">
        <Tiles>
          <StatTile label="Invoices" value={state.loading ? null : s.total_count ?? 0} delta={<Money value={s.total_amount} />} />
          <StatTile label="Outstanding (sent + overdue)" value={state.loading ? null : <Money value={s.outstanding_total} />} />
          <StatTile label="Overdue" value={state.loading ? null : s.overdue_count ?? 0} family={Number(s.overdue_count) ? 'offcycle' : undefined} delta={<Money value={s.overdue_total} />} />
          <StatTile label="Drafts to send" value={state.loading ? null : s.draft_count ?? 0} delta={<Money value={s.draft_total} />} />
          <StatTile label="Credit applied" value={state.loading ? null : <Money value={s.credit_note_total} />} delta={Number(s.credit_note_pending_count) ? `${s.credit_note_pending_count} pending approval` : undefined} />
        </Tiles>

        <CoverageStrip
          month={filters.month}
          year={filters.year}
          refreshKey={nonce}
          canCreate={canCreate}
          onGenerate={(ids) => setGen({ month: filters.month, year: filters.year, ids })}
        />

        <Tabs tabs={tabs} value={tab} onChange={setTab} />

        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={`${state.total} invoice(s)`}
              right={(
                <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
                  <div style={{ minWidth: '240px' }}>
                    <SearchSelect
                      aria-label="Customer"
                      options={customerOptions}
                      value={customerId}
                      placeholder="Customer: All"
                      onChange={(e) => setCustomerId(e.target.value)}
                    />
                  </div>
                  <div style={{ width: '140px' }}>
                    <Select aria-label="Rows per page" options={PAGE_SIZES} value={pageSize} onChange={(e) => setPageSize(e.target.value)} />
                  </div>
                </div>
              )}
            />
          )}
        >
          {state.loading && <EmptyState title="Loading…" />}
          {state.error && <EmptyState title="Could not load invoices" body={state.error} />}
          {!state.loading && !state.error && (
            <>
              <DataTable
                columns={columns}
                rows={state.rows}
                rowKey={(r) => r.invoice_id}
                onRowClick={(r) => navigate(`/carret/money/invoices/${r.invoice_id}`)}
                empty={<EmptyState title="No invoices match" body="Filters combine — clear one at a time to see what is excluding them." action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>} />}
              />
              <Pager page={page} totalPages={state.totalPages} onPage={setPage} />
            </>
          )}
        </Panel>
      </div>

      <MarkPaidDrawer
        invoice={paying}
        open={Boolean(paying)}
        onClose={() => setPaying(null)}
        onDone={() => setNonce((n) => n + 1)}
      />

      <GenerateInvoicesDrawer
        open={Boolean(gen)}
        onClose={() => setGen(null)}
        onDone={() => setNonce((n) => n + 1)}
        initialMonth={gen?.month}
        initialYear={gen?.year}
        initialCustomerIds={gen?.ids}
      />
    </DeskShell>
  );
}
