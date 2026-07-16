const path = require('path');
const { generateReturnDcPdf } = require('./salesManagementPdfService');

const parseJson = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

async function nameFor(db, uid) {
  if (!uid) return null;
  try {
    const r = await db.query('SELECT name FROM users WHERE user_id = $1', [uid]);
    return r.rows[0]?.name || null;
  } catch (_) { return null; }
}

async function resolveUnitSpec(db, code) {
  if (!code) return {};
  const r = await db.query(
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
  return r.rows[0] || {};
}

/** Build units list from pickup items and/or DC serial JSON. */
function earliestTimestamp(items, field) {
  const values = items.map((i) => i[field]).filter(Boolean);
  if (!values.length) return null;
  return values.reduce((min, value) => {
    if (!min) return value;
    return new Date(value) < new Date(min) ? value : min;
  }, null);
}

async function buildUnitsForRdc(db, dcl, pickupItems) {
  const units = [];
  const seen = new Set();

  for (const item of pickupItems) {
    const code = item.ttspl_id || item.unique_serial_number || item.serial_number;
    const key = code || `item-${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = await resolveUnitSpec(db, code);
    units.push({
      brand: spec.brand || item.brand,
      model: spec.model || item.model,
      processor: spec.processor || null,
      generation: spec.generation || item.generation,
      ram: spec.ram || item.ram,
      storage: spec.storage || item.storage,
      ttspl: spec.inventory_asset_code || item.ttspl_id || item.unique_serial_number || code,
      serial: spec.serial_number || item.serial_number,
    });
  }

  if (!units.length && dcl.serial_number) {
    const entries = Array.isArray(dcl.serial_number) ? dcl.serial_number : parseJson(dcl.serial_number);
    const list = Array.isArray(entries) ? entries : [];
    for (const entry of list) {
      const parts = String(entry).split('|');
      const code = parts[2] || parts[1] || parts[0];
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const spec = await resolveUnitSpec(db, code);
      units.push({
        brand: spec.brand || dcl.brand,
        model: spec.model || dcl.model_name,
        processor: spec.processor || null,
        generation: spec.generation || null,
        ram: spec.ram || null,
        storage: spec.storage || null,
        ttspl: spec.inventory_asset_code || code,
        serial: spec.serial_number || parts[1] || null,
      });
    }
  }

  return units;
}

/** Rebuild Return DC PDF for an entire RDC (all laptops + merged e-signatures). */
async function regenerateReturnDcPdfByRdc(db, rdcNumber) {
  try {
    if (!rdcNumber) return null;
    const dclRes = await db.query(
      `SELECT dcl.*, st.customer_phone
         FROM delivery_challan_lines dcl
         LEFT JOIN support_tickets st ON st.id = dcl.support_ticket_id
        WHERE dcl.dc_number = $1 AND dcl.movement_type = 'return'
        LIMIT 1`,
      [rdcNumber]
    );
    const dcl = dclRes.rows[0];
    if (!dcl) return null;

    const itemsRes = await db.query(
      `SELECT * FROM support_ticket_items
        WHERE return_dc_number = $1 AND item_type = 'pickup'
        ORDER BY id ASC`,
      [rdcNumber]
    );
    const pickupItems = itemsRes.rows;
    const primary = pickupItems[0] || {};

    const techItem = pickupItems.find((i) => i.technician_esign_url) || primary;
    const whItem = pickupItems.find((i) => i.warehouse_esign_url)
      || pickupItems.find((i) => i.warehouse_received_at)
      || primary;

    const units = await buildUnitsForRdc(db, dcl, pickupItems);
    const allOtpVerified = pickupItems.length > 0
      && pickupItems.every((i) => i.customer_otp_verified_at);

    const pdfPath = await generateReturnDcPdf({
      returnDcNumber: rdcNumber,
      header: {
        entity_code: 'rentfoxxy',
        customer_name: dcl.customer_name || null,
        customer_email: dcl.email || null,
        customer_phone: dcl.customer_phone || null,
        pickup_address: dcl.customer_shipping_address || null,
        original_dc_number: dcl.original_dc_number || null,
        sales_order_number: dcl.sales_order_number || null,
        pickup_type: primary.pickup_type || 'return',
        dispatch_mode: dcl.dispatch_mode || primary.pickup_method || null,
        courier_name: dcl.courier_name || null,
        awb_number: dcl.awb_number || null,
        pickup_created_at: dcl.created_at || primary.created_at || null,
        pickup_date: earliestTimestamp(pickupItems, 'picked_up_at'),
        warehouse_received_at: earliestTimestamp(pickupItems, 'warehouse_received_at'),
        remarks: (dcl.remarks || '').trim() || null,
      },
      units: units.length ? units : [{
        brand: dcl.brand,
        model: dcl.model_name,
        ttspl: '—',
        serial: '—',
      }],
      esign: {
        technician_url: techItem.technician_esign_url || null,
        technician_name: await nameFor(db, techItem.technician_esign_by || techItem.pickup_assigned_to || techItem.assigned_to),
        technician_at: techItem.technician_esign_at || null,
        warehouse_url: whItem.warehouse_esign_url || null,
        warehouse_name: await nameFor(db, whItem.warehouse_esign_by || whItem.warehouse_received_by),
        warehouse_at: whItem.warehouse_esign_at || whItem.warehouse_received_at || null,
        customer_otp_verified: allOtpVerified || !!primary.customer_otp_verified_at,
      },
    });

    await db.query(
      `UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW()
        WHERE dc_number = $2 AND movement_type = 'return'`,
      [pdfPath, rdcNumber]
    );
    return pdfPath;
  } catch (e) {
    console.error('[returnDcPdf] regenerateByRdc failed:', e.message);
    return null;
  }
}

/** @deprecated Use regenerateReturnDcPdfByRdc — kept for call-site compat. */
async function regenerateReturnDcPdf(db, item) {
  if (!item?.return_dc_number) return null;
  return regenerateReturnDcPdfByRdc(db, item.return_dc_number);
}

async function regenerateStaleReturnDcPdfs(db, limit = 8) {
  try {
    const rows = (await db.query(
      `SELECT DISTINCT ON (dcl.dc_number) dcl.dc_number AS rdc
         FROM delivery_challan_lines dcl
         JOIN support_ticket_items sti
           ON sti.return_dc_number = dcl.dc_number AND sti.item_type = 'pickup'
        WHERE dcl.movement_type = 'return'
          AND (sti.technician_esign_url IS NOT NULL OR sti.warehouse_esign_url IS NOT NULL
               OR sti.customer_otp_verified_at IS NOT NULL)
          AND (
            dcl.pdf_path IS NULL
            OR EXISTS (
              SELECT 1 FROM support_ticket_items s2
               WHERE s2.return_dc_number = dcl.dc_number
                 AND (
                   (s2.technician_esign_at IS NOT NULL AND s2.technician_esign_at > dcl.updated_at)
                   OR (COALESCE(s2.warehouse_esign_at, s2.warehouse_received_at) > dcl.updated_at)
                   OR (s2.customer_otp_verified_at IS NOT NULL AND s2.customer_otp_verified_at > dcl.updated_at)
                 )
            )
          )
        ORDER BY dcl.dc_number, dcl.updated_at ASC
        LIMIT $1`,
      [limit]
    )).rows;
    for (const { rdc } of rows) {
      await regenerateReturnDcPdfByRdc(db, rdc);
    }
  } catch (e) {
    console.warn('[returnDcPdf] stale regen skipped:', e.message);
  }
}

module.exports = { regenerateReturnDcPdf, regenerateReturnDcPdfByRdc, regenerateStaleReturnDcPdfs, buildUnitsForRdc };
