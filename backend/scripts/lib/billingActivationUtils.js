/**
 * Shared read/derive helpers for billing activation & backfill scripts.
 * NULL-fill only — never overwrites existing billing trigger fields.
 */
const fs = require('fs');
const path = require('path');

function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : `${s.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s.slice(0, 10);
}

function ymFromDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  return { year: dt.getFullYear(), month: dt.getMonth() + 1 };
}

function parseYm(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function ymKey({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthRange(fromYm, untilYm) {
  const out = [];
  let year = fromYm.year;
  let month = fromYm.month;
  while (year < untilYm.year || (year === untilYm.year && month <= untilYm.month)) {
    out.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function currentMonthYm() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function lastCompletedMonthYm() {
  const now = new Date();
  if (now.getMonth() === 0) return { year: now.getFullYear() - 1, month: 12 };
  return { year: now.getFullYear(), month: now.getMonth() };
}

function parseJsonArray(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return raw.trim() ? [raw] : [];
    }
  }
  return [];
}

function serialToken(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim().toLowerCase();
  if (typeof raw === 'object') {
    return String(raw.serial || raw.serial_number || raw.value || '').trim().toLowerCase();
  }
  return String(raw).trim().toLowerCase();
}

function dcLineHasSerial(line, serialNumber, ttsplId) {
  const sn = serialToken(serialNumber);
  const tid = serialToken(ttsplId);
  const pools = [
    ...parseJsonArray(line.delivered_serial_numbers),
    ...parseJsonArray(line.serial_number),
    ...parseJsonArray(line.pickuped_serial_numbers),
  ];
  for (const item of pools) {
    const tok = serialToken(item);
    if (tok && (tok === sn || (tid && tok.includes(tid)))) return true;
  }
  return false;
}

function dcDeliveryDate(line) {
  return (
    parseDate(line.delivery_completed_at)
    || parseDate(line.delivered_at)
    || parseDate(line.date_and_time)
    || parseDate(line.created_at)
  );
}

async function gatherCustomerReadiness(pool) {
  const res = await pool.query(
    `SELECT
       COUNT(*)::int AS total_deployed,
       COUNT(*) FILTER (
         WHERE vsn.inventory_status IN ('rented', 'returned')
       )::int AS eligible_status,
       COUNT(*) FILTER (
         WHERE vsn.returned_at IS NOT NULL
           AND vsn.inventory_status IS DISTINCT FROM 'returned'
           AND vsn.inventory_status IS DISTINCT FROM 'sold'
       )::int AS needs_returned_status,
       COUNT(*) FILTER (
         WHERE vsn.returned_at IS NULL
           AND vsn.inventory_status NOT IN ('rented', 'sold', 'on_demo')
       )::int AS needs_rented_status,
       COUNT(*) FILTER (
         WHERE vsn.inventory_status IN ('rented', 'returned')
           AND vsn.rent_start_date IS NULL
       )::int AS missing_rent_start,
       COUNT(*) FILTER (
         WHERE vsn.inventory_status IN ('rented', 'returned')
           AND (vsn.rent_monthly_rate IS NULL OR vsn.rent_monthly_rate = 0)
       )::int AS missing_rate,
       COUNT(*) FILTER (
         WHERE vsn.inventory_status NOT IN ('sold', 'on_demo')
           AND vsn.rent_start_date IS NULL
       )::int AS missing_rent_start_deployed,
       COUNT(*) FILTER (
         WHERE vsn.inventory_status NOT IN ('sold', 'on_demo')
           AND (vsn.rent_monthly_rate IS NULL OR vsn.rent_monthly_rate = 0)
       )::int AS missing_rate_deployed,
       COUNT(*) FILTER (
         WHERE NOT EXISTS (
           SELECT 1 FROM customers c WHERE c.customer_id = vsn.current_customer_id
         )
       )::int AS orphan_customer,
       COUNT(DISTINCT vsn.current_customer_id)::int AS distinct_customers
     FROM vendor_serial_numbers vsn
     WHERE vsn.current_customer_id IS NOT NULL
       AND vsn.deleted_at IS NULL`
  );
  return res.rows[0];
}

async function gatherDeployedStatusBreakdown(pool) {
  const res = await pool.query(
    `SELECT COALESCE(inventory_status, '(null)') AS inventory_status, COUNT(*)::int AS c
       FROM vendor_serial_numbers
      WHERE current_customer_id IS NOT NULL AND deleted_at IS NULL
      GROUP BY 1
      ORDER BY c DESC
      LIMIT 15`
  );
  return res.rows;
}

async function planStatusNormalization(pool) {
  const res = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE returned_at IS NOT NULL
           AND inventory_status IS DISTINCT FROM 'returned'
           AND inventory_status IS DISTINCT FROM 'sold'
       )::int AS to_returned,
       COUNT(*) FILTER (
         WHERE returned_at IS NULL
           AND inventory_status NOT IN ('rented', 'sold', 'on_demo')
       )::int AS to_rented
     FROM vendor_serial_numbers
     WHERE deleted_at IS NULL
       AND current_customer_id IS NOT NULL`
  );
  return res.rows[0];
}

async function applyStatusNormalization(client) {
  const toReturned = await client.query(
    `UPDATE vendor_serial_numbers
        SET inventory_status = 'returned',
            status_changed_at = COALESCE(status_changed_at, NOW()),
            updated_at = NOW()
      WHERE deleted_at IS NULL
        AND current_customer_id IS NOT NULL
        AND returned_at IS NOT NULL
        AND inventory_status IS DISTINCT FROM 'returned'
        AND inventory_status IS DISTINCT FROM 'sold'`
  );
  const toRented = await client.query(
    `UPDATE vendor_serial_numbers
        SET inventory_status = 'rented',
            status_changed_at = COALESCE(status_changed_at, NOW()),
            updated_at = NOW()
      WHERE deleted_at IS NULL
        AND current_customer_id IS NOT NULL
        AND returned_at IS NULL
        AND inventory_status NOT IN ('rented', 'sold', 'on_demo')`
  );
  return { to_returned: toReturned.rowCount, to_rented: toRented.rowCount };
}

async function gatherVendorReadiness(pool) {
  const res = await pool.query(
    `SELECT
       COUNT(*)::int AS total_serials,
       COUNT(*) FILTER (
         WHERE (vpo.line_items->0->>'rate') IS NULL
            OR COALESCE((vpo.line_items->0->>'rate')::numeric, 0) = 0
       )::int AS missing_po_rate,
       COUNT(*) FILTER (
         WHERE COALESCE(
           (vsn.extra->>'received_at')::date,
           vsn.rental_start_date,
           vsn.created_at::date
         ) IS NULL
       )::int AS missing_start_date,
       COUNT(DISTINCT vpo.vendor_id)::int AS distinct_vendors
     FROM vendor_serial_numbers vsn
     JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
     WHERE vpo.deleted_at IS NULL
       AND vsn.deleted_at IS NULL
       AND vpo.purchase_order_type IN ('rental_purchase', 'rent_to_own')`
  );
  return res.rows[0];
}

async function loadActivationContext(pool) {
  const [serialsRes, dcRes, soRes, quotRes, rentDevRes, poRateRes, grnRes] = await Promise.all([
    pool.query(
      `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code,
              vsn.current_customer_id, vsn.current_dc_number, vsn.rent_start_date,
              vsn.rent_monthly_rate, vsn.delivered_at, vsn.created_at, vsn.extra,
              vsn.inventory_status, vsn.po_id, vsn.grn_id, vsn.rental_start_date
         FROM vendor_serial_numbers vsn
        WHERE vsn.current_customer_id IS NOT NULL
          AND vsn.deleted_at IS NULL
          AND vsn.inventory_status NOT IN ('sold', 'on_demo')`
    ),
    pool.query(
      `SELECT id, dc_number, sales_order_number, quotation_number, customer_id,
              delivery_completed_at, delivered_at, date_and_time, created_at,
              delivered_serial_numbers, serial_number, brand, model_name
         FROM delivery_challan_lines
        WHERE movement_type IS DISTINCT FROM 'return'`
    ),
    pool.query(
      `SELECT sales_order_number, customer_id, rate, brand, model_name, created_at
         FROM sales_order_lines
        WHERE sales_order_number IS NOT NULL`
    ),
    pool.query(
      `SELECT quotation_number, customer_id, rate, brand, model_name
         FROM sales_quotations
        WHERE rate IS NOT NULL AND rate > 0`
    ),
    pool.query(
      `SELECT serial_id, rent_start_date, month_rent, rent_amount, po_id
         FROM rent_devices
        ORDER BY id DESC`
    ),
    pool.query(
      `SELECT po_id, MAX(rate)::numeric AS rate
         FROM vendor_product_details
        GROUP BY po_id`
    ),
    pool.query(
      `SELECT grn_id, po_id, created_at
         FROM vendor_goods_received_notes`
    ),
  ]);

  const dcByNumber = new Map();
  for (const row of dcRes.rows) {
    if (!dcByNumber.has(row.dc_number)) dcByNumber.set(row.dc_number, []);
    dcByNumber.get(row.dc_number).push(row);
  }

  const soByNumber = new Map();
  for (const row of soRes.rows) {
    if (!soByNumber.has(row.sales_order_number)) soByNumber.set(row.sales_order_number, []);
    soByNumber.get(row.sales_order_number).push(row);
  }

  const quotByNumber = new Map(quotRes.rows.map((r) => [r.quotation_number, r]));
  const rentDevBySerial = new Map();
  for (const row of rentDevRes.rows) {
    if (!rentDevBySerial.has(row.serial_id)) rentDevBySerial.set(row.serial_id, row);
  }
  const poRateByPo = new Map(poRateRes.rows.map((r) => [r.po_id, parseMoney(r.rate)]));
  const grnById = new Map(grnRes.rows.map((r) => [r.grn_id, r]));

  return {
    serials: serialsRes.rows,
    dcByNumber,
    soByNumber,
    quotByNumber,
    rentDevBySerial,
    poRateByPo,
    grnById,
  };
}

function deriveRentStartDate(serial, ctx) {
  if (serial.rent_start_date) {
    return { date: parseDate(serial.rent_start_date), source: 'existing', confidence: 'high' };
  }

  const dcNum = serial.current_dc_number;
  const dcLines = dcNum ? (ctx.dcByNumber.get(dcNum) || []) : [];
  for (const line of dcLines) {
    if (!dcLineHasSerial(line, serial.serial_number, serial.inventory_asset_code)) continue;
    const d = dcDeliveryDate(line);
    if (d) return { date: d, source: 'delivery_challan', confidence: 'high' };
  }

  for (const lines of ctx.dcByNumber.values()) {
    for (const line of lines) {
      if (line.customer_id !== serial.current_customer_id) continue;
      if (!dcLineHasSerial(line, serial.serial_number, serial.inventory_asset_code)) continue;
      const d = dcDeliveryDate(line);
      if (d) return { date: d, source: 'delivery_challan_customer', confidence: 'high' };
    }
  }

  for (const line of dcLines) {
    if (line.sales_order_number) {
      const soLines = ctx.soByNumber.get(line.sales_order_number) || [];
      const soDate = soLines.map((s) => parseDate(s.created_at)).find(Boolean);
      if (soDate) return { date: soDate, source: 'sales_order', confidence: 'medium' };
    }
  }

  const erpStart = parseDate(serial.extra?.erp_rental_start);
  if (erpStart) return { date: erpStart, source: 'erp_extra', confidence: 'medium' };

  const rentDev = ctx.rentDevBySerial.get(serial.serial_id);
  if (rentDev?.rent_start_date) {
    return { date: parseDate(rentDev.rent_start_date), source: 'rent_devices', confidence: 'medium' };
  }

  const delivered = parseDate(serial.delivered_at);
  if (delivered) return { date: delivered, source: 'serial_delivered_at', confidence: 'medium' };

  const created = parseDate(serial.created_at);
  if (created) return { date: created, source: 'created_at', confidence: 'low' };

  return { date: null, source: null, confidence: null };
}

function deriveRentMonthlyRate(serial, ctx) {
  if (parseMoney(serial.rent_monthly_rate)) {
    return { rate: parseMoney(serial.rent_monthly_rate), source: 'existing' };
  }

  const dcNum = serial.current_dc_number;
  const dcLines = dcNum ? (ctx.dcByNumber.get(dcNum) || []) : [];
  for (const line of dcLines) {
    if (!line.sales_order_number) continue;
    const soLines = ctx.soByNumber.get(line.sales_order_number) || [];
    for (const so of soLines) {
      const rate = parseMoney(so.rate);
      if (!rate) continue;
      if (so.customer_id && so.customer_id !== serial.current_customer_id) continue;
      return { rate, source: 'sales_order_line' };
    }
  }

  for (const line of dcLines) {
    if (line.quotation_number) {
      const q = ctx.quotByNumber.get(line.quotation_number);
      const rate = parseMoney(q?.rate);
      if (rate && (!q.customer_id || q.customer_id === serial.current_customer_id)) {
        return { rate, source: 'rental_quotation' };
      }
    }
  }

  for (const lines of ctx.dcByNumber.values()) {
    for (const line of lines) {
      if (line.customer_id !== serial.current_customer_id || !line.sales_order_number) continue;
      const soLines = ctx.soByNumber.get(line.sales_order_number) || [];
      for (const so of soLines) {
        const rate = parseMoney(so.rate);
        if (rate) return { rate, source: 'sales_order_line_customer' };
      }
    }
  }

  const rentDev = ctx.rentDevBySerial.get(serial.serial_id);
  const erpRate = parseMoney(rentDev?.month_rent ?? rentDev?.rent_amount)
    || parseMoney(serial.extra?.month_rent)
    || parseMoney(serial.extra?.monthly_rate)
    || parseMoney(serial.extra?.erp_month_rent);
  if (erpRate) return { rate: erpRate, source: 'erp_migration' };

  return { rate: null, source: null };
}

async function loadVendorActivationRows(pool) {
  const poRes = await pool.query(
    `SELECT vpo.po_id, vpo.purchase_order_number, vpo.vendor_id, vpo.line_items,
            vpo.purchase_order_type, vpo.sub_total_amount
       FROM vendor_purchase_orders vpo
      WHERE vpo.deleted_at IS NULL
        AND vpo.purchase_order_type IN ('rental_purchase', 'rent_to_own')
        AND (
          (vpo.line_items->0->>'rate') IS NULL
          OR COALESCE((vpo.line_items->0->>'rate')::numeric, 0) = 0
        )`
  );

  const serialRes = await pool.query(
    `SELECT vsn.serial_id, vsn.po_id, vsn.grn_id, vsn.serial_number,
            vsn.rental_start_date, vsn.created_at, vsn.extra
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
      WHERE vsn.deleted_at IS NULL
        AND vpo.deleted_at IS NULL
        AND vpo.purchase_order_type IN ('rental_purchase', 'rent_to_own')
        AND (vsn.extra->>'received_at') IS NULL
        AND vsn.rental_start_date IS NULL`
  );

  return { pos: poRes.rows, serials: serialRes.rows };
}

function deriveVendorPoRate(po, ctx) {
  const existing = parseMoney(po.line_items?.[0]?.rate);
  if (existing) return { rate: existing, source: 'existing' };

  const productRate = ctx.poRateByPo.get(po.po_id);
  if (productRate) return { rate: productRate, source: 'vendor_product_details' };

  const items = Array.isArray(po.line_items) ? po.line_items : [];
  const qty = items.reduce((s, li) => s + (Number(li.quantity) || 0), 0) || items.length || 1;
  const sub = parseMoney(po.sub_total_amount);
  if (sub && qty) return { rate: parseFloat((sub / qty).toFixed(2)), source: 'po_subtotal_avg' };

  return { rate: null, source: null };
}

function deriveVendorSerialStart(serial, ctx) {
  const existing = parseDate(serial.extra?.received_at) || parseDate(serial.rental_start_date);
  if (existing) return { date: existing, source: 'existing' };

  const grn = ctx.grnById.get(serial.grn_id);
  if (grn?.created_at) {
    return { date: parseDate(grn.created_at), source: 'grn_received' };
  }

  const rentDev = ctx.rentDevBySerial.get(serial.serial_id);
  if (rentDev?.rent_start_date) {
    return { date: parseDate(rentDev.rent_start_date), source: 'rent_devices' };
  }

  return { date: parseDate(serial.created_at), source: 'serial_created_at' };
}

function writeMarkdownReport(relPath, body) {
  const outPath = path.join(__dirname, '..', '..', 'docs', relPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, 'utf8');
  return outPath;
}

function evaluateCustomerBlockers(customer, { strict = false } = {}) {
  const blockers = [];
  const autoFix = [];

  if (customer.needs_rented_status > 0 || customer.needs_returned_status > 0) {
    const msg = `${customer.needs_rented_status + customer.needs_returned_status} deployed serial(s) need inventory_status normalized (legacy ERP statuses)`;
    if (strict) blockers.push(msg);
    else autoFix.push(msg);
  }
  if (customer.eligible_status === 0 && strict) {
    blockers.push('No serials with billable status rented/returned');
  }
  if (customer.missing_rent_start_deployed > 0) {
    const msg = `${customer.missing_rent_start_deployed} deployed serial(s) missing rent_start_date`;
    if (strict) blockers.push(msg);
    else autoFix.push(msg);
  }
  if (customer.missing_rate_deployed > 0) {
    const msg = `${customer.missing_rate_deployed} deployed serial(s) missing rent_monthly_rate`;
    if (strict) blockers.push(msg);
    else autoFix.push(msg);
  }
  if (customer.missing_rent_start > 0) blockers.push(`${customer.missing_rent_start} billable serial(s) missing rent_start_date`);
  if (customer.missing_rate > 0) blockers.push(`${customer.missing_rate} billable serial(s) missing rent_monthly_rate`);
  if (customer.orphan_customer > 0) blockers.push(`${customer.orphan_customer} serial(s) with orphan current_customer_id`);

  return { blockers, autoFix };
}

function evaluateVendorBlockers(vendor, { strict = false } = {}) {
  const blockers = [];
  const autoFix = [];
  if (vendor.missing_po_rate > 0) {
    const msg = `${vendor.missing_po_rate} vendor rental serial(s) missing PO line rate`;
    if (strict) blockers.push(msg);
    else autoFix.push(msg);
  }
  if (vendor.missing_start_date > 0) {
    const msg = `${vendor.missing_start_date} vendor rental serial(s) missing start date`;
    if (strict) blockers.push(msg);
    else autoFix.push(msg);
  }
  return { blockers, autoFix };
}

module.exports = {
  parseMoney,
  parseDate,
  ymFromDate,
  parseYm,
  ymKey,
  monthRange,
  currentMonthYm,
  lastCompletedMonthYm,
  gatherCustomerReadiness,
  gatherVendorReadiness,
  gatherDeployedStatusBreakdown,
  planStatusNormalization,
  applyStatusNormalization,
  evaluateCustomerBlockers,
  evaluateVendorBlockers,
  loadActivationContext,
  deriveRentStartDate,
  deriveRentMonthlyRate,
  loadVendorActivationRows,
  deriveVendorPoRate,
  deriveVendorSerialStart,
  writeMarkdownReport,
};
