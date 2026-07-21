import api from './api';
import { APPLICATION_SECTIONS, PERMISSION_ACTIONS, visibleRolePermissionSections } from '../constants/sections';
import { CRM_ROLES, MANAGEABLE_ROLES } from '../constants/roles';

export const RBAC_SECTIONS = APPLICATION_SECTIONS;
export const RBAC_ACTIONS = PERMISSION_ACTIONS;
export const RBAC_CRM_ROLES = CRM_ROLES;
export const RBAC_MANAGEABLE_ROLES = MANAGEABLE_ROLES;
export const RBAC_ASSIGNABLE_ROLES = CRM_ROLES;

export async function fetchRoles(params = {}) {
  const { data } = await api.get('/roles', { params });
  return data;
}

export async function createRole(payload) {
  const { data } = await api.post('/roles', payload);
  return data;
}

export async function updateRole(id, payload) {
  const { data } = await api.put(`/roles/${id}`, payload);
  return data;
}

export async function deleteRole(id) {
  const { data } = await api.delete(`/roles/${id}`);
  return data;
}

export async function fetchRolePermissions(role) {
  const { data } = await api.get(`/role-permissions/${role}`);
  return data;
}

export async function saveRolePermissions(role, permissions) {
  const { data } = await api.put(`/role-permissions/${role}`, { permissions });
  return data;
}

export async function applyRoleDefaults(role) {
  const { data } = await api.post(`/role-permissions/${role}/apply-defaults`);
  return data;
}

export async function fetchUsers(params = {}) {
  const { data } = await api.get('/auth/users', { params });
  return data;
}

export async function fetchAuthTeams() {
  const { data } = await api.get('/auth/teams');
  return data;
}

export async function createUser(payload) {
  const { data } = await api.post('/auth/register', payload);
  return data;
}

export async function updateUser(userId, payload) {
  const { data } = await api.put(`/auth/users/${userId}`, payload);
  return data;
}

export async function updateUserStatus(userId, status, reason) {
  const { data } = await api.patch(`/auth/users/${userId}/status`, { status, reason });
  return data;
}

export async function resetUserPassword(userId, newPassword) {
  const { data } = await api.post(`/auth/users/${userId}/reset-password`, {
    new_password: newPassword || undefined,
  });
  return data;
}

export async function fetchUsersByRole(role, params = {}) {
  const { data } = await api.get(`/users/by-role/${role}`, { params });
  return data;
}

export async function fetchUserPermissions(userId) {
  const { data } = await api.get(`/user-permissions/${userId}`);
  return data;
}

export async function saveUserPermissions(userId, permissions) {
  const { data } = await api.put(`/user-permissions/${userId}`, { permissions });
  return data;
}

export async function resetUserPermissions(userId) {
  const { data } = await api.delete(`/user-permissions/${userId}/reset`);
  return data;
}

export const CUSTOMER_ACCESS_VALUES = ['all', 'sales', 'rental'];
export const INVENTORY_TAG_ACCESS_VALUES = [
  'all',
  'rental_only',
  'rental_both',
  'sale_only',
  'sale_both',
  'sales',
  'rental',
];

const LEGACY_INVENTORY_TAG_ACCESS = {
  sales: 'sale_both',
  rental: 'rental_both',
};

function normalizeCustomerAccess(value) {
  return CUSTOMER_ACCESS_VALUES.includes(value) ? value : 'all';
}

function normalizeInventoryTagAccess(value) {
  const raw = String(value || 'all').trim();
  if (LEGACY_INVENTORY_TAG_ACCESS[raw]) return LEGACY_INVENTORY_TAG_ACCESS[raw];
  return INVENTORY_TAG_ACCESS_VALUES.includes(raw) ? raw : 'all';
}

export function emptyPermissionRow() {
  return {
    can_view: false,
    can_create: false,
    can_edit: false,
    can_delete: false,
    data_scope: 'all',
    customer_access: 'all',
    inventory_tag_access: 'all',
  };
}

export function permissionsArrayToMatrix(permissions, sections = RBAC_SECTIONS) {
  const matrix = {};
  visibleRolePermissionSections(sections).forEach((section) => {
    matrix[section] = emptyPermissionRow();
  });
  (permissions || []).forEach((row) => {
    if (!row?.section) return;
    matrix[row.section] = {
      can_view: !!row.can_view,
      can_create: !!row.can_create,
      can_edit: !!row.can_edit,
      can_delete: !!row.can_delete,
      data_scope: row.data_scope === 'assigned' ? 'assigned' : 'all',
      customer_access: normalizeCustomerAccess(row.customer_access),
      inventory_tag_access: normalizeInventoryTagAccess(row.inventory_tag_access),
    };
  });
  return matrix;
}

export function matrixToPermissionsArray(matrix) {
  return Object.entries(matrix).map(([section, values]) => ({
    section,
    can_view: !!values.can_view,
    can_create: !!values.can_create,
    can_edit: !!values.can_edit,
    can_delete: !!values.can_delete,
    data_scope: values.data_scope === 'assigned' ? 'assigned' : 'all',
    customer_access: normalizeCustomerAccess(values.customer_access),
    inventory_tag_access: normalizeInventoryTagAccess(values.inventory_tag_access),
  }));
}

export function buildOverrideMatrix(rolePermissions, userPermissions, sections = RBAC_SECTIONS) {
  const roleMap = (rolePermissions || []).reduce((acc, row) => {
    acc[row.section] = row;
    return acc;
  }, {});
  const userMap = (userPermissions || []).reduce((acc, row) => {
    acc[row.section] = row;
    return acc;
  }, {});

  const overrides = {};
  const roleDefaults = {};

  sections.forEach((section) => {
    roleDefaults[section] = {
      can_view: !!roleMap[section]?.can_view,
      can_create: !!roleMap[section]?.can_create,
      can_edit: !!roleMap[section]?.can_edit,
      can_delete: !!roleMap[section]?.can_delete,
      data_scope: roleMap[section]?.data_scope === 'assigned' ? 'assigned' : 'all',
      customer_access: normalizeCustomerAccess(roleMap[section]?.customer_access),
      inventory_tag_access: normalizeInventoryTagAccess(roleMap[section]?.inventory_tag_access),
    };
    overrides[section] = {
      can_view: userMap[section]?.can_view ?? null,
      can_create: userMap[section]?.can_create ?? null,
      can_edit: userMap[section]?.can_edit ?? null,
      can_delete: userMap[section]?.can_delete ?? null,
      data_scope: userMap[section]?.data_scope ?? null,
      customer_access: userMap[section]?.customer_access ?? null,
      inventory_tag_access: userMap[section]?.inventory_tag_access ?? null,
    };
  });

  return { overrides, roleDefaults };
}

export function overridesToPayload(overrides) {
  return Object.entries(overrides)
    .map(([section, values]) => ({ section, ...values }))
    .filter((row) =>
      RBAC_ACTIONS.some((action) => row[action] === true || row[action] === false)
    );
}

/** Build editable matrix from API effective permissions object. */
export function effectiveObjectToMatrix(effective, sections = RBAC_SECTIONS) {
  const matrix = {};
  sections.forEach((section) => {
    const row = effective?.[section] || {};
    matrix[section] = {
      can_view: !!row.can_view,
      can_create: !!row.can_create,
      can_edit: !!row.can_edit,
      can_delete: !!row.can_delete,
      data_scope: row.data_scope === 'assigned' ? 'assigned' : 'all',
      customer_access: normalizeCustomerAccess(row.customer_access),
      inventory_tag_access: normalizeInventoryTagAccess(row.inventory_tag_access),
    };
  });
  return matrix;
}

/** User overrides to persist — only sections/actions that differ from role defaults. */
export function matrixDiffToOverridePayload(matrix, roleDefaultsMatrix) {
  return Object.entries(matrix)
    .map(([section, values]) => {
      const role = roleDefaultsMatrix[section] || emptyPermissionRow();
      const permDiffers = RBAC_ACTIONS.some((action) => !!values[action] !== !!role[action]);
      const scopeDiffers = (values.data_scope || 'all') !== (role.data_scope || 'all');
      const accessDiffers = normalizeCustomerAccess(values.customer_access)
        !== normalizeCustomerAccess(role.customer_access);
      const tagAccessDiffers = normalizeInventoryTagAccess(values.inventory_tag_access)
        !== normalizeInventoryTagAccess(role.inventory_tag_access);
      if (!permDiffers && !scopeDiffers && !accessDiffers && !tagAccessDiffers) return null;
      return {
        section,
        can_view: !!values.can_view,
        can_create: !!values.can_create,
        can_edit: !!values.can_edit,
        can_delete: !!values.can_delete,
        data_scope: values.data_scope === 'assigned' ? 'assigned' : 'all',
        customer_access: normalizeCustomerAccess(values.customer_access),
        inventory_tag_access: normalizeInventoryTagAccess(values.inventory_tag_access),
      };
    })
    .filter(Boolean);
}

export function countMatrixChanges(matrix, baseline) {
  let n = 0;
  Object.keys(matrix).forEach((section) => {
    RBAC_ACTIONS.forEach((action) => {
      if (!!matrix[section]?.[action] !== !!baseline[section]?.[action]) n += 1;
    });
    if ((matrix[section]?.data_scope || 'all') !== (baseline[section]?.data_scope || 'all')) {
      n += 1;
    }
    if (normalizeCustomerAccess(matrix[section]?.customer_access)
      !== normalizeCustomerAccess(baseline[section]?.customer_access)) {
      n += 1;
    }
    if (normalizeInventoryTagAccess(matrix[section]?.inventory_tag_access)
      !== normalizeInventoryTagAccess(baseline[section]?.inventory_tag_access)) {
      n += 1;
    }
  });
  return n;
}
