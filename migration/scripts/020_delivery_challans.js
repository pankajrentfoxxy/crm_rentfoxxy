/**
 * 020 — ERP delivery_challans → CRM delivery_challan_lines + sales_order_serials
 * Parses Laravel serial pipe format (id|serial|ttspl) and links SO allocations.
 */
const { progress, writeLog } = require('../lib/logger');
const {
  getCrmId,
  setCrmId,
  str,
  parseJson,
  bumpDeliveryChallanLineSequence,
} = require('../lib/helpers');

function parseMoney(raw) {
  const n = Number(String(raw ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseAddressJson(raw, fallbackName) {
  const parsed = parseJson(raw, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const out = { ...parsed };
    if (fallbackName && !out.name) out.name = fallbackName;
    return out;
  }
  const text = str(raw, 5000, '');
  if (!text) return null;
  return { address: text, name: fallbackName || undefined };
}

function parseJsonArray(raw) {
  const parsed = parseJson(raw, null);
  if (Array.isArray(parsed)) return parsed;
  if (parsed != null) return [parsed];
  return [];
}

function parseSerialEntries(...sources) {
  const entries = [];
  for (const raw of sources) {
    for (const item of parseJsonArray(raw)) {
      const parts = String(item).split('|');
      const erpSerialId = parts[0] && /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
      const serialNumber = str(parts[1] || parts[0], 255, '');
      const ttspl = str(parts[2], 64, null);
      if (!serialNumber && !ttspl) continue;
      entries.push({ erpSerialId, serialNumber, ttspl });
    }
  }
  return entries;
}

function mapDcStatus(raw) {
  const s = str(raw, 20, 'pending').toLowerCase();
  const allowed = ['pending', 'processing', 'shipped', 'in_transit', 'reached', 'delivered', 'rejected', 'cancelled'];
  if (allowed.includes(s)) return s;
  if (s === 'returned') return 'delivered';
  return 'pending';
}

function mapDispatchMode(shipBy) {
  const s = str(shipBy, 20, '').toLowerCase();
  if (s === 'by_hand') return 'inhouse';
  if (s === 'by_porter') return 'porter';
  return 'courier';
}

function parseOptionalInt(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function resolveCrmDeliveryPersonId(crm, erpDeliveryPersonId) {
  const erpId = parseOptionalInt(erpDeliveryPersonId);
  if (erpId == null) return null;
  const mapped = await getCrmId(crm, 'delivery_men', erpId);
  return mapped != null ? Number(mapped) : null;
}

function mapShipBy(shipBy) {
  const s = str(shipBy, 20, '').toLowerCase();
  if (s === 'by_hand' || s === 'by_courier') return s;
  if (s === 'by_porter') return 'by_courier';
  return s || 'by_courier';
}

function entityFromBranch(branch) {
  return str(branch, 50, '').toLowerCase() === 'gorefurbo' ? 'gorefurbo' : 'rentfoxxy';
}

function parseTimestamp(raw) {
  const s = str(raw, 64, '');
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function lookupEntityCode(crm, salesOrderNumber, branch) {
  if (salesOrderNumber) {
    const { rows } = await crm.query(
      `SELECT entity_code FROM sales_order_lines
        WHERE sales_order_number = $1 AND entity_code IS NOT NULL
        LIMIT 1`,
      [salesOrderNumber]
    );
    if (rows[0]?.entity_code) return rows[0].entity_code;
  }
  return entityFromBranch(branch);
}

async function findLineId(crm, salesOrderNumber, modelName) {
  if (!salesOrderNumber) return null;
  const { rows } = await crm.query(
    `SELECT id FROM sales_order_lines
      WHERE sales_order_number = $1
        AND ($2::text IS NULL OR model_name = $2)
      ORDER BY id
      LIMIT 1`,
    [salesOrderNumber, modelName || null]
  );
  return rows[0]?.id ?? null;
}

async function resolveVendorSerialId(crm, { erpSerialId, serialNumber, ttspl }) {
  if (erpSerialId != null) {
    const mapped = await getCrmId(crm, 'serial_numbers', erpSerialId);
    if (mapped != null) return mapped;
  }
  if (ttspl) {
    const { rows } = await crm.query(
      `SELECT serial_id FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (inventory_asset_code = $1 OR extra->>'unique_product_serial' = $1)
        LIMIT 1`,
      [ttspl]
    );
    if (rows.length) return rows[0].serial_id;
  }
  if (serialNumber) {
    const { rows } = await crm.query(
      `SELECT serial_id FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND serial_number = $1
        LIMIT 1`,
      [serialNumber]
    );
    if (rows.length) return rows[0].serial_id;
  }
  return null;
}

async function ensureSalesOrderSerial(crm, {
  salesOrderNumber,
  lineId,
  serialId,
  ttspl,
  serialNumber,
  dcNumber,
  entityCode,
  delivered,
  erpDcId,
  serialIdx,
}) {
  const mapKey = erpDcId * 10000 + serialIdx;
  const existingMap = await getCrmId(crm, 'dc_serial_allocations', mapKey);
  if (existingMap != null) return;

  const { rows: existing } = await crm.query(
    `SELECT allocation_id FROM sales_order_serials
      WHERE serial_id = $1 AND sales_order_number = $2
      LIMIT 1`,
    [serialId, salesOrderNumber]
  );
  if (existing.length) {
    await crm.query(
      `UPDATE sales_order_serials
          SET line_id = COALESCE(line_id, $2),
              ttspl_id = COALESCE(ttspl_id, $3),
              serial_number = COALESCE(serial_number, $4),
              status = CASE WHEN $5 THEN 'dispatched' ELSE status END,
              dc_number = CASE WHEN $5 THEN $6 ELSE dc_number END,
              entity_code = COALESCE(entity_code, $7),
              updated_at = NOW()
        WHERE allocation_id = $1`,
      [
        existing[0].allocation_id,
        lineId,
        ttspl,
        serialNumber,
        delivered,
        dcNumber,
        entityCode,
      ]
    );
    await setCrmId(crm, {
      entity: 'dc_serial_allocations',
      erpId: mapKey,
      crmId: existing[0].allocation_id,
      erpTable: 'delivery_challans',
      crmTable: 'sales_order_serials',
    });
    return;
  }

  const { rows: ins } = await crm.query(
    `INSERT INTO sales_order_serials (
       sales_order_number, line_id, serial_id, ttspl_id, serial_number,
       qc_status, status, dc_number, entity_code, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,'passed',$6,$7,$8,NOW(),NOW())
     RETURNING allocation_id`,
    [
      salesOrderNumber,
      lineId,
      serialId,
      ttspl,
      serialNumber,
      delivered ? 'dispatched' : 'attached',
      delivered ? dcNumber : null,
      entityCode,
    ]
  );

  await setCrmId(crm, {
    entity: 'dc_serial_allocations',
    erpId: mapKey,
    crmId: ins[0].allocation_id,
    erpTable: 'delivery_challans',
    crmTable: 'sales_order_serials',
  });
}

async function bumpDcDocumentSequences(crm) {
  for (const [entityCode, docType] of [
    ['rentfoxxy', 'dc_rentfoxxy'],
    ['gorefurbo', 'dc_gorefurbo'],
  ]) {
    const { rows } = await crm.query(
      `SELECT MAX(
         CAST(NULLIF(REGEXP_REPLACE(dc_number, '\\D', '', 'g'), '') AS INTEGER)
       ) AS max_num
         FROM delivery_challan_lines
        WHERE entity_code = $1`,
      [entityCode]
    );
    const maxNum = Number(rows[0]?.max_num) || 0;
    if (maxNum > 0) {
      await crm.query(
        `INSERT INTO sm_document_sequences (doc_type, last_value, prefix, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (doc_type) DO UPDATE
           SET last_value = GREATEST(sm_document_sequences.last_value, EXCLUDED.last_value),
               updated_at = NOW()`,
        [docType, maxNum, entityCode === 'gorefurbo' ? 'GDC-' : 'DC-']
      );
    }
  }
}

module.exports = {
  id: '020',
  name: 'delivery_challans',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `delivery_challans`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let serialLinks = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, dc_number, sales_order_number, quotation_number, customer_name, customer_id, email,
              GST_number, customer_billing_address, customer_shipping_address, brand, quantity, main_qty,
              serial_number, ship_by, courier_name, awb_number, delivery_person_id, supply_state, branch,
              remarks, model_name, submitted_name, date_and_time, submitted_remark, submitted_person_id,
              submitted_person_type, file_path, shiping_charges, security_amount, pdf_path,
              delivered_serial_numbers, rejected_serial_numbers, returned_serial_numbers,
              pickuped_serial_numbers, old_rejected_serial_numbers,
              d_customer_name, d_customer_email, d_customer_mobile, d_otp, latitude, longitude,
              status, created_at, updated_at
         FROM \`delivery_challans\`
        ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'delivery_challans', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) {
          progress('delivery_challans', processed, total);
        }
        continue;
      }

      const crmCustomerId = await getCrmId(crm, 'customers', row.customer_id);
      if (crmCustomerId == null) {
        skipped += 1;
        writeLog('migration', `020 skip DC ${row.id}: customer ${row.customer_id} not mapped`);
        if (processed % batchSize === 0 || processed === total) {
          progress('delivery_challans', processed, total);
        }
        continue;
      }

      const salesOrderNumber = str(row.sales_order_number, 50, null);
      const entityCode = await lookupEntityCode(crm, salesOrderNumber, row.branch);
      const dcStatus = mapDcStatus(row.status);
      const delivered = dcStatus === 'delivered';
      const deliveryTs = parseTimestamp(row.date_and_time);
      const serialJson = parseJsonArray(row.serial_number).length
        ? parseJsonArray(row.serial_number)
        : parseJsonArray(row.delivered_serial_numbers);

      const crmDeliveryPersonId = await resolveCrmDeliveryPersonId(crm, row.delivery_person_id);

      const { rows: ins } = await crm.query(
        `INSERT INTO delivery_challan_lines (
           dc_number, sales_order_number, quotation_number, customer_id, customer_name, email,
           gst_number, supply_state, security_amount, shiping_charges, branch, entity_code,
           customer_billing_address, customer_shipping_address, brand, model_name, quantity,
           main_qty, serial_number, ship_by, courier_name, awb_number, delivery_person_id,
           remarks, status, pdf_path, file_path, delivered_serial_numbers, rejected_serial_numbers,
           returned_serial_numbers, pickuped_serial_numbers, old_rejected_serial_numbers,
           submitted_remark, submitted_name, submitted_person_id, submitted_person_type,
           d_otp, d_customer_name, d_customer_email, d_customer_mobile, latitude, longitude,
           dispatch_mode, movement_type, date_and_time, delivery_completed_at, delivered_at,
           d_otp_verified_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19::jsonb,
           $20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,$29::jsonb,$30::jsonb,$31::jsonb,$32::jsonb,
           $33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,'outbound',$44,$45,$46,$47,$48,$49
         ) RETURNING id`,
        [
          str(row.dc_number, 50, `DC-ERP-${row.id}`),
          salesOrderNumber,
          str(row.quotation_number, 50, 'N/A'),
          crmCustomerId,
          str(row.customer_name, 255, null),
          str(row.email, 255, null),
          str(row.GST_number, 50, null),
          str(row.supply_state, 100, null),
          parseMoney(row.security_amount),
          parseMoney(row.shiping_charges),
          str(row.branch, 50, 'rentfoxxy'),
          entityCode,
          (() => {
            const b = parseAddressJson(row.customer_billing_address, row.customer_name);
            return b ? JSON.stringify(b) : null;
          })(),
          (() => {
            const s = parseAddressJson(row.customer_shipping_address, row.d_customer_name || row.customer_name);
            return s ? JSON.stringify(s) : null;
          })(),
          str(row.brand, 100, null),
          str(row.model_name, 255, null),
          Number(row.quantity) || 1,
          row.main_qty != null ? Number(row.main_qty) : Number(row.quantity) || 1,
          JSON.stringify(serialJson),
          mapShipBy(row.ship_by),
          str(row.courier_name, 255, null),
          str(row.awb_number, 100, null),
          crmDeliveryPersonId,
          str(row.remarks, 10000, null),
          dcStatus,
          str(row.pdf_path, 2000, null),
          str(row.file_path, 5000, null),
          JSON.stringify(parseJsonArray(row.delivered_serial_numbers)),
          JSON.stringify(parseJsonArray(row.rejected_serial_numbers)),
          JSON.stringify(parseJsonArray(row.returned_serial_numbers)),
          JSON.stringify(parseJsonArray(row.pickuped_serial_numbers)),
          JSON.stringify(parseJsonArray(row.old_rejected_serial_numbers)),
          str(row.submitted_remark, 2000, null),
          str(row.submitted_name, 255, null),
          parseOptionalInt(row.submitted_person_id),
          str(row.submitted_person_type, 50, null),
          str(row.d_otp, 10, null),
          str(row.d_customer_name, 255, null),
          str(row.d_customer_email, 255, null),
          str(row.d_customer_mobile, 50, null),
          str(row.latitude, 64, null),
          str(row.longitude, 64, null),
          mapDispatchMode(row.ship_by),
          deliveryTs,
          delivered ? deliveryTs || row.updated_at : null,
          delivered ? deliveryTs || row.updated_at : null,
          delivered && row.d_otp ? deliveryTs || row.updated_at : null,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );

      await setCrmId(crm, {
        entity: 'delivery_challans',
        erpId: row.id,
        crmId: ins[0].id,
        erpTable: 'delivery_challans',
        crmTable: 'delivery_challan_lines',
      });
      inserted += 1;

      if (salesOrderNumber) {
        const lineId = await findLineId(crm, salesOrderNumber, row.model_name);
        const serialEntries = parseSerialEntries(row.serial_number, row.delivered_serial_numbers);
        for (let i = 0; i < serialEntries.length; i += 1) {
          const entry = serialEntries[i];
          const serialId = await resolveVendorSerialId(crm, entry);
          if (!serialId) continue;
          await ensureSalesOrderSerial(crm, {
            salesOrderNumber,
            lineId,
            serialId,
            ttspl: entry.ttspl,
            serialNumber: entry.serialNumber,
            dcNumber: str(row.dc_number, 50, `DC-ERP-${row.id}`),
            entityCode,
            delivered,
            erpDcId: row.id,
            serialIdx: i,
          });
          serialLinks += 1;
        }
      }

      if (processed % batchSize === 0 || processed === total) {
        progress('delivery_challans', processed, total);
      }
    }

    await bumpDeliveryChallanLineSequence(crm);
    await bumpDcDocumentSequences(crm);
    writeLog(
      'migration',
      `020 complete: dc_lines=${inserted} serial_links=${serialLinks} skipped=${skipped} total=${total}`
    );
    return inserted;
  },
};
