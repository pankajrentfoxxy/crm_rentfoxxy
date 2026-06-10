import React, { useEffect, useMemo, useState } from 'react';
import CreateTechnicianModal from '../../components/admin/CreateTechnicianModal';
import PermissionCheckbox from '../../components/ui/PermissionCheckbox';
import RoleBadge from '../../components/ui/RoleBadge';
import { ToastContainer, useToast } from '../../components/ui/Toast';

const API_BASE = (process.env.REACT_APP_API_URL || process.env.VITE_API_URL || '').replace(/\/$/, '');
const ROLES = ['technician', 'vendor', 'customer', 'admin'];
const SECTIONS = ['tickets', 'inventory', 'customers', 'reports', 'catalogue', 'orders', 'dispatch', 'procurement', 'users', 'invoices'];
const ACTIONS = ['can_view', 'can_create', 'can_edit', 'can_delete'];

const authHeaders = () => {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
};

function RoleDefaultsTab({ showToast }) {
  const [matrix, setMatrix] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const res = await window.fetch(`${API_BASE}/api/permissions/roles`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        const data = await res.json();
        const transformed = (data || []).reduce((acc, item) => {
          if (!acc[item.role]) acc[item.role] = {};
          acc[item.role][item.section] = {
            can_view: !!item.can_view,
            can_create: !!item.can_create,
            can_edit: !!item.can_edit,
            can_delete: !!item.can_delete,
          };
          return acc;
        }, {});
        setMatrix(transformed);
      } catch (error) {
        if (error.name !== 'AbortError') {
          showToast('Failed to load role permissions', 'error');
        }
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [showToast]);

  const updateCell = (role, section, action, value) => {
    setMatrix((prev) => ({
      ...prev,
      [role]: {
        ...(prev[role] || {}),
        [section]: {
          can_view: false,
          can_create: false,
          can_edit: false,
          can_delete: false,
          ...((prev[role] || {})[section] || {}),
          [action]: value,
        },
      },
    }));
    setIsDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const permissions = ROLES.flatMap((role) =>
      SECTIONS.map((section) => {
        const value = matrix?.[role]?.[section] || {};
        return {
          role,
          section,
          can_view: !!value.can_view,
          can_create: !!value.can_create,
          can_edit: !!value.can_edit,
          can_delete: !!value.can_delete,
        };
      })
    );

    try {
      const res = await window.fetch(`${API_BASE}/api/permissions/roles`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ permissions }),
      });
      if (!res.ok) throw new Error();
      setIsDirty(false);
      showToast('Permissions saved', 'success');
    } catch {
      showToast('Failed to save permissions', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div key={idx} className="h-10 bg-gray-100 rounded" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-end gap-3 mb-3">
        {isDirty ? <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">Unsaved changes</span> : null}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left w-40">Section</th>
              {ROLES.map((role) => (
                <th key={role} className="px-3 py-2 text-center">
                  <RoleBadge role={role} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((section) => (
              <tr key={section} className="border-t border-gray-100">
                <td className="px-3 py-2 capitalize">{section}</td>
                {ROLES.map((role) => (
                  <td key={role} className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1 text-xs">
                      {ACTIONS.map((action) => (
                        <label key={action} className="flex flex-col items-center gap-1">
                          <span className="text-[10px] text-gray-500 uppercase">{action.split('_')[1][0]}</span>
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5"
                            checked={!!matrix?.[role]?.[section]?.[action]}
                            onChange={(e) => updateCell(role, section, action, e.target.checked)}
                          />
                        </label>
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PendingVendorsTab({ showToast, vendors, setVendors }) {
  const [loading, setLoading] = useState(true);
  const [actionState, setActionState] = useState({});

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const res = await window.fetch(`${API_BASE}/api/auth/vendors/pending`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        const data = await res.json();
        setVendors(data.users || data.vendors || []);
      } catch (error) {
        if (error.name !== 'AbortError') showToast('Failed to load vendors', 'error');
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [setVendors, showToast]);

  const setMode = (userId, mode) => {
    setActionState((prev) => ({
      ...prev,
      [userId]: { mode, reason: prev[userId]?.reason || '', loading: false },
    }));
  };

  const handleApprove = async (userId) => {
    setActionState((prev) => ({ ...prev, [userId]: { ...(prev[userId] || {}), loading: true } }));
    try {
      const res = await window.fetch(`${API_BASE}/api/auth/vendors/${userId}/approve`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'approve' }),
      });
      if (!res.ok) throw new Error();
      setVendors((prev) => prev.filter((vendor) => vendor.user_id !== userId));
      showToast('Vendor approved', 'success');
    } catch {
      showToast('Failed to approve vendor', 'error');
      setMode(userId, null);
    }
  };

  const handleReject = async (userId, reason) => {
    setActionState((prev) => ({ ...prev, [userId]: { ...(prev[userId] || {}), loading: true } }));
    try {
      const res = await window.fetch(`${API_BASE}/api/auth/vendors/${userId}/approve`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'reject', reason }),
      });
      if (!res.ok) throw new Error();
      setVendors((prev) => prev.filter((vendor) => vendor.user_id !== userId));
      showToast('Vendor rejected', 'success');
    } catch {
      showToast('Failed to reject vendor', 'error');
      setMode(userId, null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div key={idx} className="h-10 bg-gray-100 rounded" />
        ))}
      </div>
    );
  }

  if (!vendors.length) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-2">??</div>
        <p className="text-sm">No pending approvals</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Company</th>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-left">Mobile</th>
            <th className="px-3 py-2 text-left">GST</th>
            <th className="px-3 py-2 text-left">Registered</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((user) => {
            const state = actionState[user.user_id] || { mode: null, reason: '', loading: false };
            return (
              <tr key={user.user_id} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {user.name}
                    <RoleBadge role="vendor" />
                  </div>
                </td>
                <td className="px-3 py-2">{user.company_name}</td>
                <td className="px-3 py-2">{user.email}</td>
                <td className="px-3 py-2">{user.mobile_no}</td>
                <td className="px-3 py-2">{user.gst_number || '—'}</td>
                <td className="px-3 py-2">{new Date(user.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  {state.mode === null ? (
                    <div className="flex gap-2">
                      <button className="bg-green-50 text-green-700 border border-green-200 rounded-lg px-3 py-1 text-sm hover:bg-green-100" onClick={() => setMode(user.user_id, 'confirming_approve')}>
                        Approve
                      </button>
                      <button className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-1 text-sm hover:bg-red-100" onClick={() => setMode(user.user_id, 'rejecting')}>
                        Reject
                      </button>
                    </div>
                  ) : null}

                  {state.mode === 'confirming_approve' ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">Confirm approval?</span>
                      <button className="text-green-700 text-xs" onClick={() => handleApprove(user.user_id)} disabled={state.loading}>Yes</button>
                      <button className="text-gray-600 text-xs" onClick={() => setMode(user.user_id, null)} disabled={state.loading}>No</button>
                    </div>
                  ) : null}

                  {state.mode === 'rejecting' ? (
                    <div className="space-y-2">
                      <textarea
                        rows={2}
                        placeholder="Reason (optional)"
                        value={state.reason}
                        onChange={(e) =>
                          setActionState((prev) => ({
                            ...prev,
                            [user.user_id]: { ...state, reason: e.target.value },
                          }))
                        }
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <div className="flex gap-2">
                        <button className="text-red-700 text-xs" onClick={() => handleReject(user.user_id, state.reason)} disabled={state.loading}>
                          Confirm Reject
                        </button>
                        <button className="text-gray-600 text-xs" onClick={() => setMode(user.user_id, null)} disabled={state.loading}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UserPermissionsTab({ showToast }) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [searching, setSearching] = useState(false);
  const [expandedUser, setExpandedUser] = useState(null);
  const [userPerms, setUserPerms] = useState({});
  const [savingUser, setSavingUser] = useState(null);

  useEffect(() => {
    if (search.trim().length < 2) {
      setUsers([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await window.fetch(`${API_BASE}/api/users?search=${encodeURIComponent(search)}`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        const data = await res.json();
        setUsers(data.users || []);
      } catch (error) {
        if (error.name !== 'AbortError') showToast('User search failed', 'error');
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, showToast]);

  const loadPermissions = async (user) => {
    const userId = user.user_id;
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }

    setExpandedUser(userId);
    try {
      const res = await window.fetch(`${API_BASE}/api/users/${userId}/permissions`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      const rolePerms = data.role_permissions || [];
      const overrides = data.user_permissions || [];

      const normalized = {};
      SECTIONS.forEach((section) => {
        normalized[section] = {};
        ACTIONS.forEach((action) => {
          const overrideRow = overrides.find((p) => p.section === section);
          normalized[section][action] = overrideRow && overrideRow[action] !== undefined ? overrideRow[action] : null;
        });
      });

      setUserPerms((prev) => ({
        ...prev,
        [userId]: {
          values: normalized,
          roleDefaults: rolePerms,
          role: user.role,
          name: user.name,
        },
      }));
    } catch {
      showToast('Failed to fetch user permissions', 'error');
    }
  };

  const setPermissionValue = (userId, section, action, value) => {
    setUserPerms((prev) => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        values: {
          ...prev[userId].values,
          [section]: {
            ...prev[userId].values[section],
            [action]: value,
          },
        },
      },
    }));
  };

  const resetToDefaults = (userId) => {
    const resetValues = {};
    SECTIONS.forEach((section) => {
      resetValues[section] = { can_view: null, can_create: null, can_edit: null, can_delete: null };
    });
    setUserPerms((prev) => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        values: resetValues,
      },
    }));
  };

  const saveUserPermissions = async (userId) => {
    const current = userPerms[userId];
    if (!current) return;

    const permissions = SECTIONS.map((section) => ({ section, ...current.values[section] })).filter((row) =>
      ACTIONS.some((action) => row[action] !== null)
    );

    setSavingUser(userId);
    try {
      const res = await window.fetch(`${API_BASE}/api/users/${userId}/permissions`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ permissions }),
      });
      if (!res.ok) throw new Error();
      showToast('User permissions saved', 'success');
    } catch {
      showToast('Failed to save user permissions', 'error');
    } finally {
      setSavingUser(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <span className="absolute left-3 top-2.5 text-gray-400">??</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by name or email"
          className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        {searching ? <span className="absolute right-3 top-2.5 text-xs text-gray-500">...</span> : null}
      </div>

      <div className="space-y-2">
        {users.map((user) => {
          const expanded = expandedUser === user.user_id;
          const userData = userPerms[user.user_id];
          return (
            <div key={user.user_id} className="border border-gray-200 rounded-lg">
              <button
                type="button"
                onClick={() => loadPermissions(user)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center">
                    {user.name
                      ?.split(' ')
                      .map((part) => part[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-800">{user.name}</p>
                      <RoleBadge role={user.role} />
                    </div>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                </div>
                <span className="text-gray-400">{expanded ? '-' : '+'}</span>
              </button>

              {expanded && userData ? (
                <div className="px-4 pb-4 border-t border-gray-100">
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-3 mb-2">
                    <div>
                      <h4 className="text-sm font-medium text-gray-800">Permission overrides for {userData.name}</h4>
                      <p className="text-xs text-gray-500">
                        Checkboxes show user-specific overrides. Dash (—) means inheriting role default.
                      </p>
                    </div>
                    <RoleBadge role={userData.role} />
                  </div>

                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left">Section</th>
                          <th className="px-3 py-2 text-center">View</th>
                          <th className="px-3 py-2 text-center">Create</th>
                          <th className="px-3 py-2 text-center">Edit</th>
                          <th className="px-3 py-2 text-center">Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SECTIONS.map((section) => (
                          <tr key={section} className="border-t border-gray-100">
                            <td className="px-3 py-2 capitalize">{section}</td>
                            {ACTIONS.map((action) => (
                              <td key={action} className="px-3 py-2 text-center">
                                <PermissionCheckbox
                                  value={userData.values[section][action]}
                                  onChange={(value) => setPermissionValue(user.user_id, section, action, value)}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => resetToDefaults(user.user_id)}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Reset to Role Defaults
                    </button>
                    <button
                      type="button"
                      onClick={() => saveUserPermissions(user.user_id)}
                      disabled={savingUser === user.user_id}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {savingUser === user.user_id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PermissionsPage() {
  const [activeTab, setActiveTab] = useState('role_defaults');
  const [vendors, setVendors] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { toasts, setToasts, showToast } = useToast();

  const tabs = useMemo(
    () => [
      { id: 'role_defaults', label: 'Role Defaults' },
      {
        id: 'pending_vendors',
        label: `Pending Vendors${vendors.length > 0 ? ` (${vendors.length})` : ''}`,
        hasBadge: vendors.length > 0,
      },
      { id: 'user_permissions', label: 'User Permissions' },
    ],
    [vendors.length]
  );

  return (
    <>
      <div className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-2xl font-semibold text-gray-800">Roles & Permissions</h1>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            Create Technician
          </button>
        </div>

        <div className="border-b border-gray-200 mb-4 flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`pb-2 text-sm ${
                activeTab === tab.id
                  ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.hasBadge ? (
                <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 ml-1">{vendors.length}</span>
              ) : null}
            </button>
          ))}
        </div>

        {activeTab === 'role_defaults' ? <RoleDefaultsTab showToast={showToast} /> : null}
        {activeTab === 'pending_vendors' ? (
          <PendingVendorsTab showToast={showToast} vendors={vendors} setVendors={setVendors} />
        ) : null}
        {activeTab === 'user_permissions' ? <UserPermissionsTab showToast={showToast} /> : null}
      </div>

      <CreateTechnicianModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => showToast('Technician account created', 'success')}
      />

      <ToastContainer toasts={toasts} setToasts={setToasts} />
    </>
  );
}
