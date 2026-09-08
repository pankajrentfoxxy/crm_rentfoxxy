/**
 * Physical / dead parts found in the warehouse that do not exist in CRM inventory.
 * Isolated from part_instances, discarded-parts, and scrap challans.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const {
  currentFinancialYearLabel,
  dispatchPayloadFromBody,
  saveEsign,
} = require('./vendorRepairDcShared');

const STATUSES = new Set(['available', 'pending', 'out']);
const OUTWARD_STATUSES = new Set(['draft', 'dispatch_ready', 'dispatched', 'cancelled']);
const RECEIVER_TYPES = new Set(['scrap_buyer', 'vendor', 'technician', 'warehouse', 'other']);
const CONDITIONS = new Set(['dead', 'damaged', 'unusable', 'unknown']);

function actorFrom(user) {
  return {
    userId: user?.user_id || null,
    name: user?.name || user?.email || null,
  };
}

function nextSeq(prefixLike, col, table) {
  return async function nextNumber(client) {
    const fy = currentFinancialYearLabel();
    const r = await client.query(
      `SELECT COALESCE(MAX((regexp_match(${col}, '/([0-9]+)$'))[1]::int), 0) + 1 AS n
         FROM ${table}
        WHERE ${col} LIKE $1`,
      [`${prefixLike}/${fy}/%`]
    );
    const seq = String(r.rows[0]?.n || 1).padStart(4, '0');
    return `${prefixLike}/${fy}/${seq}`;
  };
}

const nextInwardNumber = nextSeq('PIN', 'inward_number', 'physical_part_inwards');
const nextOutwardNumber = nextSeq('POUT', 'outward_number', 'physical_part_outwards');

async function nextDpNumber(client) {
  const r = await client.query(
    `SELECT COALESCE(MAX((regexp_match(dp_number, 'DP-([0-9]+)$'))[1]::int), 0) + 1 AS n
       FROM physical_dead_parts`
  );
  return `DP-${String(r.rows[0]?.n || 1).padStart(4, '0')}`;
}

function resolvePhotoAbs(rel) {
  if (!rel) return null;
  const clean = String(rel).replace(/^\/?uploads\//, '').replace(/^\//, '');
  const candidates = [
    path.join(__dirname, '..', 'uploads', clean),
    path.join(__dirname, '..', clean),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function assertPhotoPath(rel, label) {
  const raw = String(rel || '').trim();
  if (!raw) throw new Error(`${label} photo is required`);
  const clean = raw.replace(/^\/?uploads\//, '');
  if (!clean.startsWith('physical-parts/')) {
    throw new Error(`${label} photo must be uploaded through Part Inward / Outward`);
  }
  if (!resolvePhotoAbs(clean)) {
    throw new Error(`${label} photo file is missing — upload again`);
  }
  return clean;
}

function collectPhotoInputs(...sources) {
  const out = [];
  for (const src of sources) {
    if (Array.isArray(src)) out.push(...src);
    else if (src) out.push(src);
  }
  return [...new Set(out.map((p) => String(p || '').trim()).filter(Boolean))];
}

function assertPhotoList(rawList, label, { min = 1, max = 12 } = {}) {
  const list = collectPhotoInputs(rawList);
  if (list.length < min) throw new Error(`${label}: at least ${min} photo${min === 1 ? '' : 's'} required`);
  if (list.length > max) throw new Error(`${label}: maximum ${max} photos`);
  return list.map((p, i) => assertPhotoPath(p, `${label} photo ${i + 1}`));
}

function normalizeMobile(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  if (digits.length !== 10) {
    throw Object.assign(new Error('Mobile number must be 10 digits'), { status: 400 });
  }
  return digits;
}

function normalizeUnit(u, idx) {
  const partName = String(u?.part_name || '').trim();
  const category = String(u?.category || '').trim();
  const serial = String(u?.serial_number || '').trim() || null;
  const condition = String(u?.condition || 'dead').trim().toLowerCase();
  const remarks = String(u?.remarks || '').trim() || null;
  if (!partName) throw new Error(`Part ${idx + 1}: part name is required`);
  if (!category) throw new Error(`Part ${idx + 1}: category is required`);
  if (!CONDITIONS.has(condition)) throw new Error(`Part ${idx + 1}: invalid condition`);
  const photos = assertPhotoList(
    collectPhotoInputs(u?.inward_photo_paths, u?.photos, u?.inward_photo_path, u?.photo_path),
    `Part ${idx + 1}`
  );
  return { partName, category, serial, condition, remarks, photo: photos[0], photos };
}

function partRow(row) {
  if (!row) return null;
  const inwardPhotos = collectPhotoInputs(row.inward_photo_paths, row.inward_photo_path);
  const outwardPhotos = collectPhotoInputs(row.photo_paths, row.outward_photo_paths, row.outward_photo_path, row.photo_path);
  return {
    ...row,
    inward_photo_path: inwardPhotos[0] || row.inward_photo_path || null,
    inward_photos: inwardPhotos,
    outward_photos: outwardPhotos,
    status_label: row.status === 'out'
      ? 'OUT'
      : row.status === 'pending'
        ? 'PENDING DISPATCH'
        : 'AVAILABLE / DEAD',
  };
}

function wrapOutward(row) {
  if (!row) return null;
  const photos = collectPhotoInputs(row.photo_paths, row.photo_path);
  return {
    ...row,
    photo_path: photos[0] || row.photo_path || null,
    photos,
    status_label: String(row.status || 'draft').replace(/_/g, ' ').toUpperCase(),
  };
}

async function createInward(client, { warehouse, inwardDate, inwardReason, remarks, units, actor }) {
  const wh = String(warehouse || '').trim();
  const reason = String(inwardReason || '').trim();
  const date = inwardDate || new Date().toISOString().slice(0, 10);
  if (!wh) throw new Error('Warehouse is required');
  if (!reason) throw new Error('Inward reason is required');
  if (!Array.isArray(units) || !units.length) throw new Error('Add at least one physical part');
  if (units.length > 50) throw new Error('Maximum 50 parts per inward');

  const normalized = units.map(normalizeUnit);
  const inwardNumber = await nextInwardNumber(client);
  const inwardRes = await client.query(
    `INSERT INTO physical_part_inwards
       (inward_number, warehouse, inward_date, inward_reason, remarks, created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [inwardNumber, wh, date, reason, String(remarks || '').trim() || null, actor.userId, actor.name]
  );
  const inward = inwardRes.rows[0];
  const parts = [];
  for (const u of normalized) {
    const dp = await nextDpNumber(client);
    const r = await client.query(
      `INSERT INTO physical_dead_parts
         (dp_number, inward_id, part_name, category, serial_number, warehouse, condition,
          inward_photo_path, inward_photo_paths, remarks, status, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'available',$11,$12)
       RETURNING *`,
      [dp, inward.inward_id, u.partName, u.category, u.serial, wh, u.condition,
        u.photo, JSON.stringify(u.photos), u.remarks, actor.userId, actor.name]
    );
    parts.push(partRow(r.rows[0]));
  }
  return { inward, parts };
}

async function listParts({ status, search, warehouse, page = 1, limit = 50 } = {}) {
  const params = [];
  const where = [];
  if (status && STATUSES.has(status)) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }
  if (warehouse) {
    params.push(`%${warehouse}%`);
    where.push(`p.warehouse ILIKE $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      p.dp_number ILIKE $${params.length}
      OR p.part_name ILIKE $${params.length}
      OR p.serial_number ILIKE $${params.length}
      OR p.category ILIKE $${params.length}
      OR i.inward_number ILIKE $${params.length}
      OR o.outward_number ILIKE $${params.length}
    )`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM physical_dead_parts p
       JOIN physical_part_inwards i ON i.inward_id = p.inward_id
       LEFT JOIN physical_part_outwards o ON o.outward_id = p.outward_id
     ${whereSql}`,
    params
  );
  const total = count.rows[0]?.n || 0;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  params.push(lim, off);
  const rows = await pool.query(
    `SELECT p.*,
            i.inward_number, i.inward_date, i.inward_reason, i.created_by_name AS inward_user,
            o.outward_number, o.outward_date, o.receiver_name, o.receiver_type, o.created_by_name AS outward_user
       FROM physical_dead_parts p
       JOIN physical_part_inwards i ON i.inward_id = p.inward_id
       LEFT JOIN physical_part_outwards o ON o.outward_id = p.outward_id
     ${whereSql}
     ORDER BY CASE p.status
                WHEN 'available' THEN 0
                WHEN 'pending' THEN 1
                ELSE 2
              END,
              p.created_at DESC, p.dp_number DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    parts: rows.rows.map(partRow),
    pagination: { page: Math.max(Number(page) || 1, 1), limit: lim, total, totalPages: Math.max(1, Math.ceil(total / lim)) },
  };
}

async function getPart(dpNumber) {
  const r = await pool.query(
    `SELECT p.*,
            i.inward_number, i.inward_date, i.inward_reason, i.warehouse AS inward_warehouse,
            i.remarks AS inward_remarks, i.created_by_name AS inward_user, i.created_at AS inward_at,
            o.outward_number, o.outward_date, o.receiver_type, o.receiver_name, o.receiver_contact,
            o.purpose AS outward_purpose, o.photo_path AS outward_photo_path,
            o.photo_paths AS outward_photo_paths, o.remarks AS outward_remarks,
            o.reference_number, o.created_by_name AS outward_user, o.created_at AS outward_at
       FROM physical_dead_parts p
       JOIN physical_part_inwards i ON i.inward_id = p.inward_id
       LEFT JOIN physical_part_outwards o ON o.outward_id = p.outward_id
      WHERE p.dp_number = $1`,
    [dpNumber]
  );
  return partRow(r.rows[0] || null);
}

async function listInwards({ search, page = 1, limit = 25 } = {}) {
  const params = [];
  const where = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(i.inward_number ILIKE $${params.length} OR i.warehouse ILIKE $${params.length} OR i.inward_reason ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM physical_part_inwards i ${whereSql}`, params);
  const total = count.rows[0]?.n || 0;
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  params.push(lim, off);
  const rows = await pool.query(
    `SELECT i.*,
            (SELECT COUNT(*)::int FROM physical_dead_parts p WHERE p.inward_id = i.inward_id) AS part_count
       FROM physical_part_inwards i
     ${whereSql}
     ORDER BY i.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    inwards: rows.rows,
    pagination: { page: Math.max(Number(page) || 1, 1), limit: lim, total, totalPages: Math.max(1, Math.ceil(total / lim)) },
  };
}

async function getInward(inwardNumber) {
  const head = await pool.query(
    `SELECT * FROM physical_part_inwards WHERE inward_number = $1`,
    [inwardNumber]
  );
  if (!head.rows[0]) return null;
  const items = await pool.query(
    `SELECT p.*, o.outward_number, o.receiver_name
       FROM physical_dead_parts p
       LEFT JOIN physical_part_outwards o ON o.outward_id = p.outward_id
      WHERE p.inward_id = $1
      ORDER BY p.dp_number`,
    [head.rows[0].inward_id]
  );
  return { inward: head.rows[0], parts: items.rows.map(partRow) };
}

async function createOutward(client, {
  partIds,
  receiverType,
  receiverName,
  receiverContact,
  outwardDate,
  purpose,
  photoPath,
  photoPaths,
  remarks,
  referenceNumber,
  actor,
}) {
  const ids = [...new Set((partIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n)))];
  if (!ids.length) throw new Error('Select at least one available part');
  const type = String(receiverType || '').trim();
  const name = String(receiverName || '').trim();
  const reason = String(purpose || '').trim();
  if (!RECEIVER_TYPES.has(type)) throw new Error('Receiver type is required');
  if (!name) throw new Error('Receiver name is required');
  if (!reason) throw new Error('Purpose / reason is required');
  const mobile = normalizeMobile(receiverContact);
  const photos = assertPhotoList(collectPhotoInputs(photoPaths, photoPath), 'Outward');
  const photo = photos[0];
  const date = outwardDate || new Date().toISOString().slice(0, 10);

  const locked = await client.query(
    `SELECT part_id, dp_number, status
       FROM physical_dead_parts
      WHERE part_id = ANY($1::int[])
      FOR UPDATE`,
    [ids]
  );
  if (locked.rows.length !== ids.length) {
    throw Object.assign(new Error('One or more selected parts were not found'), { status: 400 });
  }
  const alreadyOut = locked.rows.filter((r) => r.status !== 'available');
  if (alreadyOut.length) {
    throw Object.assign(
      new Error(`Already outwarded: ${alreadyOut.map((r) => r.dp_number).join(', ')}`),
      { status: 409 }
    );
  }

  const outwardNumber = await nextOutwardNumber(client);
  const outRes = await client.query(
    `INSERT INTO physical_part_outwards
       (outward_number, receiver_type, receiver_name, receiver_contact, outward_date,
        purpose, photo_path, photo_paths, remarks, reference_number, status,
        created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'draft',$11,$12)
     RETURNING *`,
    [
      outwardNumber, type, name, mobile, date,
      reason, photo, JSON.stringify(photos), String(remarks || '').trim() || null,
      String(referenceNumber || '').trim() || null, actor.userId, actor.name,
    ]
  );
  const outward = outRes.rows[0];

  for (const row of locked.rows) {
    const upd = await client.query(
      `UPDATE physical_dead_parts
          SET status = 'pending', outward_id = $2, updated_at = NOW()
        WHERE part_id = $1 AND status = 'available'
        RETURNING part_id`,
      [row.part_id, outward.outward_id]
    );
    if (!upd.rowCount) {
      throw Object.assign(new Error(`${row.dp_number} is no longer available`), { status: 409 });
    }
    await client.query(
      `INSERT INTO physical_part_outward_items (outward_id, part_id, dp_number)
       VALUES ($1,$2,$3)`,
      [outward.outward_id, row.part_id, row.dp_number]
    );
  }

  const items = await client.query(
    `SELECT p.* FROM physical_dead_parts p WHERE p.outward_id = $1 ORDER BY p.dp_number`,
    [outward.outward_id]
  );
  return { outward: wrapOutward(outward), parts: items.rows.map(partRow) };
}

async function dispatchOutward(client, { outwardNumber, warehouseEsign, recipientEsign, dispatchBody, actor }) {
  const headRes = await client.query(
    `SELECT * FROM physical_part_outwards WHERE outward_number = $1 FOR UPDATE`,
    [outwardNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw Object.assign(new Error('Outward not found'), { status: 404 });
  if (head.status === 'dispatch_ready' || head.status === 'dispatched') {
    return { already_dispatched: head.status === 'dispatched', outward_number: outwardNumber };
  }
  if (head.status !== 'draft') {
    throw Object.assign(new Error('Outward must be in draft to dispatch'), { status: 409 });
  }

  const body = dispatchBody || {};
  let dispatch;
  if (body.ship_by || body.shipBy || body.dispatch_mode) {
    dispatch = dispatchPayloadFromBody(body);
  } else if (head.ship_by || head.dispatch_mode) {
    dispatch = {
      ship_by: head.ship_by,
      dispatch_mode: head.dispatch_mode,
      courier_name: head.courier_name,
      awb_number: head.awb_number,
      courier_tracking_url: head.courier_tracking_url,
      porter_tracking_id: head.porter_tracking_id,
      porter_order_id: head.porter_order_id,
      porter_booking_url: head.porter_booking_url,
      delivery_person_id: head.delivery_person_id,
    };
  } else {
    throw new Error('Send mode is required before dispatch (select By Hand, Courier, or Porter)');
  }

  const whUrl = warehouseEsign
    ? saveEsign('pout_dispatch', outwardNumber, warehouseEsign)
    : head.warehouse_dispatch_esign_url;
  if (!whUrl) throw new Error('Warehouse dispatch e-signature is required');

  const recipientUrl = recipientEsign
    ? saveEsign('pout_recipient', outwardNumber, recipientEsign)
    : head.recipient_esign_url || null;
  const whSignerName = (body.warehouse_signer_name || body.warehouseSignerName || '').trim() || null;
  const recipientSignerName = (body.recipient_signer_name || body.recipientSignerName || '').trim() || null;

  await client.query(
    `UPDATE physical_part_outwards SET
        warehouse_dispatch_esign_url = $2,
        recipient_esign_url = COALESCE($3, recipient_esign_url),
        warehouse_dispatch_signer_name = COALESCE($4, warehouse_dispatch_signer_name),
        recipient_signer_name = COALESCE($5, recipient_signer_name),
        ship_by = $6,
        dispatch_mode = $7,
        courier_name = $8,
        awb_number = $9,
        courier_tracking_url = $10,
        porter_tracking_id = $11,
        porter_order_id = $12,
        porter_booking_url = $13,
        delivery_person_id = $14,
        status = 'dispatch_ready',
        updated_at = NOW()
      WHERE outward_number = $1`,
    [
      outwardNumber,
      whUrl,
      recipientUrl,
      whSignerName,
      recipientSignerName,
      dispatch.ship_by,
      dispatch.dispatch_mode,
      dispatch.courier_name,
      dispatch.awb_number,
      dispatch.courier_tracking_url,
      dispatch.porter_tracking_id,
      dispatch.porter_order_id,
      dispatch.porter_booking_url,
      dispatch.delivery_person_id,
    ]
  );
  return { outward_number: outwardNumber, status: 'dispatch_ready' };
}

async function cancelDraftOutward(client, { outwardNumber }) {
  const headRes = await client.query(
    `SELECT * FROM physical_part_outwards WHERE outward_number = $1 FOR UPDATE`,
    [outwardNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw Object.assign(new Error('Outward not found'), { status: 404 });
  if (head.status !== 'draft') {
    throw Object.assign(new Error('Only a draft outward can be cancelled'), { status: 409 });
  }

  await client.query(
    `UPDATE physical_dead_parts
        SET status = 'available', outward_id = NULL, updated_at = NOW()
      WHERE outward_id = $1 AND status = 'pending'`,
    [head.outward_id]
  );
  await client.query(
    `DELETE FROM physical_part_outward_items WHERE outward_id = $1`,
    [head.outward_id]
  );
  await client.query(
    `UPDATE physical_part_outwards
        SET status = 'cancelled', updated_at = NOW()
      WHERE outward_id = $1`,
    [head.outward_id]
  );
  return { outward_number: outwardNumber, status: 'cancelled' };
}

async function confirmGateOutward(client, { outwardNumber }) {
  const headRes = await client.query(
    `SELECT * FROM physical_part_outwards WHERE outward_number = $1 FOR UPDATE`,
    [outwardNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw Object.assign(new Error('Physical outward not found'), { status: 404 });
  if (head.status === 'dispatched') return { already: true, outward_number: outwardNumber };
  if (head.status !== 'dispatch_ready') {
    throw Object.assign(new Error('This outward is not waiting at the gate'), { status: 409 });
  }

  await client.query(
    `UPDATE physical_part_outwards
        SET status = 'dispatched',
            dispatched_at = COALESCE(dispatched_at, NOW()),
            gate_confirmed_at = NOW(),
            updated_at = NOW()
      WHERE outward_id = $1`,
    [head.outward_id]
  );
  await client.query(
    `UPDATE physical_dead_parts
        SET status = 'out', updated_at = NOW()
      WHERE outward_id = $1 AND status = 'pending'`,
    [head.outward_id]
  );
  return { already: false, outward_number: outwardNumber };
}

async function listOutwards({ search, page = 1, limit = 25 } = {}) {
  const params = [];
  const where = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      o.outward_number ILIKE $${params.length}
      OR o.receiver_name ILIKE $${params.length}
      OR o.reference_number ILIKE $${params.length}
      OR o.purpose ILIKE $${params.length}
    )`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM physical_part_outwards o ${whereSql}`, params);
  const total = count.rows[0]?.n || 0;
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  params.push(lim, off);
  const rows = await pool.query(
    `SELECT o.*,
            (SELECT COUNT(*)::int FROM physical_part_outward_items i WHERE i.outward_id = o.outward_id) AS part_count
       FROM physical_part_outwards o
     ${whereSql}
     ORDER BY o.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    outwards: rows.rows.map(wrapOutward),
    pagination: { page: Math.max(Number(page) || 1, 1), limit: lim, total, totalPages: Math.max(1, Math.ceil(total / lim)) },
  };
}

async function getOutward(outwardNumber) {
  const head = await pool.query(
    `SELECT * FROM physical_part_outwards WHERE outward_number = $1`,
    [outwardNumber]
  );
  if (!head.rows[0]) return null;
  const items = await pool.query(
    `SELECT p.*, i.inward_number, i.inward_date
       FROM physical_dead_parts p
       JOIN physical_part_inwards i ON i.inward_id = p.inward_id
      WHERE p.outward_id = $1
      ORDER BY p.dp_number`,
    [head.rows[0].outward_id]
  );
  return {
    outward: wrapOutward(head.rows[0]),
    parts: items.rows.map(partRow),
  };
}

async function getCounts() {
  const r = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'available')::int AS available,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'out')::int AS out,
        COUNT(*)::int AS total
       FROM physical_dead_parts`
  );
  return r.rows[0];
}

module.exports = {
  actorFrom,
  createInward,
  createOutward,
  dispatchOutward,
  cancelDraftOutward,
  confirmGateOutward,
  listParts,
  getPart,
  listInwards,
  getInward,
  listOutwards,
  getOutward,
  getCounts,
  RECEIVER_TYPES,
  CONDITIONS,
  OUTWARD_STATUSES,
};
