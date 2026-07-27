/**
 * Backfill: fill in the replacement SO line rate (old laptop's price) for existing
 * replacement orders whose line rate is 0/blank, using the same fallback resolver
 * used at creation time. Also updates support_replacement_orders.old_rent_monthly_rate
 * and regenerates the affected SO + outbound DC PDFs.
 *
 * Usage:
 *   node backend/scripts/backfill-replacement-rates.js --dry   (preview)
 *   node backend/scripts/backfill-replacement-rates.js         (apply)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const { resolveOldUnitPrice } = require('../services/supportReplacementFlowService');
const { getSalesOrderLines, getDeliveryChallanLines } = require('../services/salesManagementService');
const { generateDocumentPdf } = require('../services/salesManagementPdfService');

const DRY = process.argv.includes('--dry');

async function main() {
  const rows = (await pool.query(`
    SELECT ro.id AS ro_id, ro.sales_order_number, ro.sales_order_line_id,
           ro.old_machine_serial, ro.old_serial_id,
           sol.rate AS so_line_rate,
           t.customer_id,
           vsn.rent_monthly_rate AS vsn_rent, vsn.serial_number AS vsn_serial
      FROM support_replacement_orders ro
      JOIN sales_order_lines sol ON sol.id = ro.sales_order_line_id
      LEFT JOIN support_tickets t ON t.id = ro.ticket_id
      LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = ro.old_serial_id
     WHERE COALESCE(sol.rate, 0) = 0
     ORDER BY ro.id
  `)).rows;

  const affectedSos = new Set();
  let updated = 0;
  for (const r of rows) {
    const price = await resolveOldUnitPrice(pool, {
      serialRate: r.vsn_rent,
      code: r.old_machine_serial,
      serialNumber: r.vsn_serial,
      customerId: r.customer_id,
    });
    if (!(price > 0)) {
      console.log(`  (skip) SO ${r.sales_order_number} line ${r.sales_order_line_id} [${r.old_machine_serial}] — no price found anywhere`);
      continue;
    }
    console.log(`${DRY ? '[dry] ' : ''}SO ${r.sales_order_number} line ${r.sales_order_line_id} [${r.old_machine_serial}] -> ${price}`);
    updated += 1;
    affectedSos.add(r.sales_order_number);
    if (DRY) continue;
    await pool.query('UPDATE sales_order_lines SET rate = $1 WHERE id = $2', [price, r.sales_order_line_id]);
    await pool.query('UPDATE support_replacement_orders SET old_rent_monthly_rate = COALESCE(old_rent_monthly_rate, $1) WHERE id = $2', [price, r.ro_id]);
  }

  let soPdfs = 0;
  let dcPdfs = 0;
  if (!DRY) {
    for (const so of affectedSos) {
      try {
        const soLines = await getSalesOrderLines(so);
        if (soLines.length) {
          const soPdf = await generateDocumentPdf({ docType: 'sales_order', docNumber: so, header: soLines[0], lines: soLines });
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
          const pdf = await generateDocumentPdf({ docType: 'delivery_challan', docNumber: dcNumber, header: lines[0], lines });
          await pool.query('UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW() WHERE dc_number = $2', [pdf, dcNumber]);
          dcPdfs += 1;
        }
      } catch (e) {
        console.error(`PDF regen failed for SO ${so}:`, e.message);
      }
    }
  }

  console.log(`\n${DRY ? '[DRY RUN] ' : ''}Done. Zero-rate lines scanned: ${rows.length}, updated: ${updated}, SOs affected: ${affectedSos.size}, SO PDFs: ${soPdfs}, DC PDFs: ${dcPdfs}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
