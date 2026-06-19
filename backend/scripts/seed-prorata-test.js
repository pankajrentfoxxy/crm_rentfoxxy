/**
 * Pro-rata billing test seed.
 *
 * VENDOR side (Vendor 2 — Kapoor Laptops; currently has NO rental serials, so its
 *   April/May monthly bills will be purely this test data):
 *   - PO-TST-VAPR (rental_purchase, rate 4000) + GRN, 20 units received across April
 *   - PO-TST-VMAY (rental_purchase, rate 4500) + GRN, 20 units received across May
 *   Cases cover: full month, received mid-month, returned-to-vendor mid-month,
 *   spanning April->May (carry-over), received near month end.
 *
 * CUSTOMER side (2 NEW dedicated customers, units on a direct_purchase PO so they
 *   never pollute any vendor monthly bill):
 *   - Customer A "Acme Cloud Pvt Ltd": 20 units, rent_start in April (mixed rates),
 *     some returned mid-April, some returned mid-May, some ongoing.
 *   - Customer B "Globex Systems Pvt Ltd": 20 units, rent_start in May, similar mix.
 *
 * Billing engine (billingSchedulerService.js) reads vendor_serial_numbers only:
 *   - Customer invoice: current_customer_id, inventory_status IN (rented,returned),
 *     rent_start_date / COALESCE(rent_end_date, returned_at), rent_monthly_rate.
 *   - Vendor bill: PO rental_purchase|rent_to_own, extra.received_at / extra.returned_at,
 *     rate = PO line_items[0].rate.
 *
 * Idempotent: re-running is a no-op (guarded on PO-TST-VAPR existing).
 */
require('dotenv').config();
const pool = require('../config/db');

const MARKER_PO = 'PO-TST-VAPR';
const pad = (n) => 'TTSPL' + String(n).padStart(4, '0');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ex = await client.query(
      `SELECT 1 FROM vendor_purchase_orders WHERE purchase_order_number = $1`, [MARKER_PO]);
    if (ex.rows.length) {
      await client.query('ROLLBACK');
      console.log('Pro-rata test data already seeded (PO-TST-VAPR exists). Nothing to do.');
      process.exit(0);
    }

    // ---- TTSPL allocator (locks the sequence row) ----
    const seqRes = await client.query(
      `SELECT next_num FROM vendor_inventory_asset_sequence WHERE id = 1 FOR UPDATE`);
    let nextNum = seqRes.rows[0].next_num;
    const ttspl = () => pad(nextNum++);

    // ---- helpers ----
    async function createPO({ number, vendorId, type, rate, qty, brand, model, ram, storage,
                             processor, generation, screen, state, sameState, dateStr }) {
      const sub = rate * qty;
      const total = +(sub * 1.18).toFixed(2);
      const li = [{ gpu: 'Integrated', ram, rate, brand, model, storage, quantity: qty,
                    processor, generation, screen_size: screen, warranty_months: 12 }];
      const po = await client.query(
        `INSERT INTO vendor_purchase_orders
          (purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state,
           is_same_state, sub_total_amount, total_amount, line_items, status, invoice_created,
           bill_files, public_token, rental_period, approved_at, sent_to_vendor_at, created_at, updated_at)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9::jsonb,'completed',false,'[]'::jsonb,gen_random_uuid(),
                 $10,$2::timestamptz,$2::timestamptz,NOW(),NOW())
         RETURNING po_id`,
        [number, dateStr, type, vendorId, state, sameState, sub, total, JSON.stringify(li),
         type === 'direct_purchase' ? null : `12 months @ ${rate}/month`]);
      const poId = po.rows[0].po_id;

      const pd = await client.query(
        `INSERT INTO vendor_product_details
          (po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size,
           quantity, rate, vendor_locking_period, warranty, status, random_id, created_at, updated_at)
         VALUES ($1,'Laptop',$2,$3,$4,$5,$6,$7,'Integrated',$8,$9,$10,12,12,'received',$11,NOW(),NOW())
         RETURNING product_detail_id`,
        [poId, brand, model, processor, generation, ram, storage, screen, qty, rate, 'VPD-' + number]);
      const pdId = pd.rows[0].product_detail_id;

      const grn = await client.query(
        `INSERT INTO vendor_goods_received_notes (po_id, meta, bill_status, bill_files, created_at, updated_at)
         VALUES ($1,$2::jsonb,'received','[]'::jsonb,NOW(),NOW()) RETURNING grn_id`,
        [poId, JSON.stringify({ notes: `Seeded GRN for ${number}`, received_by: 'Sanjay Yadav' })]);

      return { poId, grnId: grn.rows[0].grn_id, pdId,
               spec: { brand, model, ram, storage, processor, generation } };
    }

    async function vendorSerial(ctx, serial, received, returned) {
      const code = ttspl();
      const { spec, pdId } = ctx;
      const extra = { ...spec, status: 'passed', ttspl_id: code, product_detail_id: String(pdId),
                      inventory_tag: 'rental', received_at: received };
      if (returned) extra.returned_at = returned;
      await client.query(
        `INSERT INTO vendor_serial_numbers
          (po_id, grn_id, serial_number, inventory_asset_code, qc_status, inventory_status, extra,
           current_entity, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'passed',$5,$6::jsonb,'rentfoxxy',NOW(),NOW())`,
        [ctx.poId, ctx.grnId, serial, code, returned ? 'returned' : 'in_stock', JSON.stringify(extra)]);
      return code;
    }

    async function custSerial(ctx, serial, customerId, dc, rentStart, rentEnd, rate) {
      const code = ttspl();
      const { spec, pdId } = ctx;
      const returned = !!rentEnd;
      const extra = { ...spec, os: 'Windows 11', condition: 'Good', status: 'passed', ttspl_id: code,
                      product_detail_id: String(pdId), inventory_tag: 'rental' };
      await client.query(
        `INSERT INTO vendor_serial_numbers
          (po_id, grn_id, serial_number, inventory_asset_code, qc_status, inventory_status, extra,
           current_customer_id, current_entity, current_dc_number, dispatch_mode,
           dispatched_at, delivered_at, returned_at, rent_start_date, rent_end_date,
           rent_monthly_rate, status_changed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'passed',$5,$6::jsonb,$7,'rentfoxxy',$8,'courier',
                 $9::timestamptz,$9::timestamptz,$10::timestamptz,$11::date,$12::date,$13,
                 COALESCE($10::timestamptz,$9::timestamptz),NOW(),NOW())`,
        [ctx.poId, ctx.grnId, serial, code, returned ? 'returned' : 'rented', JSON.stringify(extra),
         customerId, dc, rentStart + ' 10:00+05:30',
         returned ? rentEnd + ' 12:00+05:30' : null, rentStart, rentEnd || null, rate]);
      return code;
    }

    // =========================================================
    // VENDOR billing test (Vendor 2 — Kapoor Laptops)
    // =========================================================
    const vApr = await createPO({ number: 'PO-TST-VAPR', vendorId: 2, type: 'rental_purchase',
      rate: 4000, qty: 20, brand: 'HP', model: 'EliteBook 840 G8', ram: '16 GB', storage: '512 GB SSD',
      processor: 'Intel Core i5', generation: '11th Gen', screen: '14"', state: 'Delhi',
      sameState: false, dateStr: '2026-03-28' });

    const vMay = await createPO({ number: 'PO-TST-VMAY', vendorId: 2, type: 'rental_purchase',
      rate: 4500, qty: 20, brand: 'HP', model: 'ProBook 450 G9', ram: '16 GB', storage: '512 GB SSD',
      processor: 'Intel Core i5', generation: '12th Gen', screen: '15.6"', state: 'Delhi',
      sameState: false, dateStr: '2026-04-28' });

    const vAprCases = [
      { n: 6, received: '2026-04-01', returned: null },        // full April, carries to May+
      { n: 4, received: '2026-04-16', returned: null },        // April 15d, carries
      { n: 4, received: '2026-04-01', returned: '2026-04-20' },// April 20d, gone in May
      { n: 3, received: '2026-04-10', returned: '2026-05-10' },// April 21d + May 10d
      { n: 3, received: '2026-04-26', returned: null },        // April 5d, carries
    ];
    const vMayCases = [
      { n: 6, received: '2026-05-01', returned: null },        // full May, carries to June+
      { n: 4, received: '2026-05-16', returned: null },        // May 16d
      { n: 4, received: '2026-05-01', returned: '2026-05-20' },// May 20d
      { n: 3, received: '2026-05-10', returned: null },        // May 22d
      { n: 3, received: '2026-05-28', returned: null },        // May 4d
    ];

    let vi = 0;
    for (const c of vAprCases) for (let k = 0; k < c.n; k++)
      await vendorSerial(vApr, `VT-APR-${String(++vi).padStart(3, '0')}`, c.received, c.returned);
    vi = 0;
    for (const c of vMayCases) for (let k = 0; k < c.n; k++)
      await vendorSerial(vMay, `VT-MAY-${String(++vi).padStart(3, '0')}`, c.received, c.returned);

    // =========================================================
    // CUSTOMER billing test (2 new customers, units on a direct_purchase PO)
    // =========================================================
    const cPO = await createPO({ number: 'PO-TST-CUST', vendorId: 1, type: 'direct_purchase',
      rate: 38000, qty: 40, brand: 'Dell', model: 'Latitude 5440', ram: '16 GB', storage: '512 GB SSD',
      processor: 'Intel Core i5', generation: '13th Gen', screen: '14"', state: 'Uttar Pradesh',
      sameState: false, dateStr: '2026-03-25' });

    async function newCustomer(name, company, email, gst, pan, dc) {
      const r = await client.query(
        `INSERT INTO customers (name, company_name, email, phone, whatsapp_number, gst_no, type,
           billing_address, billing_city, billing_state, billing_pincode, shipping_same, pan_number,
           company_type, company_size, industry, kyc_verified, kyc_status, designation, status)
         VALUES ($1,$2,$3,$4,$4,$5,'B2B',$6,'Bengaluru','Karnataka','560001',true,$7,
           'Pvt Ltd',120,'IT Services',true,'verified','Procurement Head',1)
         RETURNING customer_id`,
        [name, company, email, '9' + Math.floor(100000000 + Math.random() * 899999999),
         gst, 'Prestige Tech Park, Outer Ring Rd', pan]);
      return r.rows[0].customer_id;
    }

    const custA = await newCustomer('Vikram Nair', 'Acme Cloud Pvt Ltd', 'accounts@acmecloud.test',
      '29AABCA1111A1Z1', 'AABCA1111A');
    const custB = await newCustomer('Priya Iyer', 'Globex Systems Pvt Ltd', 'accounts@globexsys.test',
      '29AABCG2222B1Z2', 'AABCG2222B');

    const cACases = [
      { n: 6, start: '2026-04-01', end: null,         rate: 4000 }, // full April + carries
      { n: 4, start: '2026-04-16', end: null,         rate: 3500 }, // April 15d + carries
      { n: 4, start: '2026-04-01', end: '2026-04-20', rate: 4500 }, // April 20d, gone in May
      { n: 3, start: '2026-04-10', end: '2026-05-12', rate: 5000 }, // April 21d + May 12d
      { n: 3, start: '2026-04-27', end: null,         rate: 3000 }, // April 4d + carries
    ];
    const cBCases = [
      { n: 6, start: '2026-05-01', end: null,         rate: 4000 }, // full May + carries
      { n: 4, start: '2026-05-16', end: null,         rate: 3500 }, // May 16d
      { n: 4, start: '2026-05-01', end: '2026-05-20', rate: 4500 }, // May 20d
      { n: 3, start: '2026-05-10', end: null,         rate: 5000 }, // May 22d
      { n: 3, start: '2026-05-28', end: null,         rate: 3000 }, // May 4d
    ];

    let ci = 0;
    for (const c of cACases) for (let k = 0; k < c.n; k++)
      await custSerial(cPO, `CA-${String(++ci).padStart(3, '0')}`, custA, 'DC-TST-CA', c.start, c.end, c.rate);
    ci = 0;
    for (const c of cBCases) for (let k = 0; k < c.n; k++)
      await custSerial(cPO, `CB-${String(++ci).padStart(3, '0')}`, custB, 'DC-TST-CB', c.start, c.end, c.rate);

    // ---- finalise sequence + marker ----
    await client.query(`UPDATE vendor_inventory_asset_sequence SET next_num = $1 WHERE id = 1`, [nextNum]);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('seed_prorata_test_apr_may')
       ON CONFLICT (name) DO NOTHING`);

    await client.query('COMMIT');

    console.log('Pro-rata test data seeded successfully.');
    console.table([
      { item: 'Vendor April PO', value: `${vApr.poId} (PO-TST-VAPR, rate 4000, 20 units)` },
      { item: 'Vendor May PO',   value: `${vMay.poId} (PO-TST-VMAY, rate 4500, 20 units)` },
      { item: 'Customer PO',     value: `${cPO.poId} (PO-TST-CUST, direct, 40 units)` },
      { item: 'Customer A',      value: `${custA} (Acme Cloud Pvt Ltd, 20 units, April starts)` },
      { item: 'Customer B',      value: `${custB} (Globex Systems Pvt Ltd, 20 units, May starts)` },
      { item: 'TTSPL allocated', value: `${pad(seqRes.rows[0].next_num)} .. ${pad(nextNum - 1)}` },
    ]);
    console.log('\nIDS:' + JSON.stringify({ vendorId: 2, custA, custB }));
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('SEED FAILED (rolled back):', err.message);
    if (err.detail) console.error('  detail:', err.detail);
    if (err.where) console.error('  where:', err.where);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
