const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('../services/customerDeployedAssets');
const { validateIndianMobile, normalizeIndianMobile } = require('../utils/phoneValidation');
const portalSvc = require('../services/customerPortalService');
const supportRequestCtrl = require('./supportRequestController');

/**
 * Document numbers arrive percent-encoded (SO%2F26-27%2F1023) and are sometimes
 * double-encoded by proxies, so decode until stable.
 */
function decodeDocNumber(raw) {
  let s = String(raw ?? '').trim();
  for (let i = 0; i < 3; i += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      break;
    }
    if (decoded === s) break;
    s = decoded;
  }
  return s;
}

/** Query params shared by the filtered list endpoints. */
function listFilters(query = {}) {
  return {
    page: query.page,
    limit: query.limit,
    search: (query.search || '').trim(),
    date_from: query.date_from || '',
    date_to: query.date_to || '',
  };
}

const PORTAL_ITEM_TYPE_MAP = {
  'Replacement Request': 'replacement',
  'Return Request': 'pickup',
  complaint: 'complaint',
  replacement: 'replacement',
  pickup: 'pickup',
  loan: 'loan',
};

function mapPortalTicketType(raw) {
  if (!raw) return 'complaint';
  const key = String(raw).trim();
  return PORTAL_ITEM_TYPE_MAP[key] || 'complaint';
}

function generateToken() {
  return crypto.randomBytes(48).toString('hex');
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += chars[crypto.randomInt(0, chars.length)];
  }
  return out;
}

async function createSession(customerId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO customer_portal_sessions (customer_id, token, expires_at) VALUES ($1, $2, $3)`,
    [customerId, token, expiresAt]
  );
  return { token, expiresAt };
}

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const result = await pool.query(
      `SELECT customer_id, name, company_name, email, portal_enabled, portal_password_hash
       FROM customers WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email.trim()]
    );

    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const row = result.rows[0];
    if (!row.portal_enabled) {
      return res.status(403).json({ success: false, message: 'Portal access disabled' });
    }
    if (!row.portal_password_hash) {
      return res.status(403).json({ success: false, message: 'Portal access disabled' });
    }

    const valid = await bcrypt.compare(password, row.portal_password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    await pool.query(`DELETE FROM customer_portal_sessions WHERE customer_id = $1`, [row.customer_id]);
    const session = await createSession(row.customer_id);
    await pool.query(`UPDATE customers SET portal_last_login = NOW() WHERE customer_id = $1`, [row.customer_id]);

    res.json({
      success: true,
      token: session.token,
      customer: {
        customer_id: row.customer_id,
        name: row.name,
        company_name: row.company_name,
        email: row.email,
      },
    });
  } catch (err) {
    console.error('customerPortal login:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.logout = async (req, res) => {
  try {
    if (req.portalToken) {
      await pool.query(`DELETE FROM customer_portal_sessions WHERE token = $1`, [req.portalToken]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.me = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT customer_id, name, company_name, email, phone, gst_no AS gst_number,
              billing_address, billing_city, billing_state, billing_pincode,
              shipping_same, shipping_address, shipping_city, shipping_state, shipping_pincode,
              kyc_verified, portal_last_login, whatsapp_number, pan_number
       FROM customers WHERE customer_id = $1`,
      [req.customer.customer_id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    res.json({
      success: true,
      ...result.rows[0],
      // Lets the portal show an "admin preview" banner and hide write actions
      // that the server would reject anyway.
      impersonated: Boolean(req.portalImpersonatedBy),
      read_only: Boolean(req.portalImpersonatedBy),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /laptops?lifecycle=active|returned&search=&date_from=&date_to=&page=&limit=
exports.listLaptops = async (req, res) => {
  const customerId = req.customer.customer_id;
  try {
    const { laptops, pagination } = await portalSvc.listCustomerLaptops(customerId, {
      ...listFilters(req.query),
      lifecycle: req.query.lifecycle || 'active',
    });
    return res.json({
      success: true,
      pagination,
      laptops: laptops.map((row) => ({
        ttspl_id: row.ttspl_id || null,
        serial_number: row.serial_number || null,
        brand: row.brand || null,
        model: row.model_name || null,
        config: row.config,
        processor: row.processor || null,
        generation: row.generation || null,
        ram: row.ram || null,
        storage: row.storage || null,
        dispatch_date: row.dispatch_date,
        delivered_at: row.delivered_at || null,
        returned_at: row.returned_at || null,
        monthly_rate: parseFloat(row.rent_monthly_rate || 0),
        dc_number: row.dc_number || null,
        status: row.status || 'active',
        lifecycle: row.lifecycle || 'active',
      })),
    });
  } catch (err) {
    // Older databases can miss columns the shared asset query relies on; fall
    // back to the portal's own narrower query rather than failing the page.
    console.warn('customerPortal listLaptops (shared query):', err.message);
  }

  try {
    let rows = [];
    try {
      const held = await pool.query(
        `SELECT COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
                vsn.extra->>'brand' AS brand,
                COALESCE(vsn.extra->>'model', vsn.extra->>'model_name') AS model,
                vsn.extra->>'processor' AS processor,
                vsn.extra->>'generation' AS generation,
                vsn.extra->>'ram' AS ram,
                vsn.extra->>'storage' AS storage,
                vsn.current_dc_number AS dc_number,
                vsn.delivered_at AS dispatch_date,
                vsn.inventory_status AS status,
                vsn.rent_monthly_rate AS monthly_rate
           FROM vendor_serial_numbers vsn
          WHERE vsn.current_customer_id = $1
            AND vsn.deleted_at IS NULL
            AND vsn.inventory_status = ANY($2::text[])
          ORDER BY vsn.delivered_at DESC NULLS LAST`,
        [customerId, DEPLOYED_WITH_CUSTOMER_STATUSES]
      );
      rows = held.rows;
    } catch (heldErr) {
      console.warn('customerPortal listLaptops (derived):', heldErr.message);
    }

    if (!rows.length) {
      const dc = await pool.query(
        `SELECT DISTINCT ON (dcl.id)
           COALESCE(vsn.inventory_asset_code, dcl.serial_number::text) AS ttspl_id,
           dcl.brand,
           dcl.model_name AS model,
           dcl.dc_number,
           COALESCE(dcl.delivered_at, dcl.created_at) AS dispatch_date,
           dcl.status,
           sol.rate AS monthly_rate,
           sol.processor,
           sol.ram,
           sol.storage,
           sol.generation
         FROM delivery_challan_lines dcl
         LEFT JOIN sales_order_lines sol
           ON sol.sales_order_number = dcl.sales_order_number AND sol.brand = dcl.brand
         LEFT JOIN vendor_serial_numbers vsn
           ON vsn.deleted_at IS NULL
           AND (
             vsn.inventory_asset_code = (dcl.serial_number::jsonb->>0)
             OR vsn.serial_number = (dcl.serial_number::jsonb->>0)
           )
         WHERE dcl.customer_id = $1 AND dcl.status = 'delivered'
         ORDER BY dcl.id, dcl.created_at DESC`,
        [customerId]
      );
      rows = dc.rows;
    }

    const laptops = rows.map((row) => ({
      ttspl_id: row.ttspl_id || null,
      brand: row.brand || null,
      model: row.model,
      config: [row.processor, row.generation, row.ram, row.storage].filter(Boolean).join(' | '),
      dispatch_date: row.dispatch_date,
      monthly_rate: parseFloat(row.monthly_rate || 0),
      dc_number: row.dc_number || null,
      status: row.status || 'active',
    }));

    res.json({ success: true, laptops });
  } catch (err) {
    console.error('customerPortal listLaptops:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /orders?search=&date_from=&date_to=&order_type=&order_status=&delivery_status=&page=&limit=
exports.listOrders = async (req, res) => {
  try {
    const result = await portalSvc.listCustomerOrders(req.customer.customer_id, {
      ...listFilters(req.query),
      order_type: req.query.order_type || '',
      order_status: req.query.order_status || '',
      delivery_status: req.query.delivery_status || '',
      entity_scope: req.query.entity_scope || '',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('customerPortal listOrders:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /orders/:soNumber — 404s for any order that is not this customer's.
exports.getOrder = async (req, res) => {
  try {
    const order = await portalSvc.getCustomerOrder(
      req.customer.customer_id,
      decodeDocNumber(req.params[0] ?? req.params.soNumber)
    );
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, order });
  } catch (err) {
    console.error('customerPortal getOrder:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /dashboard — the KPI counts behind the dashboard cards.
exports.getDashboard = async (req, res) => {
  try {
    const kpis = await portalSvc.getCustomerDashboard(req.customer.customer_id);
    res.json({ success: true, kpis });
  } catch (err) {
    console.error('customerPortal getDashboard:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listInvoices = async (req, res) => {
  try {
    const customerId = req.customer.customer_id;
    const params = [customerId];
    let where = 'customer_id = $1';
    if (req.query.status) {
      params.push(req.query.status);
      where += ` AND status = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT invoice_id, invoice_number, invoice_month, invoice_year,
              from_date, to_date, grand_total, status, irn, qr_code_url,
              pdf_path, sent_at, paid_at, gst_amount, subtotal
       FROM customer_invoices
       WHERE ${where}
       ORDER BY invoice_year DESC, invoice_month DESC`,
      params
    );
    res.json({ success: true, invoices: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM customer_invoices
       WHERE invoice_id = $1 AND customer_id = $2`,
      [req.params.invoiceId, req.customer.customer_id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    res.json({ success: true, invoice: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.downloadInvoicePdf = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT invoice_id, pdf_path, invoice_number FROM customer_invoices
       WHERE invoice_id = $1 AND customer_id = $2`,
      [req.params.invoiceId, req.customer.customer_id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const invoice = result.rows[0];
    if (!invoice.pdf_path) {
      return res.status(404).json({ success: false, message: 'PDF not generated yet' });
    }
    const abs = path.join(__dirname, '..', invoice.pdf_path);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ success: false, message: 'PDF file missing' });
    }
    res.download(abs, `${invoice.invoice_number}.pdf`);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listCreditNotes = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT credit_note_id, credit_note_number, reason, description, amount, status,
              created_at, from_date, to_date, quantity, unit_rate, ttspl_ids,
              return_ticket_id, applied_in_invoice_id
       FROM customer_credit_notes
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [req.customer.customer_id]
    );
    res.json({ success: true, credit_notes: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /deliveries?search=&status=&date_from=&date_to=&page=&limit=
exports.listDeliveries = async (req, res) => {
  try {
    const { deliveries, pagination } = await portalSvc.listCustomerDeliveries(
      req.customer.customer_id,
      { ...listFilters(req.query), status: req.query.status || '' }
    );
    res.json({
      success: true,
      pagination,
      deliveries: deliveries.map((d) => ({ ...d, so_number: d.sales_order_number })),
    });
  } catch (err) {
    console.error('customerPortal listDeliveries:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /deliveries/:dcNumber — challan tracking for this customer's own DC.
exports.getDelivery = async (req, res) => {
  try {
    const delivery = await portalSvc.getCustomerDelivery(
      req.customer.customer_id,
      decodeDocNumber(req.params[0] ?? req.params.dcNumber)
    );
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    res.json({ success: true, delivery });
  } catch (err) {
    console.error('customerPortal getDelivery:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.raiseTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    const { subject, description, ticket_type, ttspl_id, photos, pickup_address } = req.body || {};
    if (!subject || !description || description.length < 20) {
      return res.status(400).json({ success: false, message: 'Subject and description (min 20 chars) required' });
    }
    if (pickup_address?.phone != null && String(pickup_address.phone).trim()) {
      const phoneError = validateIndianMobile(pickup_address.phone, { label: 'Pickup phone' });
      if (phoneError) return res.status(400).json({ success: false, message: phoneError });
      pickup_address.phone = normalizeIndianMobile(pickup_address.phone);
    }

    const customerId = req.customer.customer_id;
    const category = mapPortalTicketType(ticket_type);
    const custRes = await client.query(
      `SELECT customer_id, name, company_name, email, phone FROM customers WHERE customer_id = $1`,
      [customerId]
    );
    const cust = custRes.rows[0];

    let dcNumber = null;
    let specs = {};
    let assetSerial = null;
    if (ttspl_id) {
      // The device must currently be deployed with this customer, otherwise a
      // portal user could raise a ticket against somebody else's laptop and read
      // its specs back out of the response.
      const asset = await portalSvc.findCustomerAsset(customerId, ttspl_id);
      if (!asset) {
        return res.status(400).json({
          success: false,
          message: 'That laptop is not registered against your account',
        });
      }
      dcNumber = asset.dc_number || null;
      assetSerial = asset.serial_number || null;
      const ex = asset.extra || {};
      specs = {
        brand: asset.brand || ex.brand || null,
        model: asset.model_name || ex.model || ex.model_name || null,
        ram: asset.ram || ex.ram || null,
        storage: asset.storage || ex.storage || null,
        generation: asset.generation || ex.generation || null,
      };
    }

    // A return is a pickup, and pickups are reviewed before anything is
    // committed to the warehouse. Park it in the same queue the public form
    // uses; Support converts it into the ticket and Return DC.
    if (category === 'pickup') {
      if (!ttspl_id) {
        return res.status(400).json({
          success: false,
          message: 'Select the laptop you want to return',
        });
      }
      const addr = pickup_address && typeof pickup_address === 'object' ? pickup_address : null;
      if (!addr?.address || !addr?.city || !addr?.pincode) {
        return res.status(400).json({
          success: false,
          message: 'Pickup address needs at least address, city and pincode',
        });
      }
      const pocPhone = normalizeIndianMobile(addr.phone || cust.phone || '');
      const pocError = validateIndianMobile(pocPhone, {
        required: true,
        label: 'Pickup contact number',
      });
      if (pocError) {
        return res.status(400).json({ success: false, message: pocError });
      }

      const conflict = await supportRequestCtrl.findConflictingSupportWork(client, ttspl_id);
      if (conflict) {
        const { status, ...body } = conflict;
        return res.status(status).json({ success: false, ...body });
      }

      const extra = {
        devices: [ttspl_id],
        machines: [{
          serial_number: assetSerial,
          unique_serial_number: ttspl_id,
          ttspl_id,
        }],
        pickup_address: { ...addr, phone: pocPhone },
        mobile_is_poc: false,
        portal_customer_id: customerId,
      };

      const reqRes = await client.query(
        `INSERT INTO support_requests (
           customer_name, mobile_number, company_name, issue_description,
           device_serial, source, status, matched_customer_id, request_type, extra
         ) VALUES ($1,$2,$3,$4,$5,'portal','pending',$6,'pickup',$7::jsonb)
         RETURNING id, created_at`,
        [
          cust.company_name || cust.name,
          pocPhone,
          cust.company_name || null,
          `${subject}\n\n${description}`,
          ttspl_id,
          customerId,
          JSON.stringify(extra),
        ]
      );
      const request = reqRes.rows[0];

      return res.status(201).json({
        success: true,
        request_id: request.id,
        request_reference: `SR-${request.id}`,
        request_type: 'pickup',
        created_at: request.created_at,
        message: 'Your return request has been submitted. Our team will review it and arrange pickup.',
      });
    }

    await client.query('BEGIN');
    const ticketRes = await client.query(
      `INSERT INTO support_tickets (
         customer_id, customer_name, customer_phone, status, last_activity_at,
         priority, top_level_remarks, ticket_email, ticket_category,
         ttspl_id, dc_number, customer_portal_ticket, portal_customer_id, pickup_address
       ) VALUES ($1,$2,$3,'open',NOW(),'normal',$4,$5,$6,$7,$8,TRUE,$9,$10::jsonb)
       RETURNING id`,
      [
        customerId,
        cust.company_name || cust.name,
        cust.phone || null,
        `${subject}\n\n${description}`,
        cust.email,
        category,
        ttspl_id || null,
        dcNumber,
        customerId,
        pickup_address ? JSON.stringify(pickup_address) : null,
      ]
    );
    const ticketId = ticketRes.rows[0].id;

    await client.query(
      `INSERT INTO support_ticket_items (
         ticket_id, serial_number, unique_serial_number, ttspl_id, item_type,
         issue_category_label, remarks, status, otp_code,
         brand, model, ram, storage, generation
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11,$12,$13)`,
      [
        ticketId,
        assetSerial || ttspl_id || null,
        ttspl_id || null,
        ttspl_id || null,
        category,
        ticket_type || subject,
        description,
        Math.floor(100000 + Math.random() * 900000).toString(),
        specs.brand, specs.model, specs.ram, specs.storage, specs.generation,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      ticket_id: ticketId,
      ticket_number: `T-${ticketId}`,
      photos_received: Array.isArray(photos) ? photos.length : 0,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('raiseTicket:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// GET /support-requests — submissions still awaiting Support review.
exports.listPendingRequests = async (req, res) => {
  try {
    const requests = await portalSvc.listCustomerPendingRequests(req.customer.customer_id);
    res.json({ success: true, requests });
  } catch (err) {
    console.error('listPendingRequests:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /tickets?search=&ttspl=&serial=&ticket_type=&status=&stage=&date_from=&date_to=&page=&limit=
exports.listTickets = async (req, res) => {
  try {
    const { tickets, pagination } = await portalSvc.listCustomerTickets(
      req.customer.customer_id,
      {
        ...listFilters(req.query),
        ttspl: (req.query.ttspl || '').trim(),
        serial: (req.query.serial || '').trim(),
        ticket_type: req.query.ticket_type || '',
        status: req.query.status || '',
        stage: req.query.stage || '',
      }
    );
    res.json({
      success: true,
      pagination,
      // `type` is kept alongside `ticket_type` for the older portal ticket list.
      tickets: tickets.map((t) => ({ ...t, type: t.ticket_type })),
      stages: portalSvc.CUSTOMER_STAGE_LABELS,
    });
  } catch (err) {
    console.error('customerPortal listTickets:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /tickets/:ticketId — customer-facing progress only.
exports.getTicket = async (req, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    if (!Number.isInteger(ticketId)) {
      return res.status(400).json({ success: false, message: 'Invalid ticket id' });
    }
    const ticket = await portalSvc.getCustomerTicket(req.customer.customer_id, ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    res.json({ success: true, ticket });
  } catch (err) {
    console.error('customerPortal getTicket:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password || new_password.length < 6) {
      return res.status(400).json({ success: false, message: 'Valid current and new password required' });
    }

    const result = await pool.query(
      `SELECT portal_password_hash FROM customers WHERE customer_id = $1`,
      [req.customer.customer_id]
    );
    if (!result.rows.length || !result.rows[0].portal_password_hash) {
      return res.status(400).json({ success: false, message: 'No portal password set' });
    }

    const valid = await bcrypt.compare(current_password, result.rows[0].portal_password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await pool.query(
      `UPDATE customers SET portal_password_hash = $1, updated_at = NOW() WHERE customer_id = $2`,
      [hash, req.customer.customer_id]
    );
    try {
      const { upsertCredential } = require('../services/authCredentialsService');
      await upsertCredential({
        email: req.customer.email,
        passwordHash: hash,
        portal: 'customer',
        entityId: req.customer.customer_id,
        enabled: true,
      });
    } catch (syncErr) {
      console.warn('auth_credentials sync (customer change password):', syncErr.message);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.generateTempPassword = generateTempPassword;
