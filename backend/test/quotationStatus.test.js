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

  it('closes the pool', async () => { await pool.end(); });
});
