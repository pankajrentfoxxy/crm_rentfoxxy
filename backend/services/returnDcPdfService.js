const path = require('path');
const { generateReturnDcPdf } = require('./salesManagementPdfService');

/** Build (or rebuild) the branded Return DC PDF for a pickup item. Best-effort. */
async function regenerateReturnDcPdf(db, item) {
  try {
    if (!item || !item.return_dc_number) return null;
    const dclRes = await db.query(
      `SELECT dcl.*, st.entity_code, st.customer_phone
         FROM delivery_challan_lines dcl
         LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
        WHERE dcl.dc_number = $1 AND dcl.movement_type = 'return'
        LIMIT 1`,
      [item.return_dc_number]
    );
    const dcl = dclRes.rows[0] || {};

    const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
    let spec = {};
    if (code) {
      const vsnRes = await db.query(
        `SELECT vsn.serial_number, vsn.inventory_asset_code,
                COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
                COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
                COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
                COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
                COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
                COALESCE(vsn.extra->>'storage', vpd.storage) AS storage
           FROM vendor_serial_numbers vsn
           LEFT JOIN vendor_product_details vpd ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
          WHERE vsn.deleted_at IS NULL
            AND (vsn.inventory_asset_code = $1 OR vsn.serial_number = $1)
          LIMIT 1`,
        [code]
      );
      spec = vsnRes.rows[0] || {};
    }

    const nameFor = async (uid) => {
      if (!uid) return null;
      try {
        const r = await db.query('SELECT name FROM users WHERE user_id = $1', [uid]);
        return r.rows[0]?.name || null;
      } catch (_) { return null; }
    };
    const technicianName = await nameFor(item.technician_esign_by || item.pickup_assigned_to || item.assigned_to);
    const warehouseName = await nameFor(item.warehouse_esign_by || item.warehouse_received_by);

    const pdfPath = await generateReturnDcPdf({
      returnDcNumber: item.return_dc_number,
      header: {
        entity_code: dcl.entity_code || null,
        customer_name: dcl.customer_name || null,
        customer_email: dcl.email || null,
        customer_phone: dcl.customer_phone || null,
        pickup_address: dcl.customer_shipping_address || null,
        original_dc_number: dcl.original_dc_number || null,
        sales_order_number: dcl.sales_order_number || null,
        pickup_type: item.pickup_type || 'return',
        dispatch_mode: dcl.dispatch_mode || item.pickup_method || null,
        courier_name: dcl.courier_name || null,
        awb_number: dcl.awb_number || null,
      },
      units: [{
        brand: spec.brand || item.brand,
        model: spec.model || item.model,
        processor: spec.processor || null,
        generation: spec.generation || item.generation,
        ram: spec.ram || item.ram,
        storage: spec.storage || item.storage,
        ttspl: spec.inventory_asset_code || item.ttspl_id || item.unique_serial_number || code,
        serial: spec.serial_number || item.serial_number,
      }],
      esign: {
        technician_url: item.technician_esign_url || null,
        technician_name: technicianName,
        technician_at: item.technician_esign_at || null,
        warehouse_url: item.warehouse_esign_url || null,
        warehouse_name: warehouseName,
        warehouse_at: item.warehouse_esign_at || item.warehouse_received_at || null,
        customer_otp_verified: !!item.customer_otp_verified_at,
      },
    });

    await db.query(
      `UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW()
        WHERE dc_number = $2 AND movement_type = 'return'`,
      [pdfPath, item.return_dc_number]
    );
    return pdfPath;
  } catch (e) {
    console.error('[returnDcPdf] regenerate failed:', e.message);
    return null;
  }
}

/** Rebuild PDFs that have e-signatures but a stale or missing pdf_path. */
async function regenerateStaleReturnDcPdfs(db, limit = 8) {
  try {
    const rows = (await db.query(
      `SELECT sti.*
         FROM support_ticket_items sti
         JOIN delivery_challan_lines dcl
           ON dcl.dc_number = sti.return_dc_number AND dcl.movement_type = 'return'
        WHERE sti.item_type = 'pickup'
          AND sti.return_dc_number IS NOT NULL
          AND (sti.technician_esign_url IS NOT NULL OR sti.warehouse_esign_url IS NOT NULL)
          AND (
            dcl.pdf_path IS NULL
            OR dcl.updated_at < GREATEST(
              COALESCE(sti.technician_esign_at, 'epoch'::timestamptz),
              COALESCE(sti.warehouse_esign_at, sti.warehouse_received_at, 'epoch'::timestamptz)
            )
          )
        ORDER BY sti.updated_at DESC
        LIMIT $1`,
      [limit]
    )).rows;
    for (const item of rows) {
      await regenerateReturnDcPdf(db, item);
    }
  } catch (e) {
    console.warn('[returnDcPdf] stale regen skipped:', e.message);
  }
}

module.exports = { regenerateReturnDcPdf, regenerateStaleReturnDcPdfs };
