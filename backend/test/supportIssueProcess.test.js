/**
 * Support issue process (claude/carret-support.md rework A+B, migration 348):
 * new complaint laptops need Type > Subtype > Issue; the job finishes only with
 * what was wrong, why and what fixed it; tickets raised before are untouched.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/rollbackHarness');

describe('support issue process', () => {
  let C; let ctrl; let lead; let customerId; let pick; let codes;
  before(async () => {
    C = await H.open();
    ctrl = require('../controllers/supportController');
    const u = (await C.query(`SELECT user_id FROM users WHERE role = 'super_admin' ORDER BY user_id LIMIT 1`)).rows[0];
    lead = { user_id: u.user_id, role: 'super_admin', permissions: [] };
    // Real laptops with one customer, none on an open ticket.
    const { SUPPORT_TICKET_ELIGIBLE_STATUSES } = require('../services/supportSerialEligibility');
    const rows = (await C.query(
      `WITH free AS (
         SELECT vsn.current_customer_id AS customer_id, vsn.inventory_asset_code AS code
           FROM vendor_serial_numbers vsn
          WHERE vsn.deleted_at IS NULL AND vsn.inventory_status = ANY($1::text[])
            AND vsn.inventory_asset_code IS NOT NULL AND vsn.current_customer_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM support_ticket_items i
                             WHERE (i.unique_serial_number = vsn.inventory_asset_code OR i.serial_number = vsn.serial_number)
                               AND i.status NOT IN ('resolved','closed','inventory_updated','cancelled'))
            AND NOT EXISTS (SELECT 1 FROM delivery_challan_lines d
                             WHERE d.movement_type = 'outbound' AND d.customer_id = vsn.current_customer_id
                               AND d.serial_number::text ILIKE '%' || vsn.inventory_asset_code || '%'
                               AND COALESCE(d.status, '') NOT IN ('delivered','rejected','cancelled'))
       ), best AS (SELECT customer_id FROM free GROUP BY 1 HAVING COUNT(*) >= 6 ORDER BY COUNT(*) DESC LIMIT 1)
       SELECT f.customer_id, f.code FROM free f JOIN best b USING (customer_id) LIMIT 6`,
      [SUPPORT_TICKET_ELIGIBLE_STATUSES]
    )).rows;
    customerId = rows[0].customer_id;
    codes = rows.map((r) => r.code);
    // Hardware > Display > a real issue, and a second issue under Battery.
    pick = (await C.query(
      `SELECT t.catalog_id AS type_id, s.catalog_id AS subtype_id, i.catalog_id AS issue_id
         FROM support_issue_catalog i
         JOIN support_issue_catalog s ON s.catalog_id = i.parent_id
         JOIN support_issue_catalog t ON t.catalog_id = s.parent_id
        WHERE s.code = 'HW-DIS' AND i.active ORDER BY i.sort_order LIMIT 1`
    )).rows[0];
  });
  after(async () => { await H.close(); });

  const laptop = (extra = {}) => ({ item_type: 'complaint', unique_serial_number: codes.shift(), remarks: 'Screen flickers', ...extra });
  const raise = (items) => H.call(ctrl.createTicket, { user: lead, body: { customer_id: customerId, ticket_category: 'complaint', items } });

  it('refuses a complaint laptop without Type > Subtype > Issue', async () => {
    const r = await raise([laptop()]);
    assert.equal(r.code, 400);
    assert.match(r.body.message, /type and subtype/);
    const r2 = await raise([laptop({ reported_type_id: pick.type_id, reported_subtype_id: pick.subtype_id })]);
    assert.equal(r2.code, 400);
    assert.match(r2.body.message, /Choose the issue/);
  });

  it('refuses an issue that does not belong to the subtype', async () => {
    const other = (await C.query(`SELECT catalog_id FROM support_issue_catalog WHERE level = 3 AND parent_id <> $1 AND active LIMIT 1`, [pick.subtype_id])).rows[0];
    const r = await raise([laptop({ reported_type_id: pick.type_id, reported_subtype_id: pick.subtype_id, reported_issue_id: other.catalog_id })]);
    assert.equal(r.code, 400);
    assert.match(r.body.message, /does not belong/);
  });

  let itemId; let ticketId;
  it('stores the reported issue and a readable label', async () => {
    const r = await raise([laptop({ reported_type_id: pick.type_id, reported_subtype_id: pick.subtype_id, reported_issue_id: pick.issue_id })]);
    assert.equal(r.code, 201, JSON.stringify(r.body));
    ticketId = r.body.ticket.id;
    const it0 = (await C.query('SELECT * FROM support_ticket_items WHERE ticket_id = $1', [ticketId])).rows[0];
    itemId = it0.id;
    assert.equal(it0.reported_issue_id, pick.issue_id);
    assert.match(it0.issue_category_label, /^Hardware › Display › /);
  });

  it('will not finish the job without the finding', async () => {
    await C.query('UPDATE support_ticket_items SET visited_at = NOW(), assigned_to = $2 WHERE id = $1', [itemId, lead.user_id]);
    const r = await H.call(ctrl.setOutcome, { user: lead, params: { itemId }, body: { outcome: 'fixed' } });
    assert.equal(r.code, 400);
    assert.match(r.body.message, /root cause/);
    const cause = (await C.query(`SELECT cause_id FROM support_root_causes WHERE code = 'RC-REF'`)).rows[0].cause_id;
    const bad = await H.call(ctrl.setOutcome, { user: lead, params: { itemId }, body: { outcome: 'fixed', root_cause_id: cause, resolution_code: 'RES-NFF' } });
    assert.equal(bad.code, 400);
    assert.match(bad.body.message, /does not match/);
    const ok = await H.call(ctrl.setOutcome, { user: lead, params: { itemId }, body: { outcome: 'fixed', root_cause_id: cause, resolution_code: 'RES-PRT', resolution_notes: 'Panel cable reseated' } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    const row = (await C.query('SELECT found_issue_id, root_cause_id, resolution_code_id, finding_by FROM support_ticket_items WHERE id = $1', [itemId])).rows[0];
    assert.equal(row.found_issue_id, pick.issue_id, 'found defaults to what was reported');
    assert.equal(row.root_cause_id, cause);
    assert.ok(row.resolution_code_id && row.finding_by);
  });

  it('no fault found needs no cause or fix', async () => {
    const r = await raise([laptop({ reported_type_id: pick.type_id, reported_subtype_id: pick.subtype_id, reported_issue_id: pick.issue_id })]);
    const id = (await C.query('SELECT id FROM support_ticket_items WHERE ticket_id = $1', [r.body.ticket.id])).rows[0].id;
    await C.query('UPDATE support_ticket_items SET visited_at = NOW() WHERE id = $1', [id]);
    const ok = await H.call(ctrl.setOutcome, { user: lead, params: { itemId: id }, body: { outcome: 'working' } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    const row = (await C.query(`SELECT rc.code AS cause, rs.code AS fix FROM support_ticket_items i JOIN support_root_causes rc ON rc.cause_id = i.root_cause_id JOIN support_resolution_codes rs ON rs.code_id = i.resolution_code_id WHERE i.id = $1`, [id])).rows[0];
    assert.deepEqual(row, { cause: 'RC-UNK', fix: 'RES-NFF' });
  });

  it('will not close a ticket while a finding is missing', async () => {
    const r = await raise([laptop({ reported_type_id: pick.type_id, reported_subtype_id: pick.subtype_id, reported_issue_id: pick.issue_id })]);
    const tid = r.body.ticket.id;
    await C.query(`UPDATE support_ticket_items SET status = 'resolved' WHERE ticket_id = $1`, [tid]);
    const c = await H.call(ctrl.closeTicket, { user: lead, params: { ticketId: tid }, body: {} });
    assert.equal(c.code, 400);
    assert.match(c.body.message, /Record what was wrong/);
  });

  it('leaves laptops raised before the process alone', async () => {
    const old = (await C.query(
      `SELECT id FROM support_ticket_items WHERE item_type = 'complaint' AND reported_issue_id IS NULL LIMIT 1`
    )).rows[0];
    if (!old) return;
    const r = await H.call(ctrl.setReportedIssue, { user: lead, params: { itemId: old.id }, body: pick });
    assert.equal(r.code, 409);
    const f = await H.call(ctrl.recordIssueFinding, { user: lead, params: { itemId: old.id }, body: {} });
    assert.equal(f.code, 409);
  });

  it('the catalog comes as a tree with causes and fixes', async () => {
    const r = await H.call(ctrl.getIssueCatalog, { user: lead });
    assert.equal(r.code, 200);
    assert.equal(r.body.types.length, 7);
    assert.ok(r.body.types[0].subtypes[0].issues.length > 0);
    assert.ok(r.body.root_causes.some((c) => c.code === 'RC-REF'));
    assert.ok(r.body.types.every((t) => t.subtypes.every((s) => s.issues.every((i) => i.name !== 'Unspecified'))), 'Unspecified is not offered');
  });
});

