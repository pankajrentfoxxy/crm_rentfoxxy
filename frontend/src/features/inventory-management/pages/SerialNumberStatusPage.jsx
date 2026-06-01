import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Search } from 'lucide-react';
import { fetchSerialNumberStatus } from '../inventoryManagementApi';

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

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-900">Serial Number Status</h2>

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
              placeholder="Serial or unique ID"
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
            {['detail', 'inward', 'outward', 'transactions'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
                  tab === t ? 'bg-sky-100 text-sky-900' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {t}
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
                <th className="px-3 py-2 text-left">Serial</th>
                <th className="px-3 py-2 text-left">PO</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Vendor</th>
              </tr>
            </thead>
            <tbody>
              {(result.serials || []).map((r) => (
                <tr key={r.serial_id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{r.serial_number}</td>
                  <td className="px-3 py-2">
                    {r.po_id ? (
                      <Link to={`/vendor-management/purchase-orders/${r.po_id}/receive`} className="text-sky-700">
                        {r.purchase_order_number}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 capitalize">{r.qc_status}</td>
                  <td className="px-3 py-2">{r.vendor_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result && tab === 'inward' ? (
        <pre className="rounded-xl border bg-slate-50 p-4 text-xs overflow-auto">
          {JSON.stringify(result.inward || [], null, 2)}
        </pre>
      ) : null}
      {result && tab === 'outward' ? (
        <pre className="rounded-xl border bg-slate-50 p-4 text-xs overflow-auto">
          {JSON.stringify(result.outward || [], null, 2)}
        </pre>
      ) : null}
      {result && tab === 'transactions' ? (
        <pre className="rounded-xl border bg-slate-50 p-4 text-xs overflow-auto">
          {JSON.stringify(result.transactions || [], null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
