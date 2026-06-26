import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { KeyRound, LogIn, Mail, Pencil, Plus, RefreshCw, Trash2, User, X } from 'lucide-react';
import { useCanLoginAsTechnician } from '../../hooks/useCanLoginAsTechnician';
import { getBackendOrigin } from '../../utils/api';
import {
  changeDeliveryTechnicianPassword,
  deleteDeliveryTechnician,
  fetchDeliveryTechnicians,
  loginAsTechnician,
  updateDeliveryTechnicianStatus,
} from '../../utils/deliveryRegisterApi';
import PermissionGate from '../../components/PermissionGate';

function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const PAGE_SIZE = 25;

function technicianImageUrl(filename) {
  if (!filename) return null;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}/uploads/delivery-man/${filename.replace(/^\//, '')}`;
}

export default function DeliveryTechniciansPage() {
  const canLoginAsTechnician = useCanLoginAsTechnician();
  const [rows, setRows] = useState([]);
  const [impersonatingId, setImpersonatingId] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchDeliveryTechnicians({
        page: pagination.page,
        limit: pagination.limit,
        search,
      });
      setRows(data.data || []);
      if (data.pagination) setPagination((p) => ({ ...p, ...data.pagination }));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load technicians');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, search]);

  useEffect(() => { load(); }, [load]);

  const handleStatusToggle = async (row, checked) => {
    setSuccess('');
    try {
      await updateDeliveryTechnicianStatus(row.technician_id, checked ? 1 : 0);
      setSuccess('Status updated successfully');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Status update failed');
    }
  };

  const handleLoginAsTechnician = async (row) => {
    setImpersonatingId(row.technician_id);
    setError('');
    try {
      const data = await loginAsTechnician({
        technician_id: row.technician_id,
        technician_email: row.email,
      });
      if (!data.technicianToken) throw new Error('No session token returned');
      const callbackUrl = `${window.location.origin}/technician/auth/callback?token=${encodeURIComponent(data.technicianToken)}`;
      window.open(callbackUrl, '_blank', 'noopener,noreferrer');
      toast.success(data.message || 'Opened technician portal in new tab');
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'Login as technician failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setImpersonatingId(null);
    }
  };

  const openPasswordModal = (row) => {
    setPasswordTarget(row);
    setNewPassword('');
    setConfirmPassword('');
    setShowPassword(false);
  };

  const closePasswordModal = () => {
    setPasswordTarget(null);
    setNewPassword('');
    setConfirmPassword('');
    setSavingPassword(false);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      await changeDeliveryTechnicianPassword(passwordTarget.technician_id, {
        password: newPassword,
        confirm_password: confirmPassword,
      });
      toast.success('Password changed successfully');
      closePasswordModal();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password');
      setSavingPassword(false);
    }
  };

  const handleDelete = async (row) => {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ');
    if (!window.confirm(`Remove technician "${name}"?`)) return;
    setSuccess('');
    try {
      await deleteDeliveryTechnician(row.technician_id);
      setSuccess('Technician removed');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Delete failed');
    }
  };

  const from = rows.length ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const to = (pagination.page - 1) * pagination.limit + rows.length;

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
          <User className="w-6 h-6 text-teal-700" />
          View Technician
          <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full bg-gray-800 text-white text-sm font-medium">
            {pagination.total}
          </span>
          <button type="button" onClick={load} className="p-1.5 text-gray-500 hover:text-teal-700" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </h1>
        <PermissionGate section="technician_bucket" action="create">
          <Link
            to="/delivery-register-management/technicians/add"
            className="inline-flex items-center gap-1 px-4 py-2 bg-teal-700 text-white rounded-lg text-sm hover:bg-teal-800"
          >
            <Plus className="w-4 h-4" /> Add Technician
          </Link>
        </PermissionGate>
      </div>

      {error ? <p className="text-red-600 text-sm mb-3">{error}</p> : null}
      {success ? <p className="text-green-700 text-sm mb-3">{success}</p> : null}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex justify-end">
          <label className="text-sm text-gray-600 flex items-center gap-2">
            Search:
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPagination((p) => ({ ...p, page: 1 }));
                  setSearch(searchInput);
                }
              }}
              className="border rounded px-2 py-1 text-sm w-52"
            />
            <button
              type="button"
              onClick={() => { setPagination((p) => ({ ...p, page: 1 })); setSearch(searchInput); }}
              className="px-3 py-1 border rounded text-xs"
            >
              Go
            </button>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">SL</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact Info</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Loading...</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">No delivery man found</td></tr>
              ) : rows.map((row, i) => {
                const img = technicianImageUrl(row.image);
                const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ');
                return (
                  <tr key={row.technician_id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">{from + i}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {img ? (
                          <img src={img} alt={fullName} className="w-10 h-10 rounded-full object-cover border" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                            <User className="w-5 h-5" />
                          </div>
                        )}
                        <span className="font-medium text-gray-800">{fullName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 text-xs">
                        {row.email ? (
                          <a href={`mailto:${row.email}`} className="text-cyan-700 font-semibold hover:underline flex items-center gap-1">
                            <Mail className="w-3.5 h-3.5" />{row.email}
                          </a>
                        ) : null}
                        {row.phone ? (
                          <a href={`tel:+${row.country_code || '91'}${row.phone}`} className="text-gray-700 hover:underline">
                            +{row.country_code || '91'} {row.phone}
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <PermissionGate section="technician_bucket" action="edit">
                        <label className="inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={row.is_active}
                            onChange={(e) => handleStatusToggle(row, e.target.checked)}
                          />
                          <span className="w-10 h-5 bg-gray-300 rounded-full peer peer-checked:bg-teal-600 relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5" />
                        </label>
                      </PermissionGate>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <PermissionGate section="technician_bucket" action="edit">
                          <Link
                            to={`/delivery-register-management/technicians/${row.technician_id}/edit`}
                            className="inline-flex items-center justify-center w-8 h-8 border border-cyan-600 text-cyan-700 rounded hover:bg-cyan-50"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => openPasswordModal(row)}
                            className="inline-flex items-center justify-center w-8 h-8 border border-amber-500 text-amber-600 rounded hover:bg-amber-50"
                            title="Change Password"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                        </PermissionGate>
                        <PermissionGate section="technician_bucket" action="delete">
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            className="inline-flex items-center justify-center w-8 h-8 border border-red-400 text-red-600 rounded hover:bg-red-50"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </PermissionGate>
                        {canLoginAsTechnician ? (
                          <button
                            type="button"
                            disabled={impersonatingId === row.technician_id}
                            onClick={() => handleLoginAsTechnician(row)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-teal-700 text-teal-700 rounded text-xs hover:bg-teal-50 disabled:opacity-50 whitespace-nowrap"
                            title="Login as Technician"
                          >
                            <LogIn className="w-3.5 h-3.5" />
                            {impersonatingId === row.technician_id ? 'Opening...' : 'Login as Technician'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
          <span>Showing {from} to {to} of {pagination.total} entries</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
              className="px-3 py-1 border rounded disabled:opacity-40"
            >
              Previous
            </button>
            <span>{pagination.page} / {pagination.totalPages}</span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
              className="px-3 py-1 border rounded disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {passwordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={closePasswordModal}
            aria-label="Close"
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <button
              type="button"
              onClick={closePasswordModal}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-600" />
              Change Password
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {[passwordTarget.first_name, passwordTarget.last_name].filter(Boolean).join(' ')}
              {passwordTarget.email ? ` · ${passwordTarget.email}` : ''}
            </p>

            <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <label className="inline-flex items-center gap-2 text-gray-600">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                  />
                  Show password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const pwd = generatePassword();
                    setNewPassword(pwd);
                    setConfirmPassword(pwd);
                    setShowPassword(true);
                  }}
                  className="text-teal-700 font-medium hover:underline"
                >
                  Generate
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm hover:bg-teal-800 disabled:opacity-50"
                >
                  {savingPassword ? 'Saving...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
