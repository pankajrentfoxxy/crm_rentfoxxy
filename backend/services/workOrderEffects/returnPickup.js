'use strict';

const inventorySM = require('../inventoryStateMachine');
const { assertAssetPickupEligible } = require('../supportPickupEligibility');
const {
  removeFromCustomerInventory,
  recordBillingStop,
  clearCustomerHolding,
} = require('../supportCustomerInventoryState');
const { generateReturnDc, loadWoAssets } = require('../supportWoDocuments');
const { logEvent } = require('../supportTicketStateService');
const { createFloorTicketFromSupportPickup } = require('../grnTicketService');
const { raiseReturnCreditNoteOnce } = require('../supportReturnCreditNote');
const {
  computeLockIn,
  notifyOverdueInvoices,
  consignmentValue,
  EWAY_THRESHOLD,
} = require('../supportReturnGuards');

const OPEN_PICKUP = `('DRAFT','PENDING_ASSIGNMENT','ASSIGNED','ACCEPTED','EN_ROUTE','ON_SITE','IN_PROGRESS')`;

async function onCreate(client, wo) {
  const assets = await loadWoAssets(client, wo.wo_id);
  const ticket = (await client.query(
    'SELECT customer_id FROM support_tickets_v2 WHERE ticket_id = $1',
    [wo.ticket_id]
  )).rows[0];
  const customerId = ticket && ticket.customer_id;
  let holdAsDraft = false;
  let lockCharge = 0;

  for (const a of assets) {
    if (!a.serial_id) continue;
    const serial = await assertAssetPickupEligible(client, a.serial_id);
    if (customerId && Number(serial.current_customer_id) !== Number(customerId)) {
      throw Object.assign(new Error('Asset is not deployed with this customer'), { status: 400 });
    }
    const open = await client.query(
      `SELECT w.wo_number FROM support_work_orders w
         JOIN support_work_order_assets l ON l.wo_id = w.wo_id
         JOIN support_ticket_assets ta ON ta.line_id = l.line_id
        WHERE ta.serial_id = $1
          AND w.wo_type IN ('REPAIR_PICKUP','RETURN_PICKUP')
          AND w.status IN ${OPEN_PICKUP}
          AND w.wo_id <> $2
        LIMIT 1`,
      [a.serial_id, wo.wo_id]
    );
    if (open.rows[0]) {
      throw Object.assign(
        new Error(`Open pickup ${open.rows[0].wo_number} already exists for this serial`),
        { status: 409 }
      );
    }
    if (!wo.replacement_group_id) {
      const lock = await computeLockIn(client, a.serial_id);
      if (lock.locked) {
        holdAsDraft = true;
        lockCharge += Number(lock.charge || 0);
      }
    }
  }

  if (holdAsDraft) {
    await client.query(
      `INSERT INTO support_approvals (
         ticket_id, wo_id, approval_type, status, amount, label, requested_by
       ) VALUES ($1,$2,'EARLY_TERMINATION','PENDING',$3,$4,$5)`,
      [wo.ticket_id, wo.wo_id, lockCharge, `Early termination for ${wo.wo_number}`, wo.created_by || null]
    );
    await client.query(
      `UPDATE support_work_orders SET status = 'DRAFT', updated_at = NOW() WHERE wo_id = $1`,
      [wo.wo_id]
    );
  }

  const dues = await notifyOverdueInvoices(client, {
    customerId,
    ticketId: wo.ticket_id,
    woId: wo.wo_id,
    actorId: wo.created_by,
  });

  const dcNumber = await generateReturnDc(client, wo, {
    purpose: 'return',
    remarks: `Return pickup ${wo.wo_number}`,
  });
  const value = await consignmentValue(client, assets.map((a) => a.serial_id).filter(Boolean));
  const requiresEway = value > EWAY_THRESHOLD;
  await client.query(
    `UPDATE support_work_orders
        SET requires_eway_bill = $2, updated_at = NOW()
      WHERE wo_id = $1`,
    [wo.wo_id, requiresEway]
  );
  await client.query(
    `UPDATE support_work_order_steps SET status = 'DONE', completed_at = NOW(), payload = $2
      WHERE wo_id = $1 AND step_code = 'DOC_GENERATED'`,
    [wo.wo_id, JSON.stringify({ document_number: dcNumber, dc_purpose: 'return' })]
  );

  return {
    document_number: dcNumber,
    requires_eway_bill: requiresEway,
    hold_as_draft: holdAsDraft,
    overdue_notified: dues.overdue,
  };
}

async function onAssign() { return null; }
async function onCancel() { return null; }

async function onWarehouseReceipt(client, wo, { serialIds, userId }) {
  const ids = (serialIds || []).map(Number).filter(Boolean);
  const creditNotes = [];
  const floorTickets = [];
  for (const serialId of ids) {
    await inventorySM.markReturned(client, serialId, {
      reason: 'SUPPORT_RETURN',
      woId: wo.wo_id,
      actorUserId: userId,
    });
    await client.query(
      `UPDATE vendor_serial_numbers SET qc_status = 'pending', updated_at = NOW() WHERE serial_id = $1`,
      [serialId]
    );
    const asset = (await client.query(
      `SELECT inventory_asset_code AS ttspl_id, serial_number FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serialId]
    )).rows[0] || {};
    const ft = await createFloorTicketFromSupportPickup(client, {
      ttspl_id: asset.ttspl_id,
      unique_serial_number: asset.ttspl_id,
      serial_number: asset.serial_number,
      pickup_type: 'return',
    }, userId || null);
    if (ft && ft.ticket_id && !wo.floor_ticket_id) {
      await client.query(
        `UPDATE support_work_orders SET floor_ticket_id = $2, updated_at = NOW() WHERE wo_id = $1`,
        [wo.wo_id, ft.ticket_id]
      );
      wo.floor_ticket_id = ft.ticket_id;
    }
    if (ft && ft.ticket_id) floorTickets.push(ft.ticket_id);
    const cn = await raiseReturnCreditNoteOnce(client, {
      serialId,
      customerId: wo.customer_id,
      stopDate: wo.billing_stop_date,
      woId: wo.wo_id,
      actorUserId: userId,
    });
    if (cn) creditNotes.push(cn);
    await clearCustomerHolding(client, serialId);
  }
  return { credit_notes: creditNotes, floor_ticket_ids: floorTickets };
}

async function onStep(client, wo, step, payload) {
  if (step.step_code === 'GRADE') {
    const assets = await loadWoAssets(client, wo.wo_id);
    for (const a of assets) {
      if (!a.serial_id) continue;
      const row = await client.query(
        `SELECT condition_id FROM support_asset_condition WHERE wo_id = $1 AND serial_id = $2`,
        [wo.wo_id, a.serial_id]
      );
      if (!row.rows[0]) {
        throw Object.assign(new Error(`Condition grade missing for serial ${a.serial_id}`), { status: 400 });
      }
    }
    return { graded: true };
  }
  if (step.step_code !== 'WH_RECEIPT') return null;
  const assets = await loadWoAssets(client, wo.wo_id);
  const serialIds = (payload && payload.serial_ids)
    ? payload.serial_ids
    : assets.map((a) => a.serial_id).filter(Boolean);
  return onWarehouseReceipt(client, wo, { serialIds, userId: payload && payload.userId });
}

async function getPairedDelivery(client, groupId) {
  if (!groupId) return null;
  const r = await client.query(
    `SELECT * FROM support_work_orders
      WHERE replacement_group_id = $1 AND wo_type = 'REPLACEMENT_DELIVERY'
      ORDER BY wo_id DESC LIMIT 1`,
    [groupId]
  );
  return r.rows[0] || null;
}

async function onComplete(client, wo, opts = {}) {
  if (wo.replacement_group_id) {
    const pair = await getPairedDelivery(client, wo.replacement_group_id);
    const waived = (await client.query(
      `SELECT collect_waived FROM support_replacements
        WHERE replacement_group_id = $1
        ORDER BY replacement_id DESC LIMIT 1`,
      [wo.replacement_group_id]
    )).rows[0];
    const override = Boolean(opts.collect_override || (waived && waived.collect_waived));
    if (pair && pair.status !== 'COMPLETED' && !override) {
      throw Object.assign(
        new Error('Deliver the replacement before collecting the old unit. A lead can override with a reason.'),
        { status: 409, code: 'COLLECT_BEFORE_DELIVERY' }
      );
    }
    if (override && pair && pair.status !== 'COMPLETED') {
      await logEvent(client, {
        ticketId: wo.ticket_id,
        woId: wo.wo_id,
        eventType: 'COLLECT_OVERRIDE',
        actorId: opts.userId || null,
        summary: `Collect-before-delivery waived: ${opts.collect_override_reason || (waived && waived.collect_waived_reason) || 'lead override'}`,
        detail: { replacement_group_id: wo.replacement_group_id },
      });
    }
  }
  const assets = await loadWoAssets(client, wo.wo_id);
  const ticket = (await client.query(
    'SELECT customer_id FROM support_tickets_v2 WHERE ticket_id = $1',
    [wo.ticket_id]
  )).rows[0];
  const today = new Date().toISOString().slice(0, 10);
  for (const a of assets) {
    if (!a.serial_id) continue;
    await inventorySM.markInTransit(client, a.serial_id, {
      reason: 'SUPPORT_RETURN_PICKUP',
      woId: wo.wo_id,
      dcNumber: wo.document_number || null,
    });
    await removeFromCustomerInventory(client, a.serial_id, {
      reason: 'Returned by customer',
      woId: wo.wo_id,
    });
    await recordBillingStop(client, {
      serialId: a.serial_id,
      customerId: ticket && ticket.customer_id,
      stopDate: today,
      woId: wo.wo_id,
    });
  }
  await logEvent(client, {
    ticketId: wo.ticket_id,
    woId: wo.wo_id,
    eventType: 'RETURN_PICKUP_COMPLETED',
    actorKind: 'SYSTEM',
    summary: `Return pickup ${wo.wo_number} completed — billing stopped, credit note waits for warehouse receipt`,
    isCustomerVisible: true,
    detail: { document_number: wo.document_number, billing_stop_date: today },
  });
  return { billing_stop_date: today };
}

module.exports = { onCreate, onAssign, onComplete, onCancel, onStep, onWarehouseReceipt };
