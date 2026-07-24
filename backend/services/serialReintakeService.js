/**
 * When a physical laptop re-enters via GRN but its serial_number is still on a
 * terminal inventory row (scrapped / unrepairable), archive the old row's serial
 * so history stays intact and the new intake can use the real serial + new TTSPL.
 */
const { logTtsplEvent } = require('./ttsplAuditService');

const REINTAKE_ELIGIBLE_STATUSES = new Set(['scrapped', 'qc_failed']);

async function findActiveSerialByNumber(db, serialNumber) {
  const sn = String(serialNumber || '').trim();
  if (!sn) return null;
  const r = await db.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status, qc_status, extra
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND LOWER(TRIM(serial_number)) = LOWER($1)
      LIMIT 1`,
    [sn]
  );
  return r.rows[0] || null;
}

function isEligibleForReintake(row) {
  if (!row) return false;
  const st = String(row.inventory_status || '').toLowerCase();
  const qc = String(row.qc_status || '').toLowerCase();
  if (REINTAKE_ELIGIBLE_STATUSES.has(st)) return true;
  if (qc === 'unrepairable' || qc === 'failed') return true;
  return false;
}

async function archiveSerialForReintake(db, row, {
  reason = 'grn_reintake',
  actorUserId = null,
  actorName = null,
  newPoId = null,
  newGrnId = null,
} = {}) {
  const canonical = String(row.serial_number || '').trim();
  const archivedSerial = `${canonical}#archived-${row.serial_id}`;
  await db.query(
    `UPDATE vendor_serial_numbers SET
        serial_number = $2,
        extra = COALESCE(extra, '{}'::jsonb) || $3::jsonb,
        updated_at = NOW()
      WHERE serial_id = $1`,
    [
      row.serial_id,
      archivedSerial,
      JSON.stringify({
        archived_serial_number: canonical,
        archived_at: new Date().toISOString(),
        archived_reason: reason,
        reintake_po_id: newPoId,
        reintake_grn_id: newGrnId,
      }),
    ]
  );
  if (row.inventory_asset_code) {
    await logTtsplEvent({
      ttsplId: row.inventory_asset_code,
      vendorSerialId: row.serial_id,
      eventType: 'serial_archived_for_reintake',
      description: `Serial ${canonical} archived as ${archivedSerial} — same physical unit re-entering via GRN`,
      metadata: {
        archived_serial_number: canonical,
        archived_as: archivedSerial,
        reason,
        reintake_po_id: newPoId,
        reintake_grn_id: newGrnId,
      },
      actorUserId,
      actorName,
      db,
    });
  }
  return { archivedSerial, canonicalSerial: canonical, previousSerialId: row.serial_id };
}

/**
 * @returns {{ ok: true, archived?: boolean, previousSerialId?: number }
 *         | { ok: false, blocked: true, message: string }}
 */
async function resolveSerialForGrnIntake(db, serialNumber, opts = {}) {
  const existing = await findActiveSerialByNumber(db, serialNumber);
  if (!existing) return { ok: true, archived: false };
  if (!isEligibleForReintake(existing)) {
    return {
      ok: false,
      blocked: true,
      message: `Serial ${existing.serial_number} already exists in inventory`
        + ` (${existing.inventory_asset_code || `id ${existing.serial_id}`},`
        + ` status: ${existing.inventory_status || 'unknown'})`,
    };
  }
  const archived = await archiveSerialForReintake(db, existing, opts);
  return { ok: true, archived: true, ...archived };
}

module.exports = {
  findActiveSerialByNumber,
  isEligibleForReintake,
  archiveSerialForReintake,
  resolveSerialForGrnIntake,
};
