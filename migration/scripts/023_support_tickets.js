/**
 * 023 — ERP complaints_ticket → CRM support_tickets + support_ticket_items
 * One ERP row = one ticket with one item (machine + complaint/pickup).
 */
const { progress, writeLog } = require('../lib/logger');
const {
  getCrmId,
  setCrmId,
  str,
  parseJson,
  bumpSupportTicketSequence,
  bumpSupportTicketItemSequence,
} = require('../lib/helpers');

function parseOptionalInt(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parsePartsJson(raw) {
  const parsed = parseJson(raw, null);
  return Array.isArray(parsed) ? parsed : [];
}

function mapTicketCategory(complaintType) {
  return str(complaintType, 50, 'complain').toLowerCase() === 'pickup' ? 'pickup' : 'complaint';
}

function mapTicketStatus(erpStatus) {
  const s = str(erpStatus, 40, 'open').toLowerCase();
  if (s === 'close') return 'closed';
  if (s === 'processing' || s === 'approved') return 'in_progress';
  if (s === 'rejected') return 'closed';
  return 'open';
}

function mapItemStatus(erpStatus, complaintType) {
  const s = str(erpStatus, 40, 'open').toLowerCase();
  const isPickup = str(complaintType, 50, '').toLowerCase() === 'pickup';
  if (s === 'close') return 'resolved';
  if (isPickup) return 'assigned';
  return 'open';
}

function inferPickupType(remark) {
  const r = str(remark, 500, '').toLowerCase();
  return r.includes('return') ? 'return' : 'repair';
}

function buildTopRemarks(row) {
  const parts = [];
  if (row.ticket_number) parts.push(`[${row.ticket_number}]`);
  if (row.comments) parts.push(row.comments);
  if (row.remark && row.remark !== row.comments) parts.push(row.remark);
  return parts.join(' ').trim() || null;
}

async function lookupMachineSpecs(crm, serialNumber, ttspl) {
  const sn = str(serialNumber, 120, '');
  const mn = str(ttspl, 120, '');
  if (!sn && !mn) return {};
  const { rows } = await crm.query(
    `SELECT brand, model, ram, storage, generation
       FROM inventory
      WHERE ($1::text <> '' AND serial_number = $1)
         OR ($2::text <> '' AND machine_number = $2)
      LIMIT 1`,
    [sn, mn]
  );
  return rows[0] || {};
}

module.exports = {
  id: '023',
  name: 'support_tickets',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `complaints_ticket`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, ticket_number, return_dc_number, user_id, delivery_person_id, courier_name, awb_number,
              customer_id, name, email, phone, serial_number, unique_number, complaint_type,
              damage_description, remark, status, generated_by, comments,
              add_parts, assign_parts, old_assign_parts, assigned_parts, installed_parts,
              replaced_parts, handover_removed, created_at, updated_at, closed_at
         FROM \`complaints_ticket\`
        ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'complaints_ticket', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) {
          progress('support_tickets', processed, total);
        }
        continue;
      }

      const crmCustomerId = await getCrmId(crm, 'customers', row.customer_id);
      if (crmCustomerId == null) {
        skipped += 1;
        writeLog('migration', `023 skip ticket ${row.id}: customer ${row.customer_id} not mapped`);
        if (processed % batchSize === 0 || processed === total) {
          progress('support_tickets', processed, total);
        }
        continue;
      }

      const ticketCategory = mapTicketCategory(row.complaint_type);
      const ticketStatus = mapTicketStatus(row.status);
      const closed = ticketStatus === 'closed';
      const createdBy = row.user_id != null ? await getCrmId(crm, 'users', row.user_id) : null;
      const assignedParts = parsePartsJson(row.assigned_parts || row.assign_parts || row.add_parts);
      const replacedParts = parsePartsJson(row.replaced_parts);
      const ttspl = str(row.unique_number, 120, null);
      const serialNumber = str(row.serial_number, 120, '');

      const { rows: ticketIns } = await crm.query(
        `INSERT INTO support_tickets (
           customer_id, customer_name, customer_phone, status, created_by, closed_at,
           last_activity_at, priority, top_level_remarks, ticket_phone_override, ticket_email,
           ticket_category, return_dc_number, complaint_type, serial_number, unique_number,
           delivery_person_id, assigned_parts, replaced_parts, ttspl_id,
           customer_portal_ticket, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,'normal',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,$22
         ) RETURNING id`,
        [
          crmCustomerId,
          str(row.name, 500, null),
          str(row.phone, 80, null),
          ticketStatus,
          createdBy,
          closed ? row.closed_at || row.updated_at : null,
          row.updated_at || row.created_at || new Date(),
          buildTopRemarks(row),
          str(row.phone, 80, null),
          str(row.email, 320, null),
          ticketCategory,
          str(row.return_dc_number, 50, null),
          str(row.complaint_type, 50, null),
          serialNumber || null,
          ttspl,
          parseOptionalInt(row.delivery_person_id),
          JSON.stringify(assignedParts),
          JSON.stringify(replacedParts),
          ttspl,
          str(row.generated_by, 20, '').toLowerCase() === 'customer',
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );

      const ticketId = ticketIns[0].id;
      await setCrmId(crm, {
        entity: 'complaints_ticket',
        erpId: row.id,
        crmId: ticketId,
        erpTable: 'complaints_ticket',
        crmTable: 'support_tickets',
      });

      const specs = await lookupMachineSpecs(crm, serialNumber, ttspl);
      const itemType = ticketCategory;
      const itemStatus = mapItemStatus(row.status, row.complaint_type);
      const isPickup = itemType === 'pickup';
      const pickupType = isPickup ? inferPickupType(row.remark) : null;
      const pickupMethod = row.courier_name ? 'courier' : row.delivery_person_id ? 'technician' : null;

      const { rows: itemIns } = await crm.query(
        `INSERT INTO support_ticket_items (
           ticket_id, serial_number, unique_serial_number, ttspl_id,
           brand, model, ram, storage, generation,
           item_type, issue_category_label, remarks, status,
           pickup_type, pickup_method, pickup_courier_name, pickup_awb,
           return_dc_number, resolved_at, pickup_completed_at,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
         ) RETURNING id`,
        [
          ticketId,
          serialNumber || null,
          ttspl,
          ttspl,
          str(specs.brand, 120, null),
          str(specs.model, 300, null),
          str(specs.ram, 120, null),
          str(specs.storage, 200, null),
          str(specs.generation, 80, null),
          itemType,
          str(row.damage_description, 120, null),
          str(row.remark, 10000, null),
          itemStatus,
          pickupType,
          pickupMethod,
          str(row.courier_name, 200, null),
          str(row.awb_number, 120, null),
          str(row.return_dc_number, 50, null),
          closed ? row.closed_at || row.updated_at : null,
          isPickup && closed ? row.closed_at || row.updated_at : null,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );

      await setCrmId(crm, {
        entity: 'complaints_ticket_items',
        erpId: row.id,
        crmId: itemIns[0].id,
        erpTable: 'complaints_ticket',
        crmTable: 'support_ticket_items',
      });

      inserted += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('support_tickets', processed, total);
      }
    }

    await bumpSupportTicketSequence(crm);
    await bumpSupportTicketItemSequence(crm);
    writeLog('migration', `023 complete: tickets=${inserted} skipped=${skipped} total=${total}`);
    return inserted;
  },
};
