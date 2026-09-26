'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('feedback WhatsApp stays off until its template is named', async () => {
  delete process.env.INTERAKT_TPL_SUPPORT_FEEDBACK;
  const { notifySupportFeedback } = require('../services/supportWhatsApp');
  const out = await notifySupportFeedback(1, 'https://crm.rentfoxxy.com/feedback/x');
  assert.equal(out.skipped, true);
  assert.match(out.error, /not configured/);
});

test('feedback template takes customer, ticket and link', () => {
  const { resolveTemplate } = require('../constants/whatsappTemplates');
  const spec = resolveTemplate('support_feedback_v1');
  assert.equal(spec.varCount, 3);
  assert.deepEqual(spec.fields, ['customer_name', 'ticket_no', 'feedback_link']);
});
