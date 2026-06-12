import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy, Key, Pencil, Plus, Power, Search, X,
} from 'lucide-react';
import RoleBadge from '../../../components/ui/RoleBadge';
import { ToastContainer, useToast } from '../../../components/ui/Toast';
import { useAuth } from '../../../context/AuthContext';
import {
  FLOOR_TEAM_ROLES,
  MANAGEABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_DISPLAY_NAMES,
} from '../../../constants/roles';
import api from '../../../utils/api';
import {
  createUser,
  fetchUsers,
  resetUserPassword,
  updateUser,
  updateUserStatus,
} from '../../../utils/rbacApi';

function initials(name) {
  return String(name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatRelative(date) {
  if (!date) return 'Never';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function StatusDot({ status }) {
  const map = {
    active: { color: 'bg-green-500', label: 'Active' },
    inactive: { color: 'bg-gray-400', label: 'Inactive' },
    blocked: { color: 'bg-red-500', label: 'Blocked' },
    pending_approval: { color: 'bg-amber-500', label: 'Pending' },
  };
  const s = map[status] || map.inactive;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
      <span className={`w-2 h-2 rounded-full ${s.color}`} />
      {s.label}
    </span>
  );
}

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';
  let out = '';
  for (let i = 0; i < length; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const emptyForm = () => ({
  name: '',
  email: '',
  mobile_no: '',
  role: 'team_member',
  team_ids: [],
  department: '',
  designation: '',
  employee_id: '',
  joining_date: '',
  notes: '',
  password: '',
  confirm_password: '',
  autoPassword: true,
});

export default function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const { toasts, setToasts, showToast } = useToast();

  const isAdmin = ['admin', 'super_admin'].includes(currentUser?.role);

  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({});
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [departments, setDepartments] = useState([]);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [statusModal, setStatusModal] = useState(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const [resetModal, setResetModal] = useState(null);
  const [resetManual, setResetManual] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetResult, setResetResult] = useState(null);
  const [resetSaving, setResetSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUsers({
        page,
        limit: 25,
        search: search || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined,
        department: departmentFilter || undefined,
        include_inactive: includeInactive ? 'true' : undefined,
      });
      setUsers(data.users || []);
      setStats(data.stats || {});
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
      const depts = [...new Set((data.users || []).map((u) => u.department).filter(Boolean))];
      setDepartments((prev) => [...new Set([...prev, ...depts])].sort());
    } catch {
      showToast('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, statusFilter, departmentFilter, includeInactive, showToast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    api.get('/teams').then((r) => setTeams(r.data?.teams || r.data || [])).catch(() => {});
  }, []);

  const openAdd = () => {
    setEditingUser(null);
    setForm({ ...emptyForm(), password: generatePassword(), autoPassword: true });
    setDrawerOpen(true);
  };

  const openEdit = (u) => {
    setEditingUser(u);
    setForm({
      name: u.name || '',
      email: u.email || '',
      mobile_no: u.mobile_no || '',
      role: u.role || 'team_member',
      team_ids: u.team_ids || (u.team_id ? [u.team_id] : []),
      department: u.department || '',
      designation: u.designation || '',
      employee_id: u.employee_id || '',
      joining_date: u.joining_date ? String(u.joining_date).slice(0, 10) : '',
      notes: u.notes || '',
      password: '',
      confirm_password: '',
      autoPassword: false,
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingUser(null);
    setForm(emptyForm());
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const showTeamField = FLOOR_TEAM_ROLES.includes(form.role);

  const handleSave = async () => {
    if (!form.name?.trim() || !form.email?.trim()) {
      showToast('Name and email are required', 'error');
      return;
    }
    if (!editingUser) {
      if (!form.autoPassword && form.password !== form.confirm_password) {
        showToast('Passwords do not match', 'error');
        return;
      }
      if (!form.autoPassword && !form.password) {
        showToast('Password is required', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        mobile_no: form.mobile_no || null,
        role: form.role,
        team_ids: showTeamField ? form.team_ids : [],
        team_id: showTeamField && form.team_ids[0] ? form.team_ids[0] : null,
        designation: form.designation || null,
        department: form.department || null,
        employee_id: form.employee_id || null,
        joining_date: form.joining_date || null,
        notes: form.notes || null,
      };

      if (editingUser) {
        await updateUser(editingUser.user_id, payload);
        showToast('User updated', 'success');
      } else {
        await createUser({
          ...payload,
          password: form.autoPassword ? generatePassword() : form.password,
        });
        showToast('User created', 'success');
      }
      closeDrawer();
      loadUsers();
    } catch (err) {
      showToast(err.response?.data?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmStatus = async () => {
    if (!statusModal) return;
    if (!statusReason.trim()) {
      showToast('Reason is required', 'error');
      return;
    }
    setStatusSaving(true);
    try {
      await updateUserStatus(statusModal.user.user_id, statusModal.status, statusReason.trim());
      showToast(`User ${statusModal.status === 'active' ? 'activated' : statusModal.status}`, 'success');
      setStatusModal(null);
      setStatusReason('');
      loadUsers();
    } catch (err) {
      showToast(err.response?.data?.message || 'Status update failed', 'error');
    } finally {
      setStatusSaving(false);
    }
  };

  const handleReset = async () => {
    if (!resetModal) return;
    setResetSaving(true);
    try {
      const data = await resetUserPassword(
        resetModal.user_id,
        resetManual ? resetPassword : undefined
      );
      setResetResult(data.new_password);
      showToast('Password reset', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Reset failed', 'error');
    } finally {
      setResetSaving(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setRoleFilter('');
    setStatusFilter('');
    setDepartmentFilter('');
    setIncludeInactive(false);
    setPage(1);
  };

  const creatableRoles = useMemo(() => {
    if (currentUser?.role === 'manager') {
      return MANAGEABLE_ROLES.filter((r) => !['admin', 'manager', 'super_admin'].includes(r));
    }
    return MANAGEABLE_ROLES;
  }, [currentUser?.role]);

  return (
    <>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-800">Users</h1>
            <p className="text-sm text-gray-500">Manage CRM team members and their access</p>
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Users', value: stats.total ?? 0 },
            { label: 'Active', value: stats.active ?? 0 },
            { label: 'Inactive', value: stats.inactive ?? 0 },
            { label: 'Pending Approval', value: stats.pending_approval ?? 0 },
          ].map((card) => (
            <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">{card.label}</p>
              <p className="text-2xl font-semibold text-gray-800 mt-1">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Name or email"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <select
              value={roleFilter}
              onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[140px]"
            >
              <option value="">All roles</option>
              {MANAGEABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_DISPLAY_NAMES[r] || r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[120px]"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="blocked">Blocked</option>
              <option value="pending_approval">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Department</label>
            <select
              value={departmentFilter}
              onChange={(e) => { setDepartmentFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[140px]"
            >
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          {isAdmin ? (
            <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
              />
              Include inactive
            </label>
          ) : null}
          <button
            type="button"
            onClick={clearFilters}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Clear
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Department</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Team</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Last Login</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-400">Loading...</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-400">No users found</td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isDimmed = u.status === 'inactive' || u.status === 'blocked' || !u.active;
                    return (
                      <tr
                        key={u.user_id}
                        className={`border-t border-gray-100 ${isDimmed ? 'opacity-60 bg-gray-50/50' : ''}`}
                        title={u.deactivation_reason || undefined}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold shrink-0">
                              {initials(u.name)}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{u.name}</p>
                              <p className="text-xs text-gray-500">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                        <td className="px-4 py-3 text-gray-600">{u.department || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{u.team_name || '—'}</td>
                        <td className="px-4 py-3">
                          <StatusDot status={u.status || (u.active ? 'active' : 'inactive')} />
                        </td>
                        <td className="px-4 py-3 text-gray-500">{formatRelative(u.last_login)}</td>
                        <td className="px-4 py-3 text-gray-500">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(u)}
                              className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const nextStatus = u.status === 'active' || u.active ? 'inactive' : 'active';
                                setStatusModal({
                                  user: u,
                                  status: nextStatus,
                                  title: nextStatus === 'active'
                                    ? `Activate ${u.name}`
                                    : `Deactivate ${u.name}`,
                                });
                                setStatusReason('');
                              }}
                              className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                              title="Toggle status"
                            >
                              <Power className="w-4 h-4" />
                            </button>
                            {isAdmin ? (
                              <>
                                {u.status !== 'blocked' ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStatusModal({
                                        user: u,
                                        status: 'blocked',
                                        title: `Block ${u.name}`,
                                      });
                                      setStatusReason('');
                                    }}
                                    className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 text-xs"
                                    title="Block"
                                  >
                                    Block
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResetModal(u);
                                    setResetManual(false);
                                    setResetPassword('');
                                    setResetResult(null);
                                  }}
                                  className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                                  title="Reset password"
                                >
                                  <Key className="w-4 h-4" />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} users)
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1 border rounded-lg text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 border rounded-lg text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={closeDrawer} role="presentation" />
          <div className="relative w-full max-w-[520px] bg-white h-full shadow-xl flex flex-col">
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b bg-white">
              <h2 className="text-lg font-semibold text-gray-800">
                {editingUser ? `Edit: ${editingUser.name}` : 'Add User'}
              </h2>
              <button type="button" onClick={closeDrawer} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Personal Info
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setField('name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Email *</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setField('email', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Phone / WhatsApp</label>
                    <input
                      type="text"
                      value={form.mobile_no}
                      onChange={(e) => setField('mobile_no', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Role & Access
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Role *</label>
                    <select
                      value={form.role}
                      onChange={(e) => setField('role', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      {creatableRoles.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_DISPLAY_NAMES[r]} — {ROLE_DESCRIPTIONS[r]}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2"><RoleBadge role={form.role} /></div>
                  </div>

                  {showTeamField ? (
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Team(s)</label>
                      <select
                        multiple
                        value={form.team_ids.map(String)}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions).map((o) => parseInt(o.value, 10));
                          setField('team_ids', selected);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[100px]"
                      >
                        {teams.map((t) => (
                          <option key={t.team_id} value={t.team_id}>{t.team_name}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-400 mt-1">Hold Ctrl/Cmd to select multiple</p>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Department</label>
                      <input
                        type="text"
                        value={form.department}
                        onChange={(e) => setField('department', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Designation</label>
                      <input
                        type="text"
                        value={form.designation}
                        onChange={(e) => setField('designation', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Employee ID</label>
                      <input
                        type="text"
                        value={form.employee_id}
                        onChange={(e) => setField('employee_id', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">Joining Date</label>
                      <input
                        type="date"
                        value={form.joining_date}
                        onChange={(e) => setField('joining_date', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {!editingUser ? (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Password
                  </h3>
                  <label className="flex items-center gap-2 text-sm text-gray-700 mb-3">
                    <input
                      type="checkbox"
                      checked={form.autoPassword}
                      onChange={(e) => setField('autoPassword', e.target.checked)}
                    />
                    Generate secure password automatically
                  </label>
                  {!form.autoPassword ? (
                    <div className="space-y-3">
                      <input
                        type="password"
                        placeholder="Password *"
                        value={form.password}
                        onChange={(e) => setField('password', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                      <input
                        type="password"
                        placeholder="Confirm Password *"
                        value={form.confirm_password}
                        onChange={(e) => setField('confirm_password', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Notes</h3>
                <textarea
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  rows={3}
                  placeholder="Internal notes only"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </section>
            </div>

            <div className="sticky bottom-0 px-5 py-4 border-t bg-white flex justify-end gap-2">
              <button type="button" onClick={closeDrawer} className="px-4 py-2 border rounded-lg text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {statusModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setStatusModal(null)} role="presentation" />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">{statusModal.title}</h3>
            <p className="text-sm text-gray-500 mb-4">Please provide a reason for this change.</p>
            <textarea
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
              placeholder="Reason *"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStatusModal(null)}
                className="px-4 py-2 border rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmStatus}
                disabled={statusSaving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {statusSaving ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setResetModal(null)} role="presentation" />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              Reset password for {resetModal.name}
            </h3>
            {resetResult ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Share this password with {resetModal.name}:
                </p>
                <div className="flex items-center gap-2 bg-gray-50 border rounded-lg p-3">
                  <code className="flex-1 text-sm font-mono">{resetResult}</code>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(resetResult)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setResetModal(null)}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm text-gray-700 mb-3">
                  <input
                    type="checkbox"
                    checked={!resetManual}
                    onChange={(e) => setResetManual(!e.target.checked)}
                  />
                  Generate random password (recommended)
                </label>
                {resetManual ? (
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
                  />
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setResetModal(null)}
                    className="px-4 py-2 border rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={resetSaving || (resetManual && !resetPassword)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
                  >
                    {resetSaving ? 'Resetting...' : 'Reset Password'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <ToastContainer toasts={toasts} setToasts={setToasts} />
    </>
  );
}
