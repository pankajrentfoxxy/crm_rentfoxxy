'use strict';

const inventorySM = require('../inventoryStateMachine');
const { setCustomerInventoryState } = require('../supportCustomerInventoryState');
const { generateReplacementDc } = require('../supportWoDocuments');
const { logEvent } = require('../supportTicketStateService');

async function loadReplacement(client, wo) {
  const r = await client.query(
    `SELECT * FROM support_replacements
      WHERE delivery_wo_id = $1 OR replacement_group_id = $2
      ORDER BY replacement_id DESC LIMIT 1`,
    [wo.wo_id, wo.replacement_group_id]
  );
  return r.rows[0] || null;
}

async function onCreate(client, wo) {
  const repl = await loadReplacement(client, wo);
  let first = {};
  const entries = [];
  let newSerial = null;
  if (repl && repl.new_serial_id) {
    newSerial = (await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code AS ttspl_id, extra, inventory_status
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [repl.new_serial_id]
    )).rows[0];
    if (newSerial) {
      entries.push(`${newSerial.serial_id}|${newSerial.serial_number || ''}|${newSerial.ttspl_id || ''}`);
      first = newSerial.extra || {};
    }
  }
  const dcNumber = await generateReplacementDc(client, wo, { entries, first });
  if (newSerial && (newSerial.inventory_status === 'in_stock' || newSerial.inventory_status === 'reserved')) {
    try {
      await inventorySM.reserveForDc(client, newSerial.serial_id, {
        dcNumber,
        reason: 'SUPPORT_REPLACEMENT',
      });
    } catch (e) {
      console.error('replacement reserve:', e);
    }
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  await client.query(
    `UPDATE support_work_orders SET customer_otp = $2, updated_at = NOW() WHERE wo_id = $1`,
    [wo.wo_id, otp]
  );
  await client.query(
    `UPDATE support_work_order_steps SET status = 'DONE', completed_at = NOW(), payload = $2
      WHERE wo_id = $1 AND step_code = 'DOC_GENERATED'`,
    [wo.wo_id, JSON.stringify({ document_number: dcNumber, dc_purpose: 'replacement' })]
  );
  return { document_number: dcNumber, customer_otp: otp };
}

async function onAssign() { return null; }
async function onCancel() { return null; }

async function onStep(client, wo, step, payload) {
  if (step.step_code !== 'DATA_TRANSFER') return null;
  const { onDataTransfer } = require('../supportReplacementService');
  return onDataTransfer(client, wo, payload.data_transfer || payload.choice || payload.notes);
}

async function onComplete(client, wo) {
  const ticket = (await client.query(
    'SELECT customer_id FROM support_tickets_v2 WHERE ticket_id = $1',
    [wo.ticket_id]
  )).rows[0];
  const repl = await loadReplacement(client, wo);
  const serialId = repl && repl.new_serial_id;
  if (serialId) {
    await inventorySM.markDelivered(client, serialId, {
      quotationType: 'rental',
      dcNumber: wo.document_number || null,
      customerId: ticket && ticket.customer_id,
      rentMonthlyRate: repl.new_rate,
      actorName: 'support-v2',
    });
    await setCustomerInventoryState(client, serialId, 'ACTIVE');
  }
  if (repl) {
    const next = repl.collect_wo_id ? 'DELIVERED' : 'COMPLETED';
    await client.query(
      `UPDATE support_replacements SET status = $2, updated_at = NOW() WHERE replacement_id = $1`,
      [repl.replacement_id, next]
    );
  }
  await logEvent(client, {
    ticketId: wo.ticket_id,
    woId: wo.wo_id,
    eventType: 'REPLACEMENT_DELIVERED',
    actorKind: 'SYSTEM',
    summary: `Replacement ${wo.wo_number} delivered`,
    isCustomerVisible: true,
    detail: { document_number: wo.document_number, new_serial_id: serialId },
  });
  return { new_serial_id: serialId };
}

module.exports = { onCreate, onAssign, onComplete, onCancel, onStep };
