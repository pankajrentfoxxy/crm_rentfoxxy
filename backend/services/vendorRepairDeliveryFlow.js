/**
 * By-hand Vendor Repair DC (VRDC) on the technician's My Deliveries.
 *
 * A VRDC sent "by hand" names a delivery technician, and the guard's outward
 * scan moves it to 'dispatched' — but until now only the desk could record that
 * it reached the vendor, with no proof. This mirrors the vendor return flow
 * (vendorReturnDeliveryFlow.js): reached (GPS) → vendor signature (+ optional
 * photo) → the existing markDeliveredToVendor routine, in one locked
 * transaction. Migration 405 adds the proof columns.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

function isVendorRepairDcNumber(dcNumber) {
  return /^VRDC/i.test(String(dcNumber || ''));
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toDeliveryFlowItem(row) {
  // configuration is free text ("Dell Inc. · Latitude 7440 · i7 · 13 · 32 · 512").
  const serials = (row.items || []).map((item) => ({
    ttspl: item.ttspl_id || '',
    serial_number: item.serial_number || '',
    brand: '',
    model: String(item.configuration || '').trim(),
    processor: '',
    generation: '',
    ram: '',
    storage: '',
    gpu: '',
    screen_size: '',
    issue_type: item.issue_type || null,
  }));
  const phone = row.contact_mobile || row.contact_person_phone || row.vendor_phone || '';
  return {
    dc_number: row.dc_number,
    movement_type: 'outbound',
    dc_purpose: 'vendor_repair',
    customer_id: row.vendor_id,
    customer_name: row.vendor_name || 'Vendor',
    customer_phone: phone,
    status: row.vendor_reached_at ? 'reached' : 'in_transit',
    dispatch_mode: row.dispatch_mode || 'inhouse',
    ship_by: row.ship_by,
    delivery_person_id: row.delivery_person_id,
    delivery_address: {
      name: row.contact_person || row.vendor_name || 'Vendor',
      address: row.shipping_address || row.vendor_address || '',
      phone,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
    dispatched_at: row.dispatched_at,
    reached_at: row.vendor_reached_at,
    tech_latitude: row.vendor_reached_latitude,
    tech_longitude: row.vendor_reached_longitude,
    otp_pending: false,
    serials,
  };
}

async function listBucketVendorRepairs({ technicianId = null, userId = null } = {}) {
  if (!technicianId && !userId) return [];
  const heads = await pool.query(
    `SELECT d.*, v.phone AS vendor_phone, v.contact_person_phone
       FROM vendor_repair_delivery_challans d
       LEFT JOIN vendors v ON v.vendor_id = d.vendor_id
      WHERE d.status = 'dispatched'
        AND d.ship_by = 'by_hand'
        AND d.vendor_delivered_at IS NULL
        AND COALESCE(d.item_domain, 'laptop') = 'laptop'
        AND (d.delivery_person_id = $1 OR d.delivery_person_id = $2)
      ORDER BY d.dispatched_at DESC NULLS LAST, d.dc_number DESC`,
    [technicianId || -1, userId || -1]
  );
  if (!heads.rows.length) return [];
  const items = await pool.query(
    `SELECT dc_number, ttspl_id, serial_number, configuration, issue_type
       FROM vendor_repair_dc_items
      WHERE dc_number = ANY($1::text[])
      ORDER BY id`,
    [heads.rows.map((h) => h.dc_number)]
  );
  return heads.rows.map((h) => toDeliveryFlowItem({
    ...h,
    items: items.rows.filter((i) => i.dc_number === h.dc_number),
  }));
}

async function markReached(dcNumber, { latitude, longitude } = {}) {
  const upd = await pool.query(
    `UPDATE vendor_repair_delivery_challans
        SET vendor_reached_at = COALESCE(vendor_reached_at, NOW()),
            vendor_reached_latitude = COALESCE($2, vendor_reached_latitude),
            vendor_reached_longitude = COALESCE($3, vendor_reached_longitude),
            updated_at = NOW()
      WHERE dc_number = $1 AND status = 'dispatched' AND ship_by = 'by_hand'
        AND vendor_delivered_at IS NULL`,
    [dcNumber, latitude != null ? String(latitude) : null, longitude != null ? String(longitude) : null]
  );
  if (!upd.rowCount) {
    throw httpError('This repair challan is not out for delivery by hand (not through the gate yet, or already with the vendor)');
  }
  return { success: true };
}

function saveEsign(dcNumber, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const dir = path.join(__dirname, '../uploads/pod');
  fs.mkdirSync(dir, { recursive: true });
  const safeDc = String(dcNumber || 'vrdc').replace(/[^\w-]+/g, '_');
  const filename = `vrdc_esign_${safeDc}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(m[2], 'base64'));
  return `pod/${filename}`;
}

/**
 * Vendor signed for the laptops. Locks the challan, refuses a second
 * submission (409), then runs the same markDeliveredToVendor the desk uses.
 */
async function deliverWithPod(dcNumber, {
  actorUserId, actorName, podPhotoPath, esignData, signerName, notes,
}) {
  const vrdc = require('./vendorRepairDcService');
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    const headRes = await client.query(
      `SELECT * FROM vendor_repair_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
      [dcNumber]
    );
    const head = headRes.rows[0];
    if (!head) throw httpError('Vendor repair challan not found', 404);
    if (head.vendor_delivered_at) throw httpError('Already handed to the vendor', 409);
    if (head.status !== 'dispatched' || head.ship_by !== 'by_hand') {
      throw httpError('This repair challan is not out for delivery by hand');
    }
    if (!head.vendor_reached_at) throw httpError('Mark that you have reached the vendor first');
    const esignUrl = esignData ? saveEsign(dcNumber, esignData) : null;
    if (!esignUrl) throw httpError('The vendor’s signature is required');
    await client.query(
      `UPDATE vendor_repair_delivery_challans
          SET vendor_delivery_esign_url = $2,
              vendor_delivery_photo_path = $3,
              vendor_delivery_signer_name = $4,
              vendor_delivery_notes = $5,
              updated_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber, esignUrl, podPhotoPath || null, String(signerName || '').trim() || null, String(notes || '').trim() || null]
    );
    result = await vrdc.markDeliveredToVendor(client, { dcNumber, actorUserId, actorName });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Same post-commit PDF step as the desk's "mark delivered to vendor".
  try {
    const vrdcEway = require('./vrdcEwayComplianceService');
    const dc = await vrdc.getVendorRepairDc(dcNumber);
    if (await vrdcEway.shouldPersistPublicVrdcPdf(dc, dc?.items || [])) {
      const { generateVendorRepairPdf } = require('./vendorRepairPdfService');
      await generateVendorRepairPdf(dcNumber);
    } else {
      await vrdcEway.purgeLockedVrdcPublicPdf(dcNumber);
    }
  } catch (pdfErr) {
    console.error('[vendorRepairDeliveryFlow] PDF after delivery:', pdfErr.message);
  }
  return { success: true, message: 'Handed to the vendor', ...result };
}

module.exports = {
  isVendorRepairDcNumber,
  listBucketVendorRepairs,
  markReached,
  deliverWithPod,
  toDeliveryFlowItem,
};
