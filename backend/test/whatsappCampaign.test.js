const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

process.env.OUTBOUND_MESSAGING_ENABLED = 'true';
process.env.INTERAKT_API_KEY = process.env.INTERAKT_API_KEY || 'test-key';

const {
  normalizeMobile, validateRows, parseRows, detectFileKind,
} = require('../services/whatsappCampaignImportService');
const {
  validateBodyVariables, buildBodyValues, renderPreview, sanitizeText,
} = require('../services/whatsappCampaignTemplate');
const { buildTemplatePayload, sendTemplateMessage, parseRetryAfterMs } = require('../services/interaktWhatsAppService');
const { decideOutcome, retryDelayMs } = require('../services/whatsappCampaignWorker');
const { AdaptiveRateLimiter } = require('../services/whatsappRateLimiter');
const { parseWebhookEvent, validateCampaignInput } = require('../services/whatsappCampaignService');

describe('normalizeMobile', () => {
  for (const input of ['9876543210', '+919876543210', '919876543210', '+91 98765-43210', '098765 43210', '0091 9876543210', '(987) 654-3210']) {
    it(`normalises ${input}`, () => {
      assert.deepEqual(normalizeMobile(input), { ok: true, countryCode: '+91', phoneNumber: '9876543210' });
    });
  }
  it('rejects short, foreign, non-mobile and garbage numbers', () => {
    assert.equal(normalizeMobile('98765').ok, false);
    assert.equal(normalizeMobile('+14155550123').ok, false);
    assert.equal(normalizeMobile('1234567890').ok, false); // landline / not 6-9
    assert.equal(normalizeMobile('98765abc10').ok, false);
    assert.equal(normalizeMobile('').error, 'Mobile is missing');
    assert.equal(normalizeMobile('9198765432101').ok, false); // 13 digits is not silently trimmed
  });
});

describe('validateRows', () => {
  const vars = validateBodyVariables(undefined).variables;

  it('matches headers case-insensitively and accepts Phone as Mobile', () => {
    const { contacts, summary, columns } = validateRows([['NAME', 'phone'], ['Rahul', '7081002501']], { bodyVariables: vars });
    assert.equal(summary.valid, 1);
    assert.deepEqual(columns.map((c) => c.key), ['name', 'mobile']);
    assert.equal(contacts[0].phoneNumber, '7081002501');
    assert.equal(contacts[0].rowNumber, 2);
  });

  it('reports invalid, empty, missing-name and duplicate rows without dropping any', () => {
    const rows = [
      ['Name', 'Mobile'],
      ['Rahul', '9876543210'],
      ['Amit', '+91 98765 43210'], // duplicate number
      ['Rahul', '9876543210'], // exact duplicate row
      ['', '9876123456'], // missing name
      ['Neha', '12345'], // invalid
      ['', ''], // empty
      ['Priya', '9123456780'],
    ];
    const { contacts, summary } = validateRows(rows, { bodyVariables: vars });
    assert.equal(contacts.length, 7);
    assert.deepEqual(summary, { total: 7, valid: 2, invalid: 3, duplicate: 2, empty: 1 });
    assert.match(contacts[1].validationError, /already in row 2/);
    assert.match(contacts[2].validationError, /Exact duplicate of row 2/);
    assert.match(contacts[3].validationError, /Name is missing/);
    assert.equal(contacts[5].validationError, 'Empty row');
  });

  it('requires both Name and Mobile columns', () => {
    assert.throws(() => validateRows([['Name', 'Email'], ['a', 'b']]), /Required column\(s\) missing: Mobile/);
  });

  it('checks columns used by extra template variables', () => {
    const multi = validateBodyVariables([
      { source: 'column', key: 'Name' },
      { source: 'column', key: 'Order Number' },
    ]).variables;
    assert.throws(() => validateRows([['Name', 'Mobile'], ['a', '9876543210']], { bodyVariables: multi }), /ordernumber/);
    const { contacts, summary } = validateRows(
      [['Name', 'Mobile', 'OrderNumber'], ['Rahul', '9876543210', 'SO-1'], ['Amit', '9876543211', '']],
      { bodyVariables: multi }
    );
    assert.equal(summary.valid, 1);
    assert.match(contacts[1].validationError, /OrderNumber is empty/);
    assert.deepEqual(buildBodyValues(multi, contacts[0]), { ok: true, values: ['Rahul', 'SO-1'] });
  });

  it('folds Name aliases in the mapping onto the name column', () => {
    const v = validateBodyVariables([{ source: 'column', key: 'Customer Name' }]).variables;
    assert.deepEqual(v, [{ source: 'column', key: 'name' }]);
  });
});

describe('file parsing', () => {
  it('reads CSV values as text so long numbers keep every digit', () => {
    const rows = parseRows(Buffer.from('﻿Name,Mobile\nRahul,919876543210\n\n\n'), 'csv');
    assert.deepEqual(rows, [['Name', 'Mobile'], ['Rahul', '919876543210']]);
  });

  it('reads numeric Excel cells without scientific notation', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Mobile'], ['Rahul', 919876543210]]), 'S');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    assert.equal(detectFileKind(buf, 'list.xlsx'), 'xlsx');
    assert.deepEqual(parseRows(buf, 'xlsx')[1], ['Rahul', '919876543210']);
  });

  it('rejects disallowed extensions and mismatched content', () => {
    assert.throws(() => detectFileKind(Buffer.from('x'), 'evil.exe'), /Only \.xlsx/);
    assert.throws(() => detectFileKind(Buffer.from('Name,Mobile'), 'fake.xlsx'), /not a valid \.xlsx/);
    assert.throws(() => detectFileKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'renamed.csv'), /Excel workbook/);
  });
});

describe('template variables and preview', () => {
  it('maps Name to {{1}} by default and renders the preview', () => {
    const vars = validateBodyVariables(undefined).variables;
    const built = buildBodyValues(vars, { name: 'Rahul', variables: { name: 'Rahul' } });
    assert.deepEqual(built.values, ['Rahul']);
    assert.equal(renderPreview('Hi {{1}}, offer {{2}}', built.values), 'Hi Rahul, offer {{2}}');
  });
  it('supports fixed text and refuses empty values', () => {
    const vars = validateBodyVariables([{ source: 'column', key: 'name' }, { source: 'static', value: 'Diwali' }]).variables;
    assert.deepEqual(buildBodyValues(vars, { name: 'A', variables: { name: 'A' } }).values, ['A', 'Diwali']);
    assert.equal(buildBodyValues(vars, { name: '', variables: {} }).ok, false);
  });
  it('strips newlines and control characters Meta rejects', () => {
    assert.equal(sanitizeText(' Ra\nhul\t\u0000 K '), 'Ra hul K');
  });
});

describe('Interakt sendTemplateMessage', () => {
  const fake = (status, data, headers = {}) => async () => ({ status, data, headers });

  it('builds the documented payload', () => {
    assert.deepEqual(buildTemplatePayload({
      countryCode: '+91', phoneNumber: '7081002501', templateName: 'new_offer', languageCode: 'en',
      headerValues: ['https://example.com/offer.jpg'], bodyValues: ['Rahul'],
    }), {
      countryCode: '+91',
      phoneNumber: '7081002501',
      type: 'Template',
      template: {
        name: 'new_offer', languageCode: 'en', bodyValues: ['Rahul'], headerValues: ['https://example.com/offer.jpg'],
      },
    });
  });

  it('returns the message id on success', async () => {
    const r = await sendTemplateMessage({ phoneNumber: '9876543210', templateName: 't', bodyValues: ['a'] },
      { httpPost: fake(201, { result: true, id: 'abc-123' }) });
    assert.equal(r.ok, true);
    assert.equal(r.messageId, 'abc-123');
  });

  it('flags 429 as rate limited with Retry-After', async () => {
    const r = await sendTemplateMessage({ phoneNumber: '9876543210', templateName: 't' },
      { httpPost: fake(429, { message: 'Too many' }, { 'retry-after': '7' }) });
    assert.equal(r.rateLimited, true);
    assert.equal(r.retryable, true);
    assert.equal(r.retryAfterMs, 7000);
  });

  it('does not retry a 400 validation error', async () => {
    const r = await sendTemplateMessage({ phoneNumber: '9876543210', templateName: 't' },
      { httpPost: fake(400, { result: false, message: 'Unable to upload the media used in the message.', statusCode: 131053 }) });
    assert.equal(r.retryable, false);
    assert.match(r.error, /131053/);
  });

  it('treats a timeout as outcome-unknown, but a refused connection as retryable', async () => {
    const timeout = await sendTemplateMessage({ phoneNumber: '1', templateName: 't' }, {
      httpPost: async () => { const e = new Error('timeout'); e.code = 'ECONNABORTED'; throw e; },
    });
    assert.equal(timeout.outcomeUnknown, true);
    assert.equal(timeout.retryable, false);
    const refused = await sendTemplateMessage({ phoneNumber: '1', templateName: 't' }, {
      httpPost: async () => { const e = new Error('refused'); e.code = 'ECONNREFUSED'; throw e; },
    });
    assert.equal(refused.retryable, true);
  });

  it('parses Retry-After seconds and dates', () => {
    assert.equal(parseRetryAfterMs({ 'retry-after': '3' }), 3000);
    assert.equal(parseRetryAfterMs({}), null);
  });
});

describe('worker retry decisions', () => {
  it('retries temporary failures with 2s / 5s / 15s back-off, then fails', () => {
    const temp = { ok: false, retryable: true, errorCode: 'HTTP_503' };
    assert.deepEqual(decideOutcome(temp, 0, 3), { action: 'retry', delayMs: 2000 });
    assert.deepEqual(decideOutcome(temp, 1, 3), { action: 'retry', delayMs: 5000 });
    assert.deepEqual(decideOutcome(temp, 2, 3), { action: 'retry', delayMs: 15000 });
    assert.deepEqual(decideOutcome(temp, 3, 3), { action: 'failed', errorCode: 'HTTP_503' });
  });
  it('honours a longer Retry-After', () => {
    assert.equal(retryDelayMs(0, 30000), 30000);
  });
  it('never resends when the outcome is unknown, and requeues when sending is switched off', () => {
    assert.equal(decideOutcome({ ok: false, outcomeUnknown: true }, 0, 3).action, 'failed');
    assert.equal(decideOutcome({ ok: false, errorCode: 'DISABLED' }, 0, 3).action, 'requeue');
  });
});

describe('AdaptiveRateLimiter', () => {
  function clock() {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms) => { t += ms; },
      get t() { return t; },
    };
  }

  it('holds the configured rate', async () => {
    const c = clock();
    const rl = new AdaptiveRateLimiter({ perMinute: 120, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 122; i += 1) await rl.acquire(); // 2 burst tokens + 120 at 2/s
    assert.ok(c.t >= 59000 && c.t <= 61000, `took ${c.t}ms`);
  });

  it('halves the rate and pauses for Retry-After on 429, then recovers', async () => {
    const c = clock();
    const rl = new AdaptiveRateLimiter({ perMinute: 200, now: c.now, sleep: c.sleep });
    assert.equal(rl.onRateLimited(10000), 10000);
    assert.equal(rl.currentRate(), 100);
    await rl.acquire();
    assert.ok(c.t >= 10000);
    c.sleep(61000);
    rl.onSuccess();
    assert.equal(rl.currentRate(), 125);
  });
});

describe('webhook parsing', () => {
  it('reads Interakt delivery events', () => {
    const e = parseWebhookEvent({
      type: 'message_api_delivered',
      data: { message: { id: 'm-1', delivered_at_utc: '2026-10-07T10:00:00Z' } },
    });
    assert.equal(e.status, 'DELIVERED');
    assert.equal(e.messageId, 'm-1');
    assert.equal(e.at, '2026-10-07T10:00:00.000Z');
  });
  it('falls back to callback data and ignores unrelated events', () => {
    const e = parseWebhookEvent({ type: 'message_api_read', data: { message: { callback_data: 'wac:4:99' } } });
    assert.deepEqual([e.campaignId, e.contactId, e.status], [4, 99, 'READ']);
    assert.equal(parseWebhookEvent({ type: 'customer_created', data: {} }), null);
  });
});

describe('campaign input validation', () => {
  it('accepts the documented example', () => {
    const v = validateCampaignInput({
      name: 'October New Offer', template_name: 'new_offer', language_code: 'en', header_media_url: 'https://example.com/offer.jpg',
    });
    assert.equal(v.template_name, 'new_offer');
    assert.deepEqual(v.body_variables, [{ source: 'column', key: 'name' }]);
  });
  it('rejects bad template names and non-https media', () => {
    assert.throws(() => validateCampaignInput({ name: 'x', template_name: 'New Offer' }), /Template name/);
    assert.throws(() => validateCampaignInput({ name: 'x', template_name: 'a', header_media_url: 'http://x.com/a.jpg' }), /https/);
  });
});
