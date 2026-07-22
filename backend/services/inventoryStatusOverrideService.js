/**
 * Super-admin serial QC / inventory status corrections.
 * Keeps qc_status, inventory_status, and extra.* in sync for list visibility.
 */
const { parseExtra } = require('./qcManagementService');
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

function inventoryStatusForQc(qcStatus) {
  switch (qcStatus) {
    case 'out_for_repare':
      return 'out_for_repare';
    case 'out_for_return':
      return 'out_for_return';
    case 'pending':
      return 'in_stock';
    case 'qc_pending':
      return 'in_stock';
    case 'passed':
      return 'in_stock';
    case 'failed':
      return 'qc_failed';
    case 'dead':
      return 'scrapped';
    case 'missing':
      return 'missing';
    default:
      return qcStatus;
  }
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
    const invStatus = inventoryStatusForQc(qcStatus);

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

    await client.query(
      `UPDATE vendor_serial_numbers
          SET qc_status = $1,
              inventory_status = $2,
              remark = COALESCE(NULLIF($3, ''), remark),
              extra = $4::jsonb,
              updated_at = NOW()
        WHERE serial_id = $5`,
      [qcStatus, invStatus, remark, JSON.stringify(extra), serialId]
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
