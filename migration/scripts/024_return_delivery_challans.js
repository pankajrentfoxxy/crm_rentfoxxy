/**
 * 024 — ERP complaints_ticket.return_dc_number → CRM delivery_challan_lines (movement_type='return')
 * CRM Return DC list reads delivery_challan_lines, not support_tickets alone.
 */
const { progress, writeLog } = require('../lib/logger');
const {
  getCrmId,
  setCrmId,
  str,
  bumpDeliveryChallanLineSequence,
} = require('../lib/helpers');

function parseOptionalInt(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function mapReturnDcStatus(erpStatus, podClosedAt) {
  if (podClosedAt) return 'delivered';
  const s = str(erpStatus, 40, 'open').toLowerCase();
  if (s === 'close') return 'delivered';
  if (s === 'processing' || s === 'approved') return 'in_transit';
  if (s === 'rejected') return 'cancelled';
  return 'pending';
}

function mapDispatchMode({ courierName, deliveryPersonId }) {
  if (courierName) return 'courier';
  if (deliveryPersonId != null) return 'inhouse';
  return 'courier';
}

async function resolveVendorSerialId(crm, { serialNumber, ttspl }) {
  if (ttspl) {
    const { rows } = await crm.query(
      `SELECT serial_id, serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (inventory_asset_code = $1 OR extra->>'unique_product_serial' = $1)
        LIMIT 1`,
      [ttspl]
    );
    if (rows.length) return rows[0];
  }
  if (serialNumber) {
    const { rows } = await crm.query(
      `SELECT serial_id, serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND serial_number = $1
        LIMIT 1`,
      [serialNumber]
    );
    if (rows.length) return rows[0];
  }
  return null;
}

async function lookupMachineSpecs(crm, serialNumber, ttspl) {
  const sn = str(serialNumber, 120, '');
  const mn = str(ttspl, 120, '');
  if (!sn && !mn) return {};
  const { rows: invRows } = await crm.query(
    `SELECT brand, model
       FROM inventory
      WHERE ($1::text <> '' AND serial_number = $1)
         OR ($2::text <> '' AND machine_number = $2)
      LIMIT 1`,
    [sn, mn]
  );
  const { rows: vsnRows } = await crm.query(
    `SELECT current_dc_number, current_entity
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (
          ($1::text <> '' AND serial_number = $1)
          OR ($2::text <> '' AND inventory_asset_code = $2)
        )
      LIMIT 1`,
    [sn, mn]
  );
  return { ...(invRows[0] || {}), ...(vsnRows[0] || {}) };
}

async function lookupEntityCode(crm, salesOrderNumber) {
  if (salesOrderNumber) {
    const { rows } = await crm.query(
      `SELECT entity_code FROM sales_order_lines
        WHERE sales_order_number = $1 AND entity_code IS NOT NULL
        LIMIT 1`,
      [salesOrderNumber]
    );
    if (rows[0]?.entity_code) return rows[0].entity_code;
  }
  return 'rentfoxxy';
}

async function bumpReturnDcSequence(crm) {
  const { rows } = await crm.query(
    `SELECT MAX(
       CAST(NULLIF(REGEXP_REPLACE(dc_number, '\\D', '', 'g'), '') AS INTEGER)
     ) AS max_num
       FROM delivery_challan_lines
      WHERE movement_type = 'return'`
  );
  const maxNum = Number(rows[0]?.max_num) || 0;
  if (maxNum > 0) {
    await crm.query(
      `INSERT INTO sm_document_sequences (doc_type, last_value, prefix, updated_at)
       VALUES ('return_dc', $1, 'RDC', NOW())
       ON CONFLICT (doc_type) DO UPDATE
         SET last_value = GREATEST(sm_document_sequences.last_value, EXCLUDED.last_value),
             updated_at = NOW()`,
      [maxNum]
    );
  }
}

module.exports = {
  id: '024',
  name: 'return_delivery_challans',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query(
      `SELECT COUNT(*) AS cnt FROM \`complaints_ticket\`
        WHERE return_dc_number IS NOT NULL AND TRIM(return_dc_number) <> ''`
    );
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let skipped = 0;
    let linkedItems = 0;

    const [rows] = await erp.query(
      `SELECT ct.id, ct.return_dc_number, ct.customer_id, ct.name, ct.email, ct.phone,
              ct.serial_number, ct.unique_number, ct.complaint_type, ct.status,
              ct.delivery_person_id, ct.courier_name, ct.awb_number,
              ct.created_at, ct.updated_at, ct.closed_at,
              ps.pod_closed_at, ps.pod_date_time, ps.latitude, ps.longitude, ps.otp AS pod_otp,
              ps.files AS pod_files, ps.pod_remark
         FROM \`complaints_ticket\` ct
         LEFT JOIN \`pod_submissions\` ps ON ps.pickup_id = ct.id
        WHERE ct.return_dc_number IS NOT NULL AND TRIM(ct.return_dc_number) <> ''
        ORDER BY ct.id`
    );

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'return_delivery_challans', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) {
          progress('return_delivery_challans', processed, total);
        }
        continue;
      }

      const rdcNumber = str(row.return_dc_number, 50, null);
      if (!rdcNumber) {
        skipped += 1;
        continue;
      }

      const { rows: existingLine } = await crm.query(
        `SELECT id FROM delivery_challan_lines
          WHERE dc_number = $1 AND movement_type = 'return'
          LIMIT 1`,
        [rdcNumber]
      );
      if (existingLine.length) {
        await setCrmId(crm, {
          entity: 'return_delivery_challans',
          erpId: row.id,
          crmId: existingLine[0].id,
          erpTable: 'complaints_ticket',
          crmTable: 'delivery_challan_lines',
        });
        if (processed % batchSize === 0 || processed === total) {
          progress('return_delivery_challans', processed, total);
        }
        continue;
      }

      const crmTicketId = await getCrmId(crm, 'complaints_ticket', row.id);
      if (crmTicketId == null) {
        skipped += 1;
        writeLog('migration', `024 skip RDC ${rdcNumber}: ticket ${row.id} not mapped`);
        if (processed % batchSize === 0 || processed === total) {
          progress('return_delivery_challans', processed, total);
        }
        continue;
      }

      const { rows: ticketRows } = await crm.query(
        `SELECT customer_id, customer_name, ticket_email, dc_number, sales_order_number, ttspl_id
           FROM support_tickets WHERE id = $1`,
        [crmTicketId]
      );
      const ticket = ticketRows[0];
      if (!ticket?.customer_id) {
        skipped += 1;
        writeLog('migration', `024 skip RDC ${rdcNumber}: ticket ${crmTicketId} missing customer`);
        if (processed % batchSize === 0 || processed === total) {
          progress('return_delivery_challans', processed, total);
        }
        continue;
      }

      const serialNumber = str(row.serial_number, 120, '') || str(ticket.ttspl_id, 120, '');
      const ttspl = str(row.unique_number, 120, null) || ticket.ttspl_id;
      const serialRow = await resolveVendorSerialId(crm, { serialNumber, ttspl });
      const specs = await lookupMachineSpecs(crm, serialNumber, ttspl);
      const serialEntry = serialRow
        ? `${serialRow.serial_id}|${serialRow.serial_number}|${serialRow.inventory_asset_code || ttspl || ''}`
        : `|${serialNumber || ttspl || ''}|${ttspl || serialNumber || ''}`;

      const deliveryPersonId = parseOptionalInt(row.delivery_person_id);
      const courierName = str(row.courier_name, 255, null);
      const dispatchMode = mapDispatchMode({ courierName, deliveryPersonId });
      const dcStatus = mapReturnDcStatus(row.status, row.pod_closed_at);
      const delivered = dcStatus === 'delivered';
      const deliveryTs = row.pod_closed_at || row.pod_date_time || row.closed_at || null;
      const originalDc = specs.current_dc_number || ticket.dc_number || null;
      const salesOrderNumber = ticket.sales_order_number || null;
      const entityCode = specs.current_entity || await lookupEntityCode(crm, salesOrderNumber);

      const { rows: ins } = await crm.query(
        `INSERT INTO delivery_challan_lines (
           dc_number, movement_type, support_ticket_id, customer_id, customer_name, email,
           brand, model_name, quantity, serial_number, dispatch_mode, delivery_person_id,
           courier_name, awb_number, status, original_dc_number, sales_order_number, entity_code,
           latitude, longitude, d_otp, dispatched_at, delivered_at, delivery_completed_at,
           pod_submitted_at, pod_type, delivery_notes, created_at, updated_at
         ) VALUES (
           $1,'return',$2,$3,$4,$5,$6,$7,1,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,
           $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
         ) RETURNING id`,
        [
          rdcNumber,
          crmTicketId,
          ticket.customer_id,
          str(row.name, 255, ticket.customer_name),
          str(row.email, 255, ticket.ticket_email),
          str(specs.brand, 100, null),
          str(specs.model, 255, null),
          JSON.stringify([serialEntry]),
          dispatchMode,
          deliveryPersonId,
          courierName,
          str(row.awb_number, 100, null),
          dcStatus,
          originalDc,
          salesOrderNumber,
          entityCode,
          row.latitude != null ? String(row.latitude) : null,
          row.longitude != null ? String(row.longitude) : null,
          str(row.pod_otp, 10, null),
          deliveryTs || row.created_at,
          delivered ? deliveryTs || row.updated_at : null,
          delivered ? deliveryTs || row.updated_at : null,
          delivered && row.pod_closed_at ? row.pod_closed_at : null,
          row.pod_files ? 'pickup' : null,
          str(row.pod_remark, 2000, null),
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );

      await setCrmId(crm, {
        entity: 'return_delivery_challans',
        erpId: row.id,
        crmId: ins[0].id,
        erpTable: 'complaints_ticket',
        crmTable: 'delivery_challan_lines',
      });
      inserted += 1;

      const { rowCount } = await crm.query(
        `UPDATE support_ticket_items
            SET return_dc_number = $1, updated_at = NOW()
          WHERE ticket_id = $2
            AND item_type = 'pickup'
            AND (return_dc_number IS NULL OR TRIM(return_dc_number) = '')`,
        [rdcNumber, crmTicketId]
      );
      linkedItems += rowCount || 0;

      if (processed % batchSize === 0 || processed === total) {
        progress('return_delivery_challans', processed, total);
      }
    }

    await bumpDeliveryChallanLineSequence(crm);
    await bumpReturnDcSequence(crm);
    writeLog(
      'migration',
      `024 complete: return_dc_lines=${inserted} pickup_items_linked=${linkedItems} skipped=${skipped} total=${total}`
    );
    return inserted;
  },
};
