import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Plus, ShoppingBag, Trash2, UserCog } from 'lucide-react';
import { deleteVendor, fetchVendors, updateVendorPortalAccess } from '../vendorManagementApi';
import LoginAsVendorModal from '../components/LoginAsVendorModal';
import VendorFormModal from '../components/VendorFormModal';
import { useVendorMgmtCapabilities } from '../hooks/useVendorMgmtCapabilities';
import { getBackendOrigin } from '../../../utils/api';

const PAGE_SIZE = 25;

function mediaUrl(rel) {
  if (!rel) return '';
  if (rel.startsWith('http://') || rel.startsWith('https://')) return rel;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}${rel.startsWith('/') ? rel : `/${rel}`}`;
}

const IMG_FALLBACK =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#cbd5e1"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>`
  );

export default function VendorsPage() {
  const { canLoginAsVendor } = useVendorMgmtCapabilities();

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [loginModal, setLoginModal] = useState({ open: false, vendor_id: '', vendor_email: '' });
  const [vendorModal, setVendorModal] = useState({ open: false, mode: 'create', vendorId: null });
  const [passwordModal, setPasswordModal] = useState({ open: false, password: '', vendorName: '' });
  const [portalBusyId, setPortalBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await fetchVendors({
        page,
        limit: PAGE_SIZE,
        search: search.trim() || undefined
      });
      if (data.success) {
        setRows(data.data || []);
        setPagination({
          ...(data.pagination || {}),
          totalPages: data.pagination?.totalPages || 1,
          total: data.pagination?.total ?? 0,
          limit: data.pagination?.limit || PAGE_SIZE
        });
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  function applySearch(e) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete vendor “${row.business_name}”? This cannot be undone.`)) return;
    try {
      const { data } = await deleteVendor(row.vendor_id);
      if (!data.success) {
        toast.error(data.error || data.message || 'Delete failed');
        return;
      }
      toast.success(data.message || 'Vendor details deleted successfully.');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Delete failed');
    }
  }

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
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            Vendor List
            <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-slate-200 text-slate-800 text-sm font-semibold">
              {loading ? '…' : pagination.total ?? rows.length}
            </span>
          </h1>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 text-white text-sm font-semibold shadow-sm hover:bg-orange-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add new vendor
        </button>
      </header>

      <form onSubmit={applySearch} className="flex flex-wrap items-center gap-2">
        <input
          placeholder="Search name, business, email, phone…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1 min-w-[200px] max-w-md border border-slate-200 rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            className="text-sm text-slate-600 underline"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setPage(1);
            }}
          >
            Clear
          </button>
        )}
      </form>

      {loading ? (
        <div className="rounded-lg border bg-white p-12 text-center text-slate-500 animate-pulse">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
              <tr>
                <th className="p-3">SL</th>
                <th className="p-3">Business name</th>
                <th className="p-3">Vendor name</th>
                <th className="p-3">Contact info</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-center w-52">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, key) => {
                const idx = (page - 1) * (pagination.limit || PAGE_SIZE) + key + 1;
                const name = `${row.f_name || ''} ${row.l_name || ''}`.trim() || '—';
                const active = String(row.status || '').toLowerCase() === 'approved';
                const imgSrc = row.image_url ? mediaUrl(row.image_url) : IMG_FALLBACK;

                return (
                  <tr key={row.vendor_id} className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 text-slate-600 whitespace-nowrap">{idx}</td>
                    <td className="p-3 font-medium text-slate-900">{row.business_name || '—'}</td>
                    <td className="p-3">
                      <div className="flex items-start gap-3 max-w-[18rem] group">
                        <img
                          width={48}
                          height={48}
                          className="rounded-md object-cover aspect-square border border-slate-100 shrink-0 bg-slate-100"
                          src={imgSrc}
                          alt=""
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = IMG_FALLBACK;
                          }}
                        />
                        <div className="min-w-0 relative">
                          <div className="font-medium text-slate-900 leading-snug">{name}</div>
                          <div className="absolute left-0 top-full z-50 mt-1 hidden group-hover:block group-focus-within:block w-72">
                            <div className="rounded-xl border border-slate-200 bg-white shadow-xl p-4 text-xs text-slate-700 space-y-2">
                              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
                                <ShoppingBag className="w-4 h-4 text-orange-500" />
                                {name}
                              </h4>
                              <p>
                                <span className="text-slate-500">Phone:</span> {row.phone || '—'}
                              </p>
                              <p>
                                <span className="text-slate-500">Email:</span> {row.email || '—'}
                              </p>
                              <p>
                                <span className="text-slate-500">Password (hint):</span>{' '}
                                <span className="font-mono break-all">{row.remember_pass || '—'}</span>
                              </p>
                              <p>
                                <span className="text-slate-500">Address:</span> {row.address || '—'}
                              </p>
                              <div className="border-t border-slate-100 pt-2 mt-2 space-y-2">
                                <p className="font-semibold text-slate-800 text-xs uppercase tracking-wide">
                                  Portal access
                                </p>
                                {row.vendor_portal_enabled !== false ? (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                    Enabled
                                  </span>
                                ) : (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800">
                                    Disabled
                                  </span>
                                )}
                                <p className="text-slate-600">
                                  <span className="text-slate-500">Last login:</span>{' '}
                                  {formatPortalLogin(row.vendor_portal_last_login)}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    disabled={portalBusyId === row.vendor_id}
                                    className="px-2 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      togglePortalAccess(row);
                                    }}
                                  >
                                    {row.vendor_portal_enabled !== false ? 'Disable portal' : 'Enable portal'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={portalBusyId === row.vendor_id}
                                    className="px-2 py-1 rounded-md border border-orange-200 bg-orange-50 text-orange-800 text-[11px] font-semibold hover:bg-orange-100 disabled:opacity-50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      resetPortalPassword(row);
                                    }}
                                  >
                                    Reset password
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="space-y-1">
                        <a
                          className="font-semibold text-orange-700 hover:underline block truncate max-w-[14rem]"
                          href={`mailto:${row.email}`}
                        >
                          {row.email}
                        </a>
                        <a className="text-slate-700 hover:underline" href={`tel:${row.phone}`}>
                          {row.phone}
                        </a>
                      </div>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {active ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
                          In-Active
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap justify-center items-center gap-2">
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => openEdit(row)}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => handleDelete(row)}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {canLoginAsVendor && (
                          <button
                            type="button"
                            title="Login as vendor"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800"
                            onClick={() =>
                              setLoginModal({
                                open: true,
                                vendor_id: row.vendor_id,
                                vendor_email: row.email
                              })
                            }
                          >
                            <UserCog className="w-3.5 h-3.5" />
                            Login as vendor
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-500">
                    No vendors match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p>
            Page {page} of {pagination.totalPages || 1}
            <span className="mx-2 text-slate-300">·</span>
            {pagination.total} total
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <button
              disabled={page >= (pagination.totalPages || 1)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
              type="button"
              onClick={() => setPage((p) => p + 1)}
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

      <LoginAsVendorModal modal={loginModal} onClose={() => setLoginModal({ open: false })} />

      {passwordModal.open ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
            <h3 className="font-bold text-slate-900">New portal password</h3>
            <p className="text-xs text-slate-500 mt-1">{passwordModal.vendorName}</p>
            <p className="mt-4 text-sm text-slate-600">Share this password with the vendor securely:</p>
            <div className="mt-2 flex gap-2">
              <input
                readOnly
                className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono bg-slate-50"
                value={passwordModal.password}
              />
              <button
                type="button"
                onClick={copyPassword}
                className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border text-sm"
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
