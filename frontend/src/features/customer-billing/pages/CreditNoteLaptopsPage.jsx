import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Laptop, Download, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import TtsplHistoryModal from '../../../components/TtsplHistoryModal';
import { PageHeader, ResponsiveTable, SearchField, ListPagination } from '../../../components/ui/primitives';
import SearchableSelect from '../../operation-management/components/SearchableSelect';
import { creditNotePdfErrorMessage, downloadCreditNotePdf, listCreditNoteLaptops } from '../customerBillingApi';
import api from '../../../utils/api';

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  applied: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

function creditNoteStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return 'Draft';
  if (s === 'approved') return 'Approved';
  if (s === 'applied') return 'Applied';
  if (s === 'cancelled') return 'Cancelled';
  return status || '—';
}

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

const PAGE_SIZES = [25, 50, 100, 200];

export default function CreditNoteLaptopsPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [customers, setCustomers] = useState([]);
  const [historyTtspl, setHistoryTtspl] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim()), 320);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    api.get('/customer-management/customers/ids')
      .then((r) => setCustomers(r.data?.customers || []))
      .catch(() => setCustomers([]));
  }, []);

  const customerOptions = useMemo(
    () => customers.map((c) => ({
      value: String(c.customer_id),
      label: c.company_name || c.name || c.customer_name || `Customer #${c.customer_id}`,
    })),
    [customers]
  );

  useEffect(() => { setPage(1); }, [statusFilter, customerId, searchDebounced, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (statusFilter) params.status = statusFilter;
      if (customerId) params.customer_id = customerId;
      if (searchDebounced) params.search = searchDebounced;
      const res = await listCreditNoteLaptops(params);
      setRows(res.data?.laptops || []);
      setSummary(res.data?.summary || {});
      setTotal(Number(res.data?.total || 0));
    } catch {
      toast.error('Failed to load credit note laptops');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, customerId, searchDebounced, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const handleDownloadPdf = async (id, num) => {
    try {
      const res = await downloadCreditNotePdf(id, { format: 'laptop_details' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${num}-document.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(await creditNotePdfErrorMessage(err));
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <PageHeader
        title="Credit Note Laptops"
        subtitle="Every laptop on a credit note, one row each — not grouped in an accordion"
        icon={Laptop}
        actions={(
          <Link
            to="/customer-billing/credit-notes"
            className="inline-flex items-center justify-center px-4 min-h-[44px] rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Credit Notes
          </Link>
        )}
      />

      <p className="text-sm text-slate-600 mb-4">
        {Number(summary.laptop_count || 0).toLocaleString('en-IN')} laptop
        {Number(summary.laptop_count || 0) === 1 ? '' : 's'}
        {' · '}
        {Number(summary.customer_count || 0).toLocaleString('en-IN')} customer
        {Number(summary.customer_count || 0) === 1 ? '' : 's'}
        {' · '}
        {fmt(summary.amount)}
      </p>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search CN #, customer, laptop…"
        />
        <div className="min-w-[220px] w-56">
          <SearchableSelect
            id="cn-laptop-filter-customer"
            label="Customer"
            value={customerId}
            onChange={setCustomerId}
            options={customerOptions}
            placeholder="All customers"
          />
        </div>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] min-w-[140px]"
          >
            <option value="">All statuses</option>
            <option value="pending">Draft</option>
            <option value="approved">Approved</option>
            <option value="applied">Applied</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Rows
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px] w-24">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setSearchInput('');
            setCustomerId('');
            setStatusFilter('');
            setPage(1);
          }}
          className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm min-h-[44px] hover:bg-slate-50"
        >
          Clear
        </button>
      </div>

      <ResponsiveTable
        columns={[
          { key: 'customer_name', header: 'Customer', render: (r) => <span className="font-medium">{r.customer_name || '—'}</span> },
          {
            key: 'credit_note_number',
            header: 'CN #',
            render: (r) => (
              <Link to={`/customer-billing/credit-notes/${r.credit_note_id}`} className="text-blue-600 hover:underline font-medium">
                {r.credit_note_number}
              </Link>
            ),
          },
          {
            key: 'ttspl_id',
            header: 'Laptop',
            render: (r) => (
              <div>
                <div className="font-mono font-medium">{r.ttspl_id || '—'}</div>
                {r.return_dc_number && <div className="text-xs text-slate-400">{r.return_dc_number}</div>}
              </div>
            ),
          },
          {
            key: 'period',
            header: 'Period',
            render: (r) => (
              r.from_date || r.to_date
                ? `${String(r.from_date || '').slice(0, 10)} → ${String(r.to_date || '').slice(0, 10)}`
                : '—'
            ),
          },
          { key: 'quantity', header: 'Days', align: 'right', render: (r) => r.quantity || '—' },
          { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="font-medium">{fmt(r.amount)}</span> },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>
                {creditNoteStatusLabel(r.status)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (r) => (
              <div className="flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
                {r.ttspl_id && (
                  <button type="button" onClick={() => setHistoryTtspl(r.ttspl_id)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <Clock className="w-3 h-3" /> History
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDownloadPdf(r.credit_note_id, r.credit_note_number)}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <Download className="w-3 h-3" /> PDF
                </button>
              </div>
            ),
          },
        ]}
        rows={rows}
        keyField="row_key"
        loading={loading}
        empty={<p className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">No credit note laptops match these filters.</p>}
        renderCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{r.customer_name}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATUS_STYLES[r.status] || ''}`}>
                {creditNoteStatusLabel(r.status)}
              </span>
            </div>
            <p className="font-mono text-sm">{r.ttspl_id || '—'}</p>
            <p className="text-xs text-slate-500">{r.credit_note_number}</p>
            {(r.from_date || r.to_date) && (
              <p className="text-xs text-slate-500">
                {String(r.from_date || '').slice(0, 10)} → {String(r.to_date || '').slice(0, 10)}
                {r.quantity ? ` · ${r.quantity} day(s)` : ''}
              </p>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="font-bold">{fmt(r.amount)}</span>
              <div className="flex gap-3">
                {r.ttspl_id && (
                  <button type="button" onClick={() => setHistoryTtspl(r.ttspl_id)} className="text-sm text-blue-600 font-semibold">History</button>
                )}
                <button type="button" onClick={() => handleDownloadPdf(r.credit_note_id, r.credit_note_number)} className="text-sm text-blue-600 font-semibold">PDF</button>
              </div>
            </div>
          </div>
        )}
      />

      <ListPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
      />

      {historyTtspl && <TtsplHistoryModal ttsplId={historyTtspl} onClose={() => setHistoryTtspl(null)} />}
    </div>
  );
}
