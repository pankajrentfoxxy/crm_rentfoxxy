/**
 * CT1 (27 Sep 2026) — role OR section gates.
 *
 * permissionService is replaced in the require cache by a stub, so these run
 * without a database: the stub grants exactly the (section, action) pairs a
 * test hands it and records every lookup.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const permPath = path.join(__dirname, '../services/permissionService.js');
const granted = new Set();
const lookups = [];
require.cache[permPath] = {
  id: permPath,
  filename: permPath,
  loaded: true,
  exports: {
    async hasPermission(userId, role, section, action, cache) {
      lookups.push(`${section}:${action}`);
      if (role === 'super_admin') return true;
      const key = `${section}:${String(action).replace(/^can_/, '')}`;
      const ok = granted.has(key);
      if (cache) cache[key] = ok;
      return ok;
    },
  },
};

const { roleOrSection, userHasRoleOrSection } = require('../middleware/roleOrSection');
const { legacyOrSection, hasLegacyPermission } = require('../middleware/legacyOrSection');

function run(mw, user) {
  return new Promise((resolve) => {
    const req = { user };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ next: false, status: this.statusCode, body }); return this; },
    };
    mw(req, res, () => resolve({ next: true }));
  });
}

beforeEach(() => { granted.clear(); lookups.length = 0; });

describe('userHasRoleOrSection', () => {
  it('super_admin passes without a lookup', async () => {
    assert.equal(await userHasRoleOrSection({ user_id: 1, role: 'super_admin' }, [], 'warehouse', 'edit'), true);
    assert.equal(lookups.length, 0);
  });

  it('a listed role passes without a lookup (nobody loses access)', async () => {
    assert.equal(await userHasRoleOrSection({ user_id: 2, role: 'warehouse' }, ['admin', 'warehouse'], 'warehouse', 'edit'), true);
    assert.equal(lookups.length, 0);
  });

  it('accepts a Set of roles', async () => {
    assert.equal(await userHasRoleOrSection({ user_id: 2, role: 'manager' }, new Set(['manager']), 'x', 'edit'), true);
  });

  it('an unlisted role passes only with the section grant', async () => {
    const user = { user_id: 3, role: 'support_agent' };
    assert.equal(await userHasRoleOrSection(user, ['admin'], 'return_dc', 'edit'), false);
    granted.add('return_dc:edit');
    assert.equal(await userHasRoleOrSection(user, ['admin'], 'return_dc', 'edit'), true);
  });

  it('any one of several sections is enough', async () => {
    granted.add('dispatch:view');
    assert.equal(await userHasRoleOrSection({ user_id: 4, role: 'sales' }, [], ['qc_management', 'dispatch'], 'view'), true);
  });

  it('the action must match: view does not open edit', async () => {
    granted.add('warehouse:view');
    assert.equal(await userHasRoleOrSection({ user_id: 5, role: 'sales' }, [], 'warehouse', 'edit'), false);
  });

  it('no user, no access', async () => {
    assert.equal(await userHasRoleOrSection(null, ['admin'], 'warehouse', 'edit'), false);
  });
});

describe('roleOrSection middleware', () => {
  it('403 with no role and no grant', async () => {
    const out = await run(roleOrSection(['admin'], 'pending_inventory', 'edit'), { user_id: 6, role: 'qc' });
    assert.equal(out.next, false);
    assert.equal(out.status, 403);
  });

  it('next() with the grant', async () => {
    granted.add('pending_inventory:edit');
    const out = await run(roleOrSection(['admin'], 'pending_inventory', 'edit'), { user_id: 6, role: 'qc' });
    assert.equal(out.next, true);
  });

  it('401 without a user', async () => {
    const out = await run(roleOrSection(['admin'], 'x', 'edit'), undefined);
    assert.equal(out.status, 401);
  });
});

describe('legacyOrSection middleware', () => {
  const legacy = (u) => u.role === 'admin' || hasLegacyPermission(u, 'warehouse_access');

  it('legacy permissions[] still pass', async () => {
    const out = await run(legacyOrSection(legacy, 'warehouse', 'edit'), { user_id: 7, role: 'sales', permissions: ['warehouse_access'] });
    assert.equal(out.next, true);
    assert.equal(lookups.length, 0);
  });

  it('the section grant also passes, and the refusal body is preserved', async () => {
    const body = { message: 'Access denied: Warehouse access required' };
    let out = await run(legacyOrSection(legacy, 'warehouse', 'edit', body), { user_id: 8, role: 'sales' });
    assert.equal(out.status, 403);
    assert.deepEqual(out.body, body);
    granted.add('warehouse:edit');
    out = await run(legacyOrSection(legacy, 'warehouse', 'edit', body), { user_id: 8, role: 'sales' });
    assert.equal(out.next, true);
  });
});
