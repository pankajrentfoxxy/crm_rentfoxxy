import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { listSalesOrders } from '../../sales-pipeline/salesPipelineApi';
import { getCustomers } from '../leadCrmApi';
import CustomerFormDrawer from '../components/CustomerFormDrawer';
import PermissionGate from '../../../components/PermissionGate';
import toast from 'react-hot-toast';

export default function CustomerListPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [kycFilter, setKycFilter] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [activeOrderCounts, setActiveOrderCounts] = useState({});

  const load = useCallback(async (page = 1) => {
    try {
      const res = await getCustomers({ page, limit: 25, search: search || undefined });
      setCustomers(res.data?.customers || []);
      setPagination(res.data?.pagination || { page: 1, totalPages: 1 });
    } catch {
      toast.error('Failed to load customers');
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    listSalesOrders({ limit: 500 })
      .then((res) => {
        const counts = {};
        (res.data?.sales_orders || []).forEach((so) => {
          if (!so.customer_id) return;
          const qty = Number(so.remaining_qty ?? 0);
          if (qty > 0) {
            counts[so.customer_id] = (counts[so.customer_id] || 0) + 1;
          }
        });
        setActiveOrderCounts(counts);
      })
      .catch(() => setActiveOrderCounts({}));
  }, []);

  const filtered = useMemo(() => {
    if (kycFilter === 'verified') return customers.filter((c) => c.kyc_verified);
    if (kycFilter === 'pending') return customers.filter((c) => !c.kyc_verified);
    return customers;
  }, [customers, kycFilter]);

  const stats = useMemo(() => ({
    total: customers.length,
    kyc: customers.filter((c) => c.kyc_verified).length,
    portal: customers.filter((c) => c.portal_enabled).length,
  }), [customers]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500">Manage customer profiles and KYC</p>
        </div>
        <button type="button" onClick={() => { setEditCustomer(null); setDrawerOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg">
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[['Total', stats.total], ['KYC Verified', stats.kyc], ['Portal Enabled', stats.portal]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
            <p className="text-xs text-gray-500">{l}</p>
            <p className="text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" />
        <select value={kycFilter} onChange={(e) => setKycFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All KYC</option>
          <option value="verified">Verified</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 text-left">
            <tr>
              {['ID', 'Company', 'Contact', 'Phone', 'Email', 'GST', 'City', 'Active Orders', 'Portal', 'KYC', 'Actions'].map((h) => (
                <th key={h} className="p-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.customer_id} className="border-t border-gray-100 hover:bg-gray-50/50">
                <td className="p-3">#{c.customer_id}</td>
                <td className="p-3 font-medium">{c.company_name || c.customer_name}</td>
                <td className="p-3">{c.contact_person_name || c.customer_name}</td>
                <td className="p-3">{c.customer_number || c.phone}</td>
                <td className="p-3">{c.email || '—'}</td>
                <td className="p-3 text-xs">{c.gst_number || '—'}</td>
                <td className="p-3">{c.billing_city || '—'}</td>
                <td className="p-3 text-center">{activeOrderCounts[c.customer_id] ?? 0}</td>
                <td className="p-3">
                  <span className={`inline-block w-2 h-2 rounded-full ${c.portal_enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${c.kyc_verified ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {c.kyc_verified ? 'Verified' : 'Pending'}
                  </span>
                </td>
                <td className="p-3 space-x-2 whitespace-nowrap">
                  <button type="button" onClick={() => navigate(`/lead-crm/customers/${c.customer_id}`)}
                    className="text-blue-600 text-xs hover:underline">View</button>
                  <button type="button" onClick={() => { setEditCustomer(c); setDrawerOpen(true); }}
                    className="text-gray-600 text-xs hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CustomerFormDrawer open={drawerOpen} customer={editCustomer} onClose={() => setDrawerOpen(false)} onSaved={() => load(pagination.page)} />
    </div>
  );
}
