/**
 * Customer money (Builder 1 — claude/carret-remaining-build.md MD1-MD4).
 *
 * Real services and handlers end to end inside one transaction that is rolled
 * back (test/helpers/rollbackHarness), so no invoice, credit-note number or
 * payment is left behind. Needs migration 363.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';
require('../services/outboundMessagingGuard');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/rollbackHarness');

const MAKER = { user_id: 2, role: 'admin', name: 'Maker' };
const CHECKER = { user_id: 3, role: 'manager', name: 'Checker' };
const FULL = ['sales', 'rental', 'both'];

let db;
let seq = 0;

async function customer({ type = 'rental', state = 'Haryana' } = {}) {
  seq += 1;
  const r = await db.query(
    `INSERT INTO customers (name, company_name, customer_type, billing_state, email)
     VALUES ($1, $1, $2, $3, 'money-test@example.invalid') RETURNING customer_id`,
    [`Money test ${Date.now()}-${seq}`, type, state]
  );
  return r.rows[0].customer_id;
}

async function invoice(customerId, {
  status = 'sent', subtotal = 1000, month = 1, year = 2031, lines = [], credit = 0,
} = {}) {
  seq += 1;
  const gst = Math.round(subtotal * 18) / 100;
  const r = await db.query(
    `INSERT INTO customer_invoices
       (invoice_number, customer_id, invoice_month, invoice_year, invoice_date, from_date, to_date,
        line_items, subtotal, gst_percent, gst_amount, credit_note_adjustment, grand_total, status)
     VALUES ($1,$2,$3,$4,'2031-01-01','2031-01-01','2031-01-31',$5::jsonb,$6,18,$7,$8,$9,$10)
     RETURNING *`,
    [`TEST-INV-${Date.now()}-${seq}`, customerId, month, year, JSON.stringify(lines),
      subtotal, gst, credit, Math.max(0, subtotal + gst - credit), status]
  );
  return r.rows[0];
}

async function creditNote(customerId, { status = 'pending', amount = 100, createdBy = MAKER.user_id, invoiceId = null } = {}) {
  seq += 1;
  const r = await db.query(
    `INSERT INTO customer_credit_notes
       (credit_note_number, customer_id, invoice_id, reason, amount, status, created_by, credit_note_type)
     VALUES ($1,$2,$3,'test',$4,$5,$6,'return') RETURNING *`,
    [`TEST-CN-${Date.now()}-${seq}`, customerId, invoiceId, amount, status, createdBy]
  );
  return r.rows[0];
}

const invRow = async (id) => (await db.query('SELECT * FROM customer_invoices WHERE invoice_id = $1', [id])).rows[0];
const cnRow = async (id) => (await db.query('SELECT * FROM customer_credit_notes WHERE credit_note_id = $1', [id])).rows[0];

before(async () => { db = await H.open(); });
after(async () => { await H.close(); });

describe('MD1 — recording a payment', () => {
  const ledger = () => require('../services/paymentLedgerService');

  it('posts a part payment and moves the invoice to partially_paid', async () => {
    const c = await customer();
    const inv = await invoice(c, { subtotal: 1000 }); // 1180.00
    const out = await ledger().recordPayment(require('../config/db'), {
      partyType: 'customer', invoiceId: inv.invoice_id, amount: 180, recordedBy: 1,
    });
    assert.equal(out.status, 'partially_paid');
    assert.equal(out.outstanding, 1000);
    assert.equal(Number((await invRow(inv.invoice_id)).amount_paid), 180);
  });

  it('refuses more than is outstanding', async () => {
    const c = await customer();
    const inv = await invoice(c, { subtotal: 1000 });
    await assert.rejects(
      () => ledger().recordPayment(require('../config/db'), { partyType: 'customer', invoiceId: inv.invoice_id, amount: 1180.01 }),
      (e) => e.status === 409 && /more than the Rs 1180.00 outstanding/.test(e.message)
    );
  });

  it('refuses a cancelled invoice and a draft invoice', async () => {
    const c = await customer();
    const cancelled = await invoice(c, { status: 'cancelled', month: 2 });
    const draft = await invoice(c, { status: 'draft', month: 3 });
    await assert.rejects(
      () => ledger().recordPayment(require('../config/db'), { partyType: 'customer', invoiceId: cancelled.invoice_id, amount: 10 }),
      (e) => e.status === 409 && /cancelled/.test(e.message)
    );
    await assert.rejects(
      () => ledger().recordPayment(require('../config/db'), { partyType: 'customer', invoiceId: draft.invoice_id, amount: 10 }),
      (e) => e.status === 409 && /draft/.test(e.message)
    );
  });

  it('refuses zero, negative and future-dated payments', async () => {
    const c = await customer();
    const inv = await invoice(c);
    for (const amount of [0, -5, 'abc']) {
      await assert.rejects(() => ledger().recordPayment(require('../config/db'), {
        partyType: 'customer', invoiceId: inv.invoice_id, amount,
      }), /greater than zero/);
    }
    await assert.rejects(() => ledger().recordPayment(require('../config/db'), {
      partyType: 'customer', invoiceId: inv.invoice_id, amount: 10, paymentDate: '2999-01-01',
    }), /future/);
  });

  it('the same idempotency key posts once (double click)', async () => {
    const c = await customer();
    const inv = await invoice(c);
    const args = { partyType: 'customer', invoiceId: inv.invoice_id, amount: 100, idempotencyKey: `k-${Date.now()}` };
    const first = await ledger().recordPayment(require('../config/db'), args);
    const second = await ledger().recordPayment(require('../config/db'), args);
    assert.equal(second.duplicate, true);
    assert.equal(second.payment.payment_id, first.payment.payment_id);
    const n = await db.query('SELECT COUNT(*)::int AS n FROM payment_records WHERE invoice_id = $1', [inv.invoice_id]);
    assert.equal(n.rows[0].n, 1);
  });

  it('"mark paid" twice posts one full payment, not two', async () => {
    const c = await customer();
    const inv = await invoice(c, { subtotal: 500 }); // 590
    const pool = require('../config/db');
    const a = await ledger().recordFullPayment(pool, { partyType: 'customer', invoiceId: inv.invoice_id, recordedBy: 1 });
    const b = await ledger().recordFullPayment(pool, { partyType: 'customer', invoiceId: inv.invoice_id, recordedBy: 1 });
    assert.equal(Number(a.payment.amount), 590);
    assert.equal(b.skipped, true);
    const sum = await db.query('SELECT SUM(amount)::numeric AS s FROM payment_records WHERE invoice_id = $1', [inv.invoice_id]);
    assert.equal(Number(sum.rows[0].s), 590);
    assert.equal((await invRow(inv.invoice_id)).status, 'paid');
  });

  it('mark paid after a part payment pays only the rest', async () => {
    const c = await customer();
    const inv = await invoice(c, { subtotal: 1000 }); // 1180
    const pool = require('../config/db');
    await ledger().recordPayment(pool, { partyType: 'customer', invoiceId: inv.invoice_id, amount: 1000 });
    const rest = await ledger().recordFullPayment(pool, { partyType: 'customer', invoiceId: inv.invoice_id });
    assert.equal(Number(rest.payment.amount), 180);
  });

  it('part-paying an overdue invoice keeps it overdue', () => {
    assert.equal(ledger().deriveCustomerStatus(100, 1000, 'overdue'), 'overdue');
    assert.equal(ledger().deriveCustomerStatus(100, 1000, 'sent'), 'partially_paid');
  });

  it('the payment handler answers 409 with the reason, and lists payments received', async () => {
    const ctrl = require('../controllers/customerBillingController');
    const c = await customer();
    const inv = await invoice(c);
    const over = await H.call(ctrl.recordInvoicePayment, {
      params: { id: String(inv.invoice_id) }, body: { amount: 99999 }, user: CHECKER,
    });
    assert.equal(over.code, 409);
    const ok = await H.call(ctrl.recordInvoicePayment, {
      params: { id: String(inv.invoice_id) }, body: { amount: 50, method: 'neft', reference: 'UTR-TEST' }, user: CHECKER,
    });
    assert.equal(ok.code, 201);
    const list = await H.call(ctrl.listCustomerPayments, { query: { search: 'UTR-TEST' }, user: CHECKER });
    assert.equal(list.code, 200);
    assert.ok(list.body.payments.some((p) => p.invoice_id === inv.invoice_id));
    const ev = await db.query(
      `SELECT event_type FROM events WHERE entity_id = $1 AND event_type = 'invoice_payment_recorded'`,
      [String(inv.invoice_id)]
    );
    assert.equal(ev.rows.length, 1);
  });
});

describe('MD4 — cancelling an invoice', () => {
  const { cancelInvoice } = require('../services/invoiceLifecycleService');

  it('refuses when a payment exists on the ledger, even if amount_paid says 0', async () => {
    const c = await customer();
    const inv = await invoice(c);
    await db.query(
      `INSERT INTO payment_records (party_type, customer_id, invoice_id, amount, payment_date)
       VALUES ('customer', $1, $2, 10, CURRENT_DATE)`,
      [c, inv.invoice_id]
    );
    await assert.rejects(
      () => cancelInvoice(require('../config/db'), { invoiceId: inv.invoice_id, reason: 'raised in error', actor: MAKER }),
      /credit note instead/
    );
  });

  it('releases applied credit notes, held security deposits and the rent watermark', async () => {
    const c = await customer();
    const serial = (await db.query('SELECT serial_id FROM vendor_serial_numbers WHERE deleted_at IS NULL ORDER BY serial_id LIMIT 1')).rows[0].serial_id;
    await db.query(
      `UPDATE vendor_serial_numbers SET current_customer_id = $1, rent_start_date = '2030-06-10', rent_billed_until = '2031-01-31'
        WHERE serial_id = $2`,
      [c, serial]
    );
    const inv = await invoice(c, {
      status: 'sent',
      credit: 100,
      lines: [
        { serial_id: serial, rent_start: '2031-01-01', rent_end: '2031-01-31', amount: 1000 },
        { serial_id: serial, line_type: 'security', is_security: true, rent_start: '2031-01-05', amount: 999 },
      ],
    });
    const cn = await creditNote(c, { status: 'applied', amount: 100 });
    await db.query('UPDATE customer_credit_notes SET applied_in_invoice_id = $1, invoice_id = $1 WHERE credit_note_id = $2', [inv.invoice_id, cn.credit_note_id]);
    await db.query(
      `INSERT INTO customer_security_deposits (customer_id, amount, received_date, status, invoice_id, serial_id)
       VALUES ($1, 999, '2031-01-05', 'held', $2, $3)`,
      [c, inv.invoice_id, serial]
    );

    const out = await cancelInvoice(require('../config/db'), { invoiceId: inv.invoice_id, reason: 'wrong customer billed', actor: MAKER });
    assert.equal(out.status, 'cancelled');
    const note = await cnRow(cn.credit_note_id);
    assert.equal(note.status, 'approved');
    assert.equal(note.applied_in_invoice_id, null);
    const dep = await db.query('SELECT COUNT(*)::int AS n FROM customer_security_deposits WHERE invoice_id = $1', [inv.invoice_id]);
    assert.equal(dep.rows[0].n, 0);
    const wm = await db.query(`SELECT rent_billed_until::text AS d FROM vendor_serial_numbers WHERE serial_id = $1`, [serial]);
    assert.equal(wm.rows[0].d, '2030-12-31');
    await assert.rejects(
      () => cancelInvoice(require('../config/db'), { invoiceId: inv.invoice_id, reason: 'again please', actor: MAKER }),
      /already cancelled/
    );
  });
});

describe('MD2 — credit notes', () => {
  const svc = () => require('../services/creditNoteService');
  const sched = () => require('../services/billingSchedulerService');

  it('a manual note takes the CN/yy-yy/NNNN series inside the transaction', async () => {
    const c = await customer();
    const inv = await invoice(c, { subtotal: 1000 });
    const cn = await svc().createManualCreditNote(require('../config/db'), {
      customer_id: c, invoice_id: inv.invoice_id, reason: 'rate correction', amount: 200,
    }, { actor: MAKER });
    assert.match(cn.credit_note_number, /^CN\/\d{2}-\d{2}\/\d{4,}$/);
    assert.equal(cn.status, 'pending');
    assert.equal(cn.credit_note_type, 'manual');
    assert.equal(cn.created_by, MAKER.user_id);
  });

  it('the scheduler and the manual path share one series', async () => {
    const a = await sched().nextCreditNoteNumber(null);
    const b = await sched().nextCreditNoteNumber(null);
    const n = (s) => Number(s.split('/')[2]);
    assert.equal(a.split('/')[1], b.split('/')[1]);
    assert.equal(n(b), n(a) + 1);
  });

  it('refuses Rs 0, more than the invoice has left, another customer\'s invoice, a draft', async () => {
    const pool = require('../config/db');
    const c = await customer();
    const other = await customer();
    const inv = await invoice(c, { subtotal: 1000 }); // 1180
    const draft = await invoice(c, { status: 'draft', month: 5 });
    await assert.rejects(() => svc().createManualCreditNote(pool, { customer_id: c, invoice_id: inv.invoice_id, reason: 'x y z', amount: 0 }), /more than Rs 0/);
    await assert.rejects(() => svc().createManualCreditNote(pool, { customer_id: c, invoice_id: inv.invoice_id, reason: 'x y z', amount: 1180.5 }), /left to credit/);
    await assert.rejects(() => svc().createManualCreditNote(pool, { customer_id: other, invoice_id: inv.invoice_id, reason: 'x y z', amount: 10 }), /different customer/);
    await assert.rejects(() => svc().createManualCreditNote(pool, { customer_id: c, invoice_id: draft.invoice_id, reason: 'x y z', amount: 10 }), /draft/);
    await assert.rejects(() => svc().createManualCreditNote(pool, { customer_id: c, reason: 'x y z', amount: 10 }), /reference its invoice/);
    // A second note only fits in what the first left.
    await svc().createManualCreditNote(pool, { customer_id: c, invoice_id: inv.invoice_id, reason: 'first', amount: 1000 }, { actor: MAKER });
    await assert.rejects(() => svc().createManualCreditNote(pool, { customer_id: c, invoice_id: inv.invoice_id, reason: 'second', amount: 200 }), /Rs 180.00/);
  });

  it('the maker cannot approve; a different user can, and it lands on the draft', async () => {
    const c = await customer();
    const draft = await invoice(c, { status: 'draft', subtotal: 1000 }); // 1180
    const cn = await creditNote(c, { amount: 300, createdBy: MAKER.user_id });
    const own = await sched().approveAndApplyCreditNote(cn.credit_note_id, MAKER.user_id);
    assert.equal(own.ok, false);
    assert.equal(own.status, 403);
    const ok = await sched().approveAndApplyCreditNote(cn.credit_note_id, CHECKER.user_id);
    assert.equal(ok.ok, true);
    assert.equal(ok.applied, true);
    const after = await invRow(draft.invoice_id);
    assert.equal(Number(after.credit_note_adjustment), 300);
    assert.equal(Number(after.grand_total), 880);
    assert.ok((await cnRow(cn.credit_note_id)).approved_at);
  });

  it('a note larger than the draft stays approved for the next invoice instead of being lost', async () => {
    const c = await customer();
    const draft = await invoice(c, { status: 'draft', subtotal: 100 }); // 118
    const cn = await creditNote(c, { amount: 500 });
    const ok = await sched().approveAndApplyCreditNote(cn.credit_note_id, CHECKER.user_id);
    assert.equal(ok.ok, true);
    assert.equal(ok.applied, false);
    assert.equal((await cnRow(cn.credit_note_id)).status, 'approved');
    assert.equal(Number((await invRow(draft.invoice_id)).grand_total), 118);
  });

  it('approving Rs 0 is refused', async () => {
    const c = await customer();
    const cn = await creditNote(c, { amount: 0 });
    const r = await sched().approveAndApplyCreditNote(cn.credit_note_id, CHECKER.user_id);
    assert.equal(r.ok, false);
    assert.match(r.reason, /Rs 0/);
  });

  it('cancel takes a note off its draft and recomputes it; a note on an issued invoice stays', async () => {
    const pool = require('../config/db');
    const c = await customer();
    const draft = await invoice(c, { status: 'draft', subtotal: 1000 });
    const cn = await creditNote(c, { amount: 200 });
    await sched().approveAndApplyCreditNote(cn.credit_note_id, CHECKER.user_id);
    assert.equal(Number((await invRow(draft.invoice_id)).grand_total), 980);
    const out = await svc().cancelCreditNote(pool, { creditNoteId: cn.credit_note_id, reason: 'approved by mistake', actor: CHECKER });
    assert.equal(out.status, 'cancelled');
    assert.equal(Number((await invRow(draft.invoice_id)).grand_total), 1180);

    const sent = await invoice(c, { status: 'sent', month: 7 });
    const onSent = await creditNote(c, { status: 'applied', amount: 50 });
    await db.query('UPDATE customer_credit_notes SET applied_in_invoice_id = $1 WHERE credit_note_id = $2', [sent.invoice_id, onSent.credit_note_id]);
    await assert.rejects(() => svc().cancelCreditNote(pool, { creditNoteId: onSent.credit_note_id, reason: 'try withdrawing', actor: CHECKER }), /issued invoice/);
    await assert.rejects(() => svc().cancelCreditNote(pool, { creditNoteId: onSent.credit_note_id, reason: '', actor: CHECKER }), /reason is required/);
  });
});

describe('every generate path finishes the invoice (GST split, due date, credits, event)', () => {
  it('finaliseGeneratedInvoice classifies GST, stamps the due date and applies approved credit', async () => {
    const { finaliseGeneratedInvoice } = require('../services/billingSchedulerService');
    const c = await customer({ state: 'Karnataka' });
    const draft = await invoice(c, { status: 'draft', subtotal: 1000 });
    await db.query('UPDATE customer_invoices SET due_date = NULL WHERE invoice_id = $1', [draft.invoice_id]);
    const cn = await creditNote(c, { status: 'approved', amount: 100 });
    const out = await finaliseGeneratedInvoice(draft.invoice_id, { actor: MAKER, created: true, source: 'test' });
    assert.equal(out.credit_notes_applied, 1);
    const row = await invRow(draft.invoice_id);
    assert.equal(row.is_intra_state, false);
    assert.equal(Number(row.igst_amount), 180);
    assert.ok(row.due_date);
    assert.equal((await cnRow(cn.credit_note_id)).status, 'applied');
    const ev = await db.query(`SELECT 1 FROM events WHERE entity_id = $1 AND event_type = 'invoice_generated'`, [String(draft.invoice_id)]);
    assert.equal(ev.rows.length, 1);
  });

  it('the single Generate button no longer finishes invoices on its own', () => {
    const fs = require('fs');
    const ctrl = fs.readFileSync(`${__dirname}/../controllers/customerBillingController.js`, 'utf8');
    assert.ok(!/await finaliseGeneratedInvoice\(result\.invoice_id, req\)/.test(ctrl));
    const svc = fs.readFileSync(`${__dirname}/../services/billingSchedulerService.js`, 'utf8');
    assert.match(svc, /async function generateCustomerInvoice\([^)]*\) \{\n\s+const result = await generateCustomerInvoiceCore/);
  });
});

describe('MD3 — security deposits', () => {
  it('the standalone refund route is closed', async () => {
    const ctrl = require('../controllers/customerBillingController');
    const r = await H.call(ctrl.refundSecurityDeposit, { params: { id: '1' }, body: { refund_amount: 10 }, user: CHECKER });
    assert.equal(r.code, 410);
    assert.match(r.body.message, /account is closed/);
  });

  it('recording a deposit refuses Rs 0 and a repeated idempotency key posts once', async () => {
    const ctrl = require('../controllers/customerBillingController');
    const c = await customer();
    const zero = await H.call(ctrl.recordSecurityDeposit, { body: { customer_id: c, amount: 0, received_date: '2026-09-01' }, user: CHECKER });
    assert.equal(zero.code, 400);
    const key = `dep-${Date.now()}`;
    const body = { customer_id: c, amount: 1999, received_date: '2026-09-01', idempotency_key: key };
    const a = await H.call(ctrl.recordSecurityDeposit, { body, user: CHECKER });
    const b = await H.call(ctrl.recordSecurityDeposit, { body, user: CHECKER });
    assert.equal(a.code, 201);
    assert.equal(b.body.duplicate, true);
    assert.equal(b.body.deposit.deposit_id, a.body.deposit.deposit_id);
  });

  it('closing an account that owes more than the deposit refunds Rs 0 and leaves it held', async () => {
    const { closeAccount } = require('../services/customerOverviewService');
    const c = await customer();
    await invoice(c, { status: 'sent', subtotal: 5000 }); // owes 5900
    const dep = await db.query(
      `INSERT INTO customer_security_deposits (customer_id, amount, received_date, status)
       VALUES ($1, 1000, '2026-01-01', 'held') RETURNING deposit_id`,
      [c]
    );
    const out = await closeAccount(db, c, { note: 'contract ended', user: CHECKER });
    assert.equal(out.refundable, 0);
    const row = (await db.query('SELECT * FROM customer_security_deposits WHERE deposit_id = $1', [dep.rows[0].deposit_id])).rows[0];
    assert.equal(row.status, 'held');
    assert.equal(Number(row.refund_amount || 0), 0);
    assert.equal(row.refund_date, null);
    assert.match(row.notes, /kept against dues/);
  });

  it('closing with nothing owed refunds the deposit in full', async () => {
    const { closeAccount } = require('../services/customerOverviewService');
    const c = await customer();
    const dep = await db.query(
      `INSERT INTO customer_security_deposits (customer_id, amount, received_date, status)
       VALUES ($1, 1000, '2026-01-01', 'held') RETURNING deposit_id`,
      [c]
    );
    await closeAccount(db, c, { note: 'contract ended', refundReference: 'NEFT-1', user: CHECKER });
    const row = (await db.query('SELECT * FROM customer_security_deposits WHERE deposit_id = $1', [dep.rows[0].deposit_id])).rows[0];
    assert.equal(row.status, 'refunded');
    assert.equal(Number(row.refund_amount), 1000);
  });

  it('a security_deposit payment on a sales order creates the deposit row', async () => {
    const ctrl = require('../controllers/salesManagementController');
    const so = (await db.query(
      `SELECT sales_order_number, customer_id FROM sales_order_lines WHERE customer_id IS NOT NULL ORDER BY id DESC LIMIT 1`
    )).rows[0];
    if (!so) return;
    const r = await H.call(ctrl.recordPayment, {
      params: { soNumber: so.sales_order_number },
      body: { amount: 2500, payment_type: 'security_deposit', reference_number: 'SEC-TEST' },
      user: { ...CHECKER },
    });
    assert.equal(r.code, 201);
    const dep = await db.query('SELECT * FROM customer_security_deposits WHERE so_payment_id = $1', [r.body.payment_id]);
    assert.equal(dep.rows.length, 1);
    assert.equal(Number(dep.rows[0].amount), 2500);
    assert.equal(dep.rows[0].status, 'held');
    assert.equal(dep.rows[0].customer_id, so.customer_id);
  });
});

describe('Customer Access scope on /api/customer-billing', () => {
  it('a sales-only user cannot open a rental customer\'s invoice, and lists exclude it', async () => {
    const ctrl = require('../controllers/customerBillingController');
    const c = await customer({ type: 'rental' });
    const inv = await invoice(c, { month: 9 });
    const salesOnly = ['sales', 'both'];
    const res = { code: 200, body: null };
    res.status = (x) => { res.code = x; return res; };
    res.json = (b) => { res.body = b; return res; };
    await ctrl.getInvoice({ params: { invoiceId: String(inv.invoice_id) }, query: {}, user: CHECKER, allowedCustomerTypes: salesOnly }, res);
    assert.equal(res.code, 403);

    const list = { code: 200, body: null };
    list.status = (x) => { list.code = x; return list; };
    list.json = (b) => { list.body = b; return list; };
    await ctrl.listInvoices({ query: { customer_id: String(c) }, user: CHECKER, allowedCustomerTypes: salesOnly }, list);
    assert.equal(list.code, 200);
    assert.equal(list.body.invoices.length, 0);
    await ctrl.listInvoices({ query: { customer_id: String(c) }, user: CHECKER, allowedCustomerTypes: FULL }, list);
    assert.equal(list.body.invoices.length, 1);
  });

  it('the router mounts the scope middleware', () => {
    const fs = require('fs');
    const src = fs.readFileSync(`${__dirname}/../routes/customerBilling.js`, 'utf8');
    assert.match(src, /router\.use\(customerScope\)/);
  });
});
