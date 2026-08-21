'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { serializeWorkOrder } = require('../services/supportWoSerialize');
const { isFieldTechnician, applyTechnicianTicketScope } = require('../services/supportTicketScope');

test('serializeWorkOrder strips OTP secrets', () => {
  const out = serializeWorkOrder({
    wo_id: 1, wo_number: 'WO-1', customer_otp: '123456', otp_expires_at: new Date(),
    otp_verified_at: new Date(), otp_sent_to: '9876543210', status: 'ON_SITE',
  });
  assert.equal(out.customer_otp, undefined);
  assert.equal(out.otp_expires_at, undefined);
  assert.equal(out.otp_verified_at, undefined);
  assert.equal(out.otp_sent_to, '••••••3210');
});

test('field technician roles are scoped', () => {
  assert.equal(isFieldTechnician({ role: 'support_tech' }), true);
  assert.equal(isFieldTechnician({ role: 'technician' }), true);
  assert.equal(isFieldTechnician({ role: 'support_lead' }), false);
  const conds = [];
  const params = [];
  applyTechnicianTicketScope({ role: 'support_tech', user_id: 9 }, conds, params);
  assert.equal(conds.length, 1);
  assert.deepEqual(params, [9]);
});

after(() => {});
