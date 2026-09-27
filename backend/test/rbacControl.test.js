// Control (Roles & Permissions) — pure parts: escalation guard, section
// validation, override diff, catalogue, role-defaults dedupe, users_role_check.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const guard = require('../services/rbacGuard');
const catalog = require('../constants/permissionCatalog');
const { buildAllowedRoleList, rolesInConstraintDef } = require('../services/userRoleCheck');
const { defaultRowsFor, hasRoleDefaults } = require('../services/roleDefaultsSeed');

const superAdmin = { user_id: 1, role: 'super_admin' };
const admin = { user_id: 2, role: 'admin' };
const manager = { user_id: 3, role: 'manager' };
const accounts = { user_id: 4, role: 'accounts' }; // reaches RBAC only through a section grant

describe('escalation guard — role permissions', () => {
  it('only super_admin edits the admin / super_admin roles', () => {
    assert.equal(guard.canEditRolePermissions(superAdmin, 'admin').ok, true);
    assert.equal(guard.canEditRolePermissions(superAdmin, 'super_admin').ok, true);
    assert.equal(guard.canEditRolePermissions(admin, 'admin').ok, false);
    assert.equal(guard.canEditRolePermissions(admin, 'super_admin').ok, false);
    assert.equal(guard.canEditRolePermissions(accounts, 'admin').ok, false);
  });

  it('nobody edits their own role', () => {
    assert.equal(guard.canEditRolePermissions(manager, 'manager').ok, false);
    assert.equal(guard.canEditRolePermissions(accounts, 'accounts').ok, false);
  });

  it('other roles are editable', () => {
    assert.equal(guard.canEditRolePermissions(admin, 'manager').ok, true);
    assert.equal(guard.canEditRolePermissions(accounts, 'sales').ok, true);
  });
});

describe('escalation guard — users', () => {
  it('only super_admin manages admin / super_admin users', () => {
    assert.equal(guard.canManageUser(superAdmin, { user_id: 9, role: 'admin' }).ok, true);
    assert.equal(guard.canManageUser(admin, { user_id: 9, role: 'admin' }).ok, false);
    assert.equal(guard.canManageUser(admin, { user_id: 9, role: 'super_admin' }).ok, false);
    assert.equal(guard.canManageUser(accounts, { user_id: 9, role: 'admin' }).ok, false);
  });

  it('only an admin manages a manager', () => {
    assert.equal(guard.canManageUser(admin, { user_id: 9, role: 'manager' }).ok, true);
    assert.equal(guard.canManageUser(manager, { user_id: 9, role: 'manager' }).ok, false);
    assert.equal(guard.canManageUser(accounts, { user_id: 9, role: 'manager' }).ok, false);
  });

  it('nobody changes their own access unless allowSelf', () => {
    assert.equal(guard.canManageUser(admin, { user_id: 2, role: 'admin' }).ok, false);
    assert.equal(guard.canManageUser(accounts, { user_id: 4, role: 'accounts' }).ok, false);
    assert.equal(guard.canManageUser(accounts, { user_id: 4, role: 'accounts' }, { allowSelf: true }).ok, true);
    assert.equal(guard.canManageUser(superAdmin, { user_id: 1, role: 'super_admin' }).ok, false);
  });

  it('a section-granted user manages ordinary users', () => {
    assert.equal(guard.canManageUser(accounts, { user_id: 9, role: 'sales' }).ok, true);
    assert.equal(guard.canManageUser(manager, { user_id: 9, role: 'warehouse' }).ok, true);
  });
});

describe('escalation guard — role assignment', () => {
  const known = ['admin', 'manager', 'sales', 'support_agent', 'super_admin', 'vendor', 'custom_role'];
  it('nobody assigns super_admin or portal roles', () => {
    assert.equal(guard.canAssignRole(superAdmin, 'super_admin', known).ok, false);
    assert.equal(guard.canAssignRole(superAdmin, 'vendor', known).ok, false);
  });
  it('admin only by super_admin; manager only by admin / super_admin', () => {
    assert.equal(guard.canAssignRole(superAdmin, 'admin', known).ok, true);
    assert.equal(guard.canAssignRole(admin, 'admin', known).ok, false);
    assert.equal(guard.canAssignRole(admin, 'manager', known).ok, true);
    assert.equal(guard.canAssignRole(manager, 'manager', known).ok, false);
    assert.equal(guard.canAssignRole(accounts, 'manager', known).ok, false);
  });
  it('support_agent and custom roles are assignable; unknown roles are not', () => {
    assert.equal(guard.canAssignRole(manager, 'support_agent', known).ok, true);
    assert.equal(guard.canAssignRole(manager, 'custom_role', known).ok, true);
    const r = guard.canAssignRole(admin, 'made_up', known);
    assert.equal(r.ok, false);
    assert.match(r.reason, /^Unknown role/);
  });
  it('assignableRoles filters by the same rules', () => {
    assert.deepEqual(guard.assignableRoles(manager, known), ['sales', 'support_agent', 'custom_role']);
    assert.deepEqual(guard.assignableRoles(superAdmin, known), ['admin', 'manager', 'sales', 'support_agent', 'custom_role']);
  });
});

describe('section validation', () => {
  it('flags unknown and missing section names', () => {
    const known = new Set(['leads', 'customers']);
    assert.deepEqual(guard.findUnknownSections([{ section: 'leads' }, { section: 'bogus' }, {}], known), ['bogus', '']);
    assert.deepEqual(guard.findUnknownSections([{ section: 'leads' }], known), []);
  });
  it('flags duplicate sections', () => {
    assert.deepEqual(guard.findDuplicateSections([{ section: 'a' }, { section: 'b' }, { section: 'a' }]), ['a']);
  });
  it('normalizes a role row (booleans, scope whitelist)', () => {
    assert.deepEqual(guard.normalizeRoleRow({ section: 'leads', can_view: 1, data_scope: 'assigned', customer_access: 'x' }), {
      section: 'leads', can_view: false, can_create: false, can_edit: false, can_delete: false,
      data_scope: 'assigned', customer_access: 'all', inventory_tag_access: 'all',
    });
  });
});

describe('override diff (only differences from the role are stored)', () => {
  const roleRow = { section: 'leads', can_view: true, can_create: true, can_edit: false, can_delete: false, data_scope: 'assigned' };

  it('returns null when the desired values equal the role', () => {
    assert.equal(guard.diffOverride('leads', roleRow, {
      can_view: true, can_create: true, can_edit: false, can_delete: false, data_scope: 'assigned',
    }), null);
  });

  it('stores only the fields that differ; the rest inherit (null)', () => {
    assert.deepEqual(guard.diffOverride('leads', roleRow, {
      can_view: true, can_create: true, can_edit: true, can_delete: false, data_scope: 'all',
    }), {
      section: 'leads', can_view: null, can_create: null, can_edit: true, can_delete: null,
      data_scope: 'all', customer_access: null, inventory_tag_access: null,
    });
  });

  it('an explicit revoke is stored as false', () => {
    const d = guard.diffOverride('leads', roleRow, { can_view: false, can_create: true, can_edit: false, can_delete: false });
    assert.equal(d.can_view, false);
  });

  it('a section with no role row compares against all-false / all', () => {
    assert.deepEqual(guard.diffOverride('warehouse', null, { can_view: true }), {
      section: 'warehouse', can_view: true, can_create: null, can_edit: null, can_delete: null,
      data_scope: null, customer_access: null, inventory_tag_access: null,
    });
  });

  it('scope fields only count where the scope is enforced', () => {
    assert.equal(guard.diffOverride('warehouse', null, { can_view: false, data_scope: 'assigned' }), null);
    assert.equal(guard.diffOverride('customers', null, { customer_access: 'rental' }).customer_access, 'rental');
    assert.equal(guard.diffOverride('inventory_management', null, { inventory_tag_access: 'sale_only' }).inventory_tag_access, 'sale_only');
  });

  it('planOverrides upserts differences and deletes rows that no longer differ', () => {
    const plan = guard.planOverrides(
      [roleRow],
      [{ section: 'leads' }, { section: 'customers' }],
      [
        { section: 'leads', can_view: true, can_create: true, can_edit: false, can_delete: false, data_scope: 'assigned' },
        { section: 'customers', can_view: true },
      ]
    );
    assert.deepEqual(plan.deletes, ['leads']);
    assert.equal(plan.upserts.length, 1);
    assert.equal(plan.upserts[0].section, 'customers');
  });

  it('valueSources reports override / role / none', () => {
    const src = guard.valueSources(roleRow, { can_edit: true, can_view: null, data_scope: null });
    assert.equal(src.can_edit, 'override');
    assert.equal(src.can_view, 'role');
    assert.equal(src.data_scope, 'role');
    assert.equal(guard.valueSources(null, null).can_view, 'none');
    assert.equal(guard.valueSources(null, null).customer_access, 'default');
  });
});

describe('permission catalogue', () => {
  it('every visible section is in exactly one group', () => {
    const seen = new Map();
    for (const g of catalog.SECTION_GROUPS) {
      for (const s of g.sections) {
        assert.ok(!seen.has(s), `${s} in ${seen.get(s)} and ${g.key}`);
        seen.set(s, g.key);
      }
    }
    for (const h of catalog.HIDDEN_SECTIONS) assert.ok(!seen.has(h), `${h} is hidden and grouped`);
  });

  it('includes the sections enforced but previously not grantable', () => {
    const visible = new Set(catalog.SECTION_GROUPS.flatMap((g) => g.sections));
    for (const s of ['delivery_my_deliveries', 'delivery_technicians', 'kyc_management', 'demo_management',
      'vendor_return_to_vendor', 'vendor_return_ticket', 'customer_management', 'follow_ups', 'lead_orders']) {
      assert.ok(visible.has(s), s);
    }
  });

  it('buildCatalogue merges DB rows, honours DB hidden/group, and adds code-only sections', () => {
    const { sections, groups } = catalog.buildCatalogue([
      { section: 'leads', description: 'Leads', sort_order: 1 },
      { section: 'support_triage', description: 'x', sort_order: 2, hidden: true, section_group: '_hidden' },
      { section: 'brand_new', description: 'Brand new', sort_order: 3 },
      { section: 'warehouse', hidden: true },
    ]);
    const by = Object.fromEntries(sections.map((s) => [s.section, s]));
    assert.equal(by.leads.group, 'sales');
    assert.equal(by.leads.in_catalogue, true);
    assert.equal(by.support_triage.group, '_hidden');
    assert.equal(by.brand_new.group, 'other');
    assert.equal(by.warehouse.hidden, true);
    assert.equal(by.delivery_my_deliveries.in_catalogue, false);
    assert.deepEqual(by.leads.scopes, { data_scope: true, customer_access: false, inventory_tag_access: false });
    assert.deepEqual(by.customers.scopes, { data_scope: false, customer_access: true, inventory_tag_access: false });
    assert.equal(groups[groups.length - 1].key, '_hidden');
    const all = groups.flatMap((g) => g.sections);
    assert.equal(all.length, sections.length);
  });

  it('permissionService and dataScopeService use the catalogue aliases (no private copies)', () => {
    const ps = fs.readFileSync(path.join(__dirname, '../services/permissionService.js'), 'utf8');
    const ds = fs.readFileSync(path.join(__dirname, '../services/dataScopeService.js'), 'utf8');
    assert.doesNotMatch(ps, /const SECTION_ALIASES = \{/);
    assert.doesNotMatch(ds, /const SECTION_ALIASES = \{/);
    assert.deepEqual(catalog.DATA_SCOPE_SECTION_ALIASES.dispatch, ['dispatch', 'delivery_challans']);
    assert.deepEqual(catalog.SECTION_ALIASES.vendor_repair_dc, ['vendor_repair_dc', 'vendor_repair_dc_dispatch']);
    assert.equal(catalog.DATA_SCOPE_SECTION_ALIASES.vendor_repair_dc, undefined);
  });
});

describe('role defaults', () => {
  it('roles without defaults are refused, not wiped', () => {
    assert.equal(hasRoleDefaults('support_agent'), false);
    assert.equal(hasRoleDefaults('custom_role'), false);
    assert.equal(hasRoleDefaults('admin'), true);
    assert.equal(hasRoleDefaults('manager'), true);
  });
  it('default rows have one row per section', () => {
    for (const role of ['manager', 'sales', 'warehouse', 'support_lead']) {
      const rows = defaultRowsFor(role);
      assert.equal(new Set(rows.map((r) => r[0])).size, rows.length, role);
    }
  });
  it('the seed never deletes before writing the defaults', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/roleDefaultsSeed.js'), 'utf8');
    const body = src.slice(src.indexOf('async function seedRoleDefaults'));
    assert.ok(body.indexOf('INSERT INTO role_permissions') < body.indexOf('DELETE FROM role_permissions'));
  });
});

describe('users_role_check list', () => {
  it('unions, dedupes, sorts and drops unsafe names', () => {
    assert.deepEqual(
      buildAllowedRoleList(['admin', 'sales'], ['support_agent', "x'); DROP TABLE users;--"], ['sales', 'Custom']),
      ['admin', 'sales', 'support_agent']
    );
  });
  it('reads role names from a pg constraint definition', () => {
    const def = "CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'sales'::character varying])::text[])))";
    assert.deepEqual([...rolesInConstraintDef(def)].sort(), ['admin', 'sales']);
  });
  it('ensureUserSchema no longer replays the hardcoded-role-check migrations', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/authController.js'), 'utf8');
    const body = src.slice(src.indexOf('exports.ensureUserSchema'), src.indexOf('exports.getAssignableRoles'));
    assert.doesNotMatch(body, /'028_support_user_roles\.sql'|'029_rbac_system\.sql'|'207_guard_gate_checking\.sql'/);
  });
});

describe('sessions end on role change and password reset', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/authController.js'), 'utf8');
  it('updateUser bumps token_version when the role changes', () => {
    const body = src.slice(src.indexOf('exports.updateUser = '), src.indexOf('exports.updateUserStatus'));
    assert.match(body, /token_version = CASE WHEN \$12::boolean THEN token_version \+ 1/);
    assert.match(body, /permissions = CASE WHEN \$12::boolean THEN \$13::text\[\]/);
  });
  it('resetUserPassword bumps token_version', () => {
    const body = src.slice(src.indexOf('exports.resetUserPassword'), src.indexOf('exports.updateUserTeams'));
    assert.match(body, /token_version = token_version \+ 1/);
  });
});
