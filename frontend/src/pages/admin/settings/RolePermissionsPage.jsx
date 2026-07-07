import React, { useEffect, useMemo, useRef, useState } from 'react';
import GroupedPermissionMatrix from '../../../components/admin/GroupedPermissionMatrix';
import RoleBadge from '../../../components/ui/RoleBadge';
import { ToastContainer, useToast } from '../../../components/ui/Toast';
import { ROLE_DESCRIPTIONS } from '../../../constants/roles';
import { useAuth } from '../../../context/AuthContext';
import {
  RBAC_SECTIONS,
  applyRoleDefaults,
  fetchRolePermissions,
  fetchRoles,
  matrixToPermissionsArray,
  permissionsArrayToMatrix,
  saveRolePermissions,
} from '../../../utils/rbacApi';
import { visibleRolePermissionSections } from '../../../constants/sections';

function countChanges(matrix, baseline) {
  let n = 0;
  Object.keys(matrix).forEach((section) => {
    ['can_view', 'can_create', 'can_edit', 'can_delete'].forEach((action) => {
      if (!!matrix[section]?.[action] !== !!baseline[section]?.[action]) n += 1;
    });
  });
  return n;
}

export default function RolePermissionsPage() {
  const { user, refreshPermissions } = useAuth();
  const { toasts, setToasts, showToast } = useToast();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const [roles, setRoles] = useState([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [sections, setSections] = useState(RBAC_SECTIONS);
  const [matrix, setMatrix] = useState({});
  const [baselineMatrix, setBaselineMatrix] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingDefaults, setApplyingDefaults] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRoles({ limit: 100 })
      .then((data) => {
        if (cancelled) return;
        const list = (data.roles || []).filter((r) => r.name !== 'vendor' && r.name !== 'customer');
        setRoles(list);
        if (list.length > 0) {
          setSelectedRole((prev) => prev || list[0].name);
        }
      })
      .catch(() => {
        if (!cancelled) showToastRef.current('Failed to load roles', 'error');
      });
    return () => { cancelled = true; };
  }, []);

  const loadPermissions = (role) => {
    if (!role) return;
    setLoading(true);
    fetchRolePermissions(role)
      .then((data) => {
        const sectionList = visibleRolePermissionSections(
          data.sections?.length
            ? data.sections.map((s) => (typeof s === 'string' ? s : s.section))
            : RBAC_SECTIONS
        );
        setSections(sectionList);
        const loaded = permissionsArrayToMatrix(data.permissions, sectionList);
        setMatrix(loaded);
        setBaselineMatrix(JSON.parse(JSON.stringify(loaded)));
      })
      .catch(() => showToastRef.current('Failed to load permissions', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPermissions(selectedRole);
  }, [selectedRole]);

  const selectedRoleMeta = useMemo(
    () => roles.find((r) => r.name === selectedRole),
    [roles, selectedRole]
  );

  const changeCount = useMemo(
    () => countChanges(matrix, baselineMatrix),
    [matrix, baselineMatrix]
  );

  const updateSection = (section, values) => {
    setMatrix((prev) => ({ ...prev, [section]: values }));
  };

  const handleApplyDefaults = async () => {
    if (!selectedRole) return;
    if (!window.confirm(`Reset "${selectedRoleMeta?.display_name || selectedRole}" to migration defaults? This cannot be undone.`)) {
      return;
    }
    setApplyingDefaults(true);
    try {
      const data = await applyRoleDefaults(selectedRole);
      const sectionList = visibleRolePermissionSections(
        data.sections?.length
          ? data.sections.map((s) => (typeof s === 'string' ? s : s.section))
          : sections
      );
      const loaded = permissionsArrayToMatrix(data.permissions, sectionList);
      setMatrix(loaded);
      setBaselineMatrix(JSON.parse(JSON.stringify(loaded)));
      if (user?.role === selectedRole) {
        await refreshPermissions();
      }
      showToast('Role defaults applied', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to apply defaults', 'error');
    } finally {
      setApplyingDefaults(false);
    }
  };

  const handleSave = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await saveRolePermissions(selectedRole, matrixToPermissionsArray(matrix));
      setBaselineMatrix(JSON.parse(JSON.stringify(matrix)));
      if (user?.role === selectedRole) {
        await refreshPermissions();
      }
      showToast('Permissions saved', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-800">Role Permissions</h1>
          <p className="text-sm text-gray-500">
            Define what each role can access across all modules
          </p>
        </div>

        <div className="flex gap-6 items-start">
          <aside className="w-60 shrink-0 space-y-2">
            {roles.map((role) => (
              <button
                key={role.id || role.name}
                type="button"
                onClick={() => setSelectedRole(role.name)}
                className={`w-full text-left p-3 rounded-xl border transition-colors ${
                  selectedRole === role.name
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <RoleBadge role={role.name} />
                </div>
                <p className="text-sm font-medium text-gray-800 truncate">
                  {role.display_name}
                </p>
                <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">
                  {role.description || ROLE_DESCRIPTIONS[role.name] || ''}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Active users: {role.active_users ?? 0}
                </p>
              </button>
            ))}
          </aside>

          <div className="flex-1 min-w-0">
            {selectedRoleMeta ? (
              <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <RoleBadge role={selectedRoleMeta.name} />
                      <h2 className="text-lg font-semibold text-gray-800">
                        {selectedRoleMeta.display_name}
                      </h2>
                    </div>
                    <p className="text-sm text-gray-500">
                      {selectedRoleMeta.description || ROLE_DESCRIPTIONS[selectedRoleMeta.name]}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {selectedRoleMeta.active_users ?? 0} active users
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleApplyDefaults}
                      disabled={applyingDefaults || loading}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      {applyingDefaults ? 'Applying...' : 'Apply Role Defaults'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className="space-y-3 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-24 bg-gray-100 rounded-xl" />
                ))}
              </div>
            ) : (
              <GroupedPermissionMatrix
                matrix={matrix}
                baselineMatrix={baselineMatrix}
                onChange={(section, values) => updateSection(section, values)}
              />
            )}

            <div className="sticky bottom-4 mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || loading || changeCount === 0}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium shadow-lg disabled:opacity-50"
              >
                {saving ? 'Saving...' : changeCount > 0 ? `Save (${changeCount} changes)` : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
      <ToastContainer toasts={toasts} setToasts={setToasts} />
    </>
  );
}
