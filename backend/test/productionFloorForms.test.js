/**
 * Production — the floor's stage forms. Pure rules first, then the real
 * handlers end to end inside one transaction that is rolled back (migrations
 * 339 and 340 are applied inside it, so this runs before they are live).
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const fs = require('fs');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('../services/floorChecklists');

const allGood = () => Object.fromEntries(fc.QC_ITEMS.map((it) => [it.key, it.options[0].value]));
const dxAllOk = () => Object.fromEntries(fc.DIAGNOSIS_ITEMS.map((it) => [it.key, 'good']));

describe('floor checklists — the rules', () => {
  it('every QC question says which answer is good, and the first answer is the good one', () => {
    for (const it of fc.QC_ITEMS) {
      assert.ok(it.q, it.key);
      assert.ok(['good', 'info'].includes(it.options[0].tone), `${it.key} starts with a good answer`);
    }
  });

  it('every QC fail rule points at a real question and a real answer', () => {
    for (const c of [...fc.QC_BASE_CRITERIA, ...fc.QC2_ADDITIONAL_CRITERIA]) {
      const it = fc.QC_ITEMS.find((i) => i.key === c.key);
      assert.ok(it, c.key);
      for (const v of c.values) assert.ok(it.options.some((o) => o.value === v), `${c.key}=${v}`);
    }
  });

  it('"Not fitted" never fails a stage', () => {
    const c = allGood();
    for (const it of fc.QC_ITEMS) if (it.options.some((o) => o.value === 'NA')) c[it.key] = 'NA';
    assert.equal(fc.qcResult(c, 'QC2').result, 'PASS');
  });

  it('BitLocker left on fails every QC stage', () => {
    for (const st of ['QC1', 'QC2', 'Dispatch QC']) assert.equal(fc.qcResult({ ...allGood(), bitlocker_off: 'NO' }, st).result, 'FAIL');
  });

  it('checkAnswers finds unanswered and invalid answers', () => {
    const a = allGood();
    delete a.keyboard;
    a.touchpad = 'MAYBE';
    const r = fc.checkAnswers(fc.QC_ITEMS, a);
    assert.deepEqual(r.missing, ['keyboard']);
    assert.deepEqual(r.invalid, ['touchpad']);
  });

  it('diagnosis suggests the outcome from the faults', () => {
    assert.equal(fc.suggestDiagnosisOutcome(dxAllOk()), 'assembly');
    assert.equal(fc.suggestDiagnosisOutcome({ ...dxAllOk(), no_short: 'fault' }), 'chip');
    assert.equal(fc.suggestDiagnosisOutcome({ ...dxAllOk(), fan_spinning: 'fault' }), 'parts');
    assert.equal(fc.suggestDiagnosisOutcome({ ...dxAllOk(), body_intact: 'fault' }), 'body');
    assert.equal(fc.suggestDiagnosisOutcome({ ...dxAllOk(), no_mdm_computrace: 'fault', no_short: 'fault' }), 'floor_manager');
  });

  it('a laptop failing Dispatch QC can go back to the floor as in_repair, never straight to in_stock', () => {
    const { isAllowed } = require('../services/inventoryStateMachine');
    assert.equal(isAllowed('reserved', 'in_repair'), true);
    assert.equal(isAllowed('dispatch_ready', 'in_repair'), true);
    const src = fs.readFileSync(`${__dirname}/../services/dispatchQcCaptureService.js`, 'utf8');
    assert.match(src, /toStatus: 'in_repair',\s*\n\s*\/\/ Not truncated/);
  });

  it('cost uses a line\'s unit price, then price, then rate', () => {
    const { lineAmount } = require('../services/laptopCostService');
    assert.equal(lineAmount({ unit_price: 100, rate: 5 }), 100);
    assert.equal(lineAmount({ rate: 0, price: 70 }), 70);
    assert.equal(lineAmount({ rate: 0 }), null);
  });

  it('config comparison ignores formatting, not real differences', () => {
    const { norm } = require('../services/laptopConfigService');
    assert.equal(norm('ram', '16 GB DDR4'), norm('ram', '16GB'));
    assert.equal(norm('storage', '1 TB SSD'), norm('storage', '1024GB'));
    assert.equal(norm('generation', '8TH'), norm('generation', '8th Gen'));
    assert.equal(norm('model', 'Dell Dell Latitude 5420'), norm('model', 'Dell Latitude 5420'));
    assert.notEqual(norm('storage', '256GB SSD'), norm('storage', '512 SSD'));
  });
});

describe('floor stage forms — real handlers (rolled back)', () => {
  const h = require('./helpers/rollbackHarness');
  let C;
  let t;
  let mgr;
  const stageOf = async () => (await C.query('SELECT s.stage_name FROM tickets tt JOIN stages s ON s.stage_id = tt.current_stage_id WHERE tt.ticket_id = $1', [t.ticket_id])).rows[0].stage_name;
  const putAt = async (name, assignee = mgr.user_id) => {
    const s = (await C.query('SELECT stage_id, team_id FROM stages WHERE stage_name = $1 LIMIT 1', [name])).rows[0];
    await C.query('UPDATE tickets SET current_stage_id = $1, assigned_team_id = $2, assigned_user_id = $3, status = \'in_progress\', qc_fail_count = 0 WHERE ticket_id = $4', [s.stage_id, s.team_id, assignee, t.ticket_id]);
    await C.query("UPDATE part_requests SET status = 'cancelled' WHERE ticket_id = $1 AND status NOT IN ('attached', 'cancelled', 'rejected')", [t.ticket_id]);
  };

  before(async () => {
    C = await h.open();
    for (const f of ['339_floor_stage_forms.sql', '340_laptop_config_confirmations.sql']) {
      await C.query(fs.readFileSync(`${__dirname}/../migrations/${f}`, 'utf8'));
    }
    t = (await C.query(`SELECT ticket_id, ttspl_id, serial_number, vendor_serial_id FROM tickets
                         WHERE status = 'in_progress' AND vendor_serial_id IS NOT NULL AND ttspl_id IS NOT NULL
                           AND serial_number IS NOT NULL AND serial_number <> 'NOT_ON'
                         ORDER BY ticket_id DESC LIMIT 1`)).rows[0];
    await C.query("UPDATE tickets SET received_condition = 'on' WHERE ticket_id = $1", [t.ticket_id]);
    mgr = { user_id: (await C.query('SELECT user_id FROM users ORDER BY user_id LIMIT 1')).rows[0].user_id, name: 'Test FM', role: 'super_admin' };
  });
  after(() => h.close());

  it('diagnosis keeps every answer and moves by the chosen outcome', async () => {
    const dx = require('../controllers/diagnosisController');
    await putAt('Diagnosis');
    const body = { answers: { ...dxAllOk(), no_short: 'fault' }, outcome: 'assembly', remarks: 'Board shorted near the charging IC', verify_ttspl: t.ttspl_id, verify_serial: t.serial_number, laptop_condition: 'on' };
    let r = await h.call(dx.submitDiagnosis, { params: { id: t.ticket_id }, body, user: mgr });
    assert.equal(r.code, 400, 'a fault rules out "No faults"');
    r = await h.call(dx.submitDiagnosis, { params: { id: t.ticket_id }, body: { ...body, outcome: 'chip' }, user: mgr });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(await stageOf(), 'Chip Level Repair');
    const row = (await C.query('SELECT answers, outcome, no_short, power_on FROM diagnosis_results WHERE ticket_id = $1', [t.ticket_id])).rows[0];
    assert.equal(row.outcome, 'chip');
    assert.equal(row.answers.no_short, 'fault');
    assert.equal(row.no_short, false);
    assert.equal(row.power_on, true);
  });

  it('chip repair "done" needs every tick, then goes back to Diagnosis', async () => {
    const fb = require('../controllers/floorBoard.controller');
    await putAt('Chip Level Repair');
    const items = await fc.stageChecklistItems(C, 'Chip Level Repair');
    let r = await h.call(fb.completeStageWork, { params: { id: t.ticket_id }, body: { outcome: 'done', checklist: {} }, user: mgr });
    assert.equal(r.code, 400);
    r = await h.call(fb.completeStageWork, { params: { id: t.ticket_id }, body: { outcome: 'done', checklist: Object.fromEntries(items.map((i) => [i.key, true])) }, user: mgr });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(await stageOf(), 'Diagnosis');
  });

  it('Body & Paint can now leave its stage', async () => {
    const fb = require('../controllers/floorBoard.controller');
    await putAt('Body & Paint');
    const items = await fc.stageChecklistItems(C, 'Body & Paint');
    const r = await h.call(fb.completeStageWork, { params: { id: t.ticket_id }, body: { outcome: 'done', checklist: Object.fromEntries(items.map((i) => [i.key, true])) }, user: mgr });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(await stageOf(), 'Diagnosis');
  });

  it('someone else\'s ticket: a technician cannot finish its stage', async () => {
    const fb = require('../controllers/floorBoard.controller');
    await putAt('Assembly & Software');
    const r = await h.call(fb.completeStageWork, { params: { id: t.ticket_id }, body: { outcome: 'needs_body', reason: 'Lid cracked' }, user: { user_id: -1, role: 'technician' } });
    assert.equal(r.code, 403);
  });

  it('Assembly → Final Testing is refused by the stage mover until the checklist is finished', async () => {
    const { applyStageMove } = require('../services/stageTransitionService');
    await putAt('Assembly & Software');
    await C.query("SELECT pg_sleep(0.01)");
    await C.query('SAVEPOINT mv');
    await assert.rejects(
      applyStageMove(C, { ticket: { ticket_id: t.ticket_id }, toStageName: 'Final Testing', source: 'test', actor: { user_id: -1, role: 'technician' } }),
      /checklist/
    );
    await C.query('ROLLBACK TO SAVEPOINT mv');
  });

  it('QC submit: unanswered questions are refused; "fail now" fails with the reason', async () => {
    const qc = require('../controllers/qcController');
    await putAt('QC1');
    let r = await h.call(qc.submitQC, { params: { id: t.ticket_id }, body: { checklist_version: 2, checklist: { keyboard: 'WORKING' }, grading: { final_grade: 'A' } }, user: mgr });
    assert.equal(r.code, 400);
    assert.equal(r.body.code, 'QC_INCOMPLETE');
    r = await h.call(qc.submitQC, { params: { id: t.ticket_id }, body: { force_fail_reason: 'Will not start — no display' }, user: mgr });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.result, 'FAIL');
    assert.equal(await stageOf(), 'Assembly & Software');
  });

  it('the laptop cost and configuration reads return for a real laptop', async () => {
    const { getLaptopCost } = require('../services/laptopCostService');
    const { getCurrentConfig } = require('../services/laptopConfigService');
    const cost = await getLaptopCost(C, { serialId: t.vendor_serial_id });
    assert.ok(cost && typeof cost.total === 'number');
    const cfg = await getCurrentConfig(C, { serialId: t.vendor_serial_id });
    assert.ok(cfg && cfg.config);
  });
});
