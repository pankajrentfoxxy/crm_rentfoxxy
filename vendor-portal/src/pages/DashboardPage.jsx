import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/vendor-portal/dashboard')
      .then(({ data }) => {
        if (data.success) setStats(data.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    { label: 'Laptops with Rentfoxxy', value: stats?.laptops_with_rentfoxxy ?? '—' },
    { label: 'Active POs', value: stats?.active_pos ?? '—' },
    {
      label: 'Pending Bills',
      value: stats?.pending_bills ?? 0,
      sub: stats?.pending_bills_amount != null ? inr(stats.pending_bills_amount) : null,
    },
    { label: 'Total Outstanding', value: inr(stats?.total_outstanding ?? 0) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Overview of your business with Rentfoxxy</p>
      </div>
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white rounded-xl border" />
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
              <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{c.label}</p>
              <p className="text-3xl font-bold text-slate-900 mt-2 tabular-nums">{c.value}</p>
              {c.sub && <p className="text-sm text-slate-500 mt-1">{c.sub}</p>}
            </div>
          ))}
        </div>
      )}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-slate-900">Quick links</h2>
        <div className="flex flex-wrap gap-3 mt-3">
          <Link to="/purchase-orders" className="px-4 py-2 rounded-lg bg-emerald-50 text-brand-dark text-sm font-semibold">
            View purchase orders
          </Link>
          <Link to="/laptops" className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold">
            My laptops (TTSPL)
          </Link>
          <Link to="/bills" className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold">
            My bills
          </Link>
          <Link to="/debit-notes" className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold">
            Debit notes
          </Link>
        </div>
      </div>
    </div>
  );
}
