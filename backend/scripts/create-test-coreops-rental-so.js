/**
 * Test: create 1 rental SO for CoreOps.AI with 5 differently configured
 * ready-to-rent laptops, then attach those serials.
 *
 * Usage: node scripts/create-test-coreops-rental-so.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const pool = require('../config/db');

const API_HOST = process.env.TEST_API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.PORT || 5001);
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@rentfoxxy.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'Test@1234';

function request(method, path, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: API_HOST,
        port: API_PORT,
        path,
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 60000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('request timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function pickReadySerials(limit = 5) {
  const stock = await pool.query(`
    SELECT serial_id,
           serial_number,
           inventory_asset_code AS ttspl_id,
           inventory_status,
           qc_status,
           extra->>'brand' AS brand,
           COALESCE(extra->>'model', extra->>'model_name') AS model_name,
           extra->>'processor' AS processor,
           extra->>'generation' AS generation,
           extra->>'ram' AS ram,
           extra->>'storage' AS storage,
           extra->>'gpu' AS gpu,
           extra->>'screen_size' AS screen_size
    FROM vendor_serial_numbers vsn
    WHERE vsn.qc_status = 'passed'
      AND vsn.inventory_status IN ('in_stock', 'passed')
      AND vsn.po_id IS NOT NULL
      AND vsn.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM sales_order_serials sos
        WHERE sos.serial_id = vsn.serial_id AND sos.status = 'attached'
      )
      AND COALESCE(extra->>'processor', '') <> ''
      AND COALESCE(extra->>'ram', '') <> ''
      AND COALESCE(extra->>'storage', '') <> ''
    ORDER BY serial_id DESC
    LIMIT 150
  `);

  const seen = new Set();
  const picked = [];
  for (const row of stock.rows) {
    const key = [row.processor, row.generation, row.ram, row.storage]
      .map((x) => String(x || '').toUpperCase().replace(/\s+/g, ''))
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  return picked;
}

async function main() {
  const custRes = await pool.query(`
    SELECT customer_id, name, company_name, email, phone, gst_no, customer_type
    FROM customers
    WHERE COALESCE(status, 1) = 1
      AND (company_name ILIKE '%CoreOps%' OR name ILIKE '%CoreOps%')
    ORDER BY customer_id
    LIMIT 1
  `);
  const customer = custRes.rows[0];
  if (!customer) throw new Error('Customer CoreOps.AI not found');

  const serials = await pickReadySerials(5);
  if (serials.length < 5) {
    throw new Error(`Need 5 ready-to-rent serials with distinct configs; found ${serials.length}`);
  }

  console.log('Customer:', customer.customer_id, customer.company_name);
  console.log('Serials:');
  for (const s of serials) {
    console.log(
      `  ${s.ttspl_id} ${s.serial_number} | ${s.brand} ${s.model_name} | ${s.processor} / ${s.generation} / ${s.ram} / ${s.storage}`
    );
  }

  const login = await request('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!login.data?.token) {
    throw new Error(`Login failed: ${JSON.stringify(login.data)}`);
  }
  const token = login.data.token;

  const shipping = {
    name: String(customer.company_name || '').trim() || 'CoreOps.AI',
    phone: customer.phone || '9899700341',
    address: 'CoreOps.AI — Test delivery address',
    city: 'Noida',
    state: 'Uttar Pradesh',
    zip_code: '201301',
    country: 'India',
    gst_number: customer.gst_no || '09AALCC7914K1Z5',
  };
  const billing = {
    name: String(customer.company_name || '').trim() || 'CoreOps.AI',
    email: customer.email,
    phone: customer.phone || '9899700341',
    address: 'CoreOps.AI — Test billing address',
    city: 'Noida',
    state: 'Uttar Pradesh',
    pincode: '201301',
    country: 'India',
    gst_number: customer.gst_no || '09AALCC7914K1Z5',
  };

  const line_items = serials.map((s, i) => ({
    brand: s.brand || 'Unknown',
    model_name: s.model_name || 'Laptop',
    processor: s.processor,
    generation: s.generation || '-',
    ram: s.ram,
    storage: s.storage,
    gpu: s.gpu || 'Integrated',
    screen_size: s.screen_size || '14-inch',
    quantity: 1,
    rate: 2500 + i * 250,
    locking_period: 3,
    remark: `Test line ${i + 1} — ${s.ttspl_id}`,
  }));

  const create = await request('POST', '/api/sales-management/sales-orders', {
    token,
    body: {
      customer_id: customer.customer_id,
      customer_name: String(customer.company_name || '').trim() || 'CoreOps.AI',
      email: customer.email,
      customer_email: customer.email,
      customer_mobile: customer.phone,
      GST_number: customer.gst_no,
      quotation_type: 'rental',
      branch: 'rentfoxxy',
      is_without_quotation: true,
      quotation_number: 'N/A',
      security_type: 'none',
      security_amount: 0,
      shiping_charges: 0,
      supply_state: 'uttar pradesh',
      customer_shipping_address: shipping,
      customer_billing_address: billing,
      line_items,
    },
  });

  if (create.status >= 400 || !create.data?.sales_order_number) {
    throw new Error(`Create SO failed (${create.status}): ${JSON.stringify(create.data)}`);
  }
  const soNumber = create.data.sales_order_number;
  console.log('\nCreated SO:', soNumber);

  const linesRes = await pool.query(
    `SELECT id AS line_id, brand, model_name, processor, generation, ram, storage, remark
       FROM sales_order_lines
      WHERE sales_order_number = $1
      ORDER BY id ASC`,
    [soNumber]
  );
  const lines = linesRes.rows;
  if (lines.length !== serials.length) {
    throw new Error(`Expected ${serials.length} lines, got ${lines.length}`);
  }

  const attached = [];
  for (let i = 0; i < serials.length; i += 1) {
    const serial = serials[i];
    const line = lines[i];
    const attach = await request('POST', `/api/sales-management/sales-orders/${encodeURIComponent(soNumber)}/serials`, {
      token,
      body: { serial_id: serial.serial_id, line_id: line.line_id },
    });
    if (attach.status >= 400 || attach.data?.success === false) {
      throw new Error(
        `Attach failed for ${serial.ttspl_id} → line ${line.line_id}: ${JSON.stringify(attach.data)}`
      );
    }
    attached.push({
      line_id: line.line_id,
      ttspl_id: serial.ttspl_id,
      serial_number: serial.serial_number,
      config: `${serial.brand} ${serial.model_name} | ${serial.processor} / ${serial.generation} / ${serial.ram} / ${serial.storage}`,
      attach: attach.data,
    });
    console.log(`Attached ${serial.ttspl_id} → line ${line.line_id}`);
  }

  console.log('\nDone.');
  console.log(JSON.stringify({
    sales_order_number: soNumber,
    customer: { id: customer.customer_id, name: customer.company_name },
    url: `http://localhost:3000/sales-pipeline/sales-orders-rental`,
    detail_hint: soNumber,
    laptops: attached.map((a) => ({
      ttspl_id: a.ttspl_id,
      serial_number: a.serial_number,
      line_id: a.line_id,
      config: a.config,
    })),
  }, null, 2));
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); } catch { /* ignore */ }
  });
