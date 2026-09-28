/**
 * Escalation guard + pure helpers for the Roles & Permissions writes.
 * No DB access here — everything is unit-tested (test/rbacGuard.test.js).
 *
 * Rules (27 Sep 2026, Control step 4):
 *  - Only super_admin edits the admin / super_admin roles' permissions, and
 *    only super_admin edits admin / super_admin USERS (role, status, overrides,
 *    password, profile).
 *  - Nobody grants themselves: no edits to the permissions of your own role,
 *    no overrides on yourself, no changing your own role or status.
 *    (super_admin already has everything and is exempt from the role rule.)
 *  - Role assignment: nobody assigns super_admin here; only super_admin assigns
 *    admin; only admin / super_admin assign manager.
 *  - Every section written must be a known section; every role must exist.
 */
const {
  DATA_SCOPE_VALUES,
  CUSTOMER_ACCESS_VALUES,
  INVENTORY_TAG_ACCESS_VALUES,
  sectionScopes,
} = require('../constants/permissionCatalog');

const PROTECTED_ROLES = Object.freeze(['super_admin', 'admin']);
/** Roles never assignable from the CRM user screens (portal / field identities). */
const NON_CRM_ROLES = Object.freeze(['vendor', 'customer', 'technician']);
const ACTIONS = Object.freeze(['can_view', 'can_create', 'can_edit', 'can_delete']);
const SCOPE_FIELDS = Object.freeze(['data_scope', 'customer_access', 'inventory_tag_access']);

const isSuper = (actor) => actor?.role === 'super_admin';
const isProtectedRole = (role) => PROTECTED_ROLES.includes(String(role || ''));
const sameUser = (a, b) => a && b && Number(a.user_id) === Number(b.user_id);

/** May `actor` change the permission rows of `targetRole`? Returns {ok, reason}. */
function canEditRolePermissions(actor, targetRole) {
  if (!actor) return { ok: false, reason: 'Unauthorized' };
  if (isSuper(actor)) return { ok: true };
  if (isProtectedRole(targetRole)) {
    return { ok: false, reason: 'Only a super admin can change the admin / super admin roles.' };
  }
  if (String(actor.role) === String(targetRole)) {
    return { ok: false, reason: 'You cannot change the permissions of your own role.' };
  }
  return { ok: true };
}

/**
 * May `actor` manage user `target` (profile, role, status, teams, password,
 * overrides)? `allowSelf` is for harmless self-edits (none today).
 */
function canManageUser(actor, target, { allowSelf = false } = {}) {
  if (!actor || !target) return { ok: false, reason: 'Unauthorized' };
  if (isSuper(actor)) {
    if (sameUser(actor, target) && !allowSelf) {
      return { ok: false, reason: 'You cannot change your own account here.' };
    }
    return { ok: true };
  }
  if (isProtectedRole(target.role)) {
    return { ok: false, reason: 'Only a super admin can change an admin or super admin user.' };
  }
  if (sameUser(actor, target) && !allowSelf) {
    return { ok: false, reason: 'You cannot change your own access.' };
  }
  if (target.role === 'manager' && actor.role !== 'admin') {
    return { ok: false, reason: 'Only an admin can change a manager.' };
  }
  return { ok: true };
}

/** May `actor` give someone `role`? `knownRoles` = names from the roles table (+ built-ins). */
function canAssignRole(actor, role, knownRoles) {
  const name = String(role || '').trim().toLowerCase();
  if (!name) return { ok: false, reason: 'Role is required' };
  if (knownRoles && !new Set(knownRoles).has(name)) {
    return { ok: false, reason: `Unknown role: ${name}` };
  }
  if (name === 'super_admin') return { ok: false, reason: 'The super admin role cannot be assigned here.' };
  if (NON_CRM_ROLES.includes(name)) return { ok: false, reason: 'Portal roles cannot be assigned here.' };
  if (name === 'admin' && !isSuper(actor)) {
    return { ok: false, reason: 'Only a super admin can assign the admin role.' };
  }
  if (name === 'manager' && !['admin', 'super_admin'].includes(actor?.role)) {
    return { ok: false, reason: 'Only an admin can assign the manager role.' };
  }
  return { ok: true };
}

/** Roles from `allRoles` the actor may assign (for the user drawer). */
function assignableRoles(actor, allRoles) {
  const names = (allRoles || []).map((r) => (typeof r === 'string' ? r : r?.name)).filter(Boolean);
  return names.filter((n) => canAssignRole(actor, n, names).ok);
}

/** Unknown sections in a permissions payload. */
function findUnknownSections(rows, knownSections) {
  const known = knownSections instanceof Set ? knownSections : new Set(knownSections || []);
  const unknown = new Set();
  for (const row of rows || []) {
    const s = row?.section;
    if (!s || typeof s !== 'string' || !known.has(s)) unknown.add(String(s ?? ''));
  }
  return [...unknown];
}

const pickScope = (value, allowed) => (allowed.includes(value) ? value : null);

/** Canonical role_permissions row: booleans + scopes defaulting to 'all'. */
function normalizeRoleRow(perm) {
  return {
    section: perm.section,
    can_view: perm.can_view === true,
    can_create: perm.can_create === true,
    can_edit: perm.can_edit === true,
    can_delete: perm.can_delete === true,
    data_scope: pickScope(perm.data_scope, DATA_SCOPE_VALUES) || 'all',
    customer_access: pickScope(perm.customer_access, CUSTOMER_ACCESS_VALUES) || 'all',
    inventory_tag_access: pickScope(perm.inventory_tag_access, INVENTORY_TAG_ACCESS_VALUES) || 'all',
  };
}

/** Rejects duplicate sections in one payload (the old "Apply defaults" 500). */
function findDuplicateSections(rows) {
  const seen = new Set();
  const dup = new Set();
  for (const row of rows || []) {
    if (seen.has(row?.section)) dup.add(row.section);
    seen.add(row?.section);
  }
  return [...dup];
}

/**
 * Override row for one section = only what differs from the role (null = inherit).
 * `roleRow` may be null (role has no row → every action false, scopes 'all').
 * `desired` holds the EFFECTIVE values the editor wants. Returns null when
 * nothing differs (the override row should not exist).
 * Scope fields only count on sections where that scope is enforced.
 */
function diffOverride(section, roleRow, desired) {
  const base = normalizeRoleRow({ ...(roleRow || {}), section });
  const scopes = sectionScopes(section);
  const out = { section };
  let any = false;
  for (const a of ACTIONS) {
    if (desired[a] === true || desired[a] === false) {
      if (desired[a] !== base[a]) { out[a] = desired[a]; any = true; continue; }
    }
    out[a] = null;
  }
  const allowed = {
    data_scope: DATA_SCOPE_VALUES,
    customer_access: CUSTOMER_ACCESS_VALUES,
    inventory_tag_access: INVENTORY_TAG_ACCESS_VALUES,
  };
  for (const f of SCOPE_FIELDS) {
    const v = pickScope(desired[f], allowed[f]);
    if (scopes[f] && v && v !== base[f]) { out[f] = v; any = true; } else { out[f] = null; }
  }
  return any ? out : null;
}

/**
 * Plan the override writes for a user: for each desired section, upsert the
 * diff or delete the row. Returns {upserts: [row], deletes: [section]}.
 * `roleRows` = role_permissions rows of the user's role; `existing` = current
 * user_permissions rows (only used to avoid no-op deletes).
 */
function planOverrides(roleRows, existing, desiredRows) {
  const roleMap = new Map((roleRows || []).map((r) => [r.section, r]));
  const existingSet = new Set((existing || []).map((r) => r.section));
  const upserts = [];
  const deletes = [];
  for (const desired of desiredRows || []) {
    if (!desired?.section) continue;
    const diff = diffOverride(desired.section, roleMap.get(desired.section), desired);
    if (diff) upserts.push(diff);
    else if (existingSet.has(desired.section)) deletes.push(desired.section);
  }
  return { upserts, deletes };
}

/**
 * Where each effective value comes from, for the user-permissions screen.
 * 'override' | 'role' | 'none' (actions), 'override' | 'role' | 'default' (scopes).
 */
function valueSources(roleRow, userRow) {
  const src = {};
  for (const a of ACTIONS) {
    if (userRow && (userRow[a] === true || userRow[a] === false)) src[a] = 'override';
    else if (roleRow && roleRow[a] === true) src[a] = 'role';
    else src[a] = roleRow ? 'role' : 'none';
  }
  for (const f of SCOPE_FIELDS) {
    if (userRow && userRow[f]) src[f] = 'override';
    else if (roleRow && roleRow[f]) src[f] = 'role';
    else src[f] = 'default';
  }
  return src;
}

module.exports = {
  PROTECTED_ROLES,
  NON_CRM_ROLES,
  ACTIONS,
  SCOPE_FIELDS,
  isProtectedRole,
  canEditRolePermissions,
  canManageUser,
  canAssignRole,
  assignableRoles,
  findUnknownSections,
  findDuplicateSections,
  normalizeRoleRow,
  diffOverride,
  planOverrides,
  valueSources,
};
