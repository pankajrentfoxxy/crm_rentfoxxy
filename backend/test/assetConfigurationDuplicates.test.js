/**
 * Asset configuration — no duplicate the check/normalize scripts would merge.
 * Names are compared with utils/assetConfigNormalize.compareKey (the same key
 * scripts/normalize-asset-configuration.js groups by), so "997 gb" and
 * "997GB RAM" are one value. The real handlers run inside one transaction that
 * is rolled back, so nothing is left in the database.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { asDuplicateError } = require('../services/assetConfigurationService');
const { compareKey } = require('../utils/assetConfigNormalize');

describe('asset configuration duplicates — the rules', () => {
  it('a unique-index violation is reported as 409, not 500', () => {
    const e = asDuplicateError({ code: '23505', message: 'duplicate key value' }, { label: 'RAM' });
    assert.equal(e.status, 409);
    assert.match(e.message, /RAM name must be unique/);
  });

  it('other database errors pass through unchanged', () => {
    const orig = new Error('boom');
    assert.equal(asDuplicateError(orig, { label: 'RAM' }), orig);
  });

  it('the compare key ignores case, spacing and the unit spelling', () => {
    assert.equal(compareKey('ram', '997 gb'), compareKey('ram', '997GB RAM'));
    assert.equal(compareKey('generations', '8TH'), compareKey('generations', '8th Gen'));
  });
});

describe('asset configuration duplicates — through the handlers', () => {
  const H = require('./helpers/rollbackHarness');
  let ctrl;
  const user = { user_id: 1, role: 'super_admin' };

  before(async () => {
    await H.open();
    ctrl = require('../controllers/assetConfigurationController');
  });
  after(async () => { await H.close(); });

  it('creating the same RAM twice in another spelling is refused with 409', async () => {
    const first = await H.call(ctrl.createRam, { body: { name: '997 GB' }, user });
    assert.equal(first.code, 201, JSON.stringify(first.body));
    assert.equal(first.body.item.name, '997GB RAM');

    const again = await H.call(ctrl.createRam, { body: { name: '997gb ram' }, user });
    assert.equal(again.code, 409);
    assert.match(again.body.message, /unique/);
  });

  it('renaming another value onto an existing one is refused; renaming itself is fine', async () => {
    const other = await H.call(ctrl.createRam, { body: { name: '998 GB' }, user });
    assert.equal(other.code, 201);
    const clash = await H.call(ctrl.updateRam, { params: { id: String(other.body.item.id) }, body: { name: '997GB' }, user });
    assert.equal(clash.code, 409);

    const self = await H.call(ctrl.updateRam, { params: { id: String(other.body.item.id) }, body: { name: '998gb' }, user });
    assert.equal(self.code, 200, JSON.stringify(self.body));
    assert.equal(self.body.item.name, '998GB RAM');
  });

  it('a deleted value can be added again (the scripts ignore deleted rows too)', async () => {
    const row = await H.call(ctrl.createGeneration, { body: { name: '97th' }, user });
    assert.equal(row.code, 201, JSON.stringify(row.body));
    const del = await H.call(ctrl.deleteGeneration, { params: { id: String(row.body.item.id) }, user });
    assert.equal(del.code, 200);
    const back = await H.call(ctrl.createGeneration, { body: { name: '97 TH gen' }, user });
    assert.equal(back.code, 201, JSON.stringify(back.body));
    assert.equal(back.body.item.name, '97th Gen');
  });
});
