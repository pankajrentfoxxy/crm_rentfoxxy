const pool = require('../config/db');

const ROUTE_STATUS_MAP = {
  in_transit: 'pending',
  delivered: 'delivered',
  rejected: 'rejected_filter',
};

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

function serialPickerValue(serial) {
  if (typeof serial === 'string') return serial;
  return String(serial);
}

function buildSerialMeta(line, serialRaw) {
  const serial = serialPickerValue(serialRaw);
  const parts = serial.split('|');
  return {
    serial,
    dc_id: line.id,
    dc_number: line.dc_number,
    model_name: line.model_name,
    processor: line.processor || '',
    generation: line.generation || '',
    screen_size: line.screen_size || '',
    ram: line.ram || '',
    storage: line.storage || '',
    gpu: line.gpu || '',
  };
}

async function enrichLineSpecs(line) {
  if (line.processor && line.generation) return line;
  const r = await pool.query(
    `SELECT processor, generation, ram, storage, gpu, screen_size
     FROM sales_order_lines
     WHERE sales_order_number = $1 AND model_name = $2
     LIMIT 1`,
    [line.sales_order_number, line.model_name]
  );
  if (!r.rows.length) return line;
  const p = r.rows[0];
  return {
    ...line,
    processor: line.processor || p.processor,
    generation: line.generation || p.generation,
    ram: line.ram || p.ram,
    storage: line.storage || p.storage,
    gpu: line.gpu || p.gpu,
    screen_size: line.screen_size || p.screen_size,
  };
}

function groupDcRows(lines) {
  const groups = new Map();
  for (const line of lines) {
    if (!groups.has(line.dc_number)) groups.set(line.dc_number, []);
    groups.get(line.dc_number).push(line);
  }
  return groups;
}

function aggregateDcGroup(lines) {
  const first = lines[0];
  const allSerials = [];
  const allDelivered = [];
  const allRejected = [];

  for (const line of lines) {
    for (const s of parseJsonArray(line.serial_number)) {
      allSerials.push(buildSerialMeta(line, s));
    }
    for (const s of parseJsonArray(line.delivered_serial_numbers)) {
      allDelivered.push(buildSerialMeta(line, s));
    }
    for (const s of parseJsonArray(line.rejected_serial_numbers)) {
      allRejected.push(buildSerialMeta(line, s));
    }
    for (const s of parseJsonArray(line.old_rejected_serial_numbers)) {
      allRejected.push(buildSerialMeta(line, s));
    }
  }

  const hasRejected = allRejected.length > 0;
  const status = lines.every((l) => l.status === 'delivered') ? 'delivered' : first.status;

  return {
    dc_number: first.dc_number,
    sales_order_number: first.sales_order_number,
    customer_id: first.customer_id,
    customer_name: first.customer_name,
    email: first.email,
    gst_number: first.gst_number,
    branch: first.branch,
    ship_by: first.ship_by,
    courier_name: first.courier_name,
    awb_number: first.awb_number,
    delivery_person_id: first.delivery_person_id,
    delivery_person_name: first.delivery_person_name,
    created_at: first.created_at,
    status,
    submitted_name: first.submitted_name,
    submitted_remark: first.submitted_remark,
    file_path: first.file_path,
    pdf_path: first.pdf_path,
    line_ids: lines.map((l) => l.id),
    first_line_id: first.id,
    total_products: allSerials.length,
    delivered_count: allDelivered.length,
    rejected_count: allRejected.length,
    has_rejected: hasRejected,
    all_serials: allSerials,
    all_delivered: allDelivered,
    all_rejected: allRejected,
    lines,
  };
}

async function getDeliveryRegisterCounts() {
  const [inTransit, delivered, rejected, technicians] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines WHERE status = 'pending'`
    ),
    pool.query(
      `SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines WHERE status = 'delivered'`
    ),
    pool.query(
      `SELECT COUNT(DISTINCT dc_number)::int AS c
       FROM delivery_challan_lines
       WHERE status IN ('delivered', 'rejected')
         AND COALESCE(jsonb_array_length(rejected_serial_numbers), 0) > 0`
    ),
    pool.query(`SELECT COUNT(*)::int AS c FROM delivery_technicians WHERE is_active = TRUE`),
  ]);
  return {
    in_transit: inTransit.rows[0]?.c || 0,
    delivered: delivered.rows[0]?.c || 0,
    rejected: rejected.rows[0]?.c || 0,
    technicians: technicians.rows[0]?.c || 0,
  };
}

async function listDeliveryRegister({ status = 'in_transit', page = 1, limit = 10, search = '' }) {
  const routeStatus = String(status).toLowerCase();
  const params = [];
  const conditions = [];

  if (routeStatus === 'in_transit') {
    conditions.push(`d.status = 'pending'`);
  } else if (routeStatus === 'delivered') {
    conditions.push(`d.status = 'delivered'`);
    conditions.push(`COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) = 0`);
  } else if (routeStatus === 'rejected') {
    conditions.push(`d.status IN ('delivered', 'rejected')`);
    conditions.push(`COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0`);
  } else {
    conditions.push(`d.status = $${params.length + 1}`);
    params.push(ROUTE_STATUS_MAP[routeStatus] || routeStatus);
  }

  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    conditions.push(`(
      d.dc_number ILIKE $${i}
      OR d.customer_name ILIKE $${i}
      OR d.sales_order_number ILIKE $${i}
      OR COALESCE(d.gst_number, '') ILIKE $${i}
    )`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const allLines = await pool.query(
    `SELECT
       d.*,
       COALESCE(u.name, u.email, '') AS delivery_person_name,
       c.phone AS customer_phone
     FROM delivery_challan_lines d
     LEFT JOIN users u ON u.user_id = d.delivery_person_id
     LEFT JOIN customers c ON c.customer_id = d.customer_id
     ${where}
     ORDER BY d.dc_number DESC, d.id ASC`,
    params
  );

  const enriched = [];
  for (const row of allLines.rows) {
    enriched.push(await enrichLineSpecs(row));
  }

  const groups = groupDcRows(enriched);
  let items = Array.from(groups.values()).map(aggregateDcGroup);

  if (routeStatus === 'delivered') {
    items = items.filter((g) => !g.has_rejected);
  }

  const total = items.length;
  const offset = (page - 1) * limit;
  const paged = items.slice(offset, offset + limit);

  return {
    status: routeStatus,
    items: paged,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function listDeliveryTechnicians({ activeOnly = true } = {}) {
  const where = activeOnly ? 'WHERE is_active = TRUE' : '';
  const r = await pool.query(
    `SELECT technician_id, user_id, first_name, last_name, phone, email, is_active, created_at
     FROM delivery_technicians ${where}
     ORDER BY first_name, last_name`
  );
  return r.rows;
}

async function listDeliveryPersonOptions() {
  const [techs, users] = await Promise.all([
    listDeliveryTechnicians({ activeOnly: true }),
    pool.query(
      `SELECT user_id AS id, name FROM users WHERE active = TRUE ORDER BY name`
    ),
  ]);
  const fromTechs = techs.map((t) => ({
    id: t.user_id || t.technician_id,
    user_id: t.user_id,
    technician_id: t.technician_id,
    name: [t.first_name, t.last_name].filter(Boolean).join(' ').trim(),
    source: 'technician',
  }));
  const fromUsers = users.rows.map((u) => ({
    id: u.id,
    user_id: u.id,
    name: u.name,
    source: 'user',
  }));
  const seen = new Set();
  const merged = [];
  for (const p of [...fromTechs, ...fromUsers]) {
    const key = String(p.user_id || p.id);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  return merged;
}

async function changeDeliveryPerson({ dcNumber, deliveryPersonId, shipBy, courierName, awbNumber }) {
  const r = await pool.query(
    `SELECT id FROM delivery_challan_lines WHERE dc_number = $1 AND status = 'pending'`,
    [dcNumber]
  );
  if (!r.rows.length) {
    return { ok: false, message: 'No pending delivery challan found' };
  }

  if (deliveryPersonId === 'by_courier' || shipBy === 'by_courier') {
    await pool.query(
      `UPDATE delivery_challan_lines SET
         ship_by = 'by_courier',
         courier_name = $2,
         awb_number = $3,
         delivery_person_id = NULL,
         updated_at = NOW()
       WHERE dc_number = $1 AND status = 'pending'`,
      [dcNumber, courierName || null, awbNumber || null]
    );
  } else {
    await pool.query(
      `UPDATE delivery_challan_lines SET
         ship_by = 'by_hand',
         delivery_person_id = $2,
         courier_name = NULL,
         awb_number = NULL,
         updated_at = NOW()
       WHERE dc_number = $1 AND status = 'pending'`,
      [dcNumber, deliveryPersonId || null]
    );
  }
  return { ok: true };
}

module.exports = {
  parseJsonArray,
  getDeliveryRegisterCounts,
  listDeliveryRegister,
  listDeliveryTechnicians,
  listDeliveryPersonOptions,
  changeDeliveryPerson,
  aggregateDcGroup,
};
