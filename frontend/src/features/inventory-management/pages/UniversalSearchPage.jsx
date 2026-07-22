import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { fetchUniversalSearch } from '../inventoryManagementApi';
import SuperAdminSerialStatusPanel from '../components/SuperAdminSerialStatusPanel';

export default function UniversalSearchPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    const q = input.trim().toUpperCase();
    if (!q) return;
    setLoading(true);
    try {
      const { data } = await fetchUniversalSearch(q);
      setResult(data);
      if (!data.success) toast.error(data.message || 'No results');
    } catch (err) {
      setResult(null);
      toast.error(err.response?.data?.message || err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-900">Universal Search</h2>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <form onSubmit={onSubmit} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-sm font-medium text-slate-700 mb-1">Enter Value</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="Serial, unique ID, PO…"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-700 text-white px-4 py-2 text-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </button>
        </form>
      </div>

      {result?.success && Array.isArray(result.data) ? (
        <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
          <p className="px-4 py-2 text-xs text-slate-500 border-b">
            Found in: <strong>{result.found_in}</strong> ({result.data.length} rows)
          </p>
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Serial</th>
                <th className="px-3 py-2 text-left">Unique</th>
                <th className="px-3 py-2 text-left">PO</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((r) => (
                <tr key={r.serial_id || r.serial_number} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      to={`/inventory-management/serial-number-status?serial=${encodeURIComponent(r.serial_number)}`}
                      className="text-sky-700"
                    >
                      {r.serial_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.unique_product_serial || '—'}</td>
                  <td className="px-3 py-2 text-xs">{r.purchase_order_number || '—'}</td>
                  <td className="px-3 py-2 capitalize text-xs">{r.qc_status?.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isSuperAdmin && result.data.length === 1 ? (
            <div className="p-4 border-t">
              <SuperAdminSerialStatusPanel
                row={result.data[0]}
                onUpdated={async () => {
                  try {
                    const { data } = await fetchUniversalSearch(input.trim().toUpperCase());
                    setResult(data);
                  } catch {
                    /* ignore refresh errors */
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
