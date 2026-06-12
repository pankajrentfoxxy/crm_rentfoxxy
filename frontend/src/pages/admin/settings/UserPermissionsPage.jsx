import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import RoleBadge from '../../../components/ui/RoleBadge';
import { ToastContainer, useToast } from '../../../components/ui/Toast';
import { ROLE_DISPLAY_NAMES } from '../../../constants/roles';
import { SECTION_LABELS } from '../../../constants/sections';
import {
  RBAC_ACTIONS,
  RBAC_CRM_ROLES,
  RBAC_SECTIONS,
  buildOverrideMatrix,
  fetchUserPermissions,
  fetchUsersByRole,
  overridesToPayload,
  resetUserPermissions,
  saveUserPermissions,
} from '../../../utils/rbacApi';

const ROLE_OPTIONS = RBAC_CRM_ROLES.map((name) => ({
  value: name,
  label: ROLE_DISPLAY_NAMES[name] || name,
}));

const ACTION_LABELS = {
  can_view: 'View',
  can_create: 'Add',
  can_edit: 'Update',
  can_delete: 'Delete',
};

function resolveEffective(override, roleDefault) {
  if (override === true || override === false) return override;
  return !!roleDefault;
}

function activeBadges(sectionOverrides, sectionRoleDefaults) {
  return RBAC_ACTIONS.filter((action) =>
    resolveEffective(sectionOverrides?.[action], sectionRoleDefaults?.[action])
  ).map((action) => ACTION_LABELS[action].toLowerCase());
}

function UserPermissionSectionCard({
  section,
  overrides,
  roleDefaults,
  expanded,
  isEditing,
  onToggleExpand,
  onEdit,
  onCancel,
  onToggleSectionAll,
  onToggleAction,
  onSaveSection,
  saving,
}) {
  const sectionOverrides = overrides[section] || {};
  const sectionRoleDefaults = roleDefaults[section] || {};
  const badges = activeBadges(sectionOverrides, sectionRoleDefaults);

  const allChecked = RBAC_ACTIONS.every((action) =>
    resolveEffective(sectionOverrides[action], sectionRoleDefaults[action])
  );

  const someChecked = RBAC_ACTIONS.some((action) =>
    resolveEffective(sectionOverrides[action], sectionRoleDefaults[action])
  );

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        {isEditing ? (
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-gray-300 text-blue-600 shrink-0"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = !allChecked && someChecked;
            }}
            onChange={(e) => onToggleSectionAll(section, e.target.checked)}
          />
        ) : null}

        <button
          type="button"
          onClick={() => onToggleExpand(section)}
          className="flex-1 flex items-center gap-3 text-left min-w-0"
        >
          <span className="font-semibold text-gray-800 shrink-0">
            {SECTION_LABELS[section] || section}
          </span>
          <div className="flex flex-wrap gap-1.5 min-w-0">
            {badges.length > 0 ? (
              badges.map((badge) => (
                <span
                  key={badge}
                  className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium border border-emerald-400 text-emerald-700 bg-emerald-50"
                >
                  {badge}
                </span>
              ))
            ) : (
              <span className="text-xs text-gray-400">No permissions</span>
            )}
          </div>
        </button>

        {!isEditing ? (
          <button
            type="button"
            onClick={() => onEdit(section)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        ) : null}

        <button type="button" onClick={() => onToggleExpand(section)} className="text-gray-500 shrink-0">
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {expanded && isEditing ? (
        <div className="px-4 py-4 border-t border-gray-100 bg-gray-50/60">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-4">
            {RBAC_ACTIONS.map((action) => {
              const inherited = sectionOverrides[action] == null;
              const checked = resolveEffective(sectionOverrides[action], sectionRoleDefaults[action]);
              return (
                <label key={action} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-blue-600"
                    checked={checked}
                    onChange={(e) => onToggleAction(section, action, e.target.checked)}
                  />
                  <span>{ACTION_LABELS[action]}</span>
                  {inherited ? (
                    <span className="text-[10px] text-gray-400 uppercase">inherit</span>
                  ) : null}
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onCancel(section)}
              disabled={saving}
              className="px-4 py-2 border border-gray-300 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSaveSection(section)}
              disabled={saving}
              className="px-5 py-2 bg-slate-800 text-white text-sm font-medium rounded-md hover:bg-slate-900 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function UserPermissionsPage() {
  const { toasts, setToasts, showToast } = useToast();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const [selectedRole, setSelectedRole] = useState(RBAC_CRM_ROLES[0]);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [sections, setSections] = useState(RBAC_SECTIONS);
  const [overrides, setOverrides] = useState({});
  const [roleDefaults, setRoleDefaults] = useState({});
  const [selectedUser, setSelectedUser] = useState(null);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [savingSection, setSavingSection] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});
  const [editingSection, setEditingSection] = useState(null);
  const [draftOverrides, setDraftOverrides] = useState(null);
  useEffect(() => {
    if (!selectedRole) return;
    let cancelled = false;
    setUsersLoading(true);
    setSelectedUserId('');
    setSelectedUser(null);
    setOverrides({});
    setRoleDefaults({});
    setExpandedSections({});
    setEditingSection(null);
    setDraftOverrides(null);

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

    return () => {
      cancelled = true;
    };
  }, [selectedRole]);

  const loadUserPermissions = useCallback(async (userId) => {
    if (!userId) return;
    setLoadingPerms(true);
    setEditingSection(null);
    setDraftOverrides(null);
    try {
      const data = await fetchUserPermissions(userId);
      const sectionList = data.sections?.length ? data.sections : RBAC_SECTIONS;
      setSections(sectionList);
      setSelectedUser(data.user);
      const built = buildOverrideMatrix(data.role_permissions, data.user_permissions, sectionList);
      setRoleDefaults(built.roleDefaults);
      setOverrides(built.overrides);
      setExpandedSections({});
    } catch {
      showToastRef.current('Failed to load user permissions', 'error');
    } finally {
      setLoadingPerms(false);
    }
  }, []);

  const handleRoleChange = (role) => {
    setSelectedRole(role);
  };

  const handleUserChange = (userId) => {
    setSelectedUserId(userId);
    if (userId) {
      loadUserPermissions(userId);
    } else {
      setSelectedUser(null);
      setOverrides({});
      setRoleDefaults({});
      setExpandedSections({});
      setEditingSection(null);
    }
  };

  const toggleExpand = (section) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleEditSection = (section) => {
    setDraftOverrides(JSON.parse(JSON.stringify(overrides)));
    setEditingSection(section);
    setExpandedSections((prev) => ({ ...prev, [section]: true }));
  };

  const handleCancelSection = (section) => {
    if (draftOverrides) {
      setOverrides(draftOverrides);
    }
    setEditingSection(null);
    setDraftOverrides(null);
    setExpandedSections((prev) => ({ ...prev, [section]: false }));
  };

  const toggleSectionAll = (section, checked) => {
    setOverrides((prev) => ({
      ...prev,
      [section]: RBAC_ACTIONS.reduce((acc, action) => {
        acc[action] = checked;
        return acc;
      }, {}),
    }));
  };

  const toggleAction = (section, action, checked) => {
    setOverrides((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [action]: checked,
      },
    }));
  };

  const handleSaveSection = async (section) => {
    if (!selectedUserId) return;
    setSavingSection(section);
    try {
      const payload = overridesToPayload({ [section]: overrides[section] });
      await saveUserPermissions(selectedUserId, payload);
      showToastRef.current(`${section} permissions saved`, 'success');
      setEditingSection(null);
      setDraftOverrides(null);
      await loadUserPermissions(selectedUserId);
    } catch (err) {
      showToastRef.current(err.response?.data?.message || 'Save failed', 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetAll = async () => {
    if (!selectedUserId) return;
    setSavingSection('all');
    try {
      await resetUserPermissions(selectedUserId);
      showToastRef.current('Reset to role defaults', 'success');
      await loadUserPermissions(selectedUserId);
    } catch (err) {
      showToastRef.current(err.response?.data?.message || 'Reset failed', 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const selectedUserOption = useMemo(
    () => users.find((u) => String(u.user_id) === String(selectedUserId)),
    [users, selectedUserId]
  );

  return (
    <>
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-semibold text-gray-800">User Permission Overrides</h1>
            <p className="text-sm text-gray-500">Per-user overrides above or below role defaults</p>
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          These are per-user overrides. A user&apos;s effective permissions =
          their role defaults + these overrides. Leave as &apos;Role Default&apos; to inherit.
        </div>

        {/* Step 1 & 2: Role + User dropdowns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Role</label>
            <select
              value={selectedRole}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Select User
              {users.length > 0 ? (
                <span className="ml-1 text-gray-400 font-normal">({users.length} {selectedRole}s)</span>
              ) : null}
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => handleUserChange(e.target.value)}
              disabled={usersLoading || users.length === 0}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {usersLoading
                  ? 'Loading users...'
                  : users.length === 0
                    ? `No ${selectedRole} users found`
                    : `Choose a ${selectedRole}`}
              </option>
              {users.map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {user.name} — {user.email}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedUser ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">{selectedUser.name}</span>
              <span className="text-sm text-gray-500">{selectedUser.email}</span>
              <RoleBadge role={selectedUser.role} />
            </div>
            <button
              type="button"
              onClick={handleResetAll}
              disabled={!!savingSection}
              className="text-xs text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Reset all to role default
            </button>
          </div>
        ) : null}

        {loadingPerms ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-gray-100 rounded-lg" />
            ))}
          </div>
        ) : selectedUser ? (
          <div className="space-y-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              All sections — click Edit to change permissions
            </p>
            {sections.map((section) => (
              <UserPermissionSectionCard
                key={section}
                section={section}
                overrides={overrides}
                roleDefaults={roleDefaults}
                expanded={!!expandedSections[section]}
                isEditing={editingSection === section}
                onToggleExpand={toggleExpand}
                onEdit={handleEditSection}
                onCancel={handleCancelSection}
                onToggleSectionAll={toggleSectionAll}
                onToggleAction={toggleAction}
                onSaveSection={handleSaveSection}
                saving={savingSection === section}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 text-gray-400 border border-dashed border-gray-200 rounded-xl bg-white">
            {selectedUserOption
              ? 'Loading permissions...'
              : 'Select a role and user to view and edit permissions'}
          </div>
        )}
      </div>

      <ToastContainer toasts={toasts} setToasts={setToasts} />
    </>
  );
}
