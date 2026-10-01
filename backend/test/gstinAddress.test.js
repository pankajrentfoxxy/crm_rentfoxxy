const test = require('node:test');
const assert = require('node:assert');
const { normalizeGstPayload } = require('../services/gstinLookupService');

test('GSTIN address holds the street part only; city, state and PIN are separate', () => {
  const out = normalizeGstPayload({
    data: {
      gstin: '07AAAAA0000A1Z5',
      pradr: { addr: {
        flno: '2ND FLOOR', bno: '205', bnm: '64-65 HARSH BHAWAN', st: '', locality: 'Nehru Place',
        loc: 'New Delhi', dst: 'South East Delhi', stcd: 'Delhi', pncd: '110019',
      } },
    },
  }, '07AAAAA0000A1Z5');
  assert.strictEqual(out.address, '2ND FLOOR, 205, 64-65 HARSH BHAWAN, Nehru Place, New Delhi');
  assert.strictEqual(out.city, 'South East Delhi');
  assert.strictEqual(out.state, 'Delhi');
  assert.strictEqual(out.pincode, '110019');
});

test('without a district the place is the city and is not repeated in the address', () => {
  const out = normalizeGstPayload({ data: { pradr: { addr: {
    bno: '12', st: 'MG Road', locality: 'MG Road', loc: 'Gurugram', stcd: 'Haryana', pncd: '122001',
  } } } }, '06AAAAA0000A1Z5');
  assert.strictEqual(out.address, '12, MG Road');
  assert.strictEqual(out.city, 'Gurugram');
});
