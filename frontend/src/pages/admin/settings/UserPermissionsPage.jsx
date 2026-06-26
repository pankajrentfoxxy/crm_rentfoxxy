import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GroupedPermissionMatrix from '../../../components/admin/GroupedPermissionMatrix';
import RoleBadge from '../../../components/ui/RoleBadge';
import { ToastContainer, useToast } from '../../../components/ui/Toast';
import { ROLE_DESCRIPTIONS, ROLE_DISPLAY_NAMES } from '../../../constants/roles';
import { useAuth } from '../../../context/AuthContext';
import {
  RBAC_SECTIONS,
  countMatrixChanges,
  effectiveObjectToMatrix,
  fetchRoles,
  fetchUserPermissions,
  fetchUsersByRole,
  matrixDiffToOverridePayload,
  permissionsArrayToMatrix,
  resetUserPermissions,
  saveUserPermissions,
} from '../../../utils/rbacApi';

export default function UserPermissionsPage() {
  const { user, refreshPermissions } = useAuth();
  const { toasts, setToasts, showToast } = useToast();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const [roles, setRoles] = useState([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [sections, setSections] = useState(RBAC_SECTIONS);
  const [matrix, setMatrix] = useState({});
  const [roleDefaultsMatrix, setRoleDefaultsMatrix] = useState({});
  const [savedMatrix, setSavedMatrix] = useState({});
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    if (!selectedRole) return;
    let cancelled = false;
    setUsersLoading(true);
    setSelectedUserId('');
    setSelectedUser(null);
    setMatrix({});
    setRoleDefaultsMatrix({});
    setSavedMatrix({});

    fetchUsersByRole(selectedRole, { limit: 200 })
      .then((data) => {
        if (cancelled) return;
        setUsers(data.users || []);
      })
      .catch(() => {
        if (!cancelled) showToastRef.current('Failed to load users', 'error');
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedRole]);

  const loadUserPermissions = useCallback(async (userId) => {
    if (!userId) return;
    setLoadingPerms(true);
    try {
      const data = await fetchUserPermissions(userId);
      const sectionList = data.sections?.length
        ? data.sections.map((s) => (typeof s === 'string' ? s : s.section))
        : RBAC_SECTIONS;
      setSections(sectionList);
      setSelectedUser(data.user);

      const roleDefaults = permissionsArrayToMatrix(data.role_permissions, sectionList);
      const effective = effectiveObjectToMatrix(data.effective, sectionList);

      setRoleDefaultsMatrix(JSON.parse(JSON.stringify(roleDefaults)));
      setMatrix(JSON.parse(JSON.stringify(effective)));
      setSavedMatrix(JSON.parse(JSON.stringify(effective)));
    } catch {
      showToastRef.current('Failed to load user permissions', 'error');
    } finally {
      setLoadingPerms(false);
    }
  }, []);

  const handleUserSelect = (userId) => {
    setSelectedUserId(userId);
    if (userId) {
      loadUserPermissions(userId);
    } else {
      setSelectedUser(null);
      setMatrix({});
      setRoleDefaultsMatrix({});
      setSavedMatrix({});
    }
  };

  const updateSection = (section, values) => {
    setMatrix((prev) => ({ ...prev, [section]: values }));
  };

  const unsavedCount = useMemo(
    () => countMatrixChanges(matrix, savedMatrix),
    [matrix, savedMatrix]
  );

  const overrideCount = useMemo(
    () => countMatrixChanges(matrix, roleDefaultsMatrix),
    [matrix, roleDefaultsMatrix]
  );

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      const overrides = matrixDiffToOverridePayload(matrix, roleDefaultsMatrix);
      await resetUserPermissions(selectedUserId);
      if (overrides.length) {
        await saveUserPermissions(selectedUserId, overrides);
      }
      setSavedMatrix(JSON.parse(JSON.stringify(matrix)));
      if (String(user?.user_id) === String(selectedUserId)) {
        await refreshPermissions();
      }
      showToastRef.current('User overrides saved', 'success');
    } catch (err) {
      showToastRef.current(err.response?.data?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    if (!selectedUserId) return;
    if (!window.confirm('Remove all overrides and revert to role defaults for this user?')) return;
    setSaving(true);
    try {
      await resetUserPermissions(selectedUserId);
      const reverted = JSON.parse(JSON.stringify(roleDefaultsMatrix));
      setMatrix(reverted);
      setSavedMatrix(reverted);
      if (String(user?.user_id) === String(selectedUserId)) {
        await refreshPermissions();
      }
      showToastRef.current('Reset to role defaults', 'success');
    } catch (err) {
      showToastRef.current(err.response?.data?.message || 'Reset failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectedRoleMeta = useMemo(
    () => roles.find((r) => r.name === selectedRole),
    [roles, selectedRole]
  );

  return (
    <>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-800">User Permission Overrides</h1>
          <p className="text-sm text-gray-500">
            Override role defaults for individual users — role permissions are not changed
          </p>
        </div>

        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Permissions start from the user&apos;s role defaults. Checkboxes show the effective access;
          sections marked <strong>Modified</strong> differ from their role. Use <strong>Data Scope</strong> to
          limit each module to all records or assigned records only. Saving stores only user-specific overrides.
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Role</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {roles.map((role) => (
                <option key={role.id || role.name} value={role.name}>
                  {role.display_name || ROLE_DISPLAY_NAMES[role.name] || role.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Select User
              {users.length > 0 ? (
                <span className="ml-1 text-gray-400 font-normal">({users.length})</span>
              ) : null}
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => handleUserSelect(e.target.value)}
              disabled={usersLoading || users.length === 0}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {usersLoading
                  ? 'Loading users...'
                  : users.length === 0
                    ? 'No users for this role'
                    : 'Choose a user'}
              </option>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.name} — {u.email}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedUser ? (
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <RoleBadge role={selectedUser.role} />
                  <h2 className="text-lg font-semibold text-gray-800">{selectedUser.name}</h2>
                </div>
                <p className="text-sm text-gray-500">{selectedUser.email}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Role: {selectedRoleMeta?.display_name || ROLE_DISPLAY_NAMES[selectedUser.role] || selectedUser.role}
                  {' · '}
                  {ROLE_DESCRIPTIONS[selectedUser.role] || selectedRoleMeta?.description || ''}
                </p>
                {overrideCount > 0 ? (
                  <p className="text-xs text-amber-700 mt-2">
                    {overrideCount} permission(s) differ from role default
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-2">Using role defaults — no overrides</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleResetAll}
                disabled={saving || loadingPerms || overrideCount === 0}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Reset to role defaults
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400 border border-dashed border-gray-200 rounded-xl bg-white mb-4">
            Select a role and user to view and edit permission overrides
          </div>
        )}

        {loadingPerms ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-xl" />
            ))}
          </div>
        ) : selectedUser ? (
          <GroupedPermissionMatrix
            matrix={matrix}
            baselineMatrix={roleDefaultsMatrix}
            onChange={(section, values) => updateSection(section, values)}
            showDataScope
          />
        ) : null}

        {selectedUser ? (
          <div className="sticky bottom-4 mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loadingPerms || unsavedCount === 0}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium shadow-lg disabled:opacity-50"
            >
              {saving
                ? 'Saving...'
                : unsavedCount > 0
                  ? `Save overrides (${unsavedCount} changes)`
                  : 'Save Changes'}
            </button>
          </div>
        ) : null}
      </div>

      <ToastContainer toasts={toasts} setToasts={setToasts} />
    </>
  );
}
