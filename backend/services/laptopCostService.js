/**
 * Production PD15 — what one laptop cost.
 *
 *   base    its OWN purchase-order line (extra.line_index into the PO's
 *           line_items, else its product_detail_id). The older summaries took
 *           the priciest line on the whole PO (MAX(rate)), so every laptop on a
 *           mixed PO looked like the most expensive one.
 *   parts   every part unit fitted to this laptop now, at that unit's cost
 *           (part_instances.unit_cost — the ledger's cost).
 *   credits old parts taken off this laptop that the warehouse has collected,
 *           valued at the cost of the unit that replaced them (a returned unit
 *           itself is recorded at 0).
 *
 * Read-only: it computes, it writes nothing. Customer and vendor billing do
 * not read it.
 *
 * Rented from a vendor (#6, 26 Sep 2026): the line's monthly rent is read the
 * way the vendor bill reads it (Monthly rental, then monthly_rate, then Rate),
 * and the laptop also gets
 *   purchase_equivalent  what it would have cost to buy: the line's asset
 *                        value, else its Rate when that is clearly a purchase
 *                        price (above the monthly rent);
 *   rent_paid            rent accrued to date — day by day, from rent start to
 *                        today or the rent end, repair pauses left out.
 * The total for a rented laptop is purchase-equivalent + parts − credits
 * (`total_basis: 'purchase_equivalent'`), so it compares with a bought one.
 */
const pool = require('../config/db');
const { calcVendorLineAmount } = require('./billingMath');
const { declaredValueFromLine } = require('./vendorRepairMail');

const RENTAL_TYPES = ['rental_purchase', 'rent_to_own'];

function monthlyRentOfLine(line) {
  if (!line || typeof line !== 'object') return null;
  for (const k of ['monthly_rental_amount', 'monthly_rate', 'rate']) {
    const n = num(line[k]);
    if (n != null && n > 0) return n;
  }
  return null;
}

/**
 * No asset value on the rental line: the average we paid for the same model on
 * our own purchase POs (a line priced above Rs 5,000, so a rent is never taken
 * for a price). Null when we never bought that model.
 */
const BRANDS = ['dell', 'hp', 'lenovo', 'apple', 'acer', 'asus', 'microsoft', 'samsung', 'toshiba', 'msi', 'fujitsu'];

/** "Dell Latitude 5490" and "latitude-5490" are one model: letters and digits, brand removed. */
function modelKey(model) {
  let k = String(model || '').toLowerCase();
  for (const b of BRANDS) k = k.replace(new RegExp(`\\b${b}\\b`, 'g'), '');
  return k.replace(/[^a-z0-9]/g, '');
}

async function sameModelPurchasePrice(db, model) {
  const m = modelKey(model);
  if (m.length < 3) return null;
  const r = (await db.query(
    `SELECT ROUND(AVG((li->>'rate')::numeric), 2)::float AS avg, COUNT(*)::int AS n
       FROM vendor_purchase_orders vpo, jsonb_array_elements(vpo.line_items) li
      WHERE vpo.deleted_at IS NULL
        AND vpo.purchase_order_type NOT IN ('rental_purchase', 'rent_to_own', 'vendor_repair_replacement')
        AND (li->>'rate') ~ '^[0-9]+(\\.[0-9]+)?$' AND (li->>'rate')::numeric > 5000
        AND regexp_replace(
              regexp_replace(LOWER(COALESCE(li->>'model', li->>'model_name', '')), '\\m(${BRANDS.join('|')})\\M', '', 'g'),
              '[^a-z0-9]', '', 'g') = $1`,
    [m]
  )).rows[0];
  return r?.n ? { amount: r.avg, lines: r.n } : null;
}

/** Rent accrued from `start` to `end` (inclusive), month by month, minus pauses. */
function rentAccrued({ start, end, monthlyRate, pauses = [] }) {
  if (!start || !(monthlyRate > 0)) return { amount: 0, days: 0 };
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s > e) return { amount: 0, days: 0 };
  let amount = 0;
  let days = 0;
  let y = s.getFullYear();
  let m = s.getMonth();
  while (new Date(y, m, 1) <= e) {
    const calc = calcVendorLineAmount({
      receivedAt: s, returnedAt: e, monthStart: new Date(y, m, 1), monthEnd: new Date(y, m + 1, 0), monthlyRate, pauses,
    });
    if (calc) { amount += calc.amount; days += calc.days; }
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return { amount: Math.round(amount * 100) / 100, days };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lineAmount(line) {
  if (!line || typeof line !== 'object') return null;
  for (const k of ['unit_price', 'price', 'rate']) {
    const n = num(line[k]);
    if (n != null && n > 0) return n;
  }
  return null;
}

async function resolveBase(db, vsn) {
  const extra = vsn.extra || {};
  if (!vsn.po_id) return { amount: null, kind: 'unknown', source: 'no_po', po_number: null };
  const po = (await db.query(
    `SELECT purchase_order_number, purchase_order_type, line_items FROM vendor_purchase_orders WHERE po_id = $1`,
    [vsn.po_id]
  )).rows[0];
  if (!po) return { amount: null, kind: 'unknown', source: 'no_po', po_number: null };
  const kind = RENTAL_TYPES.includes(po.purchase_order_type) ? 'monthly_rent' : 'purchase';
  const lines = Array.isArray(po.line_items) ? po.line_items : [];
  const amountOf = (line) => (kind === 'monthly_rent' ? monthlyRentOfLine(line) : lineAmount(line));
  const out = (amount, source, line) => {
    const pe = kind === 'monthly_rent' && line != null ? declaredValueFromLine(po.purchase_order_type, lines[line]) : null;
    return {
      amount,
      kind,
      source,
      po_number: po.purchase_order_number,
      line_index: line ?? null,
      purchase_equivalent: kind === 'monthly_rent'
        ? { amount: pe, source: pe == null ? 'not_on_po' : (num(lines[line]?.asset_value) > 0 ? 'asset_value' : 'po_rate') }
        : null,
    };
  };

  const li = num(extra.line_index);
  if (li != null && li >= 0 && lines[li]) {
    const a = amountOf(lines[li]);
    if (a != null) return out(a, 'po_line', li);
  }
  const pd = extra.product_detail_id ?? extra.pro_id ?? extra.product_id;
  if (pd != null && String(pd).trim() !== '') {
    const idx = lines.findIndex((l) => String(l?.product_detail_id ?? l?.product_id ?? l?.pro_id ?? l?.id) === String(pd));
    if (idx >= 0) {
      const a = amountOf(lines[idx]);
      if (a != null) return out(a, 'po_line', idx);
    }
    const vpd = (await db.query(
      `SELECT rate FROM vendor_product_details WHERE product_detail_id::text = $1::text`,
      [String(pd)]
    )).rows[0];
    const a = num(vpd?.rate);
    if (a != null && a > 0) return out(a, 'product_detail', null);
  }
  return out(null, 'unresolved', null);
}

/**
 * getLaptopCost(db, { serialId } | { ttsplId })
 * → { ttspl_id, base, parts, credits, total, lines[] } or null.
 */
async function getLaptopCost(db, { serialId = null, ttsplId = null } = {}) {
  const c = db || pool;
  const vsn = (await c.query(
    `SELECT serial_id, po_id, extra, inventory_asset_code AS ttspl_id,
            COALESCE((extra->>'received_at')::date, rental_start_date, created_at::date) AS rent_start,
            vendor_rent_end_date, inventory_status
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND ($1::int IS NOT NULL AND serial_id = $1 OR $2::text IS NOT NULL AND inventory_asset_code = $2)
      ORDER BY serial_id DESC LIMIT 1`,
    [serialId, ttsplId]
  )).rows[0];
  if (!vsn) return null;
  const ttspl = vsn.ttspl_id;
  const base = await resolveBase(c, vsn);
  if (base.kind === 'monthly_rent' && base.purchase_equivalent && base.purchase_equivalent.amount == null) {
    const same = await sameModelPurchasePrice(c, vsn.extra?.model || vsn.extra?.model_name);
    if (same) base.purchase_equivalent = { amount: same.amount, source: 'same_model_purchases', lines: same.lines };
  }
  const lines = [];

  const fitted = ttspl ? (await c.query(
    `SELECT pi.instance_id, pi.prt_id, pi.unit_cost, pi.installed_at, p.part_name
       FROM part_instances pi LEFT JOIN parts p ON p.part_id = pi.part_id
      WHERE pi.installed_ttspl_id = $1 AND pi.status = 'installed'
      ORDER BY pi.installed_at NULLS LAST`,
    [ttspl]
  )).rows : [];
  for (const r of fitted) {
    lines.push({ kind: 'part', label: r.part_name || 'Part', ref: r.prt_id, amount: num(r.unit_cost) || 0, when: r.installed_at, no_cost: !(num(r.unit_cost) > 0) });
  }

  // Parts added before units were tracked one by one (legacy direct attach).
  const legacy = (await c.query(
    `SELECT tp.id, tp.quantity_used, tp.unit_cost, tp.added_at, p.part_name
       FROM ticket_parts tp
       JOIN tickets t ON t.ticket_id = tp.ticket_id
       LEFT JOIN parts p ON p.part_id = tp.part_id
      WHERE t.vendor_serial_id = $1
        AND NOT EXISTS (SELECT 1 FROM part_instances pi
                         WHERE pi.installed_ticket_id = tp.ticket_id AND pi.part_id = tp.part_id)`,
    [vsn.serial_id]
  )).rows;
  for (const r of legacy) {
    const amt = (num(r.unit_cost) || 0) * (num(r.quantity_used) || 1);
    lines.push({ kind: 'part', label: `${r.part_name || 'Part'} (older record)`, ref: null, amount: amt, when: r.added_at, no_cost: !(amt > 0) });
  }

  const returned = ttspl ? (await c.query(
    `SELECT old.instance_id, old.prt_id, old.collected_at, p.part_name,
            (SELECT newu.unit_cost FROM part_requests pr JOIN part_instances newu ON newu.instance_id = pr.instance_id
              WHERE pr.old_part_instance_id = old.instance_id ORDER BY pr.request_id DESC LIMIT 1) AS replaced_by_cost
       FROM part_instances old LEFT JOIN parts p ON p.part_id = old.part_id
      WHERE old.removed_from_ttspl_id = $1 AND old.collected_at IS NOT NULL`,
    [ttspl]
  )).rows : [];
  for (const r of returned) {
    const amt = num(r.replaced_by_cost) || 0;
    lines.push({ kind: 'credit', label: `${r.part_name || 'Old part'} returned`, ref: r.prt_id, amount: -amt, when: r.collected_at, no_cost: !(amt > 0) });
  }

  const round = (v) => Math.round(v * 100) / 100;
  const parts = round(lines.filter((l) => l.kind === 'part').reduce((s, l) => s + l.amount, 0));
  const credits = round(-lines.filter((l) => l.kind === 'credit').reduce((s, l) => s + l.amount, 0));
  let rentPaid = null;
  if (base.kind === 'monthly_rent' && base.amount > 0) {
    const pauses = (await c.query(
      `SELECT paused_from, resumed_on FROM vendor_rent_pauses
        WHERE serial_id = $1 AND COALESCE(closed_reason, '') <> 'cancelled'`,
      [vsn.serial_id]
    ).catch(() => ({ rows: [] }))).rows.map((p) => ({
      from: p.paused_from,
      to: p.resumed_on ? new Date(new Date(p.resumed_on).getFullYear(), new Date(p.resumed_on).getMonth(), new Date(p.resumed_on).getDate() - 1) : null,
    }));
    const today = new Date();
    const endAt = vsn.vendor_rent_end_date && new Date(vsn.vendor_rent_end_date) < today ? new Date(vsn.vendor_rent_end_date) : today;
    const acc = rentAccrued({ start: vsn.rent_start, end: endAt, monthlyRate: base.amount, pauses });
    rentPaid = {
      amount: acc.amount,
      days: acc.days,
      from: vsn.rent_start,
      to: endAt,
      ended: Boolean(vsn.vendor_rent_end_date && new Date(vsn.vendor_rent_end_date) < today),
      // Rent start after today = a bad date (ERP import put 2027-02-07 on most rented laptops).
      start_in_future: Boolean(vsn.rent_start && new Date(vsn.rent_start) > today),
    };
  }
  const purchase = base.kind === 'purchase' && base.amount != null
    ? base.amount
    : (base.purchase_equivalent?.amount || 0);
  return {
    ttspl_id: ttspl,
    base,
    parts,
    credits,
    rent_paid: rentPaid,
    total_basis: base.kind === 'monthly_rent' ? (base.purchase_equivalent?.amount ? 'purchase_equivalent' : 'parts_only') : 'purchase',
    total: round(purchase + parts - credits),
    lines,
  };
}

module.exports = { getLaptopCost, lineAmount, monthlyRentOfLine, rentAccrued, modelKey };
