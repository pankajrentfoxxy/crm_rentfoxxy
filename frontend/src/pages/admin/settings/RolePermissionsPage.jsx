import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PermissionMatrix from '../../../components/admin/PermissionMatrix';
import RoleBadge from '../../../components/ui/RoleBadge';
import { ToastContainer, useToast } from '../../../components/ui/Toast';
import {
  RBAC_SECTIONS,
  fetchRolePermissions,
  fetchRoles,
  matrixToPermissionsArray,
  permissionsArrayToMatrix,
  saveRolePermissions,
} from '../../../utils/rbacApi';

const FLOOR_SECTIONS = new Set([
  'floor_pipeline',
  'floor_tickets',
  'chip_level_repair',
  'parts_inventory',
  'ttspl_history'
]);

export default function RolePermissionsPage() {
  const [searchParams] = useSearchParams();
  const floorFilter = searchParams.get('filter') === 'floor';
  const { toasts, setToasts, showToast } = useToast();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const [roles, setRoles] = useState([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [sections, setSections] = useState(RBAC_SECTIONS);
  const [matrix, setMatrix] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchRoles({ limit: 100 })
      .then((data) => {
        if (cancelled) return;
        const list = data.roles || [];
        setRoles(list);
        if (list.length > 0) {
          setSelectedRole((prev) => prev || list[0].name);
        }
      })
      .catch(() => {
        if (!cancelled) showToastRef.current('Failed to load roles', 'error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedRole) return;

    let cancelled = false;
    setLoading(true);

    fetchRolePermissions(selectedRole)
      .then((data) => {
        if (cancelled) return;
        const sectionList = data.sections?.length ? data.sections : RBAC_SECTIONS;
        setSections(sectionList);
        setMatrix(permissionsArrayToMatrix(data.permissions, sectionList));
        setIsDirty(false);
      })
      .catch(() => {
        if (!cancelled) showToastRef.current('Failed to load permissions', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRole]);

  const selectedRoleMeta = useMemo(
    () => roles.find((r) => r.name === selectedRole),
    [roles, selectedRole]
  );

  const updateCell = (section, action, value) => {
    setMatrix((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [action]: value,
      },
    }));
    setIsDirty(true);
  };

  const selectAll = () => {
    const next = {};
    sections.forEach((section) => {
      next[section] = { can_view: true, can_create: true, can_edit: true, can_delete: true };
    });
    setMatrix(next);
    setIsDirty(true);
  };

  const removeAll = () => {
    const next = {};
    sections.forEach((section) => {
      next[section] = { can_view: false, can_create: false, can_edit: false, can_delete: false };
    });
    setMatrix(next);
    setIsDirty(true);
  };

  const handleReset = () => {
    if (!selectedRole) return;
    fetchRolePermissions(selectedRole).then((data) => {
      setMatrix(permissionsArrayToMatrix(data.permissions, sections));
      setIsDirty(false);
    });
  };

  const handleSave = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await saveRolePermissions(selectedRole, matrixToPermissionsArray(matrix));
      showToast('Permissions saved', 'success');
      setIsDirty(false);
    } catch (err) {
      showToast(err.response?.data?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-800">Role Permissions</h1>
          <p className="text-sm text-gray-500">Configure default permissions for each role</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Role</label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[220px]"
            >
              {roles.map((role) => (
                <option key={role.id} value={role.name}>
                  {role.display_name}
                </option>
              ))}
            </select>
            {selectedRoleMeta ? <RoleBadge role={selectedRoleMeta.name} /> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
          {isDirty ? (
            <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full mr-auto">
              Unsaved changes
            </span>
          ) : (
            <span className="mr-auto" />
          )}
          <button type="button" onClick={selectAll} className="text-xs text-blue-600 hover:underline">
            Select All
          </button>
          <button type="button" onClick={removeAll} className="text-xs text-blue-600 hover:underline">
            Remove All
          </button>
          <button type="button" onClick={handleReset} className="px-3 py-1.5 border rounded-lg text-sm">
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded" />
            ))}
          </div>
        ) : (
          <PermissionMatrix
            sections={floorFilter ? sections.filter((s) => FLOOR_SECTIONS.has(s.section || s)) : sections}
            matrix={matrix}
            onChange={updateCell}
            mode="checkbox"
          />
        )}
      </div>
      <ToastContainer toasts={toasts} setToasts={setToasts} />
    </>
  );
}
