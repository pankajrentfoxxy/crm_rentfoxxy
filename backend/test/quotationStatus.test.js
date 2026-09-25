/**
 * Part 4.3 — quotation status rules, and a form that no longer burns numbers.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: `${__dirname}/../.env` });

const {
  canTransitionQuotation, peekDocumentNumber, entityDocType,
} = require('../services/salesManagementService');
const pool = require('../config/db');

describe('4.3 — quotation status transitions', () => {
  it('lets a draft be sent, approved, accepted or rejected', () => {
    for (const to of ['sent', 'approved', 'accepted', 'rejected']) {
      assert.equal(canTransitionQuotation('pending', to), true, `pending → ${to}`);
    }
  });

  it('never moves an accepted quotation back to draft or approved', () => {
    assert.equal(canTransitionQuotation('accepted', 'pending'), false);
    assert.equal(canTransitionQuotation('accepted', 'approved'), false);
  });

  it('still lets an accepted quotation be resent or rejected', () => {
    assert.equal(canTransitionQuotation('accepted', 'sent'), true);
    assert.equal(canTransitionQuotation('accepted', 'rejected'), true);
  });

  it('closes a rejected quotation for good', () => {
    for (const to of ['pending', 'sent', 'approved', 'accepted', 'rejected']) {
      assert.equal(canTransitionQuotation('rejected', to), false, `rejected → ${to}`);
    }
  });

  it('treats a missing status as a draft', () => {
    assert.equal(canTransitionQuotation(null, 'sent'), true);
    assert.equal(canTransitionQuotation(undefined, 'accepted'), true);
  });
});

describe('4.3 — opening the quotation form does not consume a number', () => {
  it('peeks the same number twice and leaves the counter where it was', async () => {
    const docType = entityDocType('quotation', 'rentfoxxy');
    const before = await pool.query('SELECT last_value FROM sm_document_sequences WHERE doc_type = $1', [docType]);
    const a = await peekDocumentNumber(docType);
    const b = await peekDocumentNumber(docType);
    const after = await pool.query('SELECT last_value FROM sm_document_sequences WHERE doc_type = $1', [docType]);
    assert.equal(a, b);
    assert.match(a, /^EST-\d+$/);
    assert.equal(after.rows[0]?.last_value, before.rows[0]?.last_value);
  });

  it('previews the sale book with its own prefix', async () => {
    const n = await peekDocumentNumber(entityDocType('quotation', 'gorefurbo'));
    assert.match(n, /^GEST-\d+$/);
  });

});

describe('4.3 — the status handler against the database', () => {
  const ctrl = require('../controllers/salesManagementController');
  const qn = `TEST-QSTATUS-${Date.now()}`;
  const call = async (status) => {
    const res = { code: 200, body: null };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await ctrl.updateQuotationStatus({ params: { quotationNumber: qn }, body: { status }, user: { user_id: 1, name: 'test' } }, res);
    return res;
  };

  it('records acceptance with accepted_at, then refuses going back to draft', async () => {
    await pool.query(
      `INSERT INTO sales_quotations (quotation_number, customer_name, status, quotation_type, quantity, rate)
       VALUES ($1, 'test', 'pending', 'rental', 1, 1)`,
      [qn]
    );
    try {
      const ok = await call('accepted');
      assert.equal(ok.code, 200, JSON.stringify(ok.body));
      const { rows } = await pool.query('SELECT status, accepted_at FROM sales_quotations WHERE quotation_number = $1', [qn]);
      assert.equal(rows[0].status, 'accepted');
      assert.ok(rows[0].accepted_at, 'accepted_at must be set');

      const back = await call('pending');
      assert.equal(back.code, 409);
      assert.equal(back.body.code, 'QUOTATION_TRANSITION_REFUSED');

      assert.equal((await call('rejected')).code, 200);
      assert.equal((await call('accepted')).code, 409, 'rejected stays closed');
    } finally {
      await pool.query('DELETE FROM sales_quotations WHERE quotation_number = $1', [qn]);
    }
  });

  it('closes the pool', async () => { await pool.end(); });
});

describe('migration 327 — quotation terms follow the validity date', () => {
  const { quotationTermsFor, QUOTATION_TERMS } = require('../constants/quotationTerms');
  it('states the date instead of the generic 10 days', () => {
    const t = quotationTermsFor('02 Oct 2026');
    assert.equal(t[0], '1. The quotation is valid until 02 Oct 2026.');
    assert.equal(t.length, QUOTATION_TERMS.length);
    assert.deepEqual(t.slice(1), QUOTATION_TERMS.slice(1));
  });
  it('keeps the standard terms when there is no date', () => {
    assert.deepEqual(quotationTermsFor(null), QUOTATION_TERMS);
  });
});
