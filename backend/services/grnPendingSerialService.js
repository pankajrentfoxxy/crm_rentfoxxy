/**
 * 428 — laptops received on GRN without a serial number.
 *
 * A laptop that will not power on and has no readable sticker cannot run the
 * capture script and cannot be typed in, so it is received with a TTSPL and a
 * placeholder serial `NOSERIAL-<TTSPL>` (serial_pending = TRUE). The
 * placeholder is unique (the TTSPL is), so every table that copies the serial
 * at receive — the floor ticket, the legacy inventory row, … — holds it too.
 * When the laptop powers on, addPendingSerial() swaps the placeholder for the
 * real serial everywhere it was copied.
 *
 * Until then inventoryStateMachine refuses to reserve or dispatch it: a
 * laptop does not go to a customer under a made-up serial.
 */
const pool = require('../config/db');
const { resolveSerialForGrnIntake } = require('./serialReintakeService');
const { recordAssetEvent } = require('./eventService');
const { logTtsplEvent } = require('./ttsplAuditService');

const PLACEHOLDER_PREFIX = 'NOSERIAL-';

class PendingSerialError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PendingSerialError';
    this.status = status;
  }
}

function pendingSerialPlaceholder(ttsplId) {
  return `${PLACEHOLDER_PREFIX}${String(ttsplId || '').trim().toUpperCase()}`;
}

function isPendingSerial(serialNumber) {
  return String(serialNumber || '').trim().toUpperCase().startsWith(PLACEHOLDER_PREFIX);
}

/** Laptops still waiting for their serial, oldest first. */
async function listPendingSerials(db = pool) {
  const { rows } = await db.query(
    `SELECT s.serial_id, s.inventory_asset_code AS ttspl_id, s.serial_number, s.inventory_status,
            s.received_condition, s.missing_parts, s.created_at AS received_at, s.grn_id, s.po_id,
            p.purchase_order_number,
            COALESCE(NULLIF(TRIM(v.business_name), ''), v.first_name) AS vendor_name,
            s.extra->>'brand' AS brand, COALESCE(s.extra->>'model', s.extra->>'model_name') AS model,
            s.extra->>'processor' AS processor, s.extra->>'generation' AS generation,
            s.extra->>'ram' AS ram, s.extra->>'storage' AS storage,
            t.ticket_id, st.stage_name
       FROM vendor_serial_numbers s
       LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id
       LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
       LEFT JOIN LATERAL (
         SELECT ticket_id, current_stage_id FROM tickets
          WHERE vendor_serial_id = s.serial_id ORDER BY ticket_id DESC LIMIT 1
       ) t ON TRUE
       LEFT JOIN stages st ON st.stage_id = t.current_stage_id
      WHERE s.serial_pending AND s.deleted_at IS NULL
      ORDER BY s.created_at, s.serial_id`
  );
  return rows;
}

/**
 * Every (table, column) in the live schema that can hold a laptop serial.
 * Read from the catalogue — not a hand list — so a copy added later is not
 * left behind on the placeholder. Identifiers come from pg itself, never
 * from the request.
 */
async function serialColumns(client) {
  const { rows } = await client.query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.column_name IN ('serial_number', 'machine_number', 'unique_serial_number')
        AND c.data_type IN ('character varying', 'text')
        AND c.table_name <> 'vendor_serial_numbers'`
  );
  return rows;
}

const qid = (s) => `"${String(s).replace(/"/g, '""')}"`;

/**
 * Give a pending laptop its real serial. Runs in its own transaction.
 * @returns {{ serial_id, ttspl_id, serial_number, previous }}
 */
async function addPendingSerial({ serialId, serialNumber, actor, correlationId = null }) {
  const serial = String(serialNumber || '').trim().toUpperCase();
  if (serial.length < 3 || serial.length > 100) {
    throw new PendingSerialError('Enter the serial number from the laptop (3–100 characters).');
  }
  if (isPendingSerial(serial) || /^TTSPL/i.test(serial)) {
    throw new PendingSerialError('That is a TTSPL code, not the laptop’s serial number.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code, serial_pending, po_id, grn_id
         FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [serialId]
    )).rows[0];
    if (!row) throw new PendingSerialError('Laptop not found', 404);
    if (!row.serial_pending) {
      throw new PendingSerialError(`${row.inventory_asset_code || 'This laptop'} already has serial ${row.serial_number}.`, 409);
    }
    const placeholder = row.serial_number;

    // Same rule as a GRN receive: a serial already live elsewhere is refused;
    // one left on a scrapped / failed unit is archived so this one can take it.
    const reintake = await resolveSerialForGrnIntake(client, serial, {
      reason: 'grn_pending_serial_added',
      actorUserId: actor?.user_id || null,
      actorName: actor?.name || null,
      newPoId: row.po_id,
      newGrnId: row.grn_id,
    });
    if (!reintake.ok) throw new PendingSerialError(reintake.message, 409);

    const openTicket = (await client.query(
      `SELECT ticket_id FROM tickets
        WHERE serial_number = $1 AND status IN ('in_progress', 'on_hold') AND vendor_serial_id IS DISTINCT FROM $2
        LIMIT 1`,
      [serial, serialId]
    )).rows[0];
    if (openTicket) {
      throw new PendingSerialError(`Serial ${serial} is on open floor ticket #${openTicket.ticket_id} for another laptop.`, 409);
    }

    // The legacy inventory table keeps one row per serial. A unit that was
    // here before still has its row: keep that one, drop the placeholder's.
    const legacy = (await client.query(
      'SELECT inventory_id FROM inventory WHERE serial_number = $1 OR machine_number = $1 LIMIT 1',
      [serial]
    )).rows[0];
    if (legacy) {
      await client.query(
        'DELETE FROM inventory WHERE serial_number = $1 OR machine_number = $1',
        [placeholder]
      );
      await client.query(
        `UPDATE inventory SET status = 'Floor', updated_at = CURRENT_TIMESTAMP WHERE inventory_id = $1`,
        [legacy.inventory_id]
      );
    }
    const hasVpi = (await client.query("SELECT to_regclass('public.vendor_product_inventory') IS NOT NULL AS ok")).rows[0].ok;
    const vpiTaken = hasVpi && (await client.query(
      'SELECT 1 FROM vendor_product_inventory WHERE LOWER(serial_number) = LOWER($1) LIMIT 1',
      [serial]
    )).rows.length > 0;

    const updated = [];
    for (const { table_name: t, column_name: c } of await serialColumns(client)) {
      if (t === 'vendor_product_inventory' && vpiTaken) continue;
      const r = await client.query(
        `UPDATE ${qid(t)} SET ${qid(c)} = $1 WHERE ${qid(c)} = $2`,
        [serial, placeholder]
      );
      if (r.rowCount) updated.push(`${t}.${c}:${r.rowCount}`);
    }

    await client.query(
      `UPDATE vendor_serial_numbers
          SET serial_number = $2, serial_pending = FALSE, serial_added_at = NOW(), serial_added_by = $3,
              extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('serial_added_from_placeholder', $4::text),
              updated_at = NOW()
        WHERE serial_id = $1`,
      [serialId, serial, actor?.user_id || null, placeholder]
    );

    await recordAssetEvent(client, {
      serialId,
      ttsplId: row.inventory_asset_code,
      eventType: 'grn_serial_added',
      payload: { serial_number: serial, placeholder, copies_updated: updated },
      correlationId,
      source: 'grnPendingSerialService.addPendingSerial',
      actor,
    });
    await logTtsplEvent({
      ttsplId: row.inventory_asset_code,
      vendorSerialId: serialId,
      eventType: 'serial_number_added',
      description: `Serial ${serial} added (received without serial; was ${placeholder})`,
      metadata: { serial_number: serial, placeholder },
      actorUserId: actor?.user_id || null,
      actorName: actor?.name || null,
      db: client,
    });

    await client.query('COMMIT');
    return { serial_id: serialId, ttspl_id: row.inventory_asset_code, serial_number: serial, previous: placeholder };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (String(e.code) === '23505') {
      throw new PendingSerialError(`Serial ${serial} already exists in inventory.`, 409);
    }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  PLACEHOLDER_PREFIX,
  PendingSerialError,
  pendingSerialPlaceholder,
  isPendingSerial,
  listPendingSerials,
  addPendingSerial,
};
