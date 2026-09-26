/**
 * Issue insights (claude/carret-support.md rework C): counts laptops raised
 * under the issue process and traces floor-missed faults back to the people
 * who prepared and QC'd the laptop.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/rollbackHarness');

describe('issue insights', () => {
  let C; let ctrl; let lead; let laptop; let pick;
  before(async () => {
    C = await H.open();
    ctrl = require('../controllers/supportController');
    const u = (await C.query(`SELECT user_id FROM users WHERE role = 'super_admin' ORDER BY user_id LIMIT 1`)).rows[0];
    lead = { user_id: u.user_id, role: 'super_admin', permissions: [] };
    const { SUPPORT_TICKET_ELIGIBLE_STATUSES } = require('../services/supportSerialEligibility');
    // A laptop with the customer that went through QC on the floor.
    laptop = (await C.query(
      `SELECT vsn.current_customer_id AS customer_id, vsn.inventory_asset_code AS code
         FROM vendor_serial_numbers vsn
        WHERE vsn.deleted_at IS NULL AND vsn.inventory_status = ANY($1::text[])
          AND vsn.current_customer_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM qc_results q JOIN tickets tk ON tk.ticket_id = q.ticket_id WHERE tk.ttspl_id = vsn.inventory_asset_code)
          AND NOT EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.unique_serial_number = vsn.inventory_asset_code
                            AND i.status NOT IN ('resolved','closed','inventory_updated','cancelled'))
          AND NOT EXISTS (SELECT 1 FROM delivery_challan_lines d WHERE d.movement_type = 'outbound' AND d.customer_id = vsn.current_customer_id
                            AND d.serial_number::text ILIKE '%' || vsn.inventory_asset_code || '%'
                            AND COALESCE(d.status, '') NOT IN ('delivered','rejected','cancelled'))
        LIMIT 1`,
      [SUPPORT_TICKET_ELIGIBLE_STATUSES]
    )).rows[0];
    pick = (await C.query(
      `SELECT s.parent_id AS type_id, s.catalog_id AS subtype_id, i.catalog_id AS issue_id
         FROM support_issue_catalog i JOIN support_issue_catalog s ON s.catalog_id = i.parent_id
        WHERE s.code = 'HW-KBD' AND i.active ORDER BY i.sort_order LIMIT 1`
    )).rows[0];
  });
  after(async () => { await H.close(); });

  it('counts the laptop and names the floor people for a missed fault', async (t) => {
    if (!laptop) { t.skip('no QC-ed laptop with a customer on this database'); return; }
    const r = await H.call(ctrl.createTicket, {
      user: lead,
      body: { customer_id: laptop.customer_id, ticket_category: 'complaint', items: [{ item_type: 'complaint', unique_serial_number: laptop.code, remarks: 'Keys dead', reported_type_id: pick.type_id, reported_subtype_id: pick.subtype_id, reported_issue_id: pick.issue_id }] },
    });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    const item = (await C.query('SELECT id FROM support_ticket_items WHERE ticket_id = $1', [r.body.ticket.id])).rows[0];
    await C.query('UPDATE support_ticket_items SET visited_at = NOW() WHERE id = $1', [item.id]);
    const cause = (await C.query(`SELECT cause_id FROM support_root_causes WHERE code = 'RC-REF'`)).rows[0].cause_id;
    const o = await H.call(ctrl.setOutcome, { user: lead, params: { itemId: item.id }, body: { outcome: 'fixed', root_cause_id: cause, resolution_code: 'RES-PRT' } });
    assert.equal(o.code, 200, JSON.stringify(o.body));

    const { issueInsights } = require('../services/supportIssueInsightsService');
    const out = await issueInsights({ days: 7 }, C);
    assert.ok(out.summary.laptops >= 1);
    assert.ok(out.summary.floor_cases >= 1);
    assert.ok(out.by_issue.some((g) => /Keyboard/.test(g.label)));
    assert.ok(out.by_cause.some((g) => g.key === 'RC-REF'));
    const mine = out.floor.filter((p) => p.laptops.some((l) => l.id === item.id));
    assert.ok(mine.length > 0, 'somebody on the floor is named');
    assert.ok(mine.some((p) => p.roles.some((role) => /QC|Dispatch/.test(role))), 'a QC tester or checker is named');
  });
});
