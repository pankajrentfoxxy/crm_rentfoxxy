/**
 * By-hand Vendor Return DC in the technician bucket / My Deliveries.
 * Destination is the vendor — no customer WhatsApp OTP and no per-laptop
 * TTSPL scan. Reached + vendor e-signature completes the DC.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { completeVendorReturn } = require('./vendorReturnToVendorService');

function isVendorReturnDcNumber(dcNumber) {
  return String(dcNumber || '').toUpperCase().startsWith('VRTDC');
}

function flowStatus(row) {
  if (row.status === 'completed') return 'delivered';
  if (row.reached_at) return 'reached';
  return 'in_transit';
}

function toDeliveryFlowItem(row) {
  const serials = (row.items || []).map((item) => ({
    ttspl: item.ttspl_id || '',
    serial_number: item.serial_number || '',
    brand: item.brand || '',
    model: item.model || '',
    processor: '',
    generation: '',
    ram: '',
    storage: '',
    gpu: '',
    screen_size: '',
  }));
  const phone = row.contact_mobile || row.contact_person_phone || row.phone || '';
  const addressText = row.shipping_address || row.vendor_address || row.vendor_ship_address || '';
  return {
    dc_number: row.dc_number,
    movement_type: 'outbound',
    dc_purpose: 'vendor_return',
    sales_order_number: row.po_number || null,
    customer_id: row.vendor_id,
    customer_name: row.vendor_name || row.vendor_business_name || 'Vendor',
    customer_phone: phone,
    customer_email: null,
    status: flowStatus(row),
    dispatch_mode: row.dispatch_mode || 'inhouse',
    ship_by: row.ship_by || 'by_hand',
    courier_name: row.courier_name,
    awb_number: row.awb_number,
    delivery_person_id: row.delivery_person_id,
    technician_name: row.technician_name || null,
    technician_phone: row.technician_phone || null,
    delivery_address: {
      name: row.vendor_name || row.vendor_business_name || 'Vendor',
      address: addressText,
      phone,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
    dispatched_at: row.dispatched_at,
    reached_at: row.reached_at,
    tech_latitude: row.tech_latitude,
    tech_longitude: row.tech_longitude,
    serial_verified_at: row.serial_verified_at,
    serial_verified_no: row.serial_verified_no,
    otp_pending: Boolean(row.serial_verified_at),
    otp_sent_at: row.serial_verified_at || null,
    otp_verified_at: null,
    otp_code: undefined,
    can_view_otp: false,
    pod_type: row.delivery_pod_type,
    pod_photo_url: row.delivery_pod_path,
    esign_url: row.delivery_pod_type === 'esign' ? row.delivery_pod_path : null,
    delivery_notes: row.delivery_notes,
    delivered_at: row.vendor_received_at,
    serials,
  };
}

async function loadAssignedHead(dcNumber) {
  const head = await pool.query(
    `SELECT d.*,
            vpo.purchase_order_number AS po_number,
            v.business_name AS vendor_business_name,
            v.shipping_address AS vendor_ship_address,
            v.contact_person_phone, v.phone,
            COALESCE(NULLIF(TRIM(CONCAT(dt.first_name,' ',COALESCE(dt.last_name,''))),''), u.name) AS technician_name,
            COALESCE(dt.phone, u.mobile_no) AS technician_phone
       FROM vendor_return_delivery_challans d
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = d.po_id
       LEFT JOIN vendors v ON v.vendor_id = d.vendor_id AND v.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT dt.*
           FROM delivery_technicians dt
          WHERE dt.technician_id = d.delivery_person_id
             OR dt.user_id = d.delivery_person_id
          ORDER BY CASE WHEN dt.technician_id = d.delivery_person_id THEN 0 ELSE 1 END
          LIMIT 1
       ) dt ON TRUE
       LEFT JOIN users u ON u.user_id = COALESCE(dt.user_id, d.delivery_person_id)
      WHERE d.dc_number = $1`,
    [dcNumber]
  );
  return head.rows[0] || null;
}

async function loadItems(dcNumber) {
  const items = await pool.query(
    `SELECT * FROM vendor_return_dc_items WHERE dc_number = $1 ORDER BY id`,
    [dcNumber]
  );
  return items.rows;
}

async function listBucketVendorReturns({ technicianId = null, userId = null } = {}) {
  const params = [];
  const cond = [
    `d.status = 'dispatched'`,
    `d.ship_by = 'by_hand'`,
    `d.delivery_person_id IS NOT NULL`,
  ];
  if (technicianId || userId) {
    params.push(technicianId || -1, userId || -1);
    cond.push(`(d.delivery_person_id = $1 OR d.delivery_person_id = $2)`);
  }
  const heads = await pool.query(
    `SELECT d.*,
            vpo.purchase_order_number AS po_number,
            v.business_name AS vendor_business_name,
            v.shipping_address AS vendor_ship_address,
            v.contact_person_phone, v.phone,
            COALESCE(NULLIF(TRIM(CONCAT(dt.first_name,' ',COALESCE(dt.last_name,''))),''), u.name) AS technician_name,
            COALESCE(dt.phone, u.mobile_no) AS technician_phone
       FROM vendor_return_delivery_challans d
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = d.po_id
       LEFT JOIN vendors v ON v.vendor_id = d.vendor_id AND v.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT dt.*
           FROM delivery_technicians dt
          WHERE dt.technician_id = d.delivery_person_id
             OR dt.user_id = d.delivery_person_id
          ORDER BY CASE WHEN dt.technician_id = d.delivery_person_id THEN 0 ELSE 1 END
          LIMIT 1
       ) dt ON TRUE
       LEFT JOIN users u ON u.user_id = COALESCE(dt.user_id, d.delivery_person_id)
      WHERE ${cond.join(' AND ')}
      ORDER BY d.updated_at DESC NULLS LAST, d.dispatched_at DESC NULLS LAST, d.dc_number DESC`,
    params
  );
  const out = [];
  for (const row of heads.rows) {
    const items = await loadItems(row.dc_number);
    out.push(toDeliveryFlowItem({ ...row, items }));
  }
  return out;
}

async function markReached(dcNumber, { latitude, longitude } = {}) {
  const upd = await pool.query(
    `UPDATE vendor_return_delivery_challans
        SET reached_at = COALESCE(reached_at, NOW()),
            tech_latitude = COALESCE($2, tech_latitude),
            tech_longitude = COALESCE($3, tech_longitude),
            updated_at = NOW()
      WHERE dc_number = $1 AND status = 'dispatched' AND ship_by = 'by_hand'`,
    [dcNumber, latitude != null ? String(latitude) : null, longitude != null ? String(longitude) : null]
  );
  if (!upd.rowCount) {
    const err = new Error('Vendor return is not in a deliverable (dispatched by hand) state');
    err.status = 400;
    throw err;
  }
  return { success: true };
}

async function verifySerial(dcNumber, serialInput) {
  const input = String(serialInput || '').trim();
  if (!input) {
    const err = new Error('serial_number is required');
    err.status = 400;
    throw err;
  }
  const head = await loadAssignedHead(dcNumber);
  if (!head || head.status !== 'dispatched') {
    const err = new Error('Vendor return DC not found or not dispatched');
    err.status = 404;
    throw err;
  }
  if (!head.reached_at) {
    const err = new Error('Mark as reached at the vendor before verifying the serial');
    err.status = 400;
    throw err;
  }
  const items = await loadItems(dcNumber);
  const norm = (v) => String(v || '').trim().toLowerCase();
  const matched = items.find((it) =>
    norm(it.serial_number) === norm(input) || norm(it.ttspl_id) === norm(input));
  if (!matched) {
    const err = new Error('Serial does not match any laptop on this vendor return');
    err.status = 400;
    throw err;
  }
  await pool.query(
    `UPDATE vendor_return_delivery_challans
        SET serial_verified_at = NOW(),
            serial_verified_no = $2,
            updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, matched.serial_number || matched.ttspl_id || input]
  );
  return {
    success: true,
    message: 'Serial verified. Capture POD and confirm delivery to the vendor (no customer OTP).',
  };
}

function saveEsign(dcNumber, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const dir = path.join(__dirname, '../uploads/pod');
  fs.mkdirSync(dir, { recursive: true });
  const safeDc = String(dcNumber || 'vrtdc').replace(/[^\w-]+/g, '_');
  const filename = `vrtdc_esign_${safeDc}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(m[2], 'base64'));
  return `pod/${filename}`;
}

async function deliverWithPod(dcNumber, {
  actorUserId,
  actorName,
  podPhotoPath,
  esignData,
  notes,
  podType,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const headRes = await client.query(
      `SELECT * FROM vendor_return_delivery_challans WHERE dc_number = $1 FOR UPDATE`,
      [dcNumber]
    );
    const head = headRes.rows[0];
    if (!head) {
      const err = new Error('Vendor return DC not found');
      err.status = 404;
      throw err;
    }
    if (head.status === 'completed') {
      const err = new Error('Vendor return already delivered');
      err.status = 409;
      throw err;
    }
    if (head.status !== 'dispatched' || head.ship_by !== 'by_hand') {
      const err = new Error('This vendor return is not assigned for by-hand delivery');
      err.status = 400;
      throw err;
    }
    if (!head.reached_at) {
      const err = new Error('Mark as reached at the vendor before confirming delivery');
      err.status = 400;
      throw err;
    }
    const esignUrl = esignData ? saveEsign(dcNumber, esignData) : null;
    if (!esignUrl) {
      const err = new Error('Vendor / receiver e-signature is required before submitting this return');
      err.status = 400;
      throw err;
    }
    const storedPath = esignUrl;
    const storedType = 'esign';
    await client.query(
      `UPDATE vendor_return_delivery_challans
          SET delivery_pod_path = $2,
              delivery_pod_type = $3,
              delivery_notes = $4,
              updated_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber, storedPath, storedType, notes || null]
    );
    const dc = await completeVendorReturn(client, { dcNumber, actorUserId, actorName });
    await client.query('COMMIT');
    try {
      const { generateVendorReturnDcPdf } = require('./vendorReturnToVendorPdfService');
      await generateVendorReturnDcPdf(dcNumber);
    } catch (pdfErr) {
      console.error('VRTDC PDF after delivery:', pdfErr.message);
    }
    return { success: true, message: 'Delivered to vendor', dc };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  isVendorReturnDcNumber,
  listBucketVendorReturns,
  markReached,
  verifySerial,
  deliverWithPod,
};
