// Control → Settings (company / entity) and Reports export access (29 Sep 2026).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { sectionsForExport } = require('../utils/reportExportSections');
const H = require('./helpers/rollbackHarness');
const ctrl = require('../controllers/companyController');
const teams = require('../controllers/teamController');

const { validateCompanyUpdate, defaultRow } = ctrl._test;

describe('report export — the section a report type needs', () => {
  it('each exported type accepts its own report section or reports_export', () => {
    assert.deepEqual(sectionsForExport('revenue'), ['report_revenue', 'reports_export']);
    assert.deepEqual(sectionsForExport('inward_outward'), ['report_inward_outward', 'reports_export']);
  });
  it('the Sales Order report Excel needs report_sales_order (was reports_export only)', () => {
    assert.deepEqual(sectionsForExport('sales_order_config'), ['report_sales_order', 'reports_export']);
    assert.deepEqual(sectionsForExport('sales_order_report'), ['report_sales_order', 'reports_export']);
  });
  it('technician performance Excel needs report_laptop, same as its GET', () => {
    assert.deepEqual(sectionsForExport('technician_performance'), ['report_laptop', 'reports_export']);
  });
  it('an unknown type (or prototype key) needs reports_export only', () => {
    assert.deepEqual(sectionsForExport('nope'), ['reports_export']);
    assert.deepEqual(sectionsForExport('constructor'), ['reports_export']);
    assert.deepEqual(sectionsForExport(undefined), ['reports_export']);
  });
});

describe('company settings — validation', () => {
  it('accepts a consistent GSTIN / PAN / state code and upper-cases them', () => {
    const r = validateCompanyUpdate({ gstin: '06aahct0310n1zg', pan: 'aahct0310n', state_code: '06' });
    assert.equal(r.error, undefined);
    assert.equal(r.values.gstin, '06AAHCT0310N1ZG');
    assert.equal(r.values.pan, 'AAHCT0310N');
  });
  it('refuses a malformed GSTIN, PAN, state code, HSN or email', () => {
    assert.match(validateCompanyUpdate({ gstin: '06AAHCT0310N1Z' }).error, /GSTIN/);
    assert.match(validateCompanyUpdate({ pan: 'AAHC0310N' }).error, /PAN/);
    assert.match(validateCompanyUpdate({ state_code: 'HR' }).error, /State code/);
    assert.match(validateCompanyUpdate({ hsn_code: 'abc' }).error, /HSN/);
    assert.match(validateCompanyUpdate({ email: 'accounts@' }).error, /Email/);
  });
  it('refuses a PAN or state code that does not match the GSTIN', () => {
    assert.match(validateCompanyUpdate({ gstin: '06AAHCT0310N1ZG', pan: 'AAHCT0311N' }).error, /does not match/);
    assert.match(validateCompanyUpdate({ gstin: '06AAHCT0310N1ZG', state_code: '07' }).error, /does not match/);
  });
  it('refuses clearing the legal name; empty strings keep the stored value', () => {
    assert.match(validateCompanyUpdate({ legal_name: '  ' }).error, /Legal name/);
    const r = validateCompanyUpdate({ gstin: '', address: '' });
    assert.equal(r.values.gstin, null);
    assert.equal(r.values.address, null);
  });
  it('a missing entity shows what its documents print today', () => {
    const d = defaultRow('gorefurbo');
    assert.equal(d.code, 'gorefurbo');
    assert.equal(d.dc_prefix, 'GDC-');
    assert.ok(d.legal_name);
    assert.equal(d.gstin.slice(0, 2), d.state_code);
  });
});

describe('company settings + teams — on the database (rolled back)', () => {
  before(async () => { await H.open(); });
  after(async () => { await H.close(); });

  const user = { user_id: 1, role: 'super_admin' };

  it('lists both entities, a missing one flagged not saved', async () => {
    await H.db().query("DELETE FROM companies WHERE code = 'gorefurbo'");
    const r = await H.call(ctrl.listCompanies, { user });
    assert.equal(r.code, 200);
    const codes = r.body.data.map((c) => c.code);
    assert.ok(codes.includes('rentfoxxy'));
    const g = r.body.data.find((c) => c.code === 'gorefurbo');
    assert.equal(g.saved, false);
  });

  it('the first save creates the missing row from the defaults, then applies the change', async () => {
    await H.db().query("DELETE FROM companies WHERE code = 'gorefurbo'");
    const r = await H.call(ctrl.updateCompany, { user, params: { code: 'gorefurbo' }, body: { phone: '9876543210' } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.code, 'gorefurbo');
    assert.equal(r.body.data.dc_prefix, 'GDC-');
    assert.equal(r.body.data.phone, '9876543210');
    assert.equal(r.body.data.legal_name, defaultRow('gorefurbo').legal_name);
    const again = await H.call(ctrl.listCompanies, { user });
    assert.equal(again.body.data.filter((c) => c.code === 'gorefurbo').length, 1);
    assert.equal(again.body.data.find((c) => c.code === 'gorefurbo').saved, true);
  });

  it('refuses a GSTIN that no longer matches the stored PAN', async () => {
    await H.call(ctrl.updateCompany, { user, params: { code: 'rentfoxxy' }, body: { gstin: '06AAHCT0310N1ZG', pan: 'AAHCT0310N', state_code: '06' } });
    const r = await H.call(ctrl.updateCompany, { user, params: { code: 'rentfoxxy' }, body: { gstin: '07ABCDE1234F1Z5' } });
    assert.equal(r.code, 400);
    assert.match(r.body.message, /does not match/);
    const row = await H.db().query("SELECT gstin FROM companies WHERE code = 'rentfoxxy'");
    assert.equal(row.rows[0].gstin, '06AAHCT0310N1ZG');
  });

  it('an unknown entity code is still 404 and creates nothing', async () => {
    const r = await H.call(ctrl.updateCompany, { user, params: { code: 'acme' }, body: { phone: '9876543210' } });
    assert.equal(r.code, 404);
    const n = await H.db().query("SELECT COUNT(*)::int AS n FROM companies WHERE code = 'acme'");
    assert.equal(n.rows[0].n, 0);
  });

  it('a bad value is refused before anything is written', async () => {
    const r = await H.call(ctrl.updateCompany, { user, params: { code: 'rentfoxxy' }, body: { gstin: 'NOT-A-GSTIN' } });
    assert.equal(r.code, 400);
  });

  it('a user in a team only through user_teams is counted', async () => {
    const t = await H.db().query("INSERT INTO teams (team_name) VALUES ('ZZ Test Team Control') RETURNING team_id");
    const teamId = t.rows[0].team_id;
    const u = await H.db().query('SELECT user_id FROM users WHERE active = true ORDER BY user_id LIMIT 2');
    assert.equal(u.rows.length, 2);
    await H.db().query('UPDATE users SET team_id = $1 WHERE user_id = $2', [teamId, u.rows[0].user_id]);
    await H.db().query('INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.rows[1].user_id, teamId]);
    const c = await H.db().query(`SELECT ${teams._test.MEMBER_COUNT_SQL}::int AS n FROM teams t WHERE t.team_id = $1`, [teamId]);
    const m = await H.call(teams.getTeamMembers, { params: { id: teamId } });
    assert.equal(m.code, 200);
    assert.equal(c.rows[0].n, 2);
    assert.equal(m.body.members.length, c.rows[0].n);
  });
});
