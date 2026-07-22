/**
 * 027 — ERP rent_reports → CRM vendor_monthly_bills
 * Powers Vendor Billing → Bills (/vendor-billing/bills).
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, setCrmId, str } = require('../lib/helpers');

const MONTH_NAMES = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseOptionalInt(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseMoney(raw) {
  const n = Number(String(raw ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseErpMonth(raw) {
  const text = str(raw, 64, '');
  const m = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const billMonth = MONTH_NAMES[m[1].toLowerCase()];
  const billYear = Number(m[2]);
  if (!billMonth || !Number.isFinite(billYear)) return null;
  return { billMonth, billYear, label: text };
}

function monthBounds(billMonth, billYear) {
  const fromDate = new Date(billYear, billMonth - 1, 1);
  const toDate = new Date(billYear, billMonth, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    fromDate: `${billYear}-${pad(billMonth)}-01`,
    toDate: `${billYear}-${pad(billMonth)}-${pad(toDate.getDate())}`,
    billDate: `${billYear}-${pad(billMonth)}-${pad(toDate.getDate())}`,
  };
}

function mapBillStatus(erpStatus) {
  const s = str(erpStatus, 40, 'pending').toLowerCase();
  if (s === 'approved') return 'approved';
  if (s === 'rejected') return 'disputed';
  return 'generated';
}

function normalizePath(raw) {
  const p = str(raw, 2000, null);
  if (!p) return null;
  return p.replace(/^storage\/app\/public\//, '');
}

function buildLineItems(row, totals) {
  return [{
    erp_rent_report_id: row.id,
    source: 'erp_rent_reports',
    type: str(row.type, 64, 'rental_purchase'),
    subtotal: totals.subtotal,
    gst_amount: totals.gstAmount,
    total_amount: totals.totalPayable,
    pdf_path: normalizePath(row.pdf_path),
    excel_path: normalizePath(row.excel_path),
    migrated: true,
  }];
}

function buildNotes(row, extraIds = []) {
  const parts = [`Migrated from ERP rent_reports #${row.id}`];
  if (extraIds.length) parts.push(`Merged ERP report ids: ${extraIds.join(', ')}`);
  const pdf = normalizePath(row.pdf_path);
  const excel = normalizePath(row.excel_path);
  if (pdf) parts.push(`PDF: ${pdf}`);
  if (excel) parts.push(`Excel: ${excel}`);
  return parts.join(' · ');
}

async function bumpVendorBillSequence(crm) {
  const { rows } = await crm.query(
    `SELECT MAX(
       CAST(NULLIF(REGEXP_REPLACE(bill_number, '\\D', '', 'g'), '') AS INTEGER)
     ) AS max_num
       FROM vendor_monthly_bills
      WHERE bill_number ~ '^VB-'`
  );
  const maxNum = Number(rows[0]?.max_num) || 0;
  if (maxNum > 0) {
    await crm.query(
      `INSERT INTO sm_document_sequences (doc_type, last_value, prefix, updated_at)
       VALUES ('vendor_bill', $1, 'VB-', NOW())
       ON CONFLICT (doc_type) DO UPDATE
         SET last_value = GREATEST(sm_document_sequences.last_value, EXCLUDED.last_value),
             updated_at = NOW()`,
      [maxNum]
    );
  }
}

async function bumpVendorMonthlyBillSequence(crm) {
  await crm.query(
    `SELECT setval('vendor_monthly_bills_bill_id_seq', (SELECT COALESCE(MAX(bill_id), 1) FROM vendor_monthly_bills), true)`
  );
}

module.exports = {
  id: '027',
  name: 'vendor_monthly_bills',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `rent_reports`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let merged = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, vendor_id, month, type, excel_path, subtotal, gst_amount, total_amount, amount,
              pdf_path, approved_by_id, billing_person_id, status, approved_by_type,
              created_at, updated_at
         FROM \`rent_reports\`
        ORDER BY id`
    );

    const periodMap = new Map();

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'rent_reports', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) {
          progress('vendor_monthly_bills', processed, total);
        }
        continue;
      }

      const period = parseErpMonth(row.month);
      if (!period) {
        skipped += 1;
        writeLog('migration', `027 skip rent_report ${row.id}: unparseable month "${row.month}"`);
        if (processed % batchSize === 0 || processed === total) {
          progress('vendor_monthly_bills', processed, total);
        }
        continue;
      }

      const crmVendorId = await getCrmId(crm, 'vendors', row.vendor_id);
      if (crmVendorId == null) {
        skipped += 1;
        writeLog('migration', `027 skip rent_report ${row.id}: vendor ${row.vendor_id} not mapped`);
        if (processed % batchSize === 0 || processed === total) {
          progress('vendor_monthly_bills', processed, total);
        }
        continue;
      }

      const periodKey = `${crmVendorId}:${period.billYear}:${period.billMonth}`;
      const subtotal = parseMoney(row.subtotal || row.amount);
      const gstAmount = parseMoney(row.gst_amount);
      const totalPayable = parseMoney(row.total_amount || row.amount) || (subtotal + gstAmount);
      const bounds = monthBounds(period.billMonth, period.billYear);
      const status = mapBillStatus(row.status);
      const approvedBy = row.approved_by_id != null
        ? await getCrmId(crm, 'users', row.approved_by_id)
        : null;
      const generatedBy = row.billing_person_id != null
        ? await getCrmId(crm, 'users', row.billing_person_id)
        : null;
      const lineItems = buildLineItems(row, { subtotal, gstAmount, totalPayable });

      if (periodMap.has(periodKey)) {
        const billId = periodMap.get(periodKey).billId;
        const mergedIds = [...periodMap.get(periodKey).mergedIds, row.id];
        periodMap.set(periodKey, { billId, mergedIds });

        await crm.query(
          `UPDATE vendor_monthly_bills
              SET notes = $2,
                  line_items = COALESCE(line_items, '[]'::jsonb) || $3::jsonb,
                  updated_at = NOW()
            WHERE bill_id = $1`,
          [billId, buildNotes(row, mergedIds), JSON.stringify(lineItems)]
        );

        await setCrmId(crm, {
          entity: 'rent_reports',
          erpId: row.id,
          crmId: billId,
          erpTable: 'rent_reports',
          crmTable: 'vendor_monthly_bills',
        });
        merged += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('vendor_monthly_bills', processed, total);
        }
        continue;
      }

      const billNumber = `VB-ERP-${String(row.id).padStart(4, '0')}`;

      const { rows: existingBill } = await crm.query(
        `SELECT bill_id FROM vendor_monthly_bills
          WHERE vendor_id = $1 AND bill_month = $2 AND bill_year = $3
          LIMIT 1`,
        [crmVendorId, period.billMonth, period.billYear]
      );
      if (existingBill.length) {
        periodMap.set(periodKey, { billId: existingBill[0].bill_id, mergedIds: [row.id] });
        await setCrmId(crm, {
          entity: 'rent_reports',
          erpId: row.id,
          crmId: existingBill[0].bill_id,
          erpTable: 'rent_reports',
          crmTable: 'vendor_monthly_bills',
        });
        merged += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('vendor_monthly_bills', processed, total);
        }
        continue;
      }

      const { rows: ins } = await crm.query(
        `INSERT INTO vendor_monthly_bills (
           bill_number, vendor_id, bill_month, bill_year, bill_date, from_date, to_date,
           line_items, subtotal, gst_amount, debit_note_adjustment, total_payable, status,
           notes, generated_by, approved_by, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5::date,$6::date,$7::date,$8::jsonb,$9,$10,0,$11,$12,$13,$14,$15,$16,$17
         ) RETURNING bill_id`,
        [
          billNumber,
          crmVendorId,
          period.billMonth,
          period.billYear,
          bounds.billDate,
          bounds.fromDate,
          bounds.toDate,
          JSON.stringify(lineItems),
          subtotal,
          gstAmount,
          totalPayable,
          status,
          buildNotes(row),
          generatedBy,
          status === 'approved' ? approvedBy : null,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );

      const billId = ins[0].bill_id;
      periodMap.set(periodKey, { billId, mergedIds: [] });

      await setCrmId(crm, {
        entity: 'rent_reports',
        erpId: row.id,
        crmId: billId,
        erpTable: 'rent_reports',
        crmTable: 'vendor_monthly_bills',
      });
      inserted += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('vendor_monthly_bills', processed, total);
      }
    }

    await bumpVendorMonthlyBillSequence(crm);
    await bumpVendorBillSequence(crm);
    writeLog(
      'migration',
      `027 complete: bills=${inserted} merged=${merged} skipped=${skipped} erp_rows=${total}`
    );
    return inserted + merged;
  },
};
