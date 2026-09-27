/**
 * users_role_check, built from the data instead of a hardcoded list.
 *
 * The allowed roles are: the built-in list below ∪ every name in `roles` ∪
 * every role a user already holds (so rebuilding can never fail validation).
 * That lets support_agent / support_manager and any role created in the Roles
 * screen be assigned. Called at boot (ensureUserSchema) and after a role is
 * created. The constraint is only rebuilt when the list actually changes, so a
 * normal boot takes no lock on users.
 *
 * Role names reach SQL as quoted literals (a CHECK cannot take parameters);
 * they are validated against ROLE_NAME_RE first, and roles.name is created
 * through the slugifier in rbacController, so only [a-z0-9_] ever gets here.
 */
const pool = require('../config/db');

const BASE_ROLES = Object.freeze([
  'super_admin', 'admin', 'manager', 'team_member', 'team_lead', 'sales',
  'floor_manager', 'procurement', 'qc', 'dispatch', 'warehouse', 'accounts',
  'support_lead', 'support_tech', 'dispatch_qc', 'customer', 'vendor',
  'technician', 'guard', 'support_agent', 'support_manager',
]);

const ROLE_NAME_RE = /^[a-z0-9_]{1,50}$/;

/** Pure: the sorted, validated allowed list. */
function buildAllowedRoleList(...lists) {
  const set = new Set();
  for (const list of lists) {
    for (const r of list || []) {
      const name = String(r || '').trim();
      if (ROLE_NAME_RE.test(name)) set.add(name);
    }
  }
  return [...set].sort();
}

/** Pure: role names inside a CHECK definition from pg_get_constraintdef. */
function rolesInConstraintDef(def) {
  const out = new Set();
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(String(def || '')))) out.add(m[1]);
  return out;
}

async function ensureUsersRoleCheck(client = pool) {
  const [rolesRes, usersRes, defRes] = await Promise.all([
    client.query('SELECT name FROM roles').catch(() => ({ rows: [] })),
    client.query('SELECT DISTINCT role FROM users WHERE role IS NOT NULL'),
    client.query(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'users' AND c.conname = 'users_role_check'`
    ),
  ]);
  const allowed = buildAllowedRoleList(
    BASE_ROLES,
    rolesRes.rows.map((r) => r.name),
    usersRes.rows.map((r) => r.role)
  );
  const current = defRes.rows[0] ? rolesInConstraintDef(defRes.rows[0].def) : null;
  if (current && allowed.every((r) => current.has(r)) && current.size === allowed.length) {
    return { changed: false, allowed };
  }
  const list = allowed.map((r) => `'${r}'`).join(', ');
  await client.query('ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check');
  await client.query(`ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (${list}))`);
  return { changed: true, allowed };
}

module.exports = {
  BASE_ROLES,
  ROLE_NAME_RE,
  buildAllowedRoleList,
  rolesInConstraintDef,
  ensureUsersRoleCheck,
};
