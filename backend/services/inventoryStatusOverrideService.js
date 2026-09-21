/**
 * Super-admin serial QC / inventory status corrections.
 * Keeps qc_status, inventory_status, and extra.* in sync for list visibility.
 */
const { parseExtra } = require('./qcManagementService');
const { transitionAsset } = require('./inventoryStateMachine');
const { statusForQcOutcome } = require('../constants/statuses');
const { createProductionTicketForQcSerial } = require('./qcProcessIntakeService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { invalidateInventoryListCachesFireAndForget } = require('./inventoryListCache');

const ALLOWED_QC_STATUSES = new Set([
  'qc_pending',
  'out_for_repare',
  'out_for_return',
  'pending',
  'passed',
  'failed',
  'dead',
  'missing',
]);

/**
 * QC status -> canonical inventory status, for the super-admin override.
 *
 * Part 2.2, bypass-register B. This used to end in `default: return qcStatus`,
 * so ANY string the caller sent landed verbatim in inventory_status — and
 * three of its explicit cases returned non-canonical values too
 * (out_for_repare, out_for_return, missing). A correction tool that can write
 * an arbitrary lifecycle state is how the strays this part is cleaning up got
 * there in the first place.
 *
 * The translation now comes from constants/statuses.js, the same map the QC
 * controller uses, so the override cannot invent a vocabulary of its own.
 *
 * Returns { known, status }. `missing` is deliberately NOT mapped: it is an
 * open business question (decision log, still-outstanding #6) with zero rows
 * today, and defaulting it would be the guess that question exists to prevent.
 */
function inventoryStatusForQc(qcStatus) {
  const key = String(qcStatus || '').toLowerCase();
  if (key === 'qc_pending' || key === 'pending') {
    // Starting or resetting a QC check puts a unit back on the shelf in this
    // tool's model; that was the pre-existing behaviour and it is canonical.
    return { known: true, status: 'in_stock' };
  }
  return statusForQcOutcome(key);
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ serialId: number, qcStatus: string, remark?: string, createFloorTicket?: boolean, actorUserId?: number }} opts
 */
async function applySuperAdminSerialStatus(pool, opts) {
  const serialId = Number(opts.serialId);
  const qcStatus = String(opts.qcStatus || '').trim().toLowerCase();
  const remark = opts.remark != null ? String(opts.remark).trim() : '';
  const createFloorTicket = opts.createFloorTicket === true;
  const actorUserId = opts.actorUserId || null;

  if (!serialId) {
    return { ok: false, status: 400, message: 'Invalid serial id' };
  }
  if (!ALLOWED_QC_STATUSES.has(qcStatus)) {
    return {
      ok: false,
      status: 400,
      message: `Invalid status. Allowed: ${[...ALLOWED_QC_STATUSES].join(', ')}`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code, qc_status, inventory_status, extra, po_id
         FROM vendor_serial_numbers
        WHERE serial_id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [serialId]
    );
    if (!cur.rows.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, message: 'Serial not found' };
    }
    const row = cur.rows[0];
    if (!row.po_id) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, message: 'Only PO laptop serials can be updated here' };
    }

    const extra = parseExtra(row.extra);
    const { known: qcKnown, status: invStatus } = inventoryStatusForQc(qcStatus);
    if (!qcKnown) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        message: `"${qcStatus}" is not a status this tool can set. `
          + 'Nothing was changed. Allowed: pending, passed, failed, dead, '
          + 'require_for_parts, send_to_qc_check, out_for_return, out_for_repare, '
          + 'repared, replace, qc_reject.',
      };
    }

    extra.status = qcStatus;
    extra.action_status = qcStatus;
    if (remark) extra.action_remark = remark;
    extra.status_override_at = new Date().toISOString();
    extra.status_override_by = actorUserId;
    extra.spec_source = extra.spec_source || 'super_admin_override';

    if (qcStatus === 'out_for_repare') {
      extra.repair_type = 'out_for_repare';
      if (!extra.repair_start_date) {
        extra.repair_start_date = new Date().toISOString().slice(0, 10);
      }
    }
    if (qcStatus === 'pending') {
      extra.came_from = extra.came_from || 'Super admin status correction';
    }

    // The override stays a capability — a super admin correcting a wrong status
    // is a real need — but it is now an audited, canonical transition rather
    // than a raw write. This site was also half of finding I15: it wrote a
    // TTSPL event and no transitions row, while support cancel did the
    // reverse, so neither log was complete. transitionAsset writes both.
    if (invStatus) {
      await transitionAsset(client, {
        serialId,
        toStatus: invStatus,
        reason: `Super admin status correction to ${qcStatus}${remark ? ` — ${remark}` : ''}`,
        actorUserId,
        allowOverride: true,
        caller: 'inventoryStatusOverrideService.applySuperAdminSerialStatus',
      });
    }

    await client.query(
      `UPDATE vendor_serial_numbers
          SET qc_status = $1,
              remark = COALESCE(NULLIF($2, ''), remark),
              extra = COALESCE(extra, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE serial_id = $4`,
      [qcStatus, remark, JSON.stringify(extra), serialId]
    );
    await client.query('COMMIT');

    const ttsplId = row.inventory_asset_code || row.serial_number;
    if (ttsplId) {
      await logTtsplEvent({
        ttsplId,
        vendorSerialId: serialId,
        eventType: 'status_override',
        description: `Status set to ${qcStatus} (super admin)`,
        metadata: { qc_status: qcStatus, inventory_status: invStatus, remark: remark || null },
        actorUserId,
      });
    }

    let ticketId = null;
    if (createFloorTicket && qcStatus === 'pending') {
      const ticketResult = await createProductionTicketForQcSerial(
        pool,
        { serialId: row.serial_id, serialNumber: row.serial_number },
        actorUserId
      );
      if (ticketResult.ok) ticketId = ticketResult.data?.ticket_id || null;
    }

    invalidateInventoryListCachesFireAndForget();

    return {
      ok: true,
      message: ticketId
        ? `Status updated to QC Process. Floor ticket #${ticketId} created.`
        : `Status updated to ${qcStatus.replace(/_/g, ' ')}`,
      data: {
        serial_id: serialId,
        serial_number: row.serial_number,
        qc_status: qcStatus,
        inventory_status: invStatus,
        ticket_id: ticketId,
      },
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  ALLOWED_QC_STATUSES,
  applySuperAdminSerialStatus,
};
