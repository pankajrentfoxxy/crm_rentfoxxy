const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PaymentValidationError,
  recordFullPayment,
  recordPayment,
} = require('../services/paymentLedgerService');

function createFakeDb({
  invoice = {
    invoice_id: 1,
    customer_id: 10,
    grand_total: '1000.00',
    amount_paid: '0.00',
    status: 'sent',
  },
  paymentSum = '0.00',
} = {}) {
  const calls = [];
  const state = {
    insertedAmount: null,
    updatedInvoice: null,
  };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
        return { rows: [] };
      }
      if (normalized.startsWith('SELECT invoice_id, customer_id, grand_total, amount_paid, status')) {
        return { rows: invoice ? [invoice] : [] };
      }
      if (normalized.startsWith('INSERT INTO payment_records')) {
        state.insertedAmount = params[5];
        return { rows: [{ payment_id: 123, amount: params[5] }] };
      }
      if (normalized.startsWith('SELECT COALESCE(SUM(amount), 0)::numeric AS total')) {
        return { rows: [{ total: paymentSum }] };
      }
      if (normalized.startsWith('UPDATE customer_invoices')) {
        state.updatedInvoice = {
          amount_paid: params[0],
          status: params[1],
          reference: params[2],
          invoice_id: params[3],
        };
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
    release() {
      calls.push({ sql: 'RELEASE', params: [] });
    },
  };

  return {
    calls,
    state,
    db: {
      async connect() {
        return client;
      },
    },
  };
}

describe('paymentLedgerService', () => {
  it('rejects payments that exceed the locked remaining invoice balance', async () => {
    const { db, calls, state } = createFakeDb({
      invoice: {
        invoice_id: 1,
        customer_id: 10,
        grand_total: '1000.00',
        amount_paid: '800.00',
        status: 'sent',
      },
    });

    await assert.rejects(
      recordPayment(db, {
        partyType: 'customer',
        invoiceId: 1,
        amount: '250.00',
      }),
      PaymentValidationError
    );

    assert.equal(state.insertedAmount, null);
    assert.ok(calls.some((call) => /FOR UPDATE/.test(call.sql)));
    assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  });

  it('records only the locked remaining amount for full invoice payments', async () => {
    const { db, calls, state } = createFakeDb({
      invoice: {
        invoice_id: 1,
        customer_id: 10,
        grand_total: '1000.00',
        amount_paid: '250.00',
        status: 'sent',
      },
      paymentSum: '1000.00',
    });

    const result = await recordFullPayment(db, {
      partyType: 'customer',
      invoiceId: 1,
      reference: 'REF-1',
      recordedBy: 7,
    });

    assert.equal(result.skipped, undefined);
    assert.equal(state.insertedAmount, '750.00');
    assert.deepEqual(state.updatedInvoice, {
      amount_paid: '1000.00',
      status: 'paid',
      reference: 'REF-1',
      invoice_id: 1,
    });
    assert.ok(calls.some((call) => /FOR UPDATE/.test(call.sql)));
    assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  });

  it('does not create a duplicate ledger payment for legacy paid invoices', async () => {
    const { db, calls, state } = createFakeDb({
      invoice: {
        invoice_id: 1,
        customer_id: 10,
        grand_total: '1000.00',
        amount_paid: '0.00',
        status: 'paid',
      },
    });

    const result = await recordFullPayment(db, {
      partyType: 'customer',
      invoiceId: 1,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'Already fully paid');
    assert.equal(state.insertedAmount, null);
    assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  });
});
