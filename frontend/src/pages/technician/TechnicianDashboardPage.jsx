import React, { useEffect, useState } from 'react';
import { Package, Truck } from 'lucide-react';
import { fetchTechnicianDashboard } from '../../utils/technicianApi';

export default function TechnicianDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTechnicianDashboard()
      .then(setData)
      .catch((e) => setError(e.response?.data?.message || 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate-500 text-sm">Loading dashboard...</p>;
  if (error) return <p className="text-red-600 text-sm">{error}</p>;

  const name = [data?.technician?.first_name, data?.technician?.last_name].filter(Boolean).join(' ');

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Welcome back, {name}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-cyan-50 flex items-center justify-center">
            <Truck className="w-6 h-6 text-cyan-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Pending Deliveries</p>
            <p className="text-2xl font-bold text-slate-900">{data?.pending_count ?? 0}</p>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Package className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Account Status</p>
            <p className="text-lg font-semibold text-emerald-700">
              {data?.technician?.is_active ? 'Active' : 'Inactive'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-slate-800">Assigned In-Transit Challans</h2>
        </div>
        {!data?.technician?.user_id ? (
          <p className="px-5 py-8 text-sm text-slate-500 text-center">
            No CRM user linked to this technician account. Ask admin to link a user for delivery assignments.
          </p>
        ) : !data?.deliveries?.length ? (
          <p className="px-5 py-8 text-sm text-slate-500 text-center">No pending deliveries assigned to you.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Challan</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Ship By</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.deliveries.map((row) => (
                  <tr key={row.dc_number}>
                    <td className="px-4 py-3 font-medium text-cyan-700">{row.dc_number}</td>
                    <td className="px-4 py-3">{row.customer_name}</td>
                    <td className="px-4 py-3 capitalize">{row.ship_by?.replace('_', ' ') || '—'}</td>
                    <td className="px-4 py-3">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
