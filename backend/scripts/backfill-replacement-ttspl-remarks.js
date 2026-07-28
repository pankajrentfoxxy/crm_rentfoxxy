/**
 * Backfill: put the old (faulty) laptop's TTSPL into existing support-replacement
 * Sales Order line remarks and their outbound Delivery Challan remarks, then
 * regenerate the affected SO + DC PDFs.
 *
 * Only overwrites generic/empty remarks ('' or 'Support replacement') so any
 * manually edited remark is preserved.
 *
 * Usage:
 *   node backend/scripts/backfill-replacement-ttspl-remarks.js          (apply)
 *   node backend/scripts/backfill-replacement-ttspl-remarks.js --dry    (preview only)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const { getSalesOrderLines, getDeliveryChallanLines } = require('../services/salesManagementService');
const { generateDocumentPdf } = require('../services/salesManagementPdfService');
const { buildReplacementSoLineRemark } = require('../utils/replacementRemarkUtils');

const DRY = process.argv.includes('--dry');
const GENERIC_REMARK = 'Support replacement';

async function main() {
  const orders = await pool.query(
    `SELECT id, sales_order_number, sales_order_line_id, old_machine_serial
       FROM support_replacement_orders
      WHERE sales_order_line_id IS NOT NULL
        AND COALESCE(TRIM(old_machine_serial), '') <> ''`
  );

  const affectedSos = new Set();
  let soLineUpdates = 0;

  // 1) SO line remarks
  for (const ro of orders.rows) {
    const newRemark = buildReplacementSoLineRemark({ old_machine_serial: ro.old_machine_serial });
    affectedSos.add(ro.sales_order_number);
    if (DRY) {
      const cur = await pool.query('SELECT remark FROM sales_order_lines WHERE id = $1', [ro.sales_order_line_id]);
      const c = (cur.rows[0]?.remark || '').trim();
      if (c === '' || c === GENERIC_REMARK) {
        soLineUpdates += 1;
        console.log(`[dry] SO ${ro.sales_order_number} line ${ro.sales_order_line_id}: "${c}" -> "${newRemark}"`);
      }
      continue;
    }
    const upd = await pool.query(
      `UPDATE sales_order_lines
          SET remark = $1
        WHERE id = $2
          AND (remark IS NULL OR TRIM(remark) = '' OR TRIM(remark) = $3)`,
      [newRemark, ro.sales_order_line_id, GENERIC_REMARK]
    );
    soLineUpdates += upd.rowCount;
  }

  // 2) Outbound DC remarks (recomputed from the SO lines actually in each DC)
  let dcUpdates = 0;
  for (const so of affectedSos) {
    const dcRes = await pool.query(
      `SELECT DISTINCT dc_number FROM delivery_challan_lines
        WHERE sales_order_number = $1 AND COALESCE(movement_type, 'outbound') = 'outbound'`,
      [so]
    );
    for (const { dc_number: dcNumber } of dcRes.rows) {
      const lineIdsRes = await pool.query(
        `SELECT DISTINCT line_id FROM sales_order_serials
          WHERE dc_number = $1 AND line_id IS NOT NULL`,
        [dcNumber]
      );
      const lineIds = lineIdsRes.rows.map((r) => r.line_id);
      const remRes = lineIds.length
        ? await pool.query(
            `SELECT DISTINCT TRIM(remark) AS remark FROM sales_order_lines
              WHERE id = ANY($1::int[]) AND COALESCE(TRIM(remark), '') <> ''`,
            [lineIds]
          )
        : await pool.query(
            `SELECT DISTINCT TRIM(remark) AS remark FROM sales_order_lines
              WHERE sales_order_number = $1 AND COALESCE(TRIM(remark), '') <> ''`,
            [so]
          );
      const dcRemark = [...new Set(remRes.rows.map((r) => r.remark).filter(Boolean))].join('; ') || null;
      if (!dcRemark) continue;
      if (DRY) {
        console.log(`[dry] DC ${dcNumber} (SO ${so}) -> "${dcRemark}"`);
        dcUpdates += 1;
        continue;
      }
      const upd = await pool.query(
        `UPDATE delivery_challan_lines
            SET remarks = $1, updated_at = NOW()
          WHERE dc_number = $2 AND COALESCE(movement_type, 'outbound') = 'outbound'
            AND (remarks IS NULL OR TRIM(remarks) = '' OR TRIM(remarks) = $3)`,
        [dcRemark, dcNumber, GENERIC_REMARK]
      );
      dcUpdates += upd.rowCount;
    }
  }

  // 3) Regenerate PDFs for affected SOs + their outbound DCs
  let soPdfs = 0;
  let dcPdfs = 0;
  if (!DRY) {
    for (const so of affectedSos) {
      try {
        const soLines = await getSalesOrderLines(so);
        if (soLines.length) {
          const soPdf = await generateDocumentPdf({
            docType: 'sales_order', docNumber: so, header: soLines[0], lines: soLines,
          });
          await pool.query('UPDATE sales_order_lines SET pdf_path = $1 WHERE sales_order_number = $2', [soPdf, so]);
          soPdfs += 1;
        }
        const dcRes = await pool.query(
          `SELECT DISTINCT dc_number FROM delivery_challan_lines
            WHERE sales_order_number = $1 AND COALESCE(movement_type, 'outbound') = 'outbound'`,
          [so]
        );
        for (const { dc_number: dcNumber } of dcRes.rows) {
          const lines = await getDeliveryChallanLines(dcNumber);
          if (!lines.length) continue;
          const pdf = await generateDocumentPdf({
            docType: 'delivery_challan', docNumber: dcNumber, header: lines[0], lines,
          });
          await pool.query('UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW() WHERE dc_number = $2', [pdf, dcNumber]);
          dcPdfs += 1;
        }
      } catch (e) {
        console.error(`PDF regen failed for SO ${so}:`, e.message);
      }
    }
  }

  console.log(`${DRY ? '[DRY RUN] ' : ''}Done. Replacement orders scanned: ${orders.rows.length}, ` +
    `SO lines updated: ${soLineUpdates}, DC lines updated: ${dcUpdates}, ` +
    `SOs affected: ${affectedSos.size}, SO PDFs: ${soPdfs}, DC PDFs: ${dcPdfs}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
