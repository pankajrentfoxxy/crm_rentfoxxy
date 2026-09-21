/**
 * The gate pre-flight (Part 3.2, finding DC1).
 *
 * Decision 4 makes the guard gate *the* gate: a laptop stays Dispatch Ready
 * until the guard scans it out, and that scan is what means it left the
 * warehouse. Today the gate checks only that the challan is not cancelled,
 * delivered or rejected — it does not check QC, e-way or AWB, and it accepts
 * challans still at `pending`. That is the event which puts stock in transit
 * and starts the rent clock.
 *
 * So this is the checklist that can refuse. The important half is the second
 * word: **a refusal is recorded**, not returned as a silent 400. The challan
 * stays dispatch_ready, an event says which check failed, and the guard screen
 * can show who to call.
 *
 * Per-unit configuration match is NOT reimplemented here — buildLaptopChecks in
 * guardGateValidationService already does it, scan by scan, and rule 2 says
 * extend rather than duplicate. This covers the challan-level checks that
 * happen once, before any scanning starts.
 */
const { recordEvent, ENTITY } = require('./eventService');

/** Above this, an e-way bill is statutory. Mirrors the sales-management rule. */
const EWAY_VALUE_THRESHOLD = 50000;

const COURIER_MODES = new Set(['courier', 'bluedart', 'porter', 'delhivery', 'dtdc']);

/**
 * Each check returns null when it passes, or {code, message, detail} when it
 * does not. Returning a structure rather than throwing lets the gate collect
 * EVERY failure in one pass — a guard who fixes one problem and is then told
 * about a second has been sent away twice.
 */
async function checkDispatchQc(db, dcNumber) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'qc_passed')::int AS passed
       FROM dc_qc_tickets
      WHERE dc_number = $1`,
    [dcNumber]
  );
  const { total, passed } = rows[0] || { total: 0, passed: 0 };

  // Zero rows is "not yet checked", not "passed". Finding D3 is that the old
  // gate treated an empty result as a pass, which is the difference between a
  // gate and a formality.
  if (total === 0) {
    return {
      code: 'DISPATCH_QC_MISSING',
      message: 'No Dispatch QC record exists for this challan. It has not been checked.',
      detail: { total, passed },
    };
  }
  if (passed < total) {
    return {
      code: 'DISPATCH_QC_INCOMPLETE',
      message: `Dispatch QC has passed on ${passed} of ${total} units on this challan.`,
      detail: { total, passed },
    };
  }
  return null;
}

async function checkEwayBill(db, head) {
  // delivery_challan_lines carries eway_required (set when the challan is
  // built) and eway_asset_value. Trust the explicit flag where it exists and
  // fall back to the threshold where it does not — an older challan may predate
  // the flag, and "no flag" must not read as "not required".
  const value = Number(head?.eway_asset_value || 0);
  const flagged = head?.eway_required === true;
  const overThreshold = value >= EWAY_VALUE_THRESHOLD;

  if (!flagged && !overThreshold) return null;
  if (head?.eway_bill_number) return null;

  return {
    code: 'EWAY_MISSING',
    message: flagged
      ? 'This challan is marked as needing an e-way bill and none is recorded.'
      : `This consignment is valued at ${value} and needs an e-way bill before it can leave.`,
    detail: { value, threshold: EWAY_VALUE_THRESHOLD, eway_required: flagged },
  };
}

function checkAwb(head) {
  const mode = String(head?.dispatch_mode || head?.ship_by || '').toLowerCase();
  if (!COURIER_MODES.has(mode)) return null;

  if (head?.awb_number) return null;
  return {
    code: 'AWB_MISSING',
    message: `Dispatch mode is "${mode}" but no AWB number is recorded.`,
    detail: { dispatch_mode: mode },
  };
}

function checkChallanState(head) {
  const status = String(head?.status || '').toLowerCase();
  // DC1: the old gate accepted a challan still at `pending`. A challan that has
  // not reached dispatch_ready has not been through the steps that produce one.
  if (status && !['dispatch_ready', 'in_transit'].includes(status)) {
    return {
      code: 'CHALLAN_NOT_READY',
      message: `This challan is "${status}". Only a dispatch-ready challan can go through the gate.`,
      detail: { status },
    };
  }
  return null;
}

/**
 * Run every challan-level check and return the full picture.
 *
 * `ok` is the answer the gate acts on. `failures` is what the screen shows —
 * all of them, so the guard makes one phone call rather than three.
 */
async function runGatePreflight(db, {
  dcNumber, head, actor = null, correlationId = null,
  // The guard screen asks this question BEFORE scanning, to show which check
  // would fail. Nothing has been refused at that point, so a preview must not
  // write a gate_refused event — an audit trail full of refusals that never
  // happened is worse than none.
  record = true,
}) {
  const failures = [];

  const state = checkChallanState(head);
  if (state) failures.push(state);

  const qc = await checkDispatchQc(db, dcNumber);
  if (qc) failures.push(qc);

  const eway = await checkEwayBill(db, head);
  if (eway) failures.push(eway);

  const awb = checkAwb(head);
  if (awb) failures.push(awb);

  const ok = failures.length === 0;

  if (!ok && record) {
    // THE POINT OF THE PART. A refusal leaves a record, so "the gate would not
    // let it out" is answerable afterwards without asking the guard.
    await recordEvent(db, {
      entityType: ENTITY.DC,
      entityId: dcNumber,
      entityRef: dcNumber,
      eventType: 'gate_refused',
      payload: {
        failures: failures.map((f) => ({ code: f.code, message: f.message, detail: f.detail })),
        checked: ['challan_state', 'dispatch_qc', 'eway_bill', 'awb'],
      },
      correlationId,
      source: 'gatePreflightService.runGatePreflight',
      actor,
    });
  }

  return { ok, failures };
}

module.exports = {
  runGatePreflight,
  EWAY_VALUE_THRESHOLD,
  // Exported for the tests, which assert each rule on its own.
  checkDispatchQc,
  checkEwayBill,
  checkAwb,
  checkChallanState,
};
