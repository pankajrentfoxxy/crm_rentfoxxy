/**
 * 017 — ERP sales_orders → CRM sales_order_lines
 * One ERP row = one CRM line (grouped by sales_order_number). Additive via erp_id_map.
 * sales_order_serials are populated later from delivery_challans (module 020).
 */
const { progress, writeLog } = require('../lib/logger');
const {
  getCrmId,
  setCrmId,
  str,
  parseJson,
  bumpSalesOrderLineSequence,
} = require('../lib/helpers');

function entityForQuotationType(quotationType) {
  const t = str(quotationType, 20, 'rental').toLowerCase();
  return t === 'sale' || t === 'sales' ? 'gorefurbo' : 'rentfoxxy';
}

function normalizeQuotationType(raw) {
  const t = str(raw, 20, 'rental').toLowerCase();
  if (['rental', 'sale', 'demo'].includes(t)) return t;
  return 'rental';
}

function parseMoney(raw) {
  const n = Number(String(raw ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseAddressJson(raw, fallbackName, fallbackPhone) {
  const parsed = parseJson(raw, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const out = { ...parsed };
    if (fallbackName && !out.name) out.name = fallbackName;
    if (fallbackPhone && !out.phone) out.phone = fallbackPhone;
    return out;
  }
  const text = str(raw, 5000, '');
  if (!text) return null;
  return {
    address: text,
    name: fallbackName || undefined,
    phone: fallbackPhone || undefined,
  };
}

function mapSoStatus(raw) {
  const s = str(raw, 20, 'pending').toLowerCase();
  if (['pending', 'approved', 'rejected'].includes(s)) return s;
  return 'pending';
}

async function bumpSoDocumentSequences(crm) {
  for (const [entityCode, docType] of [
    ['rentfoxxy', 'so_rentfoxxy'],
    ['gorefurbo', 'so_gorefurbo'],
  ]) {
    const { rows } = await crm.query(
      `SELECT MAX(
         CAST(NULLIF(REGEXP_REPLACE(sales_order_number, '\\D', '', 'g'), '') AS INTEGER)
       ) AS max_num
         FROM sales_order_lines
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
        [docType, maxNum, entityCode === 'gorefurbo' ? 'GSO-' : 'SO-']
      );
    }
  }
}

module.exports = {
  id: '017',
  name: 'sales_orders',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `sales_orders`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, sales_order_number, quotation_number, supply_state, customer_id, customer_name,
              customer_email, customer_mobile, customer_shipping_address, customer_billing_address,
              contact_person_name, contact_person_mobile, gst_number, brand, model_name, processor,
              generation, ram, storage, gpu, screen_size, quantity, main_qty, rate, quotation_type,
              locking_period, battery_charger_warranty, technical_warranty, main_product_warranty,
              sub_product_warranty, remark, branch, status, token, pdf_path, invoice_created,
              invoice_path, security_amount, shiping_charges, created_at, updated_at
         FROM \`sales_orders\`
        ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'sales_orders', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) {
          progress('sales_orders', processed, total);
        }
        continue;
      }

      const crmCustomerId = await getCrmId(crm, 'customers', row.customer_id);
      if (crmCustomerId == null) {
        skipped += 1;
        writeLog('migration', `017 skip SO line ${row.id}: customer ${row.customer_id} not mapped`);
        if (processed % batchSize === 0 || processed === total) {
          progress('sales_orders', processed, total);
        }
        continue;
      }

      const quotationType = normalizeQuotationType(row.quotation_type);
      const entityCode = entityForQuotationType(quotationType);
      const shipping = parseAddressJson(
        row.customer_shipping_address,
        row.contact_person_name || row.customer_name,
        row.contact_person_mobile || row.customer_mobile
      );
      const billing = parseAddressJson(
        row.customer_billing_address,
        row.customer_name,
        row.contact_person_mobile || row.customer_mobile
      );

      const { rows: ins } = await crm.query(
        `INSERT INTO sales_order_lines (
           sales_order_number, quotation_number, customer_id, customer_name, customer_email,
           customer_mobile, customer_shipping_address, customer_billing_address, gst_number,
           supply_state, security_amount, shiping_charges, quotation_type, branch, brand,
           model_name, processor, generation, ram, storage, gpu, screen_size, quantity,
           main_qty, rate, locking_period, battery_charger_warranty, technical_warranty,
           remark, status, token, pdf_path, entity_code, security_type, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,'none',$34,$35
         ) RETURNING id`,
        [
          str(row.sales_order_number, 50, `SO-ERP-${row.id}`),
          str(row.quotation_number, 50, 'N/A'),
          crmCustomerId,
          str(row.customer_name, 255, 'Customer'),
          str(row.customer_email, 255, null),
          str(row.customer_mobile, 50, null),
          shipping ? JSON.stringify(shipping) : null,
          billing ? JSON.stringify(billing) : null,
          str(row.gst_number, 50, null),
          str(row.supply_state, 100, null),
          parseMoney(row.security_amount),
          parseMoney(row.shiping_charges),
          quotationType,
          str(row.branch, 50, 'rentfoxxy'),
          str(row.brand, 100, null),
          str(row.model_name, 255, null),
          str(row.processor, 100, null),
          str(row.generation, 50, null),
          str(row.ram, 50, null),
          str(row.storage, 50, null),
          str(row.gpu, 100, null),
          str(row.screen_size, 50, null),
          Number(row.quantity) || 1,
          Number(row.main_qty) || Number(row.quantity) || 1,
          Number(row.rate) || 0,
          row.locking_period != null ? Number(row.locking_period) : null,
          row.battery_charger_warranty != null ? Number(row.battery_charger_warranty) : null,
          row.technical_warranty != null ? Number(row.technical_warranty) : null,
          str(row.remark, 10000, null),
          mapSoStatus(row.status),
          str(row.token, 64, null),
          str(row.pdf_path, 2000, null),
          entityCode,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );

      await setCrmId(crm, {
        entity: 'sales_orders',
        erpId: row.id,
        crmId: ins[0].id,
        erpTable: 'sales_orders',
        crmTable: 'sales_order_lines',
      });
      inserted += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('sales_orders', processed, total);
      }
    }

    await bumpSalesOrderLineSequence(crm);
    await bumpSoDocumentSequences(crm);
    writeLog('migration', `017 complete: inserted=${inserted} skipped=${skipped} total=${total}`);
    return inserted;
  },
};
