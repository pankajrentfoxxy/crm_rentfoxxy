import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { fetchBilling, createBilling } from '../vendorManagementApi';

const titles = {
  overview: 'Vendor billing (overview)',
  pending: 'Monthly pending billing',
  approved: 'Monthly approved billing',
  completed: 'Monthly completed billing'
};

/**
 * @param {{ view?: 'overview'|'pending'|'approved'|'completed' }} props
 */
export default function BillingMonthlyPage({ view = 'overview' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    billing_year: new Date().getFullYear(),
    billing_month: new Date().getMonth() + 1,
    vendor_id: '',
    status: view === 'overview' ? 'pending' : view,
    totals: '{"amount":0}'
  });

  async function load() {
    try {
      setLoading(true);
      const qp = { limit: 100 };
      if (view !== 'overview') qp.status = view;
      const { data } = await fetchBilling(qp);
      if (data.success) setRows(data.data);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setForm((f) => ({ ...f, status: view === 'overview' ? f.status : view }));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  async function quickCreate(e) {
    e.preventDefault();
    try {
      let totalsObj = {};
      try {
        totalsObj = JSON.parse(form.totals || '{}');
      } catch (_) {
        throw new Error('Totals must be JSON object');
      }
      const payload = {
        billing_year: Number(form.billing_year),
        billing_month: Number(form.billing_month),
        vendor_id: form.vendor_id ? Number(form.vendor_id) : null,
        status: form.status,
        totals: totalsObj
      };
      const { data } = await createBilling(payload);
      if (data.success) {
        toast.success('Billing record created');
        load();
      }
    } catch (err) {
      toast.error(err.message || 'Failed');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{titles[view] || titles.overview}</h1>
        <p className="text-xs text-slate-500">
          Backed by PostgreSQL <code className="bg-slate-100 px-1 rounded">vendor_billing</code> (status lifecycle pending →
          approved → completed). Port Laravel Excel/cron jobs incrementally.
        </p>
      </div>

      {view !== 'overview' && (
        <form onSubmit={quickCreate} className="rounded-xl border bg-white p-5 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm shadow-sm">
          <input
            required
            type="number"
            className="border rounded px-2 py-1.5"
            placeholder="Year"
            value={form.billing_year}
            onChange={(e) => setForm((f) => ({ ...f, billing_year: e.target.value }))}
          />
          <input
            required
            type="number"
            min="1"
            max="12"
            className="border rounded px-2 py-1.5"
            placeholder="Month"
            value={form.billing_month}
            onChange={(e) => setForm((f) => ({ ...f, billing_month: e.target.value }))}
          />
          <input
            type="number"
            className="border rounded px-2 py-1.5"
            placeholder="Vendor id optional"
            value={form.vendor_id}
            onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value }))}
          />
          <select
            className="border rounded px-2 py-1.5 capitalize"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="completed">completed</option>
          </select>
          <textarea
            className="md:col-span-4 border rounded px-3 py-2 font-mono text-xs"
            rows={2}
            value={form.totals}
            onChange={(e) => setForm((f) => ({ ...f, totals: e.target.value }))}
          />
          <button className="md:col-span-4 px-4 py-2 rounded-lg bg-orange-600 text-white font-semibold">
            Create sample record
          </button>
        </form>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-500 border rounded-lg animate-pulse">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">Vendor</th>
                <th className="p-3">Period</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.billing_id} className="border-t">
                  <td className="p-3">{r.billing_id}</td>
                  <td className="p-3">{r.vendor_business_name || r.vendor_id || '—'}</td>
                  <td className="p-3">
                    {r.billing_month}/{r.billing_year}
                  </td>
                  <td className="p-3 capitalize">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-500">
              Migrate historic Laravel billing/export logic into background workers that populate these rows.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
