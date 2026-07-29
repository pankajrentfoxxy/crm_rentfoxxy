/**
 * Physical spare-part inventory operations.
 *
 * `part_instances.prt_id` is the canonical Part ID: it is what gets printed on
 * the 1x1 cm QR label, what the inventory team scans at approval, and what the
 * movement ledger keys on. Everything here keeps that record, the procurement
 * serial row, the aggregate `parts.quantity` counter and the ledger in step
 * inside one transaction.
 */
const pool = require('../config/db');
const { generatePrtId } = require('./partIdService');
const { recordMovement, MOVEMENT } = require('./partMovementService');
const { PART_CATEGORIES } = require('../constants/laptopConditions');

const VALID_CATEGORIES = new Set(PART_CATEGORIES.map((c) => c.value));

function normalizeCategory(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (VALID_CATEGORIES.has(v)) return v;
  if (v === 'ssd' || v === 'hdd' || v === 'hard disk' || v === 'harddisk') return 'storage';
  if (v === 'screen') return 'display';
  if (v === 'charger' || v === 'adapter') return 'power';
  return 'general';
}

function lineName(line) {
  return String(
    line?.name || line?.part_name || line?.spare_part_name || line?.product_name || ''
  ).trim();
}

function lineRawId(line) {
  return line?.product_detail_id ?? line?.part_id ?? line?.product_id ?? line?.pro_id ?? line?.id;
}

/**
 * Find the floor `parts.part_id` a spare-PO line refers to, in the same
 * precedence order the receive flow has always used. Returns null if unknown.
 */
async function resolveFloorPartId(line, db = pool) {
  const rawId = lineRawId(line);
  const isNumeric = (v) => v != null && /^\d+$/.test(String(v));

  const explicitFloor = line?.floor_part_id ?? line?.parts_catalog_id ?? null;
  if (isNumeric(explicitFloor)) {
    const fp = await db.query(`SELECT part_id FROM parts WHERE part_id = $1`, [Number(explicitFloor)]);
    if (fp.rows.length) return fp.rows[0].part_id;
  }

  if (isNumeric(rawId)) {
    const direct = await db.query(`SELECT part_id FROM parts WHERE part_id = $1`, [Number(rawId)]);
    if (direct.rows.length) return direct.rows[0].part_id;

    const cat = await db.query(
      `SELECT floor_part_id FROM vendor_spare_parts_catalog
        WHERE part_id = $1 AND floor_part_id IS NOT NULL`,
      [Number(rawId)]
    );
    if (cat.rows[0]?.floor_part_id) return cat.rows[0].floor_part_id;
  }

  let name = lineName(line);
  if (!name && isNumeric(rawId)) {
    const cat = await db.query(`SELECT name FROM vendor_spare_parts_catalog WHERE part_id = $1`, [Number(rawId)]);
    name = cat.rows[0]?.name || '';
  }
  if (name) {
    const match = await db.query(
      `SELECT part_id FROM parts WHERE LOWER(part_name) = LOWER($1) LIMIT 1`,
      [name]
    );
    if (match.rows.length) return match.rows[0].part_id;
  }

  return null;
}

/**
 * Same as resolveFloorPartId, but creates the catalog row when the PO line
 * describes a part the floor catalog has never seen. Receiving must never drop
 * a physical unit just because the catalogs were not linked up front.
 */
async function resolveOrCreateFloorPartId(client, line) {
  const found = await resolveFloorPartId(line, client);
  if (found) return found;

  const name = lineName(line) || `Spare part ${lineRawId(line) ?? ''}`.trim();
  const category = normalizeCategory(line?.category);
  const brands = line?.brand_name ? [String(line.brand_name).trim()] : null;

  const ins = await client.query(
    `INSERT INTO parts
       (part_name, part_type, category, quantity, min_threshold, description, compatible_brands, cost)
     VALUES ($1, $2, $3, 0, 5, $4, $5, $6)
     RETURNING part_id`,
    [
      name,
      line?.part_type || category,
      category,
      line?.specifications || name,
      brands,
      Number(line?.rate ?? line?.unit_price ?? line?.cost ?? 0) || 0,
    ]
  );
  const partId = ins.rows[0].part_id;

  // Link the vendor catalog entry so the next receive resolves directly.
  const rawId = lineRawId(line);
  if (rawId != null && /^\d+$/.test(String(rawId))) {
    await client
      .query(
        `UPDATE vendor_spare_parts_catalog SET floor_part_id = $1, updated_at = NOW()
          WHERE part_id = $2 AND floor_part_id IS NULL`,
        [partId, Number(rawId)]
      )
      .catch(() => {});
  }

  return partId;
}

async function getPartMeta(db, partId) {
  const r = await db.query(
    `SELECT part_id, part_name, category, cost, location_code FROM parts WHERE part_id = $1`,
    [Number(partId)]
  );
  return r.rows[0] || null;
}

/**
 * Turn received units into tracked inventory.
 *
 * @param {import('pg').PoolClient} client — inside an open transaction
 * @param {object[]} units — one entry per physical unit:
 *        { serialNumber?, vendorSerialId?, assetCode? }
 * @returns {Promise<object[]>} created instances incl. prt_id
 */
async function receiveUnitsIntoInventory(client, {
  partId, units, unitCost, locationCode, spoId, grnId, spoLineIndex,
  vendorId, batchNumber, receivedBy, actorName, notes,
}) {
  const list = Array.isArray(units) ? units : [];
  if (!list.length) return [];

  const part = await getPartMeta(client, partId);
  const cost = Number(unitCost) || Number(part?.cost) || 0;
  const created = [];
  const now = new Date();

  for (const unit of list) {
    const prtId = await generatePrtId(now, client);
    const serial = unit?.serialNumber != null && String(unit.serialNumber).trim() !== ''
      ? String(unit.serialNumber).trim()
      : null;

    const ins = await client.query(
      `INSERT INTO part_instances
         (prt_id, part_id, spo_id, grn_id, spo_line_index, batch_number, unit_cost,
          location_code, status, notes, serial_number, vendor_serial_id, asset_code,
          vendor_id, source, received_at, received_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_stock',$9,$10,$11,$12,$13,'purchase',NOW(),$14,NOW(),NOW())
       RETURNING instance_id, prt_id, serial_number, asset_code, unit_cost, status, location_code`,
      [
        prtId, Number(partId), spoId || null, grnId || null,
        spoLineIndex != null ? Number(spoLineIndex) : null,
        batchNumber || null, cost, locationCode || part?.location_code || null,
        notes || null, serial,
        unit?.vendorSerialId != null ? Number(unit.vendorSerialId) : null,
        unit?.assetCode || null,
        vendorId != null ? Number(vendorId) : null,
        receivedBy || null,
      ]
    );
    const instance = ins.rows[0];

    if (unit?.vendorSerialId != null) {
      await client.query(
        `UPDATE vendor_serial_numbers SET part_instance_id = $1, updated_at = NOW()
          WHERE serial_id = $2`,
        [instance.instance_id, Number(unit.vendorSerialId)]
      );
    }

    await recordMovement(client, {
      type: MOVEMENT.RECEIVED,
      partId,
      instanceId: instance.instance_id,
      prtId: instance.prt_id,
      serialNumber: instance.serial_number,
      category: part?.category,
      partName: part?.part_name,
      unitCost: cost,
      spoId,
      grnId,
      vendorId,
      actorUserId: receivedBy,
      actorName,
    });

    created.push(instance);
  }

  await client.query(
    `UPDATE parts SET quantity = COALESCE(quantity, 0) + $1, updated_at = NOW() WHERE part_id = $2`,
    [created.length, Number(partId)]
  );

  return created;
}

/**
 * Attach freshly received units to requests that were waiting on procurement.
 * Runs in the same transaction as the receive so stock can never be double-promised.
 */
async function autoLinkOpenRequests(client, { partId, instances, actorUserId, actorName }) {
  const linked = [];
  for (const inst of instances) {
    const upd = await client.query(
      `UPDATE part_requests
          SET status = 'approved', instance_id = $1, updated_at = NOW()
        WHERE request_id = (
          SELECT request_id FROM part_requests
           WHERE part_id = $2 AND status IN ('escalated', 'ordered') AND instance_id IS NULL
           ORDER BY created_at ASC LIMIT 1
        )
        RETURNING request_id, ticket_id, request_number`,
      [inst.instance_id, Number(partId)]
    );
    if (!upd.rows.length) continue;

    const request = upd.rows[0];
    await client.query(
      `UPDATE part_instances SET status = 'reserved', updated_at = NOW() WHERE instance_id = $1`,
      [inst.instance_id]
    );

    const part = await getPartMeta(client, partId);
    await recordMovement(client, {
      type: MOVEMENT.RESERVED,
      partId,
      instanceId: inst.instance_id,
      prtId: inst.prt_id,
      serialNumber: inst.serial_number,
      category: part?.category,
      partName: part?.part_name,
      unitCost: inst.unit_cost,
      requestId: request.request_id,
      ticketId: request.ticket_id,
      notes: `Auto-reserved on receipt for ${request.request_number || 'open request'}`,
      actorUserId,
      actorName,
    });
    linked.push({ ...request, instance_id: inst.instance_id, prt_id: inst.prt_id });
  }
  return linked;
}

/**
 * Take a part removed from a laptop back into inventory as its own tracked unit,
 * so defective stock can be scanned, repaired or written off later.
 */
async function createReturnedPartInstance(client, {
  partId, condition, ttsplId, ticketId, requestId, serialNumber,
  locationCode, notes, actorUserId, actorName,
}) {
  const part = await getPartMeta(client, partId);
  if (!part) throw new Error('Cannot record returned part: catalog part not found');

  const isReusable = condition === 'good';
  const status = isReusable ? 'in_stock' : 'defective';
  const prtId = await generatePrtId(new Date(), client);

  const ins = await client.query(
    `INSERT INTO part_instances
       (prt_id, part_id, unit_cost, status, location_code, notes, serial_number,
        source, origin_request_id, removed_from_ttspl_id, removed_from_ticket_id,
        condition_on_removal, removed_at, received_at, received_by, created_at, updated_at)
     VALUES ($1,$2,0,$3,$4,$5,$6,'defective_return',$7,$8,$9,$10,NOW(),NOW(),$11,NOW(),NOW())
     RETURNING instance_id, prt_id, status`,
    [
      prtId, Number(partId), status, locationCode || null, notes || null,
      serialNumber || null, requestId || null, ttsplId || null,
      ticketId || null, condition || null, actorUserId || null,
    ]
  );
  const instance = ins.rows[0];

  // Only reusable returns add back to sellable stock.
  if (isReusable) {
    await client.query(
      `UPDATE parts SET quantity = COALESCE(quantity, 0) + 1, updated_at = NOW() WHERE part_id = $1`,
      [Number(partId)]
    );
  }

  await recordMovement(client, {
    type: isReusable ? MOVEMENT.RETURNED_GOOD : MOVEMENT.RETURNED_DEFECTIVE,
    partId,
    instanceId: instance.instance_id,
    prtId: instance.prt_id,
    serialNumber,
    category: part.category,
    partName: part.part_name,
    requestId,
    ticketId,
    ttsplId,
    condition,
    notes: notes || `Removed from ${ttsplId || 'laptop'}`,
    actorUserId,
    actorName,
  });

  return instance;
}

module.exports = {
  normalizeCategory,
  resolveFloorPartId,
  resolveOrCreateFloorPartId,
  receiveUnitsIntoInventory,
  autoLinkOpenRequests,
  createReturnedPartInstance,
  getPartMeta,
};
