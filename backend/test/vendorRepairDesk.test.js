/**
 * Vendor returns desk (Builder 6, 29 Sep 2026): the repair challan's
 * "mail Accounts for the e-way bill" is a write. It was guarded by the
 * repair-DC VIEW grant while the screen only offered it to a few roles.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });
const pool = require('../config/db');
const vrdcEway = require('../services/vrdcEwayComplianceService');
const ctrl = require('../controllers/vendorRepairController');
const router = require('../routes/vendorRepair');

function run(mw, user) {
  let status = 200;
  let passed = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  mw({ user }, res, () => { passed = true; });
  return { passed, status };
}

after(async () => { await pool.end(); });

describe('VRDC e-way request to Accounts', () => {
  it('is allowed for the roles the screen offers it to', () => {
    for (const role of ['super_admin', 'warehouse', 'admin', 'manager', 'floor_manager', 'dispatch']) {
      assert.equal(vrdcEway.canRequestVrdcEway({ role }), true, role);
      assert.equal(run(ctrl.requireVrdcEwayRequest, { role, user_id: 1 }).passed, true, role);
    }
  });

  it('is refused for anyone else, even with the repair-DC view grant', () => {
    for (const role of ['procurement', 'sales', 'accounts', 'support_tech', 'guard', undefined]) {
      assert.equal(vrdcEway.canRequestVrdcEway(role ? { role } : null), false, String(role));
      const r = run(ctrl.requireVrdcEwayRequest, role ? { role, user_id: 1 } : undefined);
      assert.equal(r.passed, false, String(role));
      assert.equal(r.status, 403, String(role));
    }
  });

  it('the route runs the role check before the controller', () => {
    const layer = router.stack.find((l) => l.route && String(l.route.path).includes('send-accounts-eway-mail'));
    assert.ok(layer, 'route is mounted');
    const handles = layer.route.stack.map((s) => s.handle);
    const at = handles.indexOf(ctrl.requireVrdcEwayRequest);
    assert.ok(at >= 0, 'role check is on the route');
    assert.ok(at < handles.indexOf(ctrl.sendAccountsVrdcEwayMail));
  });

  it('the compliance payload uses the same rule', async () => {
    const head = { dc_number: 'VRDC/TEST/0001' };
    const items = [{ price: 60000 }];
    const w = await vrdcEway.buildVrdcEwayCompliance(head, items, { role: 'warehouse', user_id: 0 }, {});
    assert.equal(w.can_request_eway, true);
    const p = await vrdcEway.buildVrdcEwayCompliance(head, items, { role: 'procurement', user_id: 0 }, {});
    assert.equal(p.can_request_eway, false);
    assert.equal(p.applies, true);
  });
});
