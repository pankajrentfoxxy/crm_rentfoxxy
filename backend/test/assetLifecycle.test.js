/**
 * Laptop lifecycle (services/assetLifecycleService.js): the pure parts —
 * merging the activity from several logs, deriving milestones, rental
 * periods and the money math.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  fromTransition, fromAudit, fromEvent, fromFloor, fromDcLine, fromSupport, classifyFloor, isTestNoise,
  mergeActivity, deriveMilestones, buildRentals, invoicePaidFraction, creditForLaptop, computeMoney, vendorRentPaid, parseFiles,
} = require('../services/assetLifecycleService');

const T = (s) => `2026-09-30T${s}Z`;

describe('activity merge', () => {
  it('one status change written by the state machine, the audit log and the event spine is one row', () => {
    const rows = [
      fromTransition({ transition_id: 1, created_at: T('12:12:19.017'), from_status: 'reserved', to_status: 'dispatch_ready', reason: 'Dispatch ready on DC/26-27/1438', dc_number: 'DC/26-27/1438', actor_user_id: 4 }),
      fromAudit({ log_id: 9, created_at: T('12:12:19.017'), event_type: 'status_dispatch_ready', description: 'Dispatch ready on DC/26-27/1438', metadata: { to: 'dispatch_ready', dc_number: 'DC/26-27/1438' }, actor_user_id: 4 }),
      fromEvent({ event_id: 5, occurred_at: T('12:12:19.020'), event_type: 'status_changed', to_state: 'dispatch_ready', payload: { dc_number: 'DC/26-27/1438' }, source: 'inventoryStateMachine.transitionAsset' }),
      // the DC line itself, created a moment earlier
      ...fromDcLine({ id: 77, dc_number: 'DC/26-27/1438', status: 'pending', movement_type: 'outbound', created_at: T('12:12:18.900'), created_by: 4, customer_name: 'Acme' }, 'rental'),
    ];
    const out = mergeActivity(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].source, 'transition'); // best source supplies the row
    assert.equal(out[0].at, new Date(T('12:12:18.900')).toISOString()); // earliest time wins
    assert.equal(out[0].milestone, 'dc_attached');
    assert.equal(out[0].merged_from.length, 4);
  });

  it('event-spine backfills of the audit log are dropped (the log is read directly)', () => {
    assert.equal(fromEvent({ event_id: 1, occurred_at: T('10:00:00'), event_type: 'received', source: 'backfill:ttspl_audit_log' }), null);
  });

  it('a later clean-up that re-states a delivery keeps the real delivery time', () => {
    const rows = [
      fromTransition({ transition_id: 2, created_at: '2026-10-01T21:12:29Z', from_status: 'rented', to_status: 'sold', reason: 'erp_out_stock_sold', dc_number: 'DC/26-27/0731' }),
      ...fromDcLine({ id: 3, dc_number: 'DC/26-27/0731', status: 'delivered', movement_type: 'outbound', created_at: '2026-06-19T19:31:19Z', delivered_at: '2026-06-19T07:24:00Z', customer_name: 'Ratham' }, 'sale'),
    ];
    const out = mergeActivity(rows);
    const sold = out.find((r) => r.milestone === 'sold');
    assert.equal(sold.at, '2026-06-19T07:24:00.000Z');
  });

  it('two status changes to the same state far apart stay two rows', () => {
    const out = mergeActivity([
      fromTransition({ transition_id: 1, created_at: '2026-03-01T10:00:00Z', to_status: 'in_stock' }),
      fromTransition({ transition_id: 2, created_at: '2026-05-01T10:00:00Z', to_status: 'in_stock' }),
    ]);
    assert.equal(out.length, 2);
  });

  it('a pickup ticket and its return challan merge, keeping both references', () => {
    const rows = [
      ...fromSupport({ item_id: 1, ticket_id: 3555, ticket_category: 'pickup', complaint_type: 'pickup', created_at: '2026-09-26T04:31:32Z', return_dc_number: 'RDC002357', customer_name: 'Rhophi' }),
      ...fromDcLine({ id: 9, dc_number: 'RDC002357', movement_type: 'return', status: 'delivered', created_at: '2026-09-26T04:31:32Z', delivered_at: '2026-09-28T11:46:27Z' }),
    ];
    const out = mergeActivity(rows);
    const raised = out.find((r) => r.milestone === 'return_pickup');
    const refs = [raised.ref, ...(raised.also || []).map((a) => a.ref)];
    assert.ok(refs.includes('RDC002357'));
    assert.ok(refs.includes('Ticket #3555'));
    assert.equal(out.filter((r) => r.milestone === 'return_pickup').length, 1);
    // each reference keeps its own id
    const all = [raised, ...(raised.also || [])];
    assert.equal(all.find((x) => x.ref === 'RDC002357').ref_id ?? null, null);
    assert.equal(all.find((x) => x.ref === 'Ticket #3555').ref_id, 3555);
  });

  it('rows the concurrency unit test wrote are recognised as noise', () => {
    assert.equal(isTestNoise({ reason: 'concurrency test: first writer' }), true);
    assert.equal(isTestNoise({ reason: 'setup' }), true);
    assert.equal(isTestNoise({ reason: 'setup', actor_user_id: 4 }), false);
    assert.equal(isTestNoise({ reason: 'Attached to SO/26-27/1322' }), false);
  });

  it('ERP canonicalisation is not a milestone', () => {
    const r = fromTransition({ transition_id: 1, created_at: T('22:49:08'), from_status: 'out_stock', to_status: 'rented', reason: 'canonicalisation' });
    assert.equal(r.milestone, null);
    assert.equal(r.minor, true);
  });
});

describe('floor milestones', () => {
  const h = (o) => ({ id: 1, ticket_id: 4833, created_at: T('10:00:00'), ...o });
  it('reads who passed diagnosis, QC2, dispatch QC and received into stock', () => {
    assert.equal(classifyFloor(h({ source: 'submitDiagnosis', action: 'Diagnosis Completed', previous_stage: 'Diagnosis', current_stage: 'Assembly & Software' })), 'diagnosis_passed');
    assert.equal(classifyFloor(h({ source: 'submitDiagnosis', action: 'Sent to Chip Level Repair', previous_stage: 'Diagnosis', current_stage: 'Chip Level Repair' })), 'diagnosis_passed');
    assert.equal(classifyFloor(h({ source: 'markDiagnosisFailed', action: 'Diagnosis Failed', previous_stage: 'Diagnosis', current_stage: 'Diagnosis' })), null);
    assert.equal(classifyFloor(h({ source: 'submitQC', action: 'Stage Changed: QC2 → Pending Inventory', previous_stage: 'QC2', current_stage: 'Pending Inventory' })), 'qc2_passed');
    assert.equal(classifyFloor(h({ source: 'submitQC', action: 'QC1 Passed', previous_stage: 'QC1', current_stage: 'QC2' })), null);
    assert.equal(classifyFloor(h({ source: 'pendingInventoryReceive', action: 'Received into Inventory', previous_stage: 'Pending Inventory', current_stage: 'Inventory' })), 'into_stock');
    // dispatch QC tickets record their pass as "QC2 Passed"
    assert.equal(classifyFloor(h({ source: 'submitQC', action: 'QC2 Passed', previous_stage: 'Dispatch QC', current_stage: 'Inventory', ticket_type: 'sales_order_qc' })), 'dispatch_qc_passed');
    assert.equal(classifyFloor(h({ source: 'submitQC', action: 'QC2 Passed', previous_stage: 'Inventory', current_stage: 'Inventory', ticket_type: 'sales_order_qc' })), 'dispatch_qc_passed');
    assert.equal(classifyFloor(h({ source: 'dispatch_qc_fail', action: 'Dispatch QC Failed', previous_stage: 'Dispatch QC', current_stage: 'Diagnosis' })), 'dispatch_qc_failed');
  });

  it('the floor row carries the person who did it', () => {
    const r = fromFloor(h({ source: 'submitDiagnosis', action: 'Diagnosis Completed', previous_stage: 'Diagnosis', current_stage: 'Assembly & Software', performed_by: 50, performed_by_name: 'System' }));
    assert.equal(r.by_id, 50);
    assert.equal(r.by_name, null); // "System" is not a person
    assert.equal(r.ref_kind, 'floor_ticket');
  });
});

describe('milestones', () => {
  it('one milestone recorded twice within hours collapses to the better-sourced row, and keeps a person', () => {
    const activity = mergeActivity([
      { ...fromFloor({ id: 1, ticket_id: 1, created_at: T('10:33:31'), source: 'submitQC', action: 'Stage Changed: QC2 → Pending Inventory', previous_stage: 'QC2', current_stage: 'Pending Inventory', performed_by: 29 }), by: 'Jitendar' },
      { ...fromAudit({ log_id: 2, created_at: T('11:42:30'), event_type: 'qc2_passed', description: 'QC2 passed — ready for inventory', actor_user_id: 4 }), by: 'Omprakash' },
      { ...fromAudit({ log_id: 3, created_at: T('14:00:00'), event_type: 'stage_changed', description: 'x' }), by: null },
    ]);
    const ms = deriveMilestones(activity);
    const qc2 = ms.filter((m) => m.key === 'qc2_passed');
    assert.equal(qc2.length, 1);
    assert.equal(qc2[0].by, 'Jitendar');
    assert.equal(qc2[0].source, 'floor');
    assert.equal(activity[qc2[0].activity_index].id, qc2[0].activity_id);
  });

  it('the same milestone on different days is shown each time (a laptop goes round again)', () => {
    const activity = mergeActivity([
      { ...fromFloor({ id: 1, ticket_id: 1, created_at: '2026-03-01T10:00:00Z', source: 'submitDiagnosis', action: 'Diagnosis Completed', previous_stage: 'Diagnosis', current_stage: 'Assembly & Software' }), by: 'A' },
      { ...fromFloor({ id: 2, ticket_id: 2, created_at: '2026-06-01T10:00:00Z', source: 'submitDiagnosis', action: 'Diagnosis Completed', previous_stage: 'Diagnosis', current_stage: 'Assembly & Software' }), by: 'B' },
    ]);
    assert.deepEqual(deriveMilestones(activity).map((m) => m.by), ['A', 'B']);
  });

  it('milestones are in activity order', () => {
    const activity = mergeActivity([
      fromTransition({ transition_id: 3, created_at: T('13:13:31'), to_status: 'in_transit', dc_number: 'DC1' }),
      fromTransition({ transition_id: 1, created_at: T('11:43:13'), to_status: 'reserved' }),
      fromTransition({ transition_id: 2, created_at: T('12:12:19'), to_status: 'dispatch_ready', dc_number: 'DC1' }),
    ]);
    assert.deepEqual(deriveMilestones(activity).map((m) => m.key), ['so_attached', 'dc_attached', 'dispatched']);
  });
});

describe('rental periods', () => {
  const deployments = [
    { dc_number: 'DC-1', deal: 'rental', customer_id: 63, customer_name: 'Pettle', delivered_at: '2026-02-06T12:43:00Z', rate: null },
    { dc_number: 'DC-2', deal: 'rental', customer_id: 48, customer_name: 'Pibit', delivered_at: '2026-04-09T06:12:00Z', rate: 5474 },
    { dc_number: 'DC-3', deal: 'rental', customer_id: 106, customer_name: 'Rhophi', delivered_at: '2026-05-22T00:00:00Z', rate: 5499 },
    { dc_number: 'DC-4', deal: 'rental', customer_id: 106, customer_name: 'Rhophi', delivered_at: '2026-10-01T11:50:02Z', rate: 5499 },
  ];
  const returns = [
    { dc_number: 'RDC-1', original_dc_number: 'DC-3', customer_id: 63, created_at: '2026-03-12T11:28:40Z', received_at: '2026-03-19T15:33:45Z' },
    { dc_number: 'RDC-2', original_dc_number: null, customer_id: 48, created_at: '2026-04-21T17:25:42Z', received_at: '2026-04-29T16:24:02Z' },
    { dc_number: 'RDC-3', original_dc_number: 'DC-3', customer_id: 106, created_at: '2026-09-26T04:31:32Z', received_at: '2026-09-28T11:46:27Z' },
  ];
  const invoiceLines = [
    { line_id: 1, customer_id: 106, rent_start: '2026-07-01', rent_end: '2026-07-31', amount: 5499, monthly_rate: 5499 },
    { line_id: 2, customer_id: 106, rent_start: '2026-08-01', rent_end: '2026-08-31', amount: 5499, monthly_rate: 5499 },
    { line_id: 3, customer_id: 106, rent_start: '2026-09-01', rent_end: '2026-09-30', amount: 5499, monthly_rate: 5499, cancelled: true },
    { line_id: 4, customer_id: 999, rent_start: '2026-09-01', rent_end: '2026-09-30', amount: 100 },
  ];
  const out = buildRentals({ deployments, returns, invoiceLines, current: { status: 'rented', dc_number: 'DC-4', rate: 5499 }, today: '2026-10-02' });

  it('pairs each delivery with the return that ended it (a return named for a later challan is not taken early)', () => {
    assert.deepEqual(out.rows.map((r) => r.return_dc_number), ['RDC-1', 'RDC-2', 'RDC-3', null]);
    assert.equal(out.rows[0].returned_on, '2026-03-19');
    assert.equal(out.rows[0].days, 42);
    assert.equal(out.rows[3].ongoing, true);
    assert.equal(out.rows[3].days, 2);
  });

  it('puts invoiced rent in the period it covers, skipping cancelled lines; others are left unassigned', () => {
    assert.equal(out.rows[2].invoiced, 10998);
    assert.equal(out.rows[2].invoice_lines, 2);
    assert.equal(out.unassigned_invoiced, 100);
  });

  it('rent at rate is rate × days / 30, and needs a rate', () => {
    assert.equal(out.rows[1].rent_at_rate, Math.round(((5474 * 21) / 30) * 100) / 100);
    assert.equal(out.rows[0].rent_at_rate, null);
  });

  it('a sale is not a rental period', () => {
    const s = buildRentals({ deployments: [{ dc_number: 'DC-9', deal: 'sale', delivered_at: '2026-06-19T07:24:00Z', rate: 29000 }], today: '2026-10-01' });
    assert.equal(s.rows[0].kind, 'sale');
    assert.equal(s.rows[0].sale_amount, 29000);
    assert.equal(s.rows[0].days, null);
  });

  it('with no return and a later delivery, the period ends at the next delivery', () => {
    const r = buildRentals({
      deployments: [
        { dc_number: 'A', deal: 'rental', delivered_at: '2026-02-06T12:00:00Z', rate: 1800 },
        { dc_number: 'B', deal: 'rental', delivered_at: '2026-06-19T07:00:00Z', rate: 1800 },
      ],
      current: { status: 'in_stock' },
      today: '2026-10-01',
    });
    assert.equal(r.rows[0].end_basis, 'next_deployment');
    assert.equal(r.rows[1].end_basis, 'unknown');
    assert.equal(r.rows[1].days, null);
  });
});

describe('money', () => {
  it('paid fraction: paid → 1, part-paid → share, unpaid → 0', () => {
    assert.equal(invoicePaidFraction({ status: 'paid' }), 1);
    assert.equal(invoicePaidFraction({ grand_total: 1000, amount_paid: 250 }), 0.25);
    assert.equal(invoicePaidFraction({ grand_total: 1000, amount_paid: 0 }), 0);
    assert.equal(invoicePaidFraction({ grand_total: 1000, amount_paid: 5000 }), 1);
  });

  it('credit notes: this laptop\'s own line, else the whole note when it names only this laptop', () => {
    const c = creditForLaptop([
      { credit_note_id: 1, amount: 900, line_items: [{ serial_id: 7, amount: 300 }, { serial_id: 8, amount: 600 }] },
      { credit_note_id: 2, amount: 50, ttspl_ids: ['TTSPL1'], line_items: [] },
      { credit_note_id: 3, amount: 100, ttspl_ids: ['TTSPL1', 'TTSPL2'], line_items: [] },
    ], { serialId: 7, ttspl: 'TTSPL1' });
    assert.equal(c.amount, 300 + 50 + 50);
    assert.equal(c.estimated, true);
    assert.equal(c.notes.length, 3);
  });

  it('owned laptop: net = invoiced − credit + sale − purchase − parts + credits, on invoiced when no payment is recorded', () => {
    const m = computeMoney({
      ownership: 'owned', purchase: { amount: 25423.73, source: 'po_line' }, parts: 3500, credits: 500,
      invoiceLines: [{ amount: 1999 }, { amount: 1999, draft: true }, { amount: 999, cancelled: true }],
      credit: { amount: 100 }, saleValue: null,
    });
    assert.equal(m.rent_invoiced, 3998);
    assert.equal(m.rent_invoiced_draft, 1999);
    assert.equal(m.rent_invoiced_net, 3898);
    assert.equal(m.invested, 25423.73 + 3500 - 500);
    assert.equal(m.net_basis, 'invoiced');
    assert.equal(m.net, Math.round((3898 - (25423.73 + 3000)) * 100) / 100);
    assert.equal(m.vendor_rent_paid, null);
  });

  it('received rent is allocated by the invoice\'s paid share and flagged estimated when part-paid', () => {
    const m = computeMoney({ ownership: 'owned', purchase: { amount: 1000 }, invoiceLines: [{ amount: 600, paid_fraction: 1 }, { amount: 400, paid_fraction: 0.5 }] });
    assert.equal(m.rent_received, 800);
    assert.equal(m.received_is_estimated, true);
    assert.equal(m.net_basis, 'received');
    assert.equal(m.net, 800 - 1000);
  });

  it('vendor-rented laptop: no purchase value, vendor rent paid counts as invested', () => {
    const m = computeMoney({
      ownership: 'vendor_rented', purchase: null, purchaseEquivalent: { amount: 50000 }, parts: 0,
      invoiceLines: [{ amount: 5499 }], vendorRent: { amount: 3500, basis: 'accrued' },
    });
    assert.equal(m.purchase_value, 0);
    assert.equal(m.purchase_equivalent.amount, 50000);
    assert.equal(m.vendor_rent_paid, 3500);
    assert.equal(m.net, 1999);
  });

  it('sold laptop: sale value counts', () => {
    const m = computeMoney({ ownership: 'owned', purchase: { amount: 20000 }, saleValue: 29000 });
    assert.equal(m.net, 9000);
  });

  it('vendor rent: exact bill lines, then accrued after the last billed day', () => {
    const calls = [];
    const accrue = (a) => { calls.push(a); return { amount: 1000, days: 10 }; };
    const r = vendorRentPaid({
      billLines: [{ amount: 3500, rent_end: '2026-08-31' }, { amount: 99, rent_end: '2026-09-30', cancelled: true }],
      monthlyRate: 3500, start: new Date(2026, 6, 1), end: new Date(2026, 8, 10), accrue,
    });
    assert.equal(r.billed, 3500);
    assert.equal(r.amount, 4500);
    assert.equal(r.basis, 'vendor_bills_plus_accrued');
    assert.equal(calls[0].start.getDate(), 1); // 1 Sep, the day after the last billed day
    assert.equal(calls[0].start.getMonth(), 8);
    const none = vendorRentPaid({ billLines: [], monthlyRate: 3000, start: new Date(2026, 8, 1), end: new Date(2026, 8, 30) });
    assert.equal(none.basis, 'accrued');
    assert.equal(none.amount, 3000);
  });

  it('attachment lists accept paths, JSON strings and objects', () => {
    assert.deepEqual(parseFiles('["/uploads/a.pdf"]').map((f) => f.path), ['/uploads/a.pdf']);
    assert.deepEqual(parseFiles([{ path: '/x.jpg', name: 'bill' }]), [{ path: '/x.jpg', name: 'bill' }]);
    assert.deepEqual(parseFiles(null), []);
    assert.deepEqual(parseFiles('/uploads/one.pdf').map((f) => f.name), ['one.pdf']);
  });
});
