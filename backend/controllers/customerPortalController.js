const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

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
    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listLaptops = async (req, res) => {
  try {
    const customerId = req.customer.customer_id;
    let rows = [];

    // Authoritative source: assets currently held by this customer per the
    // inventory state machine (customer_inventory is deprecated).
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
            AND vsn.inventory_status IN ('rented','on_demo','sold')
          ORDER BY vsn.delivered_at DESC NULLS LAST`,
        [customerId]
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

exports.listOrders = async (req, res) => {
  try {
    const customerId = req.customer.customer_id;
    const result = await pool.query(
      `SELECT sales_order_number,
              MIN(created_at) AS order_date,
              MAX(quotation_type) AS quotation_type,
              COUNT(*)::int AS line_count,
              COALESCE(SUM(rate * quantity), 0) AS total_value,
              MAX(status) AS status
       FROM sales_order_lines
       WHERE customer_id = $1
       GROUP BY sales_order_number
       ORDER BY MIN(created_at) DESC`,
      [customerId]
    );
    res.json({
      success: true,
      orders: result.rows.map((r) => ({
        sales_order_number: r.sales_order_number,
        date: r.order_date,
        type: r.quotation_type,
        laptops: r.line_count,
        total_value: parseFloat(r.total_value || 0),
        status: r.status,
      })),
    });
  } catch (err) {
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

exports.listDeliveries = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (dc_number)
         dc_number, sales_order_number AS so_number, created_at AS dispatch_date,
         dispatch_mode, status, delivered_at, awb_number, courier_name, estimated_delivery
       FROM delivery_challan_lines
       WHERE customer_id = $1
       ORDER BY dc_number, created_at DESC`,
      [req.customer.customer_id]
    );
    res.json({ success: true, deliveries: result.rows });
  } catch (err) {
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

    const customerId = req.customer.customer_id;
    const category = mapPortalTicketType(ticket_type);
    const custRes = await client.query(
      `SELECT customer_id, name, company_name, email, phone FROM customers WHERE customer_id = $1`,
      [customerId]
    );
    const cust = custRes.rows[0];

    let dcNumber = null;
    let specs = {};
    if (ttspl_id) {
      const dcRes = await client.query(
        `SELECT dc_number FROM delivery_challan_lines dcl
         LEFT JOIN vendor_serial_numbers vsn ON vsn.deleted_at IS NULL
           AND (vsn.inventory_asset_code = $2 OR vsn.serial_number = $2)
         WHERE dcl.customer_id = $1
         LIMIT 1`,
        [customerId, ttspl_id]
      );
      dcNumber = dcRes.rows[0]?.dc_number || null;

      // Pull specs so support (and the eventual return QC ticket) has device details.
      const sRes = await client.query(
        `SELECT extra FROM vendor_serial_numbers
         WHERE deleted_at IS NULL
           AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
         LIMIT 1`,
        [ttspl_id]
      );
      const ex = sRes.rows[0]?.extra || {};
      specs = { brand: ex.brand || null, model: ex.model || ex.model_name || null,
                ram: ex.ram || null, storage: ex.storage || null, generation: ex.generation || null };
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
         ticket_id, serial_number, unique_serial_number, item_type,
         issue_category_label, remarks, status, otp_code,
         brand, model, ram, storage, generation
       ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,$11,$12)`,
      [
        ticketId,
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

exports.listTickets = async (req, res) => {
  try {
    const customerId = req.customer.customer_id;
    let result;
    try {
      result = await pool.query(
        `SELECT id AS ticket_id,
                SPLIT_PART(COALESCE(top_level_remarks, ''), E'\n', 1) AS subject,
                ticket_category AS type,
                status,
                created_at,
                updated_at,
                ttspl_id
         FROM support_tickets
         WHERE portal_customer_id = $1
            OR (customer_id = $1 AND COALESCE(customer_portal_ticket, FALSE) = TRUE)
         ORDER BY created_at DESC`,
        [customerId]
      );
    } catch (colErr) {
      if (!String(colErr.message || '').includes('does not exist')) throw colErr;
      result = await pool.query(
        `SELECT id AS ticket_id,
                SPLIT_PART(COALESCE(top_level_remarks, ''), E'\n', 1) AS subject,
                ticket_category AS type,
                status,
                created_at,
                updated_at
         FROM support_tickets
         WHERE customer_id = $1
         ORDER BY created_at DESC`,
        [customerId]
      );
    }
    res.json({ success: true, tickets: result.rows });
  } catch (err) {
    console.error('customerPortal listTickets:', err);
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.generateTempPassword = generateTempPassword;
