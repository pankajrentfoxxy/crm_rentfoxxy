import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DocNumber, Drawer, EmptyState, Field, FilterBar, FormGrid, Money, Notice, Panel, SearchSelect,
  Select, StatTile, StatusChip,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  BILL_STATUS_LABEL, MONTHS, billChipStatus, errMsg, generateVendorBill, monthLabel, outstandingOf, useBillableVendors,
  useVendorBills,
} from './vendorMoneyApi';

/**
 * Finance → Vendors → Vendor bills. Replaces vendor-billing/VendorBillListPage.
 *
 * One bill per vendor per month for laptops we rent from the vendor. A bill is
 * generated (maker), approved by someone else (checker), then paid. GST shows
 * the head it was classified under; bills raised before the split say so.
 */
const STATUS_OPTIONS = Object.entries(BILL_STATUS_LABEL).map(([value, label]) => ({ value, label }));
const MONTH_OPTIONS = MONTHS.slice(1).map((m, i) => ({ value: String(i + 1), label: m }));
const thisYear = new Date().getFullYear();
const YEAR_OPTIONS = [thisYear, thisYear - 1, thisYear - 2].map((y) => ({ value: String(y), label: String(y) }));
const PAGE_SIZE = 50;

function GstCell({ row }) {
  if (row.is_intra_state === null || row.is_intra_state === undefined) {
    return <span className="text-ink-3" title="Raised before the CGST/SGST vs IGST split">GST <Money value={row.gst_amount} /></span>;
  }
  return row.is_intra_state
    ? <span title={`Vendor state: ${row.place_of_supply || 'unknown'}`}>CGST+SGST <Money value={row.gst_amount} /></span>
    : <span title={`Vendor state: ${row.place_of_supply || 'unknown'}`}>IGST <Money value={row.gst_amount} /></span>;
}

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function GenerateDrawer({ open, onClose, vendors, onDone }) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [form, setForm] = useState({ vendor_id: '', month: String(prev.getMonth() + 1), year: String(prev.getFullYear()) });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const future = Number(form.year) > now.getFullYear()
    || (Number(form.year) === now.getFullYear() && Number(form.month) > now.getMonth() + 1);

  const go = async () => {
    setBusy(true);
    try {
      const { data } = await generateVendorBill({ vendor_id: Number(form.vendor_id), month: Number(form.month), year: Number(form.year) });
      toast.success(`${data.bill?.bill_number || 'Bill'} generated — someone else approves it`);
      onDone(data.bill);
    } catch (e) {
      const existing = e?.response?.data?.bill;
      if (e?.response?.status === 409 && existing) {
        toast.error(errMsg(e));
        onDone(existing);
      } else toast.error(errMsg(e, 'Could not generate the bill.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Generate a vendor bill"
      footer={(
        <Button variant="primary" disabled={busy || !form.vendor_id || future} onClick={go}>
          {busy ? 'Generating…' : 'Generate'}
        </Button>
      )}
    >
      <FormGrid cols={1}>
        <Field label="Vendor" required hint="Vendors with rental or rent-to-own purchase orders.">
          <SearchSelect
            value={form.vendor_id}
            onChange={(e) => set('vendor_id', e.target.value)}
            placeholder="Choose a vendor…"
            options={vendors.map((v) => ({ value: String(v.vendor_id), label: v.vendor_name || `Vendor #${v.vendor_id}` }))}
          />
        </Field>
        <Field label="Month" required>
          <Select value={form.month} onChange={(e) => set('month', e.target.value)} options={MONTH_OPTIONS} />
        </Field>
        <Field label="Year" required error={future ? 'That month has not happened yet.' : null}>
          <Select value={form.year} onChange={(e) => set('year', e.target.value)} options={YEAR_OPTIONS} />
        </Field>
      </FormGrid>
      <div style={{ marginTop: '12px' }}>
        <Notice tone="info" title="What goes on the bill">
          Every laptop on rent from this vendor in that month, day by day from its rent start to its return (days it
          sat with the vendor for repair are left out), at the PO line rate. GST is CGST+SGST for a Haryana vendor,
          IGST otherwise. Approved debit notes raised up to the month end are deducted; later ones wait for the next bill.
        </Notice>
      </div>
    </Drawer>
  );
}

export default function VendorBillsListPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('vendor_billing_mgmt', 'create');
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [genOpen, setGenOpen] = useState(false);
  const search = useDebounced(filters.search || '');
  const { vendors } = useBillableVendors();

  const { loading, error, rows, summary, pagination } = useVendorBills({
    search, vendor_id: filters.vendor_id, month: filters.month, year: filters.year, status: filters.status,
    page, limit: PAGE_SIZE,
  });

  const onFilter = useCallback((k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); }, []);
  const onClear = useCallback(() => { setFilters({}); setPage(1); }, []);

  const filterDefs = useMemo(() => ([
    { key: 'search', label: 'Search', type: 'search', placeholder: 'Bill number or vendor' },
    { key: 'vendor_id', label: 'Vendor', options: vendors.map((v) => ({ value: String(v.vendor_id), label: v.vendor_name || `#${v.vendor_id}` })) },
    { key: 'month', label: 'Month', options: MONTH_OPTIONS },
    { key: 'year', label: 'Year', options: YEAR_OPTIONS },
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
  ]), [vendors]);

  const columns = useMemo(() => [
    { key: 'bill_number', header: 'Bill', render: (r) => <DocNumber value={r.bill_number} />, sub: (r) => monthLabel(r.bill_month, r.bill_year) },
    { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || `#${r.vendor_id}` },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={billChipStatus(r.status)} label={BILL_STATUS_LABEL[r.status] || r.status} /> },
    { key: 'units', header: 'Laptops', numeric: true, render: (r) => r.unit_count ?? '—' },
    { key: 'subtotal', header: 'Rent', numeric: true, render: (r) => <Money value={r.subtotal} /> },
    { key: 'gst', header: 'GST', render: (r) => <GstCell row={r} /> },
    { key: 'dn', header: 'Debit notes', numeric: true, render: (r) => (Number(r.debit_note_adjustment) > 0 ? <Money value={-Number(r.debit_note_adjustment)} /> : <span className="text-ink-3">—</span>) },
    { key: 'total', header: 'Payable', numeric: true, render: (r) => <Money value={r.total_payable} /> },
    {
      key: 'due', header: 'Still owed', numeric: true,
      render: (r) => {
        if (r.status === 'cancelled') return <span className="text-ink-3">—</span>;
        const due = outstandingOf(r);
        return due ? <Money value={due} /> : <span className="text-ink-3">settled</span>;
      },
    },
  ], []);

  return (
    <DeskShell
      title="Vendor Bills"
      breadcrumb="Finance / Vendors"
      subtitle="Monthly rent we owe vendors for laptops we rent from them."
      actions={canCreate && <Button variant="primary" onClick={() => setGenOpen(true)}>Generate bill</Button>}
    >
      <div className="c-stack">
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <StatTile label="Awaiting approval" value={loading ? null : summary.generated_count ?? 0} delta={<Money value={summary.generated_total} />} />
          <StatTile label="Approved, to pay" value={loading ? null : (summary.approved_count ?? 0) + (summary.partially_paid_count ?? 0)} delta={<Money value={summary.outstanding_total} />} />
          <StatTile label="Paid" value={loading ? null : summary.paid_count ?? 0} delta={<Money value={summary.paid_total} />} family="earning" />
          <StatTile label="Cancelled" value={loading ? null : summary.cancelled_count ?? 0} />
        </div>

        <Panel
          toolbar={(
            <FilterBar
              filters={filterDefs}
              values={filters}
              onChange={onFilter}
              onClear={onClear}
              count={loading ? '…' : `${pagination.total} bill${pagination.total === 1 ? '' : 's'}`}
            />
          )}
        >
          {loading && <EmptyState title="Loading…" />}
          {error && <EmptyState title="Could not load vendor bills" body={error} />}
          {!loading && !error && (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.bill_id}
              onRowClick={(r) => navigate(`/carret/money/vendor-bills/${r.bill_id}`)}
              empty={(
                <EmptyState
                  title="No vendor bills match"
                  body="Filters combine — clear one at a time to see what is excluding them."
                  action={<Button variant="quiet" onClick={onClear}>Clear filters</Button>}
                />
              )}
            />
          )}
          {!loading && pagination.totalPages > 1 && (
            <div className="c-toolbar">
              <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-ink-3">Page {pagination.page} of {pagination.totalPages}</span>
              <Button variant="quiet" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </Panel>
      </div>

      {genOpen && (
        <GenerateDrawer
          open={genOpen}
          onClose={() => setGenOpen(false)}
          vendors={vendors}
          onDone={(bill) => { setGenOpen(false); if (bill?.bill_id) navigate(`/carret/money/vendor-bills/${bill.bill_id}`); }}
        />
      )}
    </DeskShell>
  );
}
