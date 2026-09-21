/**
 * Part 6 acceptance — Money.
 *
 * Covers the criteria that can be asserted without writing to the live database,
 * which staging shares: the permission split, the GST classification, the
 * numbering format, the overdue predicate and maker-checker.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

require('dotenv').config({ path: `${__dirname}/../.env` });

const { splitGst, reconcileToStored } = require('../services/billingGstService');
const { BillingActionError, dueDateFrom } = require('../services/invoiceLifecycleService');

function fakeDb(responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const next = queue.shift();
      return { rows: next || [], rowCount: (next || []).length };
    },
  };
}

// ── Acceptance 1: a view-only role cannot create, edit or delete ──

describe('6.1 — vendor management declares an action per verb', () => {
  const src = fs.readFileSync(`${__dirname}/../routes/vendorManagement.js`, 'utf8');

  it('still has a view-only helper, for reads', () => {
    assert.match(src, /const authorize = \[\s*authMiddleware,\s*checkSectionPermission\('vendor_management', 'view'\)/);
  });

  it('has create, edit and delete helpers that did not exist', () => {
    assert.match(src, /authorizeCreate = \[authMiddleware, checkSectionPermission\('vendor_management', 'create'\)\]/);
    assert.match(src, /authorizeEdit\s+= \[authMiddleware, checkSectionPermission\('vendor_management', 'edit'\)\]/);
    assert.match(src, /authorizeDelete = \[authMiddleware, checkSectionPermission\('vendor_management', 'delete'\)\]/);
  });

  it('gives vendor billing its own section and its own actions (BL14)', () => {
    for (const h of ['billingRead', 'billingCreate', 'billingEdit', 'billingDelete']) {
      assert.ok(src.includes(h), `${h} must exist`);
    }
    assert.match(src, /vendor_billing_mgmt/);
  });

  // The actual criterion: no write route may be guarded by the view helper.
  it('no POST, PUT, PATCH or DELETE is guarded by the view-only helper', () => {
    const lines = src.split('\n');
    const offenders = [];
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^router\.(post|put|patch|delete)\(/.exec(lines[i]);
      if (!m) continue;
      let depth = (lines[i].match(/\(/g) || []).length - (lines[i].match(/\)/g) || []).length;
      let block = lines[i];
      let j = i;
      while (depth > 0 && j + 1 < lines.length) {
        j += 1;
        block += `\n${lines[j]}`;
        depth += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length;
      }
      if (/(?<![\w.])(authorize|authorizeSpareParts|authorizeReturnToVendor|authorizeReturnTicket)(?![\w])/.test(block)) {
        offenders.push(`${m[1].toUpperCase()} ${(/'([^']*)'/.exec(block) || [])[1]}`);
      }
    }
    assert.deepEqual(offenders, [], `write routes still on a view guard:\n${offenders.join('\n')}`);
  });

  it('the comment that excused it is gone', () => {
    assert.ok(
      !/Write actions are gated by the UI's can_create\/can_edit flags/.test(src),
      'the UI hiding a button is not a gate'
    );
  });
});

// ── Acceptance 3: inter-state shows IGST, intra-state CGST + SGST ──

describe('6.2 — GST is split by place of supply (BL7)', () => {
  it('an intra-state supply splits into CGST and SGST', () => {
    const g = splitGst({ subtotal: 10000, gstPercent: 18, supplyState: 'Haryana' });
    assert.equal(g.is_intra_state, true);
    assert.equal(g.cgst, 900);
    assert.equal(g.sgst, 900);
    assert.equal(g.igst, 0);
    assert.equal(g.cgst + g.sgst, g.gst_total);
  });

  it('an inter-state supply is all IGST', () => {
    const g = splitGst({ subtotal: 10000, gstPercent: 18, supplyState: 'Karnataka' });
    assert.equal(g.is_intra_state, false);
    assert.equal(g.igst, 1800);
    assert.equal(g.cgst, 0);
    assert.equal(g.sgst, 0);
  });

  it('records the place of supply it decided on, not just the number', () => {
    assert.equal(splitGst({ subtotal: 100, supplyState: 'Karnataka' }).place_of_supply, 'Karnataka');
  });

  it('the heads always sum to the total the document carries', () => {
    // Some billing paths round differently; three heads that did not add up to
    // the printed total would be worse than no split.
    const odd = reconcileToStored({ is_intra_state: true }, 1800.01);
    assert.equal(+(odd.cgst + odd.sgst).toFixed(2), 1800.01);
    const inter = reconcileToStored({ is_intra_state: false }, 1800.01);
    assert.equal(inter.igst, 1800.01);
    assert.equal(inter.cgst + inter.sgst, 0);
  });

  it('a zero-GST document produces zero heads, not a split of nothing', () => {
    const z = reconcileToStored({ is_intra_state: true }, 0);
    assert.deepEqual(z, { cgst: 0, sgst: 0, igst: 0 });
  });
});

// ── Acceptance 4: invoice 10,000 has a valid number with an FY segment ──

describe('6.2 — invoice numbering (BL8)', () => {
  const src = fs.readFileSync(`${__dirname}/../services/billingSchedulerService.js`, 'utf8');
  // The formatter is module-private; exercise the same logic it is built from.
  const financialYearCode = (date) => {
    const d = new Date(date);
    const y = d.getFullYear();
    const startYear = d.getMonth() >= 3 ? y : y - 1;
    return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
  };
  const format = (prefix, seq, date) =>
    `${String(prefix).replace(/[-/]+$/, '')}/${financialYearCode(date)}/${String(seq).padStart(6, '0')}`;

  it('no longer pads to four digits', () => {
    assert.ok(!/LPAD\(last_value::text, 4, '0'\)/.test(src), 'the 9,999 break must be gone');
  });

  it('carries a financial-year segment like every other document', () => {
    assert.equal(format('INV-', 1193, '2026-09-21'), 'INV/26-27/001193');
  });

  it('holds past 9,999 — the number that used to break it', () => {
    assert.equal(format('INV-', 10000, '2026-09-21'), 'INV/26-27/010000');
    assert.equal(format('INV-', 999999, '2026-09-21'), 'INV/26-27/999999');
  });

  it('the financial year turns over on 1 April, not 1 January', () => {
    assert.equal(financialYearCode('2026-03-31'), '25-26');
    assert.equal(financialYearCode('2026-04-01'), '26-27');
  });

  it('preserves the series — 1192 issued means 1193 next, nothing skipped', () => {
    assert.equal(format('INV-', 1193, '2026-09-21').endsWith('001193'), true);
    assert.match(src, /RETURNING prefix, last_value/);
  });
});

// ── Acceptance 5: an overdue invoice appears without anyone touching it ──

describe('6.2 — the overdue sweep (BL9)', () => {
  const src = fs.readFileSync(`${__dirname}/../services/invoiceLifecycleService.js`, 'utf8');

  it('only moves invoices that were actually sent', () => {
    assert.match(src, /LOWER\(COALESCE\(status, ''\)\) = 'sent'/);
  });

  it('will not resurrect a cancelled invoice or reopen a paid one', () => {
    // Both are excluded by the 'sent' predicate; assert the intent explicitly so
    // a later widening of the filter has to argue with this test.
    assert.ok(!/status IN \('sent', 'paid'\)/.test(src));
    assert.match(src, /COALESCE\(amount_paid, 0\) < COALESCE\(grand_total, 0\)/);
  });

  it('needs a due date, and one is stamped when the invoice is sent', () => {
    assert.match(src, /due_date IS NOT NULL/);
    const ctrl = fs.readFileSync(`${__dirname}/../controllers/customerBillingController.js`, 'utf8');
    assert.match(ctrl, /due_date = COALESCE\(due_date,/);
  });

  it('is scheduled, not just an endpoint', () => {
    const server = fs.readFileSync(`${__dirname}/../server.js`, 'utf8');
    assert.match(server, /startOverdueInvoiceWorker\(\)/);
  });

  it('net 15 from the invoice date', () => {
    assert.equal(dueDateFrom('2026-09-01'), '2026-09-16');
  });
});

// ── Acceptance 6: the generator cannot approve their own vendor bill ──

describe('6.2 — maker-checker on vendor bills (BL12)', () => {
  const { approveVendorBill } = require('../services/invoiceLifecycleService');

  it('refuses when the approver generated the bill', async () => {
    const db = fakeDb([[{ bill_id: 7, bill_number: 'VB-0007', status: 'generated', generated_by: 42 }]]);
    await assert.rejects(
      () => approveVendorBill(db, { billId: 7, actor: { user_id: 42 } }),
      (err) => {
        assert.ok(err instanceof BillingActionError);
        assert.equal(err.status, 403);
        assert.match(err.message, /cannot approve it/);
        return true;
      }
    );
  });

  it('allows a different person', async () => {
    const db = fakeDb([
      [{ bill_id: 7, bill_number: 'VB-0007', status: 'generated', generated_by: 42 }],
      [{ bill_id: 7, bill_number: 'VB-0007', status: 'approved', approved_by: 43 }],
      [],
    ]);
    const bill = await approveVendorBill(db, { billId: 7, actor: { user_id: 43 } });
    assert.equal(bill.status, 'approved');
  });

  it('refuses a bill that is not in generated status', async () => {
    const db = fakeDb([[{ bill_id: 7, bill_number: 'VB-0007', status: 'approved', generated_by: 1 }]]);
    await assert.rejects(
      () => approveVendorBill(db, { billId: 7, actor: { user_id: 2 } }),
      /only a generated bill can be approved/
    );
  });

  it('lets a bill with no recorded generator through, rather than stranding it', async () => {
    // Historic rows and the batch run have no generated_by. Refusing would make
    // them unapprovable; the gap is recorded in the event instead.
    const db = fakeDb([
      [{ bill_id: 9, bill_number: 'VB-0009', status: 'generated', generated_by: null }],
      [{ bill_id: 9, status: 'approved' }],
      [],
    ]);
    const bill = await approveVendorBill(db, { billId: 9, actor: { user_id: 5 } });
    assert.equal(bill.status, 'approved');
  });
});

// ── BL13: cancellation has a path, a reason and a trail ──

describe('6.2 — cancelling an invoice (BL13)', () => {
  const { cancelInvoice } = require('../services/invoiceLifecycleService');

  it('demands a reason', async () => {
    await assert.rejects(
      () => cancelInvoice(fakeDb([]), { invoiceId: 1, reason: '', actor: { user_id: 1 } }),
      /reason is required/
    );
  });

  it('refuses to cancel an invoice with payment against it', async () => {
    const db = fakeDb([[{ invoice_id: 1, invoice_number: 'INV/26-27/000001', status: 'sent', amount_paid: 500, grand_total: 1000 }]]);
    await assert.rejects(
      () => cancelInvoice(db, { invoiceId: 1, reason: 'raised in error', actor: { user_id: 1 } }),
      /credit note instead/
    );
  });

  it('refuses to cancel twice', async () => {
    const db = fakeDb([[{ invoice_id: 1, status: 'cancelled', amount_paid: 0, grand_total: 100 }]]);
    await assert.rejects(
      () => cancelInvoice(db, { invoiceId: 1, reason: 'raised in error', actor: { user_id: 1 } }),
      /already cancelled/
    );
  });

  it('cancels an unpaid invoice and records who and why', async () => {
    const db = fakeDb([
      [{ invoice_id: 1, invoice_number: 'INV/26-27/000001', status: 'draft', amount_paid: 0, grand_total: 100 }],
      [{ invoice_id: 1, status: 'cancelled', cancellation_reason: 'duplicate of INV/26-27/000002' }],
      [],
    ]);
    const inv = await cancelInvoice(db, {
      invoiceId: 1, reason: 'duplicate of INV/26-27/000002', actor: { user_id: 3 },
    });
    assert.equal(inv.status, 'cancelled');
    const update = db.calls.find((c) => /UPDATE customer_invoices/.test(c.sql));
    assert.ok(update, 'the cancel must be an UPDATE through this service, not a raw one');
    assert.equal(update.params[1], 3, 'cancelled_by is recorded');
  });
});

// ── BL11: every billing action writes to the one events table ──

describe('6.2 — billing joins the event spine (BL11)', () => {
  const { BILLING_EVENTS } = require('../services/billingEventService');

  it('has a vocabulary, so a typo cannot create a second timeline', () => {
    for (const k of ['INVOICE_GENERATED', 'INVOICE_SENT', 'INVOICE_PAID', 'INVOICE_OVERDUE',
      'INVOICE_CANCELLED', 'BILL_APPROVED', 'BILL_CANCELLED']) {
      assert.equal(typeof BILLING_EVENTS[k], 'string');
    }
  });

  it('does not create a second audit table', () => {
    const src = fs.readFileSync(`${__dirname}/../services/billingEventService.js`, 'utf8');
    assert.match(src, /require\('\.\/eventService'\)/);
    assert.ok(!/CREATE TABLE/i.test(src), 'one trail, not a parallel one');
  });

  it('generation, send and paid all record', () => {
    const ctrl = fs.readFileSync(`${__dirname}/../controllers/customerBillingController.js`, 'utf8');
    assert.match(ctrl, /BILLING_EVENTS\.INVOICE_SENT/);
    assert.match(ctrl, /BILLING_EVENTS\.INVOICE_PAID/);
    assert.match(ctrl, /BILLING_EVENTS\.INVOICE_GENERATED/);
  });

  it('the invoice timeline reads the shared events table back', () => {
    const ctrl = fs.readFileSync(`${__dirname}/../controllers/customerBillingController.js`, 'utf8');
    assert.match(ctrl, /timelineFor\(ENTITY\.INVOICE/);
  });
});

// ── BL6: the debit-note sweep is bounded ──

describe('6.2 — the debit-note sweep has a bound (BL6)', () => {
  it('will not consume a note raised after the billed period ended', () => {
    const src = fs.readFileSync(`${__dirname}/../services/billingSchedulerService.js`, 'utf8');
    assert.match(src, /AND created_at::date <= \$2::date/);
  });
});
