import { applyCustomer, applySiteFromAsset, sameSite, customerHasDraftWork, EMPTY_TICKET_DRAFT } from './ticketDraft';

test('applyCustomer resets downstream draft', () => {
  const a = applyCustomer(EMPTY_TICKET_DRAFT, { customer_id: 1, name: 'Acme', phone: '9876543210', email: 'a@a.com' });
  const dirty = { ...a, lines: [{ serial_id: 9 }], contact_phone: '9999999999' };
  const b = applyCustomer(dirty, { customer_id: 2, name: 'Beta', phone: '9123456789', email: 'b@b.com' });
  expect(b.contact_phone).toBe('9123456789');
  expect(b.lines).toEqual([]);
  expect(b.step).toBe(0);
});

test('re-selecting same customer is a no-op', () => {
  const a = applyCustomer(EMPTY_TICKET_DRAFT, { customer_id: 1, name: 'Acme', phone: '9876543210' });
  const typed = { ...a, contact_phone: '9988776655', contact_source: 'MANUAL' };
  const again = applyCustomer(typed, { customer_id: 1, name: 'Acme', phone: '9876543210' });
  expect(again.contact_phone).toBe('9988776655');
});

test('cross-site detection', () => {
  expect(sameSite({ site_key: 'pin:122015:x', delivery_pincode: '122015' }, 'pin:122015:x', '122015')).toBe(true);
  expect(sameSite({ site_key: 'pin:560066:y', delivery_pincode: '560066' }, 'pin:122015:x', '122015')).toBe(false);
});

test('applySiteFromAsset locks location', () => {
  const s = applySiteFromAsset(EMPTY_TICKET_DRAFT, {
    site_key: 'pin:122015:uv',
    delivery_pincode: '122015',
    delivery_address: 'Udyog Vihar',
    dc_number: 'DC/1',
  });
  expect(s.site_source).toBe('DERIVED_FROM_ASSET');
  expect(s.site_dc_number).toBe('DC/1');
});

test('draft work detection', () => {
  expect(customerHasDraftWork(EMPTY_TICKET_DRAFT)).toBe(false);
  expect(customerHasDraftWork({ ...EMPTY_TICKET_DRAFT, lines: [{}] })).toBe(true);
});
