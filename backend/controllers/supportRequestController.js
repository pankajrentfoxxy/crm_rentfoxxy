const pool = require('../config/db');
const { validateIndianMobile, normalizeIndianMobile } = require('../utils/phoneValidation');
const {
  SUPPORT_TICKET_ELIGIBLE_STATUSES,
  checkSerialEligibleForSupportTicket,
} = require('../services/supportSerialEligibility');

/** Match Support CRM create form address display (shipping preferred). */
function formatTicketAddress(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    if (s.startsWith('{')) {
      try {
        return formatTicketAddress(JSON.parse(s));
      } catch {
        return s;
      }
    }
    return s;
  }
  if (typeof value === 'object') {
    const line1 = [value.address, value.line1, value.line2, value.landmark].filter(Boolean).join(', ');
    const cityState = [value.city, value.state].filter(Boolean).join(', ');
    const pin = value.pincode || value.pin || value.zip_code || value.postal;
    const mid = [line1, cityState].filter(Boolean).join(', ');
    if (pin) return mid ? `${mid} — ${pin}` : String(pin);
    return mid || null;
  }
  return String(value);
}

async function findCustomerByMobile(client, mobile) {
  if (!mobile) return null;
  const r = await client.query(
    `SELECT customer_id, name, company_name, phone, email
       FROM customers
      WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE '%' || $1
      ORDER BY customer_id DESC
      LIMIT 5`,
    [mobile]
  );
  return r.rows;
}

/**
 * Resolve TTSPL / serial from customer-deployed inventory (customer bucket).
 * Returns serial + customer or null if not deployed with a customer.
 */
async function resolveDeployedTtspl(client, rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return null;

  const r = await client.query(
    `SELECT vsn.serial_id,
            vsn.serial_number,
            vsn.inventory_asset_code,
            vsn.inventory_status,
            vsn.current_customer_id,
            vsn.delivered_at,
            c.customer_id,
            c.name AS customer_name,
            c.company_name,
            c.phone AS customer_phone,
            c.email AS customer_email,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id', vsn.serial_number) AS ttspl_id
       FROM vendor_serial_numbers vsn
       LEFT JOIN customers c ON c.customer_id = vsn.current_customer_id
      WHERE vsn.deleted_at IS NULL
        AND (
          UPPER(TRIM(vsn.inventory_asset_code)) = UPPER(TRIM($1))
          OR UPPER(TRIM(vsn.serial_number)) = UPPER(TRIM($1))
          OR UPPER(TRIM(COALESCE(vsn.extra->>'ttspl_id', ''))) = UPPER(TRIM($1))
        )
      ORDER BY
        CASE WHEN UPPER(TRIM(vsn.inventory_asset_code)) = UPPER(TRIM($1)) THEN 0 ELSE 1 END,
        vsn.serial_id ASC
      LIMIT 1`,
    [code]
  );
  return r.rows[0] || null;
}

/** Any open (non-closed/cancelled) support ticket item for this laptop. */
async function findOpenTicketForTtspl(client, code) {
  const r = await client.query(
    `SELECT t.id, t.status, t.customer_id, i.item_type, i.status AS item_status
       FROM support_ticket_items i
       JOIN support_tickets t ON t.id = i.ticket_id
      WHERE t.status NOT IN ('closed', 'cancelled')
        AND i.status NOT IN ('resolved', 'closed', 'inventory_updated', 'cancelled')
        AND (
          UPPER(TRIM(COALESCE(i.ttspl_id, ''))) = UPPER(TRIM($1))
          OR UPPER(TRIM(COALESCE(i.unique_serial_number, ''))) = UPPER(TRIM($1))
          OR UPPER(TRIM(COALESCE(i.serial_number, ''))) = UPPER(TRIM($1))
        )
      ORDER BY t.id DESC
      LIMIT 1`,
    [code]
  );
  return r.rows[0] || null;
}

async function findPendingQrRequestForTtspl(client, code) {
  const r = await client.query(
    `SELECT id, status, created_at
       FROM support_requests
      WHERE status IN ('pending', 'reviewed')
        AND UPPER(TRIM(COALESCE(device_serial, ''))) = UPPER(TRIM($1))
      ORDER BY id DESC
      LIMIT 1`,
    [code]
  );
  return r.rows[0] || null;
}

/** Public — no auth. QR / universal link intake. */
exports.createPublicRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body || {};
    const customer_name = String(body.customer_name || '').trim();
    const company_name = String(body.company_name || '').trim() || null;
    const issue_description = String(body.issue_description || '').trim();
    const device_serial = String(body.device_serial || body.ttspl_id || '').trim();
    const mobileRaw = body.mobile_number || body.mobile;
    const mobileError = validateIndianMobile(mobileRaw, { required: true, label: 'Mobile number' });
    if (mobileError) {
      return res.status(400).json({ success: false, message: mobileError });
    }
    const mobile = normalizeIndianMobile(mobileRaw);

    if (!customer_name) {
      return res.status(400).json({ success: false, message: 'Customer name is required' });
    }
    if (!device_serial) {
      return res.status(400).json({
        success: false,
        message: 'TTSPL / device ID is required. Enter the TTSPL printed on your laptop.',
      });
    }
    if (!issue_description || issue_description.length < 10) {
      return res.status(400).json({ success: false, message: 'Please describe the issue (at least 10 characters)' });
    }

    const deployed = await resolveDeployedTtspl(client, device_serial);
    if (!deployed) {
      return res.status(404).json({
        success: false,
        message: `TTSPL ${device_serial} was not found in our system. Please check the ID and try again.`,
        code: 'ttspl_not_found',
      });
    }

    const st = String(deployed.inventory_status || '').toLowerCase();
    if (!deployed.current_customer_id || !deployed.customer_id) {
      return res.status(400).json({
        success: false,
        message: `TTSPL ${deployed.ttspl_id || device_serial} is not assigned to any customer. Support requests can only be raised for laptops currently with a customer.`,
        code: 'ttspl_not_in_customer_bucket',
      });
    }
    if (!SUPPORT_TICKET_ELIGIBLE_STATUSES.includes(st) || !deployed.delivered_at) {
      return res.status(400).json({
        success: false,
        message: `TTSPL ${deployed.ttspl_id || device_serial} is not in the customer bucket (status: ${st || 'unknown'}). It must be delivered to the customer before raising a support request.`,
        code: 'ttspl_not_in_customer_bucket',
      });
    }

    const ttsplCode = deployed.ttspl_id || device_serial;
    const openTicket = await findOpenTicketForTtspl(client, ttsplCode);
    if (openTicket) {
      return res.status(409).json({
        success: false,
        message: `A support ticket (T-${openTicket.id}) is already open for TTSPL ${ttsplCode}. Please wait until it is closed before submitting a new request.`,
        code: 'open_ticket_exists',
        ticket_id: openTicket.id,
      });
    }

    const pendingReq = await findPendingQrRequestForTtspl(client, ttsplCode);
    if (pendingReq) {
      return res.status(409).json({
        success: false,
        message: `A support request (#${pendingReq.id}) is already pending for TTSPL ${ttsplCode}. Our team will contact you shortly.`,
        code: 'pending_request_exists',
        request_id: pendingReq.id,
      });
    }

    // Light rate limit: same mobile + same TTSPL within 2 minutes
    const dup = await client.query(
      `SELECT id FROM support_requests
        WHERE mobile_number = $1
          AND UPPER(TRIM(COALESCE(device_serial, ''))) = UPPER(TRIM($2))
          AND created_at > NOW() - INTERVAL '2 minutes'
        LIMIT 1`,
      [mobile, ttsplCode]
    );
    if (dup.rows.length) {
      return res.status(200).json({
        success: true,
        message: 'Your request has been submitted. Our team will contact you shortly.',
        request_id: dup.rows[0].id,
        duplicate: true,
      });
    }

    const crmCompany = deployed.company_name || deployed.customer_name || null;
    const resolvedCompany = company_name || crmCompany;

    const ins = await client.query(
      `INSERT INTO support_requests (
         customer_name, mobile_number, company_name, issue_description,
         device_serial, source, status, matched_customer_id
       ) VALUES ($1,$2,$3,$4,$5,'qr','pending',$6)
       RETURNING id, created_at`,
      [
        customer_name,
        mobile,
        resolvedCompany,
        issue_description,
        ttsplCode,
        deployed.customer_id,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Your request has been submitted. Our team will contact you shortly.',
      request_id: ins.rows[0].id,
      created_at: ins.rows[0].created_at,
      customer: {
        customer_id: deployed.customer_id,
        name: deployed.customer_name,
        company_name: deployed.company_name,
      },
      ttspl_id: ttsplCode,
    });
  } catch (err) {
    console.error('createPublicRequest:', err);
    res.status(500).json({ success: false, message: 'Could not submit request. Please try again.' });
  } finally {
    client.release();
  }
};

/** Staff — list inbox */
exports.listRequests = async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const q = String(req.query.q || '').trim();
    const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const to = req.query.to ? String(req.query.to).slice(0, 10) : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const params = [];
    const where = [];
    if (status && status !== 'all') {
      params.push(status);
      where.push(`sr.status = $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`sr.created_at::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      where.push(`sr.created_at::date <= $${params.length}::date`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        sr.customer_name ILIKE $${params.length}
        OR sr.mobile_number ILIKE $${params.length}
        OR sr.company_name ILIKE $${params.length}
        OR sr.issue_description ILIKE $${params.length}
        OR COALESCE(sr.device_serial, '') ILIKE $${params.length}
        OR COALESCE(c.company_name, '') ILIKE $${params.length}
        OR COALESCE(c.name, '') ILIKE $${params.length}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);

    const r = await pool.query(
      `SELECT sr.*,
              st.id AS linked_ticket_id,
              c.company_name AS matched_company_name,
              c.name AS matched_customer_name,
              c.phone AS matched_customer_phone,
              COALESCE(NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(c.name), ''), sr.company_name) AS crm_customer_display
         FROM support_requests sr
         LEFT JOIN support_tickets st ON st.id = sr.ticket_id
         LEFT JOIN customers c ON c.customer_id = sr.matched_customer_id
         ${whereSql}
        ORDER BY
          CASE sr.status WHEN 'pending' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END,
          sr.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM support_requests sr
         LEFT JOIN customers c ON c.customer_id = sr.matched_customer_id
         ${whereSql}`,
      countParams
    );

    const pendingRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM support_requests WHERE status = 'pending'`
    );

    res.json({
      success: true,
      requests: r.rows,
      total: countRes.rows[0]?.n || 0,
      pending_count: pendingRes.rows[0]?.n || 0,
    });
  } catch (err) {
    console.error('listRequests:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const r = await pool.query(
      `SELECT sr.*,
              st.id AS linked_ticket_id,
              st.status AS ticket_status,
              c.company_name AS matched_company_name,
              c.name AS matched_customer_name,
              c.email AS matched_customer_email,
              c.phone AS matched_customer_phone,
              COALESCE(NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(c.name), ''), sr.company_name) AS crm_customer_display
         FROM support_requests sr
         LEFT JOIN support_tickets st ON st.id = sr.ticket_id
         LEFT JOIN customers c ON c.customer_id = sr.matched_customer_id
        WHERE sr.id = $1`,
      [id]
    );
    if (!r.rows.length) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const row = r.rows[0];
    const matches = await findCustomerByMobile(pool, row.mobile_number);
    if (row.matched_customer_id && !matches.some((m) => Number(m.customer_id) === Number(row.matched_customer_id))) {
      matches.unshift({
        customer_id: row.matched_customer_id,
        name: row.matched_customer_name,
        company_name: row.matched_company_name,
        phone: row.matched_customer_phone,
        email: row.matched_customer_email,
      });
    }

    res.json({ success: true, request: row, customer_matches: matches });
  } catch (err) {
    console.error('getRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateRequestStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').toLowerCase();
    if (!['pending', 'reviewed', 'dismissed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be pending, reviewed, or dismissed' });
    }
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const reviewerId = req.user?.user_id != null ? Number(req.user.user_id) : null;
    const notes = req.body?.notes != null ? String(req.body.notes) : null;
    const stampReview = status === 'reviewed' || status === 'dismissed';

    const r = await pool.query(
      `UPDATE support_requests
          SET status = $2::varchar(20),
              reviewed_by = $3::integer,
              reviewed_at = CASE WHEN $4::boolean THEN NOW() ELSE reviewed_at END,
              notes = COALESCE($5::text, notes),
              updated_at = NOW()
        WHERE id = $1::integer
          AND status <> 'converted'
        RETURNING *`,
      [id, status, reviewerId, stampReview, notes]
    );
    if (!r.rows.length) {
      return res.status(404).json({ success: false, message: 'Request not found or already converted' });
    }
    res.json({ success: true, request: r.rows[0] });
  } catch (err) {
    console.error('updateRequestStatus:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Convert QR request → support ticket (complaint).
 * Uses the same eligibility + open-ticket rules as CRM Support createTicket
 * so converted tickets land cleanly in the normal Support flow.
 * Body: { customer_id, priority?, ticket_category? }
 */
exports.convertToTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    let customerId = Number(req.body?.customer_id);
    const priority = ['normal', 'high', 'urgent'].includes(req.body?.priority) ? req.body.priority : 'normal';
    const category = ['complaint', 'replacement'].includes(req.body?.ticket_category)
      ? req.body.ticket_category
      : 'complaint';

    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'request id is required' });
    }

    await client.query('BEGIN');
    const reqRes = await client.query(
      `SELECT * FROM support_requests WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const row = reqRes.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (row.status === 'converted' && row.ticket_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Already converted',
        ticket_id: row.ticket_id,
      });
    }
    if (row.status === 'dismissed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Rejected requests cannot be converted to a ticket' });
    }

    const ttspl = String(row.device_serial || '').trim();
    if (!ttspl) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'This request has no TTSPL. Cannot create a support ticket without a deployed laptop.',
      });
    }

    // Prefer the customer already linked from QR verification (laptop bucket).
    if (row.matched_customer_id && !Number.isFinite(customerId)) {
      customerId = Number(row.matched_customer_id);
    }
    if (!Number.isFinite(customerId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'customer_id is required' });
    }

    const deployed = await resolveDeployedTtspl(client, ttspl);
    if (!deployed?.customer_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `TTSPL ${ttspl} is not in a customer bucket. Cannot create a support ticket.`,
        code: 'ttspl_not_in_customer_bucket',
      });
    }

    // Do not allow linking the wrong customer — same rule as Support ticket create.
    if (Number(deployed.customer_id) !== Number(customerId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `TTSPL ${ttspl} belongs to customer ${deployed.company_name || deployed.customer_name} (ID ${deployed.customer_id}). Select that customer to create the ticket.`,
        code: 'customer_mismatch',
        expected_customer_id: deployed.customer_id,
      });
    }

    const eligibility = await checkSerialEligibleForSupportTicket(
      client,
      customerId,
      { ttspl_id: ttspl, unique_serial_number: ttspl, serial_number: ttspl },
      { ticketCategory: category }
    );
    if (!eligibility.ok) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: eligibility.message,
        code: eligibility.code,
      });
    }

    const openTicket = await findOpenTicketForTtspl(client, ttspl);
    if (openTicket) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `TTSPL ${ttspl} already has open ticket T-${openTicket.id}. Close it before creating another.`,
        ticket_id: openTicket.id,
        code: 'open_ticket_exists',
      });
    }

    const custRes = await client.query(
      `SELECT customer_id, name, company_name, email, phone,
              shipping_address, billing_address, address
         FROM customers WHERE customer_id = $1`,
      [customerId]
    );
    if (!custRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const cust = custRes.rows[0];
    const ticketAddress = formatTicketAddress(
      cust.shipping_address || cust.billing_address || cust.address
    );
    const ticketEmail = cust.email || null;
    const ticketPhone = row.mobile_number || cust.phone || null;

    const serial = eligibility.serial || {};
    const exRes = await client.query(
      `SELECT extra, grn_received_config FROM vendor_serial_numbers
        WHERE serial_id = $1 OR (
          deleted_at IS NULL AND (
            inventory_asset_code = $2 OR serial_number = $2 OR extra->>'ttspl_id' = $2
          )
        )
        ORDER BY CASE WHEN serial_id = $1 THEN 0 ELSE 1 END
        LIMIT 1`,
      [serial.serial_id || null, ttspl]
    );
    const ex = { ...(exRes.rows[0]?.grn_received_config || {}), ...(exRes.rows[0]?.extra || {}) };
    const specs = {
      brand: ex.brand || null,
      model: ex.model || ex.model_name || null,
      ram: ex.ram || null,
      storage: ex.storage || null,
      generation: ex.generation || null,
      processor: ex.processor || null,
    };

    // Customer-facing issue only — meta stays on the support_request row.
    const issueRemarks = String(row.issue_description || '').trim();

    // Same shape as CRM createTicket (complaint, open, unassigned) + autofilled address/contact.
    const ticketRes = await client.query(
      `INSERT INTO support_tickets (
         customer_id, customer_name, customer_phone, status, created_by, last_activity_at,
         priority, top_level_remarks, ticket_phone_override, ticket_email, ticket_address,
         ticket_category, ttspl_id, customer_portal_ticket
       ) VALUES ($1,$2,$3,'open',$4,NOW(),$5,$6,$7,$8,$9,$10,$11,FALSE)
       RETURNING id`,
      [
        customerId,
        cust.company_name || cust.name || row.customer_name,
        ticketPhone,
        req.user?.user_id || null,
        priority,
        issueRemarks,
        ticketPhone,
        ticketEmail,
        ticketAddress,
        category,
        ttspl,
      ]
    );
    const ticketId = ticketRes.rows[0].id;

    await client.query(
      `INSERT INTO support_ticket_items (
         ticket_id, serial_number, unique_serial_number, ttspl_id, item_type,
         issue_category_label, remarks, status, otp_code,
         brand, model, ram, storage, generation, processor
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11,$12,$13,$14)`,
      [
        ticketId,
        serial.serial_number || ttspl,
        ttspl,
        ttspl,
        category,
        'QR support request',
        issueRemarks,
        String(Math.floor(100000 + Math.random() * 900000)),
        specs.brand,
        specs.model,
        specs.ram,
        specs.storage,
        specs.generation,
        specs.processor,
      ]
    );

    // Best-effort audit (same table as Support CRM).
    try {
      await client.query(
        `INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail)
         VALUES (NULL, $1, $2, 'ticket_created', $3::jsonb)`,
        [
          ticketId,
          req.user?.user_id || null,
          JSON.stringify({
            customer_id: customerId,
            ticket_category: category,
            source: 'qr_support_request',
            support_request_id: row.id,
            ttspl_id: ttspl,
          }),
        ]
      );
    } catch (auditErr) {
      console.warn('convertToTicket audit skipped:', auditErr.message);
    }

    await client.query(
      `UPDATE support_requests
          SET status = 'converted',
              ticket_id = $2,
              matched_customer_id = $3,
              converted_by = $4,
              converted_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [id, ticketId, customerId, req.user?.user_id || null]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      ticket_id: ticketId,
      ticket_number: `T-${ticketId}`,
      message: `Ticket T-${ticketId} created — opens in Support like a normal complaint ticket`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('convertToTicket:', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

exports.pendingCount = async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM support_requests WHERE status = 'pending'`
    );
    res.json({ success: true, pending_count: r.rows[0]?.n || 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
