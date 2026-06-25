/**
 * PHASE 13 — End-to-end delivery flow.
 * Technician bucket (admin) + technician's own deliveries (dispatch role) +
 * Mark Reached -> Verify Serial (OTP) -> Verify OTP + POD -> Delivered.
 *
 * delivery_person_id on delivery_challan_lines references
 * delivery_technicians.technician_id (inhouse flow). A delivery technician is a
 * CRM user (role 'dispatch') linked via delivery_technicians.user_id.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { ensureLinkedDeliveryTechnician } = require('../services/deliveryTechnicianService');
const { emailDocument } = require('../services/salesManagementPdfService');
const sm = require('./salesManagementController');

const ADMIN_ROLES = ['admin', 'manager', 'super_admin', 'support_lead'];
const DELIVERY_MANAGER_ROLES = ['admin', 'manager', 'super_admin'];

const podDir = path.join(__dirname, '..', 'uploads', 'pod');
fs.mkdirSync(podDir, { recursive: true });

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/** Parse a DC line serial entry ("id|serial|ttspl") into structured parts. */
function parseSerialEntry(entry) {
  const parts = String(entry).split('|');
  const serialId = /^\d+$/.test(parts[0]) ? parseInt(parts[0], 10) : null;
  return { serialId, serialNumber: parts[1] || parts[0], ttsplId: parts[2] || null, raw: entry };
}

function serialEntriesForLine(line) {
  const parsed = parseJson(line.serial_number, []);
  const list = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  return list.filter(Boolean).map(parseSerialEntry);
}

/** Resolve full specs for a set of serial entries from the authoritative source. */
async function resolveSpecs(entries) {
  const ids = entries.map((e) => e.serialId).filter(Boolean);
  const nums = entries.flatMap((e) => [e.serialNumber, e.ttsplId].filter(Boolean));
  if (!ids.length && !nums.length) return [];
  const r = await pool.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code,
            COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
            COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
            COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
            COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
            COALESCE(vsn.extra->>'storage', vpd.storage) AS storage,
            COALESCE(vsn.extra->>'gpu', vpd.gpu) AS gpu,
            COALESCE(vsn.extra->>'screen_size', vpd.screen_size) AS screen_size
       FROM vendor_serial_numbers vsn
       LEFT JOIN vendor_product_details vpd
         ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
      WHERE vsn.deleted_at IS NULL
        AND (vsn.serial_id = ANY($1::int[]) OR vsn.serial_number = ANY($2::text[])
             OR vsn.inventory_asset_code = ANY($2::text[]))`,
    [ids.length ? ids : [-1], nums.length ? nums : ['']]
  );
  return r.rows;
}

/**
 * Build grouped DC rows (one object per DC) with serials, specs, technician,
 * customer phone and the chosen delivery address.
 */
async function buildDcFlow(where, params, { includeOtp = false } = {}) {
  const rowsRes = await pool.query(
    `SELECT d.*,
            COALESCE(NULLIF(TRIM(CONCAT(dt.first_name,' ',COALESCE(dt.last_name,''))),''), u.name, u.email) AS technician_name,
            COALESCE(dt.phone, u.mobile_no) AS technician_phone,
            dt.user_id AS technician_user_id,
            c.phone AS customer_phone, c.name AS customer_real_name,
            sti.customer_otp_code AS support_otp_code,
            sti.customer_otp_verified_at AS support_otp_verified_at,
            sti.customer_otp_sent_at AS support_otp_sent_at
       FROM delivery_challan_lines d
       LEFT JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
       LEFT JOIN users u ON u.user_id = d.delivery_person_id
       LEFT JOIN customers c ON c.customer_id = d.customer_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(customer_otp_code, otp_code) AS customer_otp_code,
                customer_otp_verified_at, customer_otp_sent_at
           FROM support_ticket_items
          WHERE item_type = 'pickup'
            AND (
              return_dc_number = d.dc_number
              OR (return_dc_number IS NULL AND ticket_id = d.support_ticket_id)
            )
          ORDER BY CASE WHEN return_dc_number = d.dc_number THEN 0 ELSE 1 END, id DESC
          LIMIT 1
       ) sti ON d.movement_type = 'return'
       ${where}
      ORDER BY d.dc_number DESC, d.id ASC`,
    params
  );

  const groups = new Map();
  for (const line of rowsRes.rows) {
    if (!groups.has(line.dc_number)) groups.set(line.dc_number, []);
    groups.get(line.dc_number).push(line);
  }

  const out = [];
  for (const [dcNumber, lines] of groups) {
    const first = lines[0];
    const entries = lines.flatMap(serialEntriesForLine);
    const specs = await resolveSpecs(entries);
    const serials = entries.map((e) => {
      const d = specs.find((x) =>
        (e.serialId && x.serial_id === e.serialId)
        || (e.serialNumber && x.serial_number === e.serialNumber)
        || (e.ttsplId && x.inventory_asset_code === e.ttsplId)) || {};
      return {
        ttspl: d.inventory_asset_code || e.ttsplId || e.serialNumber,
        serial_number: d.serial_number || e.serialNumber,
        brand: d.brand || first.brand || '',
        model: d.model || first.model_name || '',
        processor: d.processor || '',
        generation: d.generation || '',
        ram: d.ram || '',
        storage: d.storage || '',
        gpu: d.gpu || '',
        screen_size: d.screen_size || '',
      };
    });

    const shipping = parseJson(first.customer_shipping_address, null);

    out.push({
      dc_number: dcNumber,
      movement_type: first.movement_type || 'outbound',
      sales_order_number: first.sales_order_number,
      customer_id: first.customer_id,
      customer_name: first.customer_name || first.customer_real_name,
      customer_phone: first.customer_phone || shipping?.phone || '',
      customer_email: first.email,
      status: first.status,
      dispatch_mode: first.dispatch_mode,
      ship_by: first.ship_by,
      courier_name: first.courier_name,
      awb_number: first.awb_number,
      courier_tracking_url: first.courier_tracking_url,
      porter_tracking_id: first.porter_tracking_id,
      porter_order_id: first.porter_order_id,
      porter_booking_url: first.porter_booking_url,
      delivery_person_id: first.delivery_person_id,
      technician_name: first.technician_name || null,
      technician_phone: first.technician_phone || null,
      delivery_address: shipping,
      created_at: first.created_at,
      dispatched_at: first.dispatched_at,
      reached_at: first.reached_at,
      tech_latitude: first.tech_latitude,
      tech_longitude: first.tech_longitude,
      serial_verified_at: first.serial_verified_at,
      serial_verified_no: first.serial_verified_no,
      otp_sent_at: first.otp_sent_at || first.support_otp_sent_at,
      otp_verified_at: first.otp_verified_at || first.support_otp_verified_at,
      otp_code: includeOtp ? (first.otp_code || first.support_otp_code) : undefined,
      otp_pending: Boolean(first.otp_sent_at || first.support_otp_sent_at)
        && !(first.otp_verified_at || first.support_otp_verified_at),
      pod_type: first.pod_type,
      pod_photo_url: first.pod_photo_url,
      esign_url: first.esign_url,
      pod_submitted_at: first.pod_submitted_at,
      delivery_notes: first.delivery_notes,
      delivered_at: first.delivered_at,
      serials,
    });
  }
  return out;
}

// GET /delivery-flow?status=in_transit|reached|shipped|delivered|all&technician_id=&page=&limit=
exports.listDeliveryFlow = async (req, res) => {
  try {
    const status = String(req.query.status || 'active').toLowerCase();
    const isAdmin = ADMIN_ROLES.includes(req.user.role);
    const conditions = [];
    const params = [];

    if (status === 'active' || status === 'all') {
      conditions.push(`d.status IN ('in_transit','reached','shipped')`);
    } else if (status === 'inhouse') {
      conditions.push(`d.dispatch_mode = 'inhouse'`);
      conditions.push(`d.status IN ('in_transit','reached')`);
    } else if (status === 'porter') {
      conditions.push(`d.dispatch_mode = 'porter'`);
      conditions.push(`d.status IN ('shipped','in_transit','reached')`);
    } else if (status === 'courier') {
      conditions.push(`d.dispatch_mode = 'courier'`);
      conditions.push(`d.status IN ('shipped','in_transit','reached')`);
    } else {
      params.push(status);
      conditions.push(`d.status = $${params.length}`);
    }

    if (req.query.technician_id) {
      params.push(parseInt(req.query.technician_id, 10));
      conditions.push(`d.delivery_person_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const page = Math.max(1, parseInt(req.query.page, 10) || 0);
    const limitRaw = parseInt(req.query.limit, 10) || 0;
    const limit = limitRaw > 0 ? Math.min(100, Math.max(1, limitRaw)) : 0;
    const paginate = page > 0 && limit > 0;

    if (paginate) {
      const countRes = await pool.query(
        `SELECT COUNT(DISTINCT d.dc_number)::int AS total FROM delivery_challan_lines d ${where}`,
        params
      );
      const total = countRes.rows[0]?.total || 0;
      const offset = (page - 1) * limit;
      const dcRes = await pool.query(
        `SELECT DISTINCT d.dc_number
           FROM delivery_challan_lines d
           ${where}
          ORDER BY d.dc_number DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const dcNumbers = dcRes.rows.map((r) => r.dc_number);
      if (!dcNumbers.length) {
        return res.json({
          success: true,
          items: [],
          pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
      }
      const pageParams = [...params, dcNumbers];
      const pageWhere = `${where} AND d.dc_number = ANY($${pageParams.length}::text[])`;
      const items = await buildDcFlow(pageWhere, pageParams, { includeOtp: isAdmin });
      return res.json({
        success: true,
        items,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    }

    const items = await buildDcFlow(where, params, { includeOtp: isAdmin });
    res.json({ success: true, items });
  } catch (error) {
    console.error('listDeliveryFlow:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Resolve the delivery_technicians.technician_id for the logged-in dispatch/support user. */
async function resolveTechnicianId(userId) {
  await ensureLinkedDeliveryTechnician(userId).catch(() => null);
  const r = await pool.query(
    `SELECT technician_id FROM delivery_technicians WHERE user_id = $1 AND is_active = TRUE LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.technician_id || null;
}

function canManageAnyDelivery(user) {
  return DELIVERY_MANAGER_ROLES.includes(user?.role);
}

async function checkAssignedDeliveryAccess(db, dcNumber, user) {
  if (canManageAnyDelivery(user)) {
    return { allowed: true };
  }

  const techId = await resolveTechnicianId(user.user_id);
  const r = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE d.delivery_person_id = $3
                 OR dt.user_id = $2
                 OR (dt.technician_id IS NULL AND d.delivery_person_id = $2)
            )::int AS assigned
       FROM delivery_challan_lines d
       LEFT JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
      WHERE d.dc_number = $1`,
    [dcNumber, user.user_id, techId || -1]
  );

  const total = r.rows[0]?.total || 0;
  if (!total) {
    return { allowed: false, status: 404, message: 'Delivery challan not found' };
  }
  if (r.rows[0].assigned === total) {
    return { allowed: true };
  }
  return { allowed: false, status: 403, message: 'You are not assigned to this delivery challan' };
}

// GET /my-deliveries — the logged-in dispatch technician's active DCs.
exports.getMyDeliveries = async (req, res) => {
  try {
    const techId = await resolveTechnicianId(req.user.user_id);
    // Match by technician_id (new flow) OR by user_id (legacy data where the
    // delivery_person_id stored the user id directly).
    const params = [techId || -1, req.user.user_id];
    const where = `WHERE d.status IN ('in_transit','reached')
                     AND (
                       d.delivery_person_id = $1
                       OR (
                         d.delivery_person_id = $2
                         AND NOT EXISTS (
                           SELECT 1
                             FROM delivery_technicians legacy_dt
                            WHERE legacy_dt.technician_id = d.delivery_person_id
                         )
                       )
                     )`;
    const items = await buildDcFlow(where, params, { includeOtp: false });
    res.json({ success: true, technician_id: techId, items });
  } catch (error) {
    console.error('getMyDeliveries:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /delivery-challans/:dcNumber/reached  { latitude, longitude }
exports.markTechReached = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const access = await checkAssignedDeliveryAccess(pool, dcNumber, req.user);
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const { latitude, longitude } = req.body || {};
    const upd = await pool.query(
      `UPDATE delivery_challan_lines
          SET status = 'reached', reached_at = NOW(),
              tech_latitude = $1, tech_longitude = $2, updated_at = NOW()
        WHERE dc_number = $3 AND status IN ('in_transit','reached')`,
      [latitude != null ? String(latitude) : null, longitude != null ? String(longitude) : null, dcNumber]
    );
    if (!upd.rowCount) {
      return res.status(400).json({ success: false, message: 'DC is not in a deliverable (in-transit) state' });
    }
    res.json({ success: true, otp_generated: false });
  } catch (error) {
    console.error('markTechReached:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /delivery-challans/:dcNumber/verify-serial  { serial_number }
exports.verifySerialAndGenerateOtp = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const access = await checkAssignedDeliveryAccess(pool, dcNumber, req.user);
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const input = String(req.body?.serial_number || '').trim();
    if (!input) {
      return res.status(400).json({ success: false, message: 'serial_number is required' });
    }

    const linesRes = await pool.query(
      `SELECT * FROM delivery_challan_lines WHERE dc_number = $1`,
      [dcNumber]
    );
    if (!linesRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const first = linesRes.rows[0];

    // Match input against any serial / ttspl in the DC.
    const entries = linesRes.rows.flatMap(serialEntriesForLine);
    const specs = await resolveSpecs(entries);
    const norm = (v) => String(v || '').trim().toLowerCase();
    const matched = entries.find((e) =>
      norm(e.serialNumber) === norm(input)
      || norm(e.ttsplId) === norm(input)
      || specs.some((s) =>
        (e.serialId && s.serial_id === e.serialId)
        && (norm(s.serial_number) === norm(input) || norm(s.inventory_asset_code) === norm(input))));

    if (!matched) {
      return res.status(400).json({
        success: false,
        message: 'Serial does not match any laptop on this delivery challan',
      });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await pool.query(
      `UPDATE delivery_challan_lines
          SET otp_code = $1, otp_sent_at = NOW(), otp_verified_at = NULL,
              serial_verified_at = NOW(), serial_verified_no = $2, updated_at = NOW()
        WHERE dc_number = $3`,
      [otp, matched.serialNumber || matched.ttsplId || input, dcNumber]
    );

    const spec = specs.find((s) =>
      (matched.serialId && s.serial_id === matched.serialId)
      || (matched.serialNumber && s.serial_number === matched.serialNumber)) || {};
    const ttspl = spec.inventory_asset_code || matched.ttsplId || matched.serialNumber;
    const config = [spec.brand, spec.model, spec.processor, spec.generation, spec.ram, spec.storage]
      .filter(Boolean).join(' ');
    const shipping = parseJson(first.customer_shipping_address, {}) || {};
    const addressText = [shipping.address, shipping.city, shipping.state, shipping.pincode]
      .filter(Boolean).join(', ');

    const salesEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    if (salesEmail) {
      try {
        await emailDocument({
          to: salesEmail,
          subject: `Delivery OTP — ${dcNumber} — ${first.customer_name || ''}`.trim(),
          text:
            `DC: ${dcNumber}\n`
            + `Customer: ${first.customer_name || ''}\n`
            + `Address: ${addressText || '—'}\n`
            + `Laptop: ${ttspl} ${config}\n\n`
            + `OTP: ${otp}\n\n`
            + `(Share this OTP verbally with the customer at delivery.)`,
          pdfRelativePath: null,
        });
      } catch (mailErr) {
        console.error('OTP email failed:', mailErr.message);
      }
    }

    const isAdmin = ADMIN_ROLES.includes(req.user.role);
    if (isAdmin) {
      return res.json({ success: true, otp_visible: otp, message: 'OTP generated and emailed to sales.' });
    }
    res.json({ success: true, message: 'OTP sent. Ask the customer for the OTP.' });
  } catch (error) {
    console.error('verifySerialAndGenerateOtp:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Persist a base64 data-URL signature to uploads/pod and return its public path. */
function saveEsign(dcNumber, dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const filename = `esign_${dcNumber}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(podDir, filename), Buffer.from(m[2], 'base64'));
  return `pod/${filename}`;
}

// POST /delivery-challans/:dcNumber/deliver  (multipart: otp, pod_type, pod_photo|esign_data, notes)
exports.submitDeliveryWithPod = async (req, res) => {
  const client = await pool.connect();
  try {
    const dcNumber = req.params.dcNumber;
    const body = req.body || {};
    const otp = String(body.otp || '').trim();

    const access = await checkAssignedDeliveryAccess(client, dcNumber, req.user);
    if (!access.allowed) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    // Aggregate across all DC lines: only "already delivered" when every line is
    // delivered. Pull the OTP from a line that still needs delivering.
    const agg = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered
         FROM delivery_challan_lines WHERE dc_number = $1`,
      [dcNumber]
    );
    if (!agg.rows[0].total) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    if (agg.rows[0].delivered === agg.rows[0].total) {
      return res.status(409).json({ success: false, message: 'DC already delivered' });
    }
    const otpRes = await client.query(
      `SELECT otp_code, otp_verified_at, status FROM delivery_challan_lines
        WHERE dc_number = $1 AND status <> 'delivered'
        ORDER BY id ASC LIMIT 1`,
      [dcNumber]
    );
    const dc = otpRes.rows[0] || {};
    if (!dc.otp_code) {
      return res.status(400).json({ success: false, message: 'Verify the laptop serial to generate an OTP first' });
    }
    if (!otp || otp !== String(dc.otp_code)) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    let podPhotoUrl = null;
    let esignUrl = null;
    if (req.file) {
      podPhotoUrl = `pod/${req.file.filename}`;
    }
    if (body.esign_data) {
      esignUrl = saveEsign(dcNumber, body.esign_data);
    }
    const podType = body.pod_type || (esignUrl ? 'esign' : podPhotoUrl ? 'photo' : 'none');

    await client.query('BEGIN');
    await client.query(
      `UPDATE delivery_challan_lines
          SET status = 'delivered', delivered_at = NOW(), delivery_completed_at = NOW(),
              otp_verified_at = NOW(),
              pod_type = $1, pod_photo_url = COALESCE($2, pod_photo_url),
              esign_url = COALESCE($3, esign_url),
              pod_submitted_at = NOW(), pod_submitted_by = $4,
              delivery_notes = $5, delivered_by = $4, updated_at = NOW()
        WHERE dc_number = $6 AND status <> 'delivered'`,
      [podType, podPhotoUrl, esignUrl, req.user.user_id, body.notes || null, dcNumber]
    );

    await sm.finalizeDeliveryInventory(client, dcNumber, req.user);
    await client.query('COMMIT');

    const salesEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    if (salesEmail) {
      const podLink = podPhotoUrl || esignUrl;
      emailDocument({
        to: salesEmail,
        subject: `Delivery confirmed — ${dcNumber}`,
        text:
          `Delivery confirmed for ${dcNumber}\n`
          + `Delivered at: ${new Date().toLocaleString('en-IN')}\n`
          + (podLink ? `POD: /uploads/${podLink}\n` : 'POD: none\n'),
        pdfRelativePath: null,
      }).catch((e) => console.error('Delivery confirm email failed:', e.message));
    }

    res.json({ success: true, message: 'Delivery confirmed' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('submitDeliveryWithPod:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

// PATCH /delivery-challans/:dcNumber/admin-deliver  (multipart: pod_photo*, notes, reason)
// Admin override still requires a POD photo of the delivered laptop.
exports.adminDeliverOverride = async (req, res) => {
  const client = await pool.connect();
  try {
    const dcNumber = req.params.dcNumber;
    const body = req.body || {};
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'POD photo is required. Please upload a photo of the delivered laptop.',
      });
    }
    const podPhotoUrl = `pod/${req.file.filename}`;
    // A DC can have multiple lines; only treat it as fully delivered when EVERY
    // line is delivered. A LIMIT 1 check would falsely report "already delivered"
    // for a partially-delivered DC (some lines still in transit).
    const r = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered
         FROM delivery_challan_lines WHERE dc_number = $1`,
      [dcNumber]
    );
    if (!r.rows[0].total) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    if (r.rows[0].delivered === r.rows[0].total) {
      return res.status(409).json({ success: false, message: 'DC already delivered' });
    }

    await client.query('BEGIN');
    // Only mark the lines that are not yet delivered so already-delivered lines
    // keep their original POD / timestamps.
    await client.query(
      `UPDATE delivery_challan_lines
          SET status = 'delivered', delivered_at = NOW(), delivery_completed_at = NOW(),
              pod_type = 'admin_override', pod_photo_url = $1,
              pod_submitted_at = NOW(), pod_submitted_by = $2, delivered_by = $2,
              delivery_notes = $3, updated_at = NOW()
        WHERE dc_number = $4 AND status <> 'delivered'`,
      [podPhotoUrl, req.user.user_id, [body.reason, body.notes].filter(Boolean).join(' — ') || null, dcNumber]
    );
    await sm.finalizeDeliveryInventory(client, dcNumber, req.user);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Delivery confirmed (admin override)' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('adminDeliverOverride:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.podUploadDir = podDir;
