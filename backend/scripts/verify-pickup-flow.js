const { deriveItemCurrentStep } = require('../services/supportTicketFlow');

const base = { item_type: 'pickup', pickup_type: 'return', pickup_method: 'inhouse', status: 'open', assigned_to: 15 };
const cases = [
  ['assigned (fresh)', { ...base }, 'assigned'],
  ['reached (visited_at)', { ...base, status: 'visited', visited_at: 'now' }, 'reached'],
  ['pod uploaded', { ...base, visited_at: 'now', pod_image_path: 'x.jpg' }, 'pod_uploaded'],
  ['customer otp', { ...base, visited_at: 'now', pod_image_path: 'x.jpg', customer_otp_verified_at: 'now', status: 'picked_up' }, 'customer_otp'],
  ['warehouse confirmed', { ...base, warehouse_received_at: 'now', status: 'inventory_updated' }, 'warehouse_confirmed'],
  ['no pickup_type, inhouse default', { item_type: 'pickup', pickup_method: 'inhouse', status: 'open', assigned_to: 15 }, 'assigned'],
  ['no type/method (null)', { item_type: 'pickup', status: 'open', assigned_to: 15 }, 'assigned'],
  ['courier return', { ...base, pickup_method: 'courier', status: 'open' }, 'assigned'],
  ['legacy self_carry', { item_type: 'pickup', pickup_method: 'self_carry', status: 'in_transit' }, 'in_transit'],
];

let pass = 0;
for (const [name, item, expected] of cases) {
  const got = deriveItemCurrentStep(item);
  const ok = got === expected;
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: expected=${expected} got=${got}`);
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
