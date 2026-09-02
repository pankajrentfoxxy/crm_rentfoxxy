const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateTemplatePayload,
  sanitizeValues,
  normalizePhone,
  buildInteraktPayload,
  isProviderSuccess,
  shouldRetry,
  sendWhatsAppTemplate,
  formatDdMmYyyy,
} = require('../services/interaktWhatsAppService');
const { formatOrderType, formatQty } = require('../services/salesOrderWhatsApp');
const { formatTicketNo, formatTicketType } = require('../services/supportWhatsApp');

function fakeDb(opts = {}) {
  const inserts = [];
  const updates = [];
  return {
    inserts,
    updates,
    query: async (sql, params) => {
      if (/SELECT id FROM whatsapp_messages/i.test(sql)) {
        return { rows: opts.alreadySent ? [{ id: 9 }] : [] };
      }
      if (/INSERT INTO whatsapp_messages/i.test(sql)) {
        inserts.push(params);
        return { rows: [{ id: 1 }] };
      }
      if (/UPDATE whatsapp_messages/i.test(sql)) {
        updates.push(params);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
  };
}

describe('Interakt WhatsApp templates', () => {
  it('accepts the live Interakt name create_so for SO created', () => {
    const v = validateTemplatePayload({
      templateName: 'create_so',
      values: ['Nursid', 'SO/26-27/1236', 'Rental', '3'],
    });
    assert.equal(v.ok, true);
    assert.equal(v.spec.interaktName, 'create_so');
  });

  it('maps so_created_v1 bodyValues in strict Interakt order', () => {
    const v = validateTemplatePayload({
      templateName: 'so_created_v1',
      values: ['Nursid', 'SO/26-27/1236', 'Rental', '3'],
    });
    assert.equal(v.ok, true);
    assert.deepEqual(v.bodyValues, ['Nursid', 'SO/26-27/1236', 'Rental', '3']);
    assert.equal(v.spec.varCount, 4);
  });

  it('accepts the live Interakt name order_intrasit_vd for in-transit', () => {
    const v = validateTemplatePayload({
      templateName: 'order_intrasit_vd',
      values: ['Nursid', 'SO/26-27/1236', 'DC/26-27/1236', '1'],
    });
    assert.equal(v.ok, true);
    assert.equal(v.spec.interaktName, 'order_intrasit_vd');
    assert.equal(v.bodyValues[2], 'DC/26-27/1236');
  });

  it('maps so_in_transit_v1 with DC number as {{3}}', () => {
    const v = validateTemplatePayload({
      templateName: 'so_in_transit_v1',
      values: ['Nursid', 'SO/26-27/1236', 'DC/26-27/0100', '3'],
    });
    assert.equal(v.ok, true);
    assert.equal(v.bodyValues[2], 'DC/26-27/0100');
  });

  it('maps delivery_otp_v1 to a single OTP value', () => {
    const v = validateTemplatePayload({
      templateName: 'delivery_otp_v1',
      values: ['482913'],
    });
    assert.equal(v.ok, true);
    assert.deepEqual(v.bodyValues, ['482913']);
  });

  it('maps so_delivered_v1 with date as {{5}}', () => {
    const v = validateTemplatePayload({
      templateName: 'so_delivered_v1',
      values: ['Nursid', 'SO/26-27/1236', 'DC/26-27/0100', '3', '25-08-2026'],
    });
    assert.equal(v.ok, true);
    assert.equal(v.bodyValues[4], '25-08-2026');
  });

  it('rejects null, undefined, and empty body values', () => {
    assert.equal(sanitizeValues(['A', null, 'B']).ok, false);
    assert.equal(sanitizeValues(['A', undefined, 'B']).ok, false);
    assert.equal(sanitizeValues(['A', '  ', 'B']).ok, false);
  });

  it('rejects unknown template names and arity mismatch', () => {
    assert.equal(validateTemplatePayload({ templateName: 'task_add', values: ['x'] }).ok, false);
    assert.equal(validateTemplatePayload({
      templateName: 'so_created_v1',
      values: ['Nursid', 'SO/1', 'Rental'],
    }).ok, false);
  });

  it('normalizes +91 / 0-prefix mobiles to 10 digits', () => {
    assert.equal(normalizePhone('+91 7081002501'), '7081002501');
    assert.equal(normalizePhone('07081002501'), '7081002501');
    assert.equal(normalizePhone('123'), '');
  });

  it('builds the Interakt public message body', () => {
    const payload = buildInteraktPayload({
      phone: '7081002501',
      templateName: 'so_created_v1',
      bodyValues: ['Nursid', 'SO/26-27/1236', 'Rental', '3'],
      countryCode: '+91',
    });
    assert.deepEqual(payload, {
      countryCode: '+91',
      phoneNumber: '7081002501',
      type: 'Template',
      template: {
        name: 'so_created_v1',
        languageCode: 'en',
        bodyValues: ['Nursid', 'SO/26-27/1236', 'Rental', '3'],
      },
    });
  });

  it('treats HTTP 2xx as success unless Interakt result is false', () => {
    assert.equal(isProviderSuccess(200, { result: true }), true);
    assert.equal(isProviderSuccess(201, {}), true);
    assert.equal(isProviderSuccess(200, { result: false }), false);
    assert.equal(isProviderSuccess(400, { message: 'bad' }), false);
  });

  it('retries on 429, 5xx, and network errors only', () => {
    assert.equal(shouldRetry(429, null), true);
    assert.equal(shouldRetry(500, null), true);
    assert.equal(shouldRetry(null, new Error('ECONNRESET')), true);
    assert.equal(shouldRetry(400, null), false);
  });

  it('formats order type and quantity for templates', () => {
    assert.equal(formatOrderType('rental'), 'Rental');
    assert.equal(formatOrderType('sale'), 'Sale');
    assert.equal(formatQty(3), '3');
    assert.equal(formatQty(0), '');
  });

  it('formats support ticket number and type', () => {
    assert.equal(formatTicketNo(1096), 'T-1096');
    assert.equal(formatTicketType('pickup'), 'Pickup');
    assert.equal(formatTicketType('replacement'), 'Replacement');
    assert.equal(formatTicketType('complaint'), 'Complaint');
  });

  it('uses person name when ticket stores the company name', () => {
    const { displayCustomerName } = require('../services/supportWhatsApp');
    assert.equal(displayCustomerName({
      customer_name: 'IT Solution',
      cust_name: 'Nursid',
      company_name: 'IT Solution',
    }), 'Nursid');
  });

  it('formats delivered-on as DD-MM-YYYY IST', () => {
    const s = formatDdMmYyyy(new Date('2026-08-25T12:00:00+05:30'));
    assert.equal(s, '25-08-2026');
  });

  it('retries up to 3 times then stores failed', async () => {
    const prevKey = process.env.INTERAKT_API_KEY;
    process.env.INTERAKT_API_KEY = 'test-key';
    const db = fakeDb();
    let calls = 0;
    const httpPost = async () => {
      calls += 1;
      return { status: 500, data: { message: 'upstream' } };
    };
    try {
      const result = await sendWhatsAppTemplate({
        phone: '7081002501',
        templateName: 'so_created_v1',
        values: ['Nursid', 'SO/26-27/1236', 'Rental', '3'],
        refType: 'sales_order',
        refId: 'SO/26-27/1236',
      }, { db, httpPost });
      assert.equal(result.ok, false);
      assert.equal(calls, 3);
      assert.equal(db.updates[0][1], 'failed');
      assert.equal(db.updates[0][2], 3);
    } finally {
      if (prevKey == null) delete process.env.INTERAKT_API_KEY;
      else process.env.INTERAKT_API_KEY = prevKey;
    }
  });

  it('stores sent after a successful Interakt response', async () => {
    const prevKey = process.env.INTERAKT_API_KEY;
    process.env.INTERAKT_API_KEY = 'test-key';
    const db = fakeDb();
      const httpPost = async (_url, body) => {
      assert.equal(body.template.name, 'create_so');
      assert.deepEqual(body.template.bodyValues, ['Nursid', 'SO/26-27/1236', 'Rental', '3']);
      return { status: 200, data: { result: true, id: 'itk-1' } };
    };
    try {
      const result = await sendWhatsAppTemplate({
        phone: '7081002501',
        templateName: 'so_created_v1',
        values: ['Nursid', 'SO/26-27/1236', 'Rental', '3'],
      }, { db, httpPost });
      assert.equal(result.ok, true);
      assert.equal(db.updates[0][1], 'sent');
    } finally {
      if (prevKey == null) delete process.env.INTERAKT_API_KEY;
      else process.env.INTERAKT_API_KEY = prevKey;
    }
  });

  it('sends otp_verification with matching body and button OTP values', async () => {
    const prevKey = process.env.INTERAKT_API_KEY;
    process.env.INTERAKT_API_KEY = 'test-key';
    const db = fakeDb();
    const httpPost = async (_url, body) => {
      assert.equal(body.template.name, 'otp_verification');
      assert.deepEqual(body.template.bodyValues, ['482913']);
      assert.deepEqual(body.template.buttonValues, { 0: ['482913'] });
      return { status: 200, data: { result: true } };
    };
    try {
      const result = await sendWhatsAppTemplate({
        phone: '7081002501',
        templateName: 'delivery_otp_v1',
        values: ['482913'],
      }, { db, httpPost });
      assert.equal(result.ok, true);
    } finally {
      if (prevKey == null) delete process.env.INTERAKT_API_KEY;
      else process.env.INTERAKT_API_KEY = prevKey;
    }
  });

  it('maps support_ticket_created_ with 3 body values', () => {
    const v = validateTemplatePayload({
      templateName: 'support_ticket_created_',
      values: ['Nursid', 'T-1096', 'Complaint'],
    });
    assert.equal(v.ok, true);
    assert.equal(v.spec.interaktName, 'support_ticket_created_');
    assert.deepEqual(v.bodyValues, ['Nursid', 'T-1096', 'Complaint']);
  });

  it('maps support_pickup_scheduled with assignee as {{4}}', () => {
    const v = validateTemplatePayload({
      templateName: 'support_pickup_scheduled',
      values: ['Nursid', 'RDC001835', '2', 'Rahul'],
    });
    assert.equal(v.ok, true);
    assert.equal(v.bodyValues[3], 'Rahul');
  });

  it('maps support_picked_up with date as {{4}}', () => {
    const v = validateTemplatePayload({
      templateName: 'support_picked_up',
      values: ['Nursid', 'RDC001835', '2', '02-09-2026'],
    });
    assert.equal(v.ok, true);
    assert.equal(v.bodyValues[2], '2');
  });

  it('maps support_replacement_created_ with ticket as {{4}}', () => {
    const v = validateTemplatePayload({
      templateName: 'support_replacement_created_',
      values: ['Nursid', 'SO/26-27/1096', '1', 'T-1096'],
    });
    assert.equal(v.ok, true);
    assert.equal(v.spec.interaktName, 'support_replacement_created_');
    assert.equal(v.bodyValues[3], 'T-1096');
  });

  it('maps support_service_in_transit and support_service_delivered', () => {
    const transit = validateTemplatePayload({
      templateName: 'support_service_in_transit',
      values: ['Nursid', 'T-1096', 'SDC/26-27/0012', '1'],
    });
    assert.equal(transit.ok, true);
    const delivered = validateTemplatePayload({
      templateName: 'support_service_delivered',
      values: ['Nursid', 'T-1096', 'SDC/26-27/0012', '1', '02-09-2026'],
    });
    assert.equal(delivered.ok, true);
    assert.equal(delivered.bodyValues[4], '02-09-2026');
  });

  it('does not retry a successful send for the same SO/DC template', async () => {
    const prevKey = process.env.INTERAKT_API_KEY;
    process.env.INTERAKT_API_KEY = 'test-key';
    const db = fakeDb({ alreadySent: true });
    let calls = 0;
    try {
      const result = await sendWhatsAppTemplate({
        phone: '7081002501',
        templateName: 'so_created_v1',
        values: ['Nursid', 'SO/26-27/1236', 'Rental', '3'],
        refType: 'sales_order',
        refId: 'SO/26-27/1236',
      }, { db, httpPost: async () => { calls += 1; return { status: 200, data: {} }; } });
      assert.equal(result.skipped, true);
      assert.equal(calls, 0);
    } finally {
      if (prevKey == null) delete process.env.INTERAKT_API_KEY;
      else process.env.INTERAKT_API_KEY = prevKey;
    }
  });
});
