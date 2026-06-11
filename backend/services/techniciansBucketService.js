const pool = require('../config/db');
const { parseJsonArray } = require('./deliveryRegisterService');

function parsePartsJson(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatPartLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'N/A';
  const label = s.replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function parseSerialParts(serialRaw) {
  const s = String(serialRaw || '');
  const parts = s.split('|');
  return {
    serial: (parts[1] || parts[0] || s).trim(),
    unique: (parts[2] || '').trim(),
    raw: s,
  };
}

function cleanPodFiles(filePath) {
  if (!filePath) return [];
  try {
    const files = typeof filePath === 'string' ? JSON.parse(filePath) : filePath;
    if (!Array.isArray(files)) return [];
    return files.map((f) =>
      String(f)
        .replace(/^storage\/app\/public\//, '')
        .replace(/^\//, '')
    );
  } catch {
    return [];
  }
}

async function resolveTechnicianPersonIds(technicianId) {
  if (technicianId === 'all' || !technicianId) {
    const r = await pool.query(
      `SELECT technician_id, user_id FROM delivery_technicians WHERE is_active = TRUE`
    );
    const personIds = new Set();
    for (const row of r.rows) {
      if (row.user_id) personIds.add(row.user_id);
      personIds.add(row.technician_id);
    }
    return [...personIds];
  }

  const r = await pool.query(
    `SELECT technician_id, user_id FROM delivery_technicians WHERE technician_id = $1`,
    [Number(technicianId)]
  );
  if (!r.rows.length) return [];
  const row = r.rows[0];
  const ids = new Set([row.technician_id]);
  if (row.user_id) ids.add(row.user_id);
  return [...ids];
}

async function listBucketTechnicians() {
  const r = await pool.query(
    `SELECT technician_id, first_name, last_name, user_id
     FROM delivery_technicians
     WHERE is_active = TRUE
     ORDER BY first_name, last_name`
  );
  return r.rows.map((t) => ({
    id: t.technician_id,
    technician_id: t.technician_id,
    name: [t.first_name, t.last_name].filter(Boolean).join(' ').trim(),
    user_id: t.user_id,
  }));
}

function buildSerialItems(line) {
  const items = [];
  const push = (arr, type) => {
    for (const s of parseJsonArray(arr)) {
      const p = parseSerialParts(s);
      items.push({ ...p, type });
    }
  };

  push(line.rejected_serial_numbers, 'Rejected');
  push(line.returned_serial_numbers, 'Returned');
  push(line.pickuped_serial_numbers, 'Pickuped');

  if (!items.length && line.status === 'pending') {
    push(line.serial_number, 'Pending');
  }
  return items;
}

function buildTypeStatus(line, serialItems) {
  const types = [];
  const rej = parseJsonArray(line.rejected_serial_numbers).length;
  const ret = parseJsonArray(line.returned_serial_numbers).length;
  const pic = parseJsonArray(line.pickuped_serial_numbers).length;

  if (rej > 0) types.push({ name: 'Rejected', count: rej, color: 'danger' });
  if (ret > 0) types.push({ name: 'Returned', count: ret, color: 'warning' });
  if (pic > 0) types.push({ name: 'Pickuped', count: pic, color: 'success' });
  if (!types.length && line.status === 'pending') {
    const pending = parseJsonArray(line.serial_number).length || serialItems.filter((s) => s.type === 'Pending').length;
    types.push({ name: 'Pending Delivery', count: pending, color: 'primary' });
  }
  return types;
}

async function enrichLineSpecs(line) {
  if (line.processor && line.generation) return line;
  const r = await pool.query(
    `SELECT processor, generation, ram, storage, gpu, screen_size, model_name
     FROM sales_order_lines
     WHERE sales_order_number = $1 AND model_name = $2
     LIMIT 1`,
    [line.sales_order_number, line.model_name]
  );
  if (!r.rows.length) return line;
  const p = r.rows[0];
  return {
    ...line,
    model_name: line.model_name || p.model_name,
    processor: line.processor || p.processor,
    generation: line.generation || p.generation,
    ram: line.ram || p.ram,
    storage: line.storage || p.storage,
    gpu: line.gpu || p.gpu,
    screen_size: line.screen_size || p.screen_size,
  };
}

async function fetchAssetsBucket({ technicianId, search = '' }) {
  const personIds = await resolveTechnicianPersonIds(technicianId);
  if (!personIds.length) return [];

  const linesR = await pool.query(
    `SELECT
       d.*,
       COALESCE(dt.first_name || ' ' || dt.last_name, u.name, '') AS delivery_person_name
     FROM delivery_challan_lines d
     LEFT JOIN delivery_technicians dt ON (
       dt.user_id = d.delivery_person_id OR dt.technician_id = d.delivery_person_id
     )
     LEFT JOIN users u ON u.user_id = d.delivery_person_id
     WHERE d.delivery_person_id = ANY($1::int[])
       AND (
         COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
         OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
         OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
         OR d.status = 'pending'
       )
     ORDER BY d.updated_at DESC`,
    [personIds]
  );

  const enriched = [];
  for (const row of linesR.rows) {
    enriched.push(await enrichLineSpecs(row));
  }

  const groups = new Map();
  for (const line of enriched) {
    if (!groups.has(line.dc_number)) groups.set(line.dc_number, []);
    groups.get(line.dc_number).push(line);
  }

  let items = [];
  for (const [dcNumber, lines] of groups) {
    const first = lines[0];
    const serialItems = [];
    const typeStatusMap = new Map();

    for (const line of lines) {
      for (const item of buildSerialItems(line)) {
        serialItems.push(item);
      }
      for (const t of buildTypeStatus(line, serialItems)) {
        const key = t.name;
        typeStatusMap.set(key, { ...t, count: (typeStatusMap.get(key)?.count || 0) + t.count });
      }
    }

    const podFiles = cleanPodFiles(first.file_path);
    for (const line of lines) {
      for (const f of cleanPodFiles(line.file_path)) {
        if (!podFiles.includes(f)) podFiles.push(f);
      }
    }

    items.push({
      dc_number: dcNumber,
      created_at: first.created_at,
      updated_at: first.updated_at,
      pdf_path: first.pdf_path,
      customer_name: first.customer_name,
      customer_id: first.customer_id,
      ship_by: first.ship_by,
      delivery_type: first.ship_by === 'by_courier' ? 'Courier Delivery' : 'Hand Delivery',
      delivery_person_name: (first.delivery_person_name || '').trim() || 'N/A',
      model_name: first.model_name,
      processor: first.processor,
      generation: first.generation,
      ram: first.ram,
      storage: first.storage,
      gpu: first.gpu,
      screen_size: first.screen_size,
      serial_items: serialItems,
      type_status: [...typeStatusMap.values()],
      pod_files: podFiles,
      submitted_remark: first.submitted_remark || lines.find((l) => l.submitted_remark)?.submitted_remark || '',
      status: first.status,
    });
  }

  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter(
      (row) =>
        row.dc_number?.toLowerCase().includes(q)
        || row.customer_name?.toLowerCase().includes(q)
        || row.delivery_person_name?.toLowerCase().includes(q)
        || row.serial_items.some((s) => s.serial?.toLowerCase().includes(q) || s.unique?.toLowerCase().includes(q))
    );
  }

  return items;
}

function flattenPartsFromTicket(ticket, deliveryPersonName) {
  const records = [];
  const assigned = parsePartsJson(ticket.assigned_parts);
  const replaced = parsePartsJson(ticket.replaced_parts);

  for (const item of assigned) {
    const partNameRaw = item.part || '';
    const serialRaw = item.serial || '';
    const partParts = String(partNameRaw).split('|');
    const serialParts = parseSerialParts(serialRaw);

    records.push({
      complaint_id: ticket.id,
      ticket_date: ticket.created_at,
      part_name: partParts[1] ? formatPartLabel(partParts[1]) : formatPartLabel(partNameRaw),
      serial_number_display: serialParts.serial || 'N/A',
      serial_number_raw: serialRaw,
      delivery_person_name: deliveryPersonName || 'N/A',
      customer_name: ticket.customer_name || 'N/A',
      customer_id: ticket.customer_id,
      status: 'New',
    });
  }

  for (const item of replaced) {
    const partNameRaw = item.part || '';
    const serialRaw = item.serial || '';
    const partParts = String(partNameRaw).split('|');

    records.push({
      complaint_id: ticket.id,
      ticket_date: ticket.created_at,
      part_name: partParts[1] ? formatPartLabel(partParts[1]) : formatPartLabel(partNameRaw),
      serial_number_display: serialRaw || 'N/A',
      serial_number_raw: serialRaw,
      delivery_person_name: deliveryPersonName || 'N/A',
      customer_name: ticket.customer_name || 'N/A',
      customer_id: ticket.customer_id,
      status: 'Replaced',
    });
  }

  return records;
}

async function fetchPartsBucket({ technicianId, search = '' }) {
  const personIds = await resolveTechnicianPersonIds(technicianId);
  if (!personIds.length) return [];

  const ticketsR = await pool.query(
    `SELECT
       st.id,
       st.customer_id,
       st.customer_name,
       st.assigned_parts,
       st.replaced_parts,
       st.created_at,
       st.updated_at,
       COALESCE(dt.first_name || ' ' || dt.last_name, '') AS delivery_person_name
     FROM support_tickets st
     LEFT JOIN delivery_technicians dt ON (
       dt.technician_id = st.delivery_person_id OR dt.user_id = st.delivery_person_id
     )
     WHERE st.delivery_person_id = ANY($1::int[])
       AND (
         COALESCE(jsonb_array_length(st.assigned_parts), 0) > 0
         OR COALESCE(jsonb_array_length(st.replaced_parts), 0) > 0
       )
     ORDER BY st.updated_at DESC`,
    [personIds]
  );

  let items = ticketsR.rows.flatMap((t) =>
    flattenPartsFromTicket(t, t.delivery_person_name)
  );

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter(
      (row) =>
        String(row.part_name).toLowerCase().includes(q)
        || String(row.serial_number_display).toLowerCase().includes(q)
        || String(row.customer_name).toLowerCase().includes(q)
        || String(row.delivery_person_name).toLowerCase().includes(q)
    );
  }

  return items;
}

async function fetchBucketDetails({ technicianId, type = 'assets', search = '' }) {
  if (type === 'parts') {
    return fetchPartsBucket({ technicianId, search });
  }
  return fetchAssetsBucket({ technicianId, search });
}

module.exports = {
  listBucketTechnicians,
  fetchBucketDetails,
};
