'use strict';

const { logEvent } = require('./supportTicketStateService');
const { enqueueEmail } = require('./emailQueueService');

const GRADE_DEFS = {
  A: 'Like new. No visible marks. Fully functional.',
  B: 'Light cosmetic wear. Minor scuffs. Fully functional.',
  C: 'Visible wear — dents, deep scratches, worn keys. Functional.',
  D: 'Damaged — cracked screen/body, hinge broken, liquid, non-functional.',
};

const REASON_L3 = {
  END_OF_CONTRACT: 'LOG-RET-EOC',
  CUSTOMER_REQUEST: 'LOG-RET-REQ',
  LOST: 'LOG-LOS-LST',
};

const EWAY_THRESHOLD = 50000;
const DAMAGE_MANAGER_THRESHOLD = 10000;

function groupSerialsBySiteAndCapacity(items, capacity) {
  const cap = Math.max(1, Number(capacity) || 25);
  const bySite = new Map();
  for (const it of items) {
    const key = String(it.site_id == null ? 0 : it.site_id);
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push(it);
  }
  const groups = [];
  for (const list of bySite.values()) {
    for (let i = 0; i < list.length; i += cap) {
      const chunk = list.slice(i, i + cap);
      groups.push({
        site_id: chunk[0].site_id || null,
        serial_ids: chunk.map((x) => x.serial_id),
      });
    }
  }
  return groups;
}

function lockInEndDate(rentStart, lockingPeriodMonths) {
  if (!rentStart || !lockingPeriodMonths) return null;
  const d = new Date(rentStart);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + Number(lockingPeriodMonths));
  return d;
}

function earlyTerminationCharge({ rentMonthlyRate, lockInEnd, today = new Date() }) {
  if (!lockInEnd || lockInEnd <= today) return 0;
  const monthsLeft = Math.max(1, Math.ceil((lockInEnd - today) / (30.44 * 86400000)));
  return Number((Number(rentMonthlyRate || 0) * monthsLeft).toFixed(2));
}

async function loadCatalogs(client) {
  const [acc, dmg] = await Promise.all([
    client.query(`SELECT code, name, charge_amount FROM support_accessory_catalog WHERE active = TRUE`),
    client.query(`SELECT code, name, charge_amount FROM support_damage_catalog WHERE active = TRUE`),
  ]);
  const accessories = {};
  for (const r of acc.rows) accessories[r.code] = r;
  const damage = {};
  for (const r of dmg.rows) damage[r.code] = r;
  return { accessories, damage };
}

function computeChargeable(body, catalogs) {
  let total = 0;
  const damageItems = Array.isArray(body.damage_items) ? body.damage_items : [];
  for (const item of damageItems) {
    const code = String(item.code || item).toUpperCase();
    const row = catalogs.damage[code];
    total += Number(row ? row.charge_amount : (item.amount || 0));
  }
  const accessories = body.accessories && typeof body.accessories === 'object' ? body.accessories : {};
  const missing = [];
  for (const [code, state] of Object.entries(accessories)) {
    const status = String(state && state.status ? state.status : state).toUpperCase();
    if (status === 'MISSING' || status === 'DAMAGED') {
      const row = catalogs.accessories[code.toUpperCase()];
      total += Number(row ? row.charge_amount : 0);
      if (status === 'MISSING') missing.push(code.toUpperCase());
    }
  }
  const extraMissing = Array.isArray(body.missing_items) ? body.missing_items : [];
  for (const code of extraMissing) {
    const key = String(code).toUpperCase();
    if (missing.includes(key)) continue;
    const row = catalogs.accessories[key];
    if (row) {
      total += Number(row.charge_amount);
      missing.push(key);
    }
  }
  return { total: Number(total.toFixed(2)), missing };
}

function validateGrade(body, chargeableTotal) {
  const grade = String(body.grade || '').toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(grade)) {
    throw Object.assign(new Error('grade must be A, B, C, or D'), { status: 400 });
  }
  const damageItems = Array.isArray(body.damage_items) ? body.damage_items : [];
  const photos = Array.isArray(body.attachment_ids)
    ? body.attachment_ids
    : (Array.isArray(body.photo_attachment_ids) ? body.photo_attachment_ids : []);
  if ((grade === 'C' || grade === 'D') && !damageItems.length) {
    throw Object.assign(new Error('Grades C and D require at least one damage item'), { status: 400 });
  }
  if ((grade === 'C' || grade === 'D') && !photos.length) {
    throw Object.assign(new Error('Grades C and D require photos'), { status: 400 });
  }
  if (Number(chargeableTotal) > 0 && !photos.length) {
    throw Object.assign(new Error('Chargeable damage requires photo evidence'), { status: 400 });
  }
  return { grade, photos };
}

async function computeLockIn(client, serialId) {
  const r = await client.query(
    `SELECT serial_id, rent_start_date, rent_monthly_rate, rent_end_date, current_customer_id,
            extra
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  );
  const s = r.rows[0];
  if (!s) return { locked: false, charge: 0 };
  let months = Number(s.extra && s.extra.locking_period);
  if (!Number.isFinite(months) || months <= 0) {
    try {
      const so = await client.query(
        `SELECT soi.locking_period
           FROM sales_order_items soi
           JOIN sales_orders so ON so.id = soi.sales_order_id
          WHERE so.customer_id = $1 AND soi.locking_period IS NOT NULL
          ORDER BY so.created_at DESC NULLS LAST
          LIMIT 1`,
        [s.current_customer_id]
      );
      months = Number(so.rows[0] && so.rows[0].locking_period);
    } catch {
      months = 0;
    }
  }
  const end = lockInEndDate(s.rent_start_date, months);
  const charge = earlyTerminationCharge({ rentMonthlyRate: s.rent_monthly_rate, lockInEnd: end });
  return {
    locked: Boolean(end && end > new Date() && charge > 0),
    lock_in_end: end,
    charge,
    locking_period: months || null,
    rent_monthly_rate: Number(s.rent_monthly_rate || 0),
  };
}

async function notifyOverdueInvoices(client, { customerId, ticketId, woId, actorId }) {
  const overdue = await client.query(
    `SELECT invoice_id, invoice_number, grand_total, due_date, status
       FROM customer_invoices
      WHERE customer_id = $1
        AND LOWER(COALESCE(status,'')) NOT IN ('paid','cancelled','waived','draft')
        AND COALESCE(due_date, invoice_date + INTERVAL '15 days') < CURRENT_DATE`,
    [customerId]
  ).catch(() => ({ rows: [] }));
  if (!overdue.rows.length) return { overdue: false, count: 0 };
  await logEvent(client, {
    ticketId,
    woId,
    eventType: 'ACCOUNTS_NOTIFIED',
    actorKind: 'SYSTEM',
    actorId,
    summary: `Overdue invoices (${overdue.rows.length}) flagged — return not blocked`,
    detail: { invoice_ids: overdue.rows.map((x) => x.invoice_id) },
  });
  const accounts = await client.query(
    `SELECT email FROM users
      WHERE role IN ('accounts','admin','super_admin')
        AND email IS NOT NULL AND email <> ''
      LIMIT 8`
  ).catch(() => ({ rows: [] }));
  for (const u of accounts.rows) {
    enqueueEmail({
      toEmail: u.email,
      subject: `Return pickup — overdue invoices for customer ${customerId}`,
      bodyText: `A return pickup is proceeding for customer ${customerId} with ${overdue.rows.length} overdue invoice(s). This does not block the return.`,
      dedupeKey: `return-overdue-${ticketId || woId}-${customerId}`,
    }).catch((e) => console.error('return overdue email:', e));
  }
  return { overdue: true, count: overdue.rows.length };
}

async function consignmentValue(client, serialIds) {
  if (!serialIds.length) return 0;
  const r = await client.query(
    `SELECT COALESCE(SUM(
              COALESCE(
                NULLIF(extra->>'purchase_cost','')::numeric,
                NULLIF(extra->>'asset_value','')::numeric,
                rent_monthly_rate * 12,
                0
              )
            ), 0) AS value
       FROM vendor_serial_numbers
      WHERE serial_id = ANY($1::int[])`,
    [serialIds]
  );
  return Number(r.rows[0] && r.rows[0].value) || 0;
}

async function pickApprover(client, amount, approvalType = 'DAMAGE_CHARGE') {
  const { pickApproverForType } = require('./supportApprovalRules');
  return pickApproverForType(client, approvalType, amount);
}

module.exports = {
  GRADE_DEFS,
  REASON_L3,
  EWAY_THRESHOLD,
  DAMAGE_MANAGER_THRESHOLD,
  groupSerialsBySiteAndCapacity,
  lockInEndDate,
  earlyTerminationCharge,
  loadCatalogs,
  computeChargeable,
  validateGrade,
  computeLockIn,
  notifyOverdueInvoices,
  consignmentValue,
  pickApprover,
};
