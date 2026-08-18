'use strict';

const { generatePartReturnDc } = require('../supportWoDocuments');
const { logEvent } = require('../supportTicketStateService');

async function onCreate(client, wo) {
  const dcNumber = await generatePartReturnDc(client, wo);
  return { document_number: dcNumber };
}

async function onAssign() { return null; }
async function onCancel() { return null; }
async function onStep() { return null; }

async function onComplete(client, wo) {
  const { requestByWo } = require('../supportPartsService');
  const req = await requestByWo(client, wo.wo_id);
  const oldInstanceId = (wo.payload && wo.payload.old_instance_id) || null;
  if (oldInstanceId) {
    await client.query(
      `UPDATE part_instances SET status = 'returned', updated_at = NOW() WHERE instance_id = $1`,
      [oldInstanceId]
    );
  }
  if (req) {
    await client.query(
      `UPDATE part_requests
          SET old_part_returned = TRUE, old_part_returned_at = NOW(), updated_at = NOW()
        WHERE request_id = $1`,
      [req.request_id]
    );
  }
  await logEvent(client, {
    ticketId: wo.ticket_id,
    woId: wo.wo_id,
    eventType: 'PART_RETURNED',
    actorKind: 'SYSTEM',
    summary: `Old part receipt ${wo.wo_number}`,
    detail: { request_id: req && req.request_id, document_number: wo.document_number },
  });
  return { request_id: req && req.request_id };
}

module.exports = { onCreate, onAssign, onComplete, onCancel, onStep };
