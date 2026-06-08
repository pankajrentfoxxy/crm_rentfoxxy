import React, { useMemo, useState } from 'react';
import api from '../../utils/api';
const SECTIONS = ['tickets', 'inventory', 'customers', 'reports', 'dispatch', 'procurement'];

const initialPermissionState = () =>
  Object.fromEntries(
    SECTIONS.map((section) => [
      section,
      { can_view: false, can_create: false, can_edit: false, can_delete: false },
    ])
  );

export default function CreateTechnicianModal({ isOpen, onClose, onSuccess }) {
  const [form, setForm] = useState({ name: '', email: '', mobile_no: '', password: '' });
  const [permissions, setPermissions] = useState(initialPermissionState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const allSelected = useMemo(
    () =>
      SECTIONS.every((section) =>
        Object.values(permissions[section] || {}).every(Boolean)
      ),
    [permissions]
  );

  if (!isOpen) return null;

  const resetForm = () => {
    setForm({ name: '', email: '', mobile_no: '', password: '' });
    setPermissions(initialPermissionState());
    setError('');
    setLoading(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handlePermissionChange = (section, action, checked) => {
    setPermissions((prev) => {
      const next = { ...prev, [section]: { ...prev[section], [action]: checked } };

      if (action === 'can_delete' && checked) {
        next[section] = { can_view: true, can_create: true, can_edit: true, can_delete: true };
      }

      if (action === 'can_edit' && checked) {
        next[section].can_view = true;
      }

      if (action === 'can_view' && !checked) {
        next[section] = { can_view: false, can_create: false, can_edit: false, can_delete: false };
      }

      return next;
    });
  };

  const toggleAll = () => {
    const value = !allSelected;
    setPermissions(
      Object.fromEntries(
        SECTIONS.map((section) => [
          section,
          { can_view: value, can_create: value, can_edit: value, can_delete: value },
        ])
      )
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.mobile_no || !form.password) {
      setError('All fields are required');
      return;
    }

    setLoading(true);
    setError('');

    const permissionsArray = SECTIONS.filter((section) =>
      Object.values(permissions[section]).some(Boolean)
    ).map((section) => ({ section, ...permissions[section] }));

    try {
      const { data } = await api.post('/auth/register/technician', {
        ...form,
        permissions: permissionsArray,
      });

      if (typeof onSuccess === 'function') onSuccess(data);
      handleClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create technician');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-800">Create Technician Account</h2>
          <button type="button" onClick={handleClose} className="text-gray-500 hover:text-gray-700 text-xl">
            ù
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: 'Name', name: 'name', type: 'text' },
              { label: 'Email', name: 'email', type: 'email' },
              { label: 'Mobile Number', name: 'mobile_no', type: 'tel' },
              { label: 'Password', name: 'password', type: 'password' },
            ].map((field) => (
              <div key={field.name}>
                <label className="block text-sm text-gray-700 mb-1">{field.label}</label>
                <input
                  type={field.type}
                  value={form[field.name]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-medium text-gray-700">Section Permissions</h3>
              <button type="button" className="text-xs text-blue-600 hover:underline" onClick={toggleAll}>
                Select All
              </button>
            </div>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Section</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">View</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Create</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Edit</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {SECTIONS.map((section) => (
                    <tr key={section} className="border-t border-gray-100">
                      <td className="px-3 py-2 capitalize">{section}</td>
                      {['can_view', 'can_create', 'can_edit', 'can_delete'].map((action) => (
                        <td key={action} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={permissions[section][action]}
                            onChange={(e) => handlePermissionChange(section, action, e.target.checked)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="pt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create Technician'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
