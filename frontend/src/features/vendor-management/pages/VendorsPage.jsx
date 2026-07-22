import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Building2, Eye, Key, Pencil, Plus, Search } from 'lucide-react';
import {
  fetchAllPurchaseOrders,
  fetchAllVendors,
  updateVendorPortalAccess
} from '../vendorManagementApi';
import VendorFormModal from '../components/VendorFormModal';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  formatStateLabel,
  paymentTermsBadgeClass,
  paymentTermsLabel,
  vendorStatusKey,
  vendorStatusLabel
} from '../vendorMgmtUi';

const PAGE_SIZE = 25;

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'suspended', label: 'Suspended' }
];

function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ statusKey }) {
  const map = {
    active: 'bg-green-50 text-green-700',
    pending: 'bg-amber-50 text-amber-800',
    suspended: 'bg-red-50 text-red-700'
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[statusKey] || map.pending}`}>
      {vendorStatusLabel(statusKey)}
    </span>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4 animate-pulse">
          <div className="h-10 w-8 bg-gray-200 rounded" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-200 rounded w-1/3" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function VendorsPage() {
  const [allRows, setAllRows] = useState([]);
  const [poCountByVendor, setPoCountByVendor] = useState({});
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 320);
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(true);

  const [vendorModal, setVendorModal] = useState({ open: false, mode: 'create', vendorId: null });
  const [passwordModal, setPasswordModal] = useState({ open: false, password: '', vendorName: '' });
  const [portalPanelId, setPortalPanelId] = useState(null);
  const [portalBusyId, setPortalBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const searchQ = search.trim() || undefined;
      const [vendorRows, poRows] = await Promise.all([
        fetchAllVendors(searchQ ? { search: searchQ } : {}),
        fetchAllPurchaseOrders()
      ]);

      setAllRows(vendorRows);

      const map = {};
      poRows.forEach((po) => {
        const st = String(po.status || '').toLowerCase();
        if (['completed', 'rejected'].includes(st)) return;
        const vid = po.vendor_id;
        map[vid] = (map[vid] || 0) + 1;
      });
      setPoCountByVendor(map);
    } catch (e) {
      const msg =
        e.response?.data?.errors?.[0]?.msg ||
        e.response?.data?.message ||
        e.message ||
        'Failed to load vendors';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const counts = { total: allRows.length, active: 0, pending: 0, suspended: 0 };
    allRows.forEach((r) => {
      const k = vendorStatusKey(r);
      if (k === 'active') counts.active += 1;
      else if (k === 'suspended') counts.suspended += 1;
      else counts.pending += 1;
    });
    return counts;
  }, [allRows]);

  const tabCounts = useMemo(() => {
    const c = { all: allRows.length, active: 0, pending: 0, suspended: 0 };
    allRows.forEach((r) => {
      const k = vendorStatusKey(r);
      if (c[k] != null) c[k] += 1;
    });
    return c;
  }, [allRows]);

  const filteredRows = useMemo(() => {
    let list = [...allRows];
    if (activeTab !== 'all') list = list.filter((r) => vendorStatusKey(r) === activeTab);
    if (statusFilter !== 'all') list = list.filter((r) => vendorStatusKey(r) === statusFilter);
    if (paymentFilter !== 'all') {
      list = list.filter((r) => String(r.po_payment_terms || '').toLowerCase() === paymentFilter);
    }
    return list;
  }, [allRows, activeTab, statusFilter, paymentFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [activeTab, statusFilter, paymentFilter, search]);

  function openCreate() {
    setVendorModal({ open: true, mode: 'create', vendorId: null });
  }

  function openEdit(row) {
    setVendorModal({ open: true, mode: 'edit', vendorId: row.vendor_id });
  }

  function formatPortalLogin(raw) {
    if (!raw) return 'Never logged in';
    try {
      return new Date(raw).toLocaleString();
    } catch {
      return String(raw);
    }
  }

  async function togglePortalAccess(row) {
    const enabled = row.vendor_portal_enabled !== false;
    setPortalBusyId(row.vendor_id);
    try {
      const { data } = await updateVendorPortalAccess(row.vendor_id, { portal_enabled: !enabled });
      if (!data.success) throw new Error(data.message);
      toast.success('Portal access updated');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Update failed');
    } finally {
      setPortalBusyId(null);
    }
  }

  async function resetPortalPassword(row) {
    setPortalBusyId(row.vendor_id);
    try {
      const { data } = await updateVendorPortalAccess(row.vendor_id, { reset_password: true });
      if (!data.success) throw new Error(data.message);
      if (data.new_password) {
        setPasswordModal({
          open: true,
          password: data.new_password,
          vendorName: row.business_name || row.f_name || `Vendor #${row.vendor_id}`
        });
      }
      toast.success('Portal password reset');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Reset failed');
    } finally {
      setPortalBusyId(null);
    }
  }

  function copyPassword() {
    if (!passwordModal.password) return;
    navigator.clipboard.writeText(passwordModal.password).then(
      () => toast.success('Password copied'),
      () => toast.error('Could not copy')
    );
  }

  return (
    <div className="space-y-6 min-w-0">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-4 flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total Vendors" value={loading ? '…' : stats.total} />
            <StatCard label="Active" value={loading ? '…' : stats.active} accent="text-green-600" />
            <StatCard label="Pending Approval" value={loading ? '…' : stats.pending} accent="text-amber-600" />
            <StatCard label="Suspended" value={loading ? '…' : stats.suspended} accent="text-red-600" />
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Vendor
        </button>
      </header>

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              placeholder="Search name, GSTIN, phone, email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-3 h-9 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="all">Status: All</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="all">Payment Terms: All</option>
            <option value="postpaid_monthly">Postpaid Monthly</option>
            <option value="net30">Net 30</option>
            <option value="net15">Net 15</option>
            <option value="advance">Advance</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-gray-100 -mx-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  activeTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {loading ? '…' : tabCounts[tab.key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <TableSkeleton />
        </div>
      ) : pageRows.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 shadow-sm text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto" />
          <p className="mt-4 text-lg font-semibold text-gray-900">No vendors yet</p>
          <p className="text-sm text-gray-500 mt-1">Add your first vendor to get started with procurement.</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-6 inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add your first vendor
          </button>
        </div>
      ) : (
        <>
          <div className="hidden md:block rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">#</th>
                    <th className="px-4 py-3 font-semibold">Business Name</th>
                    <th className="px-4 py-3 font-semibold">Contact Person</th>
                    <th className="px-4 py-3 font-semibold">GSTIN</th>
                    <th className="px-4 py-3 font-semibold">City</th>
                    <th className="px-4 py-3 font-semibold">Payment Terms</th>
                    <th className="px-4 py-3 font-semibold">Active POs</th>
                    <th className="px-4 py-3 font-semibold">Portal</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-sm text-gray-900">
                  {pageRows.map((row, key) => {
                    const idx = (page - 1) * PAGE_SIZE + key + 1;
                    const sk = vendorStatusKey(row);
                    const portalOn = row.vendor_portal_enabled !== false;
                    const activePos = poCountByVendor[row.vendor_id] || 0;
                    const panelOpen = portalPanelId === row.vendor_id;

                    return (
                      <React.Fragment key={row.vendor_id}>
                        <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-500 tabular-nums">{idx}</td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-gray-900">{row.business_name || '—'}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{row.f_name || '—'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div>{row.contact_person_name || row.f_name || '—'}</div>
                            <div className="text-xs text-gray-500">{row.contact_person_phone || row.phone || '—'}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.gst_number || '—'}</td>
                          <td className="px-4 py-3 text-gray-700">
                            {[row.city, formatStateLabel(row.state)].filter(Boolean).join(', ') || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${paymentTermsBadgeClass(row.po_payment_terms)}`}
                            >
                              {paymentTermsLabel(row.po_payment_terms)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              to={`/vendor-management/purchase-orders?vendor_id=${row.vendor_id}`}
                              className="inline-flex rounded-full bg-blue-50 text-blue-700 px-2.5 py-0.5 text-xs font-semibold hover:bg-blue-100"
                            >
                              {activePos}
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-block w-2 h-2 rounded-full ${portalOn ? 'bg-green-500' : 'bg-gray-300'}`}
                              />
                              <span className="text-xs text-gray-600">{portalOn ? 'Enabled' : 'Disabled'}</span>
                              <button
                                type="button"
                                disabled={portalBusyId === row.vendor_id}
                                onClick={() => togglePortalAccess(row)}
                                className="text-xs text-blue-600 font-medium hover:underline disabled:opacity-50"
                              >
                                Toggle
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge statusKey={sk} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <Link
                                to={`/vendor-management/vendors/${row.vendor_id}`}
                                title="View"
                                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 text-blue-600 hover:bg-blue-50"
                              >
                                <Eye className="w-4 h-4" />
                              </Link>
                              <button
                                type="button"
                                title="Edit"
                                onClick={() => openEdit(row)}
                                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <Link
                                to="/vendor-management/purchase-orders"
                                state={{ openCreate: true, vendorId: row.vendor_id }}
                                title="Create PO"
                                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 text-blue-600 hover:bg-blue-50"
                              >
                                <Plus className="w-4 h-4" />
                              </Link>
                              <button
                                type="button"
                                title="View Portal Access"
                                onClick={() => setPortalPanelId(panelOpen ? null : row.vendor_id)}
                                className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border ${
                                  panelOpen ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                <Key className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {panelOpen ? (
                          <tr className="bg-blue-50/40 border-b border-gray-100">
                            <td colSpan={10} className="px-4 py-4">
                              <div className="rounded-lg border border-blue-100 bg-white p-4 text-sm space-y-3 max-w-2xl">
                                <p className="font-semibold text-gray-900">Portal access — {row.business_name}</p>
                                <div className="flex flex-wrap items-center gap-4">
                                  <label className="inline-flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={portalOn}
                                      disabled={portalBusyId === row.vendor_id}
                                      onChange={() => togglePortalAccess(row)}
                                      className="rounded border-gray-300 text-blue-600"
                                    />
                                    <span className="text-gray-700">Portal {portalOn ? 'enabled' : 'disabled'}</span>
                                  </label>
                                  <span className="text-gray-500 text-xs">
                                    Last login: {formatPortalLogin(row.vendor_portal_last_login)}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  disabled={portalBusyId === row.vendor_id}
                                  onClick={() => resetPortalPassword(row)}
                                  className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                                >
                                  Reset Password
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="md:hidden space-y-3">
            {pageRows.map((row) => {
              const sk = vendorStatusKey(row);
              return (
                <div key={row.vendor_id} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">{row.business_name || '—'}</p>
                      <p className="text-xs text-gray-500">{row.f_name}</p>
                    </div>
                    <StatusBadge statusKey={sk} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <span>{row.phone || '—'}</span>
                    <span className="truncate">{row.email || '—'}</span>
                    <span>{row.city || '—'}</span>
                    <span className="font-mono">{row.gst_number || '—'}</span>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      to={`/vendor-management/vendors/${row.vendor_id}`}
                      className="flex-1 h-9 inline-flex items-center justify-center rounded-lg border border-gray-200 text-sm font-medium text-blue-600"
                    >
                      View
                    </Link>
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="flex-1 h-9 rounded-lg border border-gray-200 text-sm font-medium text-gray-700"
                    >
                      Edit
                    </button>
                    <Link
                      to="/vendor-management/purchase-orders"
                      state={{ openCreate: true, vendorId: row.vendor_id }}
                      className="flex-1 h-9 inline-flex items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-medium"
                    >
                      Create PO
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && filteredRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
          <p>
            Page {page} of {totalPages} · {filteredRows.length} vendors
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-9 px-3 rounded-lg border border-gray-200 disabled:opacity-40 text-sm"
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              type="button"
              onClick={() => setPage((p) => p + 1)}
              className="h-9 px-3 rounded-lg border border-gray-200 disabled:opacity-40 text-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <VendorFormModal
        open={vendorModal.open}
        mode={vendorModal.mode}
        vendorId={vendorModal.vendorId}
        onClose={() => setVendorModal({ open: false, mode: 'create', vendorId: null })}
        onSaved={() => load()}
      />

      {passwordModal.open ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-100">
            <h3 className="font-bold text-gray-900">New portal password</h3>
            <p className="text-xs text-gray-500 mt-1">{passwordModal.vendorName}</p>
            <div className="mt-4 flex gap-2">
              <input
                readOnly
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50"
                value={passwordModal.password}
              />
              <button
                type="button"
                onClick={copyPassword}
                className="h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                className="h-9 px-4 rounded-lg border border-gray-200 text-sm"
                onClick={() => setPasswordModal({ open: false, password: '', vendorName: '' })}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
