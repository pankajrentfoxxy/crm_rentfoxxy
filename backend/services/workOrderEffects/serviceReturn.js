'use strict';

const inventorySM = require('../inventoryStateMachine');
const { setCustomerInventoryState, endBillingHold, freeRepairDays } = require('../supportCustomerInventoryState');
const { generateServiceDc, loadWoAssets } = require('../supportWoDocuments');
const { logEvent } = require('../supportTicketStateService');

async function onCreate(client, wo) {
  const dcNumber = await generateServiceDc(client, wo);
  await client.query(
    `UPDATE support_work_order_steps SET status = 'DONE', completed_at = NOW(), payload = $2
      WHERE wo_id = $1 AND step_code = 'DOC_GENERATED'`,
    [wo.wo_id, JSON.stringify({ document_number: dcNumber })]
  );
  return { document_number: dcNumber };
}

async function onAssign() { return null; }
async function onCancel() { return null; }

async function onComplete(client, wo) {
  const assets = await loadWoAssets(client, wo.wo_id);
  const ticket = (await client.query(
    'SELECT customer_id FROM support_tickets_v2 WHERE ticket_id = $1',
    [wo.ticket_id]
  )).rows[0];
  const days = await freeRepairDays(client);
  for (const a of assets) {
    if (!a.serial_id) continue;
    await inventorySM.markDelivered(client, a.serial_id, {
      quotationType: 'rental',
      dcNumber: wo.document_number || null,
      customerId: ticket && ticket.customer_id,
      actorName: 'support-v2',
    });
    await setCustomerInventoryState(client, a.serial_id, 'ACTIVE');
    await endBillingHold(client, { serialId: a.serial_id, freeRepairDays: days });
  }
  await logEvent(client, {
    ticketId: wo.ticket_id,
    woId: wo.wo_id,
    eventType: 'SERVICE_RETURN_COMPLETED',
    actorKind: 'SYSTEM',
    summary: `Service return ${wo.wo_number} completed`,
    isCustomerVisible: true,
    detail: { document_number: wo.document_number },
  });
  return {};
}

module.exports = { onCreate, onAssign, onComplete, onCancel };
