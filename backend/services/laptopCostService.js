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
 * not read it. On rental / rent-to-own POs the line rate is the monthly rent,
 * not a purchase price, so it is reported as `monthly_rent` and left out of
 * the total.
 */
const pool = require('../config/db');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
  const kind = ['rental_purchase', 'rent_to_own'].includes(po.purchase_order_type) ? 'monthly_rent' : 'purchase';
  const lines = Array.isArray(po.line_items) ? po.line_items : [];
  const out = (amount, source, line) => ({
    amount, kind, source, po_number: po.purchase_order_number, line_index: line ?? null,
  });

  const li = num(extra.line_index);
  if (li != null && li >= 0 && lines[li]) {
    const a = lineAmount(lines[li]);
    if (a != null) return out(a, 'po_line', li);
  }
  const pd = extra.product_detail_id ?? extra.pro_id ?? extra.product_id;
  if (pd != null && String(pd).trim() !== '') {
    const idx = lines.findIndex((l) => String(l?.product_detail_id ?? l?.product_id ?? l?.pro_id ?? l?.id) === String(pd));
    if (idx >= 0) {
      const a = lineAmount(lines[idx]);
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
    `SELECT serial_id, po_id, extra, inventory_asset_code AS ttspl_id
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND ($1::int IS NOT NULL AND serial_id = $1 OR $2::text IS NOT NULL AND inventory_asset_code = $2)
      ORDER BY serial_id DESC LIMIT 1`,
    [serialId, ttsplId]
  )).rows[0];
  if (!vsn) return null;
  const ttspl = vsn.ttspl_id;
  const base = await resolveBase(c, vsn);
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
  const purchase = base.kind === 'purchase' && base.amount != null ? base.amount : 0;
  return {
    ttspl_id: ttspl,
    base,
    parts,
    credits,
    total: round(purchase + parts - credits),
    lines,
  };
}

module.exports = { getLaptopCost, lineAmount };
