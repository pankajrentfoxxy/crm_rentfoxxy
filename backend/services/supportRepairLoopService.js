'use strict';

const { logEvent, computeTicketStatus } = require('./supportTicketStateService');
const { notifyEvent } = require('./supportNotificationService');
const { createWorkOrder } = require('./supportWorkOrderService');
const { endBillingHold, setCustomerInventoryState } = require('./supportCustomerInventoryState');

async function pauseAtRepairCentre(client, supportTicketId) {
  await client.query(
    `UPDATE support_tickets_v2
        SET pending_reason = 'AT_REPAIR_CENTRE',
            repair_tat_started_at = COALESCE(repair_tat_started_at, NOW()),
            repair_tat_due_at = COALESCE(repair_tat_due_at, NOW() + INTERVAL '72 hours'),
            updated_at = NOW()
      WHERE ticket_id = $1`,
    [supportTicketId]
  );
  await computeTicketStatus(client, supportTicketId);
}

async function onFloorTicketCompleted(db, ticket, userId) {
  if (!ticket.support_ticket_id) return { skipped: true };
  await db.query(
    `UPDATE tickets SET support_notified_ready_at = NOW() WHERE ticket_id = $1`,
    [ticket.ticket_id]
  );
  await db.query(
    `UPDATE support_tickets_v2
        SET repair_tat_ended_at = NOW(),
            pending_reason = CASE WHEN pending_reason = 'AT_REPAIR_CENTRE' THEN NULL ELSE pending_reason END,
            updated_at = NOW()
      WHERE ticket_id = $1`,
    [ticket.support_ticket_id]
  );
  await computeTicketStatus(db, ticket.support_ticket_id);
  await logEvent(db, {
    ticketId: ticket.support_ticket_id,
    eventType: 'REPAIR_COMPLETED',
    actorId: userId,
    isCustomerVisible: true,
    summary: ticket.support_field_diagnosis || 'Floor marked the machine ready for dispatch',
  });
  const existing = await db.query(
    `SELECT wo_id FROM support_work_orders
      WHERE ticket_id = $1 AND wo_type = 'SERVICE_RETURN' AND status IN ('DRAFT','PENDING_ASSIGNMENT')
      LIMIT 1`,
    [ticket.support_ticket_id]
  );
  let draft = existing.rows[0];
  if (!draft) {
    const lines = ticket.support_line_id
      ? [ticket.support_line_id]
      : (await db.query(
        'SELECT line_id FROM support_ticket_assets WHERE ticket_id = $1',
        [ticket.support_ticket_id]
      )).rows.map((r) => r.line_id);
    draft = await createWorkOrder(db, ticket.support_ticket_id, {
      wo_type: 'SERVICE_RETURN',
      line_ids: lines,
      notes: 'Drafted after floor QC pass — schedule with the customer',
    }, userId);
  }
  await notifyEvent(db, {
    eventCode: 'REPAIR_READY_FOR_DISPATCH',
    ticketId: ticket.support_ticket_id,
    woId: draft.wo_id,
    audiences: ['LEAD'],
    vars: {
      ttspl_id: ticket.ttspl_id || ticket.machine_number,
      customer_name: ticket.support_customer_name || '',
      ticket_number: '',
      wo_number: draft.wo_number || '',
    },
  }).catch(() => {});
  return { draft_wo_id: draft.wo_id };
}

async function onServiceReturnComplete(client, wo) {
  const assets = (await client.query(
    `SELECT a.serial_id, a.line_id, a.customer_id
       FROM support_work_order_assets l
       JOIN support_ticket_assets a ON a.line_id = l.line_id
      WHERE l.wo_id = $1`,
    [wo.wo_id]
  )).rows;
  for (const a of assets) {
    if (!a.serial_id) continue;
    await endBillingHold(client, { serialId: a.serial_id });
    await setCustomerInventoryState(client, a.serial_id, 'DEPLOYED');
  }
}

async function backfillOpenHolds(db) {
  const r = await db.query(
    `UPDATE asset_billing_holds h
        SET hold_to = CURRENT_DATE, updated_at = NOW()
      WHERE h.hold_to IS NULL
        AND EXISTS (
          SELECT 1 FROM customer_inventory ci
           WHERE ci.serial_id = h.serial_id AND ci.state = 'DEPLOYED'
        )
      RETURNING hold_id`
  );
  return r.rowCount;
}

module.exports = {
  pauseAtRepairCentre,
  onFloorTicketCompleted,
  onServiceReturnComplete,
  backfillOpenHolds,
};
