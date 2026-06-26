/**
 * Migrated ERP laptop history for Serial Number Status (inward_outward only).
 * Independent from CRM ttspl_audit_log / TTSPL History drawer.
 */
const { parseExtra } = require('./qcManagementService');

function normalizeSearchTerm(raw) {
  return String(raw || '').trim();
}

function formatErpDate(value) {
  if (!value) return 'N/A';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function formatSlaMinutes(raw) {
  const totalMinutes = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  const days = Math.floor(totalMinutes / (24 * 60));
  const remainingMinutesAfterDays = totalMinutes % (24 * 60);
  const hours = Math.floor(remainingMinutesAfterDays / 60);
  const minutes = remainingMinutesAfterDays % 60;
  const parts = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0 || (!days && !hours)) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  return parts.join(' ');
}

function displayStatusType(type) {
  const t = String(type || '').trim();
  if (!t) return 'N/A';
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseSparePartSerials(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [raw];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const part of parsed) {
    if (typeof part === 'string') {
      const bits = part.split('|');
      out.push(bits[1] || bits[0] || part);
      continue;
    }
    if (part && typeof part === 'object') {
      const sn = part.serial_number || part.serial || '';
      if (sn) {
        const bits = String(sn).split('|');
        out.push(bits[1] || bits[0]);
      }
    }
  }
  return out.filter(Boolean);
}

async function resolveSerialSearchKeys(db, search) {
  const term = normalizeSearchTerm(search);
  if (!term) return { term, serialNumbers: [], uniqueNumbers: [], hasMigratedSerial: false };

  const serialR = await db.query(
    `SELECT serial_id, serial_number, inventory_asset_code, extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (
          serial_number ILIKE $1
          OR COALESCE(inventory_asset_code, '') ILIKE $1
          OR COALESCE(extra->>'unique_product_serial', '') ILIKE $1
        )`,
    [`%${term}%`]
  );

  const serialNumbers = new Set([term.toUpperCase()]);
  const uniqueNumbers = new Set([term.toUpperCase()]);
  let hasMigratedSerial = false;

  for (const row of serialR.rows) {
    if (row.serial_number) serialNumbers.add(String(row.serial_number).toUpperCase());
    if (row.inventory_asset_code) uniqueNumbers.add(String(row.inventory_asset_code).toUpperCase());
    const ex = parseExtra(row.extra);
    if (ex.unique_product_serial) uniqueNumbers.add(String(ex.unique_product_serial).toUpperCase());
    hasMigratedSerial = true;
  }

  const mapR =
    serialR.rows.length > 0
      ? await db.query(
          `SELECT 1 FROM erp_id_map
            WHERE entity IN ('serial_numbers', 'vendor_serial_numbers')
              AND crm_id = ANY($1::int[])
            LIMIT 1`,
          [serialR.rows.map((r) => r.serial_id)]
        )
      : { rows: [] };
  if (mapR.rows.length) hasMigratedSerial = true;

  return {
    term,
    serialNumbers: [...serialNumbers],
    uniqueNumbers: [...uniqueNumbers],
    hasMigratedSerial
  };
}

async function fetchErpInwardOutwardRows(db, keys) {
  const params = [keys.serialNumbers, keys.uniqueNumbers];
  const r = await db.query(
    `SELECT io.*
       FROM inward_outward io
      WHERE io.source = 'erp'
        AND (io.product_type IS NULL OR io.product_type <> 'parts')
        AND (
          UPPER(COALESCE(io.serial_number, '')) = ANY($1)
          OR UPPER(COALESCE(io.unique_number, '')) = ANY($2)
        )
      ORDER BY io.created_at ASC, io.id ASC`,
    params
  );
  return r.rows;
}

async function enrichHistoryRows(db, rows) {
  if (!rows.length) return [];

  const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter(Boolean))];
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
  const techIds = [...new Set(rows.map((r) => r.technician_id).filter(Boolean))];

  const vendors = new Map();
  if (vendorIds.length) {
    const vr = await db.query(
      `SELECT vendor_id, business_name, first_name, last_name, email, phone
         FROM vendors WHERE vendor_id = ANY($1::int[]) AND deleted_at IS NULL`,
      [vendorIds]
    );
    vr.rows.forEach((v) => vendors.set(v.vendor_id, v));
  }

  const customers = new Map();
  if (customerIds.length) {
    const cr = await db.query(
      `SELECT customer_id, name, company_name, email, phone
         FROM customers WHERE customer_id = ANY($1::int[])`,
      [customerIds]
    );
    cr.rows.forEach((c) => customers.set(c.customer_id, c));
  }

  const technicians = new Map();
  if (techIds.length) {
    const tr = await db.query(
      `SELECT technician_id, first_name, last_name, email, phone
         FROM delivery_technicians WHERE technician_id = ANY($1::int[])`,
      [techIds]
    );
    tr.rows.forEach((t) => technicians.set(t.technician_id, t));
  }

  return rows.map((row, index) => {
    const ioType = row.io_type || row.transaction_type || row.meta?.type || '';
    const vendor = row.vendor_id ? vendors.get(row.vendor_id) : null;
    const customer = row.customer_id ? customers.get(row.customer_id) : null;
    const technician = row.technician_id ? technicians.get(row.technician_id) : null;

    const party = vendor
      ? {
          kind: 'vendor',
          name: vendor.business_name || [vendor.first_name, vendor.last_name].filter(Boolean).join(' '),
          email: vendor.email || '',
          phone: vendor.phone || ''
        }
      : customer
        ? {
            kind: 'customer',
            name: customer.company_name || customer.name || 'NA',
            email: customer.email || '',
            phone: customer.phone || ''
          }
        : { kind: 'unknown', name: 'NA', email: '', phone: '' };

    return {
      sno: index + 1,
      id: row.id,
      erp_id: row.erp_id,
      date: row.created_at,
      date_display: formatErpDate(row.created_at),
      serial_number: row.serial_number,
      unique_number: row.unique_number,
      type: ioType,
      type_display: displayStatusType(ioType),
      purpose: row.purpose,
      purpose_display: displayStatusType(row.purpose),
      remarks: row.remarks || '',
      ticket_number: row.ticket_number || null,
      ticket_sla_time: row.ticket_sla_time || null,
      ticket_sla_display: row.ticket_number ? formatSlaMinutes(row.ticket_sla_time) : null,
      courier_name: row.courier_name || null,
      awb_number: row.awb_number || null,
      spare_parts_serials: parseSparePartSerials(row.spare_parts_serial_number),
      party,
      technician: technician
        ? {
            name: [technician.first_name, technician.last_name].filter(Boolean).join(' '),
            email: technician.email || '',
            phone: technician.phone || ''
          }
        : null,
      found_in: row.found_in || null,
      source: row.source
    };
  });
}

async function loadErpSerialHistory(db, search) {
  const keys = await resolveSerialSearchKeys(db, search);
  const rows = await fetchErpInwardOutwardRows(db, keys);
  const history = await enrichHistoryRows(db, rows);

  return {
    search: keys.term,
    has_migrated_serial: keys.hasMigratedSerial,
    erp_history_count: history.length,
    erp_history: history,
    erp_history_inward: history.filter((r) => String(r.type).toLowerCase() === 'in_ward'),
    erp_history_outward: history.filter((r) => String(r.type).toLowerCase() === 'out_ward'),
    erp_history_summary: history
  };
}

module.exports = {
  loadErpSerialHistory,
  resolveSerialSearchKeys,
  fetchErpInwardOutwardRows,
  enrichHistoryRows,
  formatErpDate,
  formatSlaMinutes,
  displayStatusType
};
