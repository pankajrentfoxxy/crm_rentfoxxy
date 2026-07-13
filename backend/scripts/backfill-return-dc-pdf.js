/**
 * Phase 22 backfill: for existing Return DCs (delivery_challan_lines,
 * movement_type='return'), resolve the originating outbound DC + Sales Order and
 * generate the branded Return DC PDF. Safe to re-run.
 */
require('dotenv').config();
const pool = require('../config/db');
const { generateReturnDcPdf } = require('../services/salesManagementPdfService');

async function nameFor(uid) {
  if (!uid) return null;
  try { const r = await pool.query('SELECT name FROM users WHERE user_id=$1', [uid]); return r.rows[0]?.name || null; }
  catch { return null; }
}

async function main() {
  const dcls = (await pool.query(
    `SELECT * FROM delivery_challan_lines WHERE movement_type='return' ORDER BY id ASC`
  )).rows;
  console.log(`Found ${dcls.length} return DC line(s).`);

  let traced = 0; let pdfs = 0;
  for (const dcl of dcls) {
    const item = (await pool.query(
      `SELECT * FROM support_ticket_items WHERE return_dc_number=$1 AND item_type='pickup' ORDER BY id DESC LIMIT 1`,
      [dcl.dc_number]
    )).rows[0] || {};

    const code = item.ttspl_id || item.unique_serial_number || item.serial_number || dcl.serial_number;
    const codeStr = typeof code === 'string' ? code : (Array.isArray(code) ? String(code[0] || '') : '');

    // Resolve original outbound DC + SO if missing.
    let originalDc = dcl.original_dc_number;
    let soNumber = dcl.sales_order_number;
    if ((!originalDc || !soNumber) && codeStr) {
      const probe = codeStr.includes('|') ? codeStr.split('|').filter(Boolean) : [codeStr];
      for (const p of probe) {
        const out = (await pool.query(
          `SELECT dc_number, sales_order_number FROM delivery_challan_lines
            WHERE movement_type='outbound' AND serial_number::text ILIKE '%' || $1 || '%'
            ORDER BY created_at DESC NULLS LAST LIMIT 1`,
          [p]
        )).rows[0];
        if (out) { originalDc = originalDc || out.dc_number; soNumber = soNumber || out.sales_order_number; break; }
      }
      if (originalDc || soNumber) {
        await pool.query(
          `UPDATE delivery_challan_lines SET original_dc_number=COALESCE($2,original_dc_number),
                  sales_order_number=COALESCE($3,sales_order_number), updated_at=NOW()
            WHERE dc_number=$1 AND movement_type='return'`,
          [dcl.dc_number, originalDc, soNumber]
        );
        traced += 1;
      }
    }

    // Resolve spec for the unit.
    let spec = {};
    if (codeStr) {
      const c = codeStr.includes('|') ? (codeStr.split('|')[2] || codeStr.split('|')[1] || codeStr) : codeStr;
      const r = await pool.query(
        `SELECT vsn.serial_number, vsn.inventory_asset_code,
                COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
                COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
                COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
                COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
                COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
                COALESCE(vsn.extra->>'storage', vpd.storage) AS storage
           FROM vendor_serial_numbers vsn
           LEFT JOIN vendor_product_details vpd ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
          WHERE vsn.deleted_at IS NULL AND (vsn.inventory_asset_code=$1 OR vsn.serial_number=$1) LIMIT 1`,
        [c]
      );
      spec = r.rows[0] || {};
    }

    const technicianName = await nameFor(item.technician_esign_by || item.pickup_assigned_to || item.assigned_to);
    const warehouseName = await nameFor(item.warehouse_esign_by || item.warehouse_received_by);

    const pdfPath = await generateReturnDcPdf({
      returnDcNumber: dcl.dc_number,
      header: {
        entity_code: null,
        customer_name: dcl.customer_name,
        customer_email: dcl.email,
        pickup_address: dcl.customer_shipping_address,
        original_dc_number: originalDc,
        sales_order_number: soNumber,
        pickup_type: item.pickup_type || 'return',
        dispatch_mode: dcl.dispatch_mode || item.pickup_method,
        courier_name: dcl.courier_name,
        awb_number: dcl.awb_number,
        pickup_created_at: dcl.created_at || item.created_at || null,
        pickup_date: item.picked_up_at || null,
        warehouse_received_at: item.warehouse_received_at || null,
      },
      units: [{
        brand: spec.brand || dcl.brand,
        model: spec.model || dcl.model_name,
        processor: spec.processor,
        generation: spec.generation,
        ram: spec.ram,
        storage: spec.storage,
        ttspl: spec.inventory_asset_code || item.ttspl_id,
        serial: spec.serial_number || item.serial_number,
      }],
      esign: {
        technician_url: item.technician_esign_url,
        technician_name: technicianName,
        technician_at: item.technician_esign_at,
        warehouse_url: item.warehouse_esign_url,
        warehouse_name: warehouseName,
        warehouse_at: item.warehouse_esign_at || item.warehouse_received_at,
        customer_otp_verified: !!item.customer_otp_verified_at,
      },
    });
    await pool.query(
      `UPDATE delivery_challan_lines SET pdf_path=$1, updated_at=NOW() WHERE dc_number=$2 AND movement_type='return'`,
      [pdfPath, dcl.dc_number]
    );
    pdfs += 1;
    console.log(`  ${dcl.dc_number}: original=${originalDc || '—'} so=${soNumber || '—'} pdf=${pdfPath}`);
  }
  console.log(`Done. Traced ${traced}, PDFs generated ${pdfs}.`);
  process.exit(0);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
