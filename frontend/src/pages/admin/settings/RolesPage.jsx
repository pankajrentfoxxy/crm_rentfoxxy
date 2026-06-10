import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import RoleBadge from '../../../components/ui/RoleBadge';
import { ToastContainer, useToast } from '../../../components/ui/Toast';
import { createRole, deleteRole, fetchRoles, updateRole } from '../../../utils/rbacApi';

export default function RolesPage() {
  const { toasts, setToasts, showToast } = useToast();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [form, setForm] = useState({ name: '', display_name: '', description: '' });
  const [saving, setSaving] = useState(false);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRoles({ page, limit: 20, search: search.trim() || undefined });
      setRoles(data.roles || []);
      setPagination(data.pagination || { totalPages: 1, total: 0 });
    } catch {
      showToast('Failed to load roles', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, showToast]);

  useEffect(() => {
    loadRoles();
  }, [search]);

  const openCreate = () => {
    setEditingRole(null);
    setForm({ name: '', display_name: '', description: '' });
    setModalOpen(true);
  };

  const openEdit = (role) => {
    setEditingRole(role);
    setForm({
      name: role.name,
      display_name: role.display_name,
      description: role.description || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingRole) {
        await updateRole(editingRole.id, {
          display_name: form.display_name,
          description: form.description,
        });
        showToast('Role updated', 'success');
      } else {
        await createRole(form);
        showToast('Role created', 'success');
      }
      setModalOpen(false);
      loadRoles();
    } catch (err) {
      showToast(err.response?.data?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role) => {
    if (!window.confirm(`Delete role "${role.display_name}"?`)) return;
    try {
      await deleteRole(role.id);
      showToast('Role deleted', 'success');
      loadRoles();
    } catch (err) {
      showToast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  return (
    <>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-800">Roles</h1>
            <p className="text-sm text-gray-500">Manage role definitions used for permission assignment</p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Create Role
          </button>
        </div>

        <div className="mb-4">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search roles..."
            className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 space-y-3 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left">ID</th>
                    <th className="px-4 py-3 text-left">Role Name</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-left">Created At</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id} className="border-t border-gray-100">
                      <td className="px-4 py-3">{role.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <RoleBadge role={role.name} />
                          <span className="text-gray-600">{role.display_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{role.description || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {role.created_at ? new Date(role.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(role)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {!role.is_system_role ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(role)}
                              className="p-1.5 rounded hover:bg-red-50 text-red-600"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-gray-500">{pagination.total} roles</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Previous
              </button>
              <span className="px-2 py-1">
                Page {page} of {pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSave} className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">{editingRole ? 'Edit Role' : 'Create Role'}</h2>
            {!editingRole ? (
              <div className="mb-3">
                <label className="block text-sm mb-1">Role slug</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="e.g. support_agent"
                  required
                />
              </div>
            ) : null}
            <div className="mb-3">
              <label className="block text-sm mb-1">Display name</label>
              <input
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                required
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border rounded-lg text-sm">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ToastContainer toasts={toasts} setToasts={setToasts} />
    </>
  );
}
