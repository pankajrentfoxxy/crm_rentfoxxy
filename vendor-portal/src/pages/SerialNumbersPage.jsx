import React, { useEffect, useState } from 'react';
import api from '../utils/api';

export default function SerialNumbersPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api
      .get('/vendor-portal/serial-numbers', { params: { limit: 100, search: search.trim() || undefined } })
      .then(({ data }) => {
        if (data.success) setRows(data.data || []);
      })
      .finally(() => setLoading(false));
  }, [search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">My laptops</h1>
          <p className="text-sm text-slate-500 mt-1">TTSPL IDs and serial numbers currently with Rentfoxxy</p>
        </div>
        <input
          type="search"
          placeholder="Search TTSPL or serial…"
          className="border rounded-lg px-3 py-2 text-sm w-full sm:w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden">
        {loading ? (
          <p className="p-8 text-center text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="bg-white border rounded-xl p-8 text-center text-slate-500">No laptops on record.</p>
        ) : rows.map((r) => (
          <div key={r.serial_id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold text-brand-dark">{r.inventory_asset_code}</span>
              <span className="text-xs text-slate-600 capitalize">{r.qc_status || 'pending'}</span>
            </div>
            <p className="text-sm text-slate-700">Serial: <span className="font-mono">{r.serial_number}</span></p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>PO {r.purchase_order_number}</span>
              <span>GRN {r.created_at?.slice?.(0, 10) || '—'}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block bg-white rounded-xl border overflow-hidden shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-slate-500">No laptops on record.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">TTSPL ID</th>
                <th className="p-3">Serial</th>
                <th className="p-3">PO</th>
                <th className="p-3">GRN date</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.serial_id} className="border-t hover:bg-slate-50/80">
                  <td className="p-3 font-mono font-semibold text-brand-dark">{r.inventory_asset_code}</td>
                  <td className="p-3">{r.serial_number}</td>
                  <td className="p-3">{r.purchase_order_number}</td>
                  <td className="p-3">{r.created_at?.slice?.(0, 10) || '—'}</td>
                  <td className="p-3 capitalize">{r.qc_status || 'pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
