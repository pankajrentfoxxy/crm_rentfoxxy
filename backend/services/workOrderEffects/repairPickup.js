'use strict';

const inventorySM = require('../inventoryStateMachine');
const { assertAssetPickupEligible, findBlockingOpenPickup } = require('../supportPickupEligibility');
const { setCustomerInventoryState, startBillingHold } = require('../supportCustomerInventoryState');
const { generateReturnDc, loadWoAssets } = require('../supportWoDocuments');
const { logEvent } = require('../supportTicketStateService');
const { createFloorTicketFromSupportPickup } = require('../grnTicketService');

async function onCreate(client, wo) {
  const assets = await loadWoAssets(client, wo.wo_id);
  for (const a of assets) {
    if (!a.serial_id) continue;
    await assertAssetPickupEligible(client, a.serial_id);
    const open = await findBlockingOpenPickup(client, a.serial_id, wo.wo_id);
    if (open) {
      throw Object.assign(
        new Error(`Open pickup ${open.wo_number} already exists on ${open.ticket_number} for this serial`),
        { status: 409 }
      );
    }
  }
  const dcNumber = await generateReturnDc(client, wo);
  await client.query(
    `UPDATE support_work_order_steps SET status = 'DONE', completed_at = NOW(), payload = $2
      WHERE wo_id = $1 AND step_code = 'DOC_GENERATED'`,
    [wo.wo_id, JSON.stringify({ document_number: dcNumber })]
  );
  return { document_number: dcNumber };
}

async function onAssign() { return null; }
async function onCancel() { return null; }

async function onStep(client, wo, step, payload) {
  if (step.step_code !== 'WH_RECEIPT') return null;
  const assets = await loadWoAssets(client, wo.wo_id);
  const a = assets[0];
  if (!a) return null;
  if (a.serial_id) {
    await client.query(
      `UPDATE vendor_serial_numbers SET qc_status = 'pending', updated_at = NOW() WHERE serial_id = $1`,
      [a.serial_id]
    );
  }
  if (wo.floor_ticket_id) return { floor_ticket_id: wo.floor_ticket_id };
  const t = (await client.query(
    `SELECT t.ticket_number, COALESCE(c.company_name,c.name) AS customer_name, a.notes
       FROM support_tickets_v2 t
       JOIN support_ticket_assets a ON a.ticket_id = t.ticket_id
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE t.ticket_id = $1 AND a.line_id = $2`,
    [wo.ticket_id, a.line_id]
  )).rows[0] || {};
  const { pauseAtRepairCentre } = require('../supportRepairLoopService');
  const ft = await createFloorTicketFromSupportPickup(client, {
    ttspl_id: a.ttspl_id,
    unique_serial_number: a.ttspl_id,
    serial_number: a.serial_number,
    pickup_type: 'repair',
    support_ticket_id: wo.ticket_id,
    support_wo_id: wo.wo_id,
    support_line_id: a.line_id,
    support_origin: 'REPAIR_PICKUP',
    support_customer_name: t.customer_name,
    support_reported_issue: t.notes,
  }, null);
  await pauseAtRepairCentre(client, wo.ticket_id);
  if (ft && ft.ticket_id) {
    await client.query(
      `UPDATE support_work_orders SET floor_ticket_id = $2, updated_at = NOW() WHERE wo_id = $1`,
      [wo.wo_id, ft.ticket_id]
    );
  }
  return { floor_ticket_id: ft && ft.ticket_id };
}

async function onComplete(client, wo) {
  const assets = await loadWoAssets(client, wo.wo_id);
  const ticket = (await client.query(
    'SELECT customer_id FROM support_tickets_v2 WHERE ticket_id = $1',
    [wo.ticket_id]
  )).rows[0];
  for (const a of assets) {
    if (!a.serial_id) continue;
    await inventorySM.markInTransit(client, a.serial_id, {
      reason: 'SUPPORT_REPAIR_PICKUP',
      woId: wo.wo_id,
      dcNumber: wo.document_number || null,
    });
    await setCustomerInventoryState(client, a.serial_id, 'UNDER_REPAIR');
    await startBillingHold(client, {
      serialId: a.serial_id,
      customerId: ticket && ticket.customer_id,
      ticketId: wo.ticket_id,
      lineId: a.line_id,
      woId: wo.wo_id,
      reason: 'UNDER_REPAIR',
    });
  }
  await logEvent(client, {
    ticketId: wo.ticket_id,
    woId: wo.wo_id,
    eventType: 'REPAIR_PICKUP_COMPLETED',
    actorKind: 'SYSTEM',
    summary: `Repair pickup ${wo.wo_number} completed`,
    isCustomerVisible: true,
    detail: { document_number: wo.document_number },
  });
  return {};
}

module.exports = { onCreate, onAssign, onComplete, onCancel, onStep };
