import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { History, Loader2, Search } from 'lucide-react';
import { fetchSerialNumberStatus } from '../inventoryManagementApi';
import ErpSerialHistoryTable from '../components/ErpSerialHistoryTable';

const TABS = [
  { key: 'detail', label: 'Detail' },
  { key: 'inward', label: 'Inward' },
  { key: 'outward', label: 'Outward' },
  { key: 'transactions', label: 'Transactions' }
];

export default function SerialNumberStatusPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get('serial') || searchParams.get('serial_number') || '';
  const [input, setInput] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('detail');

  const runSearch = useCallback(async (serial) => {
    const q = String(serial || '').trim();
    if (!q) {
      toast.error('Enter a serial number');
      return;
    }
    setLoading(true);
    try {
      const { data } = await fetchSerialNumberStatus(q);
      if (data.success) {
        setResult(data);
        setSearchParams({ serial: q });
      } else {
        setResult(null);
        toast.error(data.message || 'Not found');
      }
    } catch (e) {
      setResult(null);
      toast.error(e.response?.data?.message || e.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [setSearchParams]);

  useEffect(() => {
    if (initial) runSearch(initial);
  }, []);

  const historyRows =
    tab === 'inward'
      ? result?.erp_history_inward || result?.inward || []
      : tab === 'outward'
        ? result?.erp_history_outward || result?.outward || []
        : tab === 'transactions'
          ? result?.erp_history_summary || result?.transactions || []
          : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-bold text-slate-900">Serial Number Status</h2>
        <span className="text-xs text-slate-500">Migrated ERP history — separate from TTSPL History</span>
      </div>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <form
          className="flex flex-wrap gap-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(input);
          }}
        >
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-slate-700 mb-1">Enter Serial Number</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="Serial or TTSPL / unique ID"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-700 text-white px-4 py-2 text-sm hover:bg-sky-800 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </button>
        </form>

        {result ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  tab === t.key ? 'bg-sky-100 text-sky-900' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {t.label}
                {t.key !== 'detail' && result.erp_history_count != null ? (
                  <span className="ml-1 opacity-70">
                    (
                    {t.key === 'inward'
                      ? (result.erp_history_inward || []).length
                      : t.key === 'outward'
                        ? (result.erp_history_outward || []).length
                        : result.erp_history_count}
                    )
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {result && tab === 'detail' ? (
        <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Serial / Unique</th>
                <th className="px-3 py-2 text-left">PO</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Model</th>
              </tr>
            </thead>
            <tbody>
              {(result.serials || []).map((r) => (
                <tr key={r.serial_id} className="border-t align-top">
                  <td className="px-3 py-2 font-mono text-xs">
                    <div className="text-orange-800 font-semibold">{r.serial_number}</div>
                    <div className="text-sky-800">{r.unique_product_serial || r.inventory_asset_code || '—'}</div>
                  </td>
                  <td className="px-3 py-2">
                    {r.po_id ? (
                      <Link to={`/vendor-management/purchase-orders/${r.po_id}/receive`} className="text-sky-700">
                        {r.purchase_order_number}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 capitalize">{r.qc_status?.replace(/_/g, ' ') || '—'}</td>
                  <td className="px-3 py-2">{r.vendor_name || '—'}</td>
                  <td className="px-3 py-2 text-xs">{r.model || r.product_name || '—'}</td>
                </tr>
              ))}
              {!result.serials?.length ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    No serial records matched this search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {result && tab !== 'detail' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <History className="w-4 h-4" />
            <span>
              Showing {historyRows.length} migrated ERP event{historyRows.length === 1 ? '' : 's'} (oldest first).
              New CRM workflow events appear in{' '}
              <Link to="/inventory-management/ttspl-history" className="text-sky-700 hover:underline">
                TTSPL History
              </Link>
              .
            </span>
          </div>
          <ErpSerialHistoryTable
            rows={historyRows}
            emptyMessage="No migrated ERP history for this filter. Run migration module 041 if data is missing."
          />
        </div>
      ) : null}
    </div>
  );
}
