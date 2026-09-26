/**
 * Support settings → the issue list (claude/carret-support.md rework E).
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/rollbackHarness');

describe('issue list settings', () => {
  let C; let ctrl; let admin; let sub;
  before(async () => {
    C = await H.open();
    ctrl = require('../controllers/supportController');
    const u = (await C.query(`SELECT user_id FROM users WHERE role = 'super_admin' ORDER BY user_id LIMIT 1`)).rows[0];
    admin = { user_id: u.user_id, role: 'super_admin', permissions: [] };
    sub = (await C.query(`SELECT catalog_id, parent_id FROM support_issue_catalog WHERE code = 'HW-DIS'`)).rows[0];
  });
  after(async () => { await H.close(); });

  it('adds an issue, refuses a duplicate, and a switched-off issue cannot be picked', async () => {
    const tech = { user_id: admin.user_id, role: 'support_tech', permissions: [] };
    assert.equal((await H.call(ctrl.addIssueCatalogEntry, { user: tech, body: { parent_id: sub.catalog_id, name: 'Hinge squeak' } })).code, 403);
    const r = await H.call(ctrl.addIssueCatalogEntry, { user: admin, body: { parent_id: sub.catalog_id, name: 'Hinge squeak' } });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    assert.equal((await H.call(ctrl.addIssueCatalogEntry, { user: admin, body: { parent_id: sub.catalog_id, name: 'hinge SQUEAK' } })).code, 409);
    const { resolveIssue } = require('../services/supportIssueService');
    const ok = await resolveIssue(C, { type_id: sub.parent_id, subtype_id: sub.catalog_id, issue_id: r.body.entry.id });
    assert.match(ok.label, /Hinge squeak$/);
    assert.equal((await H.call(ctrl.updateIssueCatalogEntry, { user: admin, params: { id: r.body.entry.id }, body: { active: false } })).code, 200);
    await assert.rejects(resolveIssue(C, { type_id: sub.parent_id, subtype_id: sub.catalog_id, issue_id: r.body.entry.id }), /does not belong/);
    const tree = await H.call(ctrl.getIssueCatalogAdmin, { user: admin });
    const disp = tree.body.types.flatMap((t) => t.subtypes).find((x) => x.id === sub.catalog_id);
    assert.ok(disp.issues.some((i) => i.id === r.body.entry.id && i.active === false), 'settings still show it, switched off');
  });

  it('a new subtype gets its hidden Unspecified for customer requests', async () => {
    const r = await H.call(ctrl.addIssueCatalogEntry, { user: admin, body: { parent_id: sub.parent_id, name: 'Fingerprint reader' } });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    const { resolveIssue } = require('../services/supportIssueService');
    const out = await resolveIssue(C, { type_id: sub.parent_id, subtype_id: r.body.entry.id }, { requireIssue: false });
    assert.match(out.label, /Fingerprint reader › Unspecified$/);
  });
});
