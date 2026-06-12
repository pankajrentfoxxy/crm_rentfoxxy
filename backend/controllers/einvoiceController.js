const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { generateEInvoice, cancelEInvoice, generateEWayBill } = require('../services/zohoGspService');
const { emailDocument, generateDocumentPdf } = require('../services/salesManagementPdfService');

async function fetchDcContext(dcNumber) {
  const dcRes = await pool.query(
    `SELECT dcl.*,
            COALESCE(sol.quotation_type, sq.quotation_type) AS quotation_type,
            c.company_name, c.gst_number AS customer_gst, c.email AS customer_email,
            c.billing_address
     FROM delivery_challan_lines dcl
     LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number AND sol.brand = dcl.brand
     LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
     LEFT JOIN customers c ON c.customer_id = dcl.customer_id
     WHERE dcl.dc_number = $1
     LIMIT 1`,
    [dcNumber]
  );
  if (!dcRes.rows.length) return null;
  const head = dcRes.rows[0];
  const linesRes = await pool.query(
    `SELECT dcl.brand, dcl.model_name, dcl.quantity,
            COALESCE(sol.rate, 0) AS rate
     FROM delivery_challan_lines dcl
     LEFT JOIN sales_order_lines sol
       ON sol.sales_order_number = dcl.sales_order_number AND sol.brand = dcl.brand
     WHERE dcl.dc_number = $1`,
    [dcNumber]
  );
  const lineItems = linesRes.rows.map((l) => ({
    brand: l.brand,
    model_name: l.model_name,
    quantity: l.quantity || 1,
    rate: parseFloat(l.rate || 0),
    description: `${l.brand || ''} ${l.model_name || ''}`.trim(),
  }));
  const totalAmount = lineItems.reduce((s, l) => s + l.rate * l.quantity, 0);
  const billingAddr = head.billing_address || head.customer_billing_address;
  let billingAddressStr = '';
  if (typeof billingAddr === 'object' && billingAddr) {
    billingAddressStr = [billingAddr.line1, billingAddr.city, billingAddr.state, billingAddr.pincode]
      .filter(Boolean).join(', ');
  } else if (typeof billingAddr === 'string') {
    billingAddressStr = billingAddr;
  }
  const customer = {
    customer_id: head.customer_id,
    name: head.customer_name || head.company_name,
    companyName: head.company_name,
    gst_no: head.gst_number || head.customer_gst,
    billing_address: billingAddressStr,
    email: head.email || head.customer_email,
  };
  return { head, lineItems, totalAmount, customer };
}

exports.generateDcEInvoice = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const ctx = await fetchDcContext(dcNumber);
    if (!ctx) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    if (ctx.head.irn) {
      return res.status(400).json({ success: false, message: 'IRN already generated for this DC' });
    }
    const result = await generateEInvoice({
      dcNumber,
      customer: ctx.customer,
      lineItems: ctx.lineItems,
      totalAmount: ctx.totalAmount,
      userId: req.user?.user_id,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.cancelDcEInvoice = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const { reason } = req.body || {};
    const dcRes = await pool.query('SELECT irn FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1', [dcNumber]);
    if (!dcRes.rows.length || !dcRes.rows[0].irn) {
      return res.status(404).json({ success: false, message: 'No IRN found for this DC' });
    }
    await cancelEInvoice({ irn: dcRes.rows[0].irn, cancelReason: reason || 'Cancelled' });
    await pool.query(
      `UPDATE delivery_challan_lines SET irn = NULL, qr_code_url = NULL, irn_generated_at = NULL WHERE dc_number = $1`,
      [dcNumber]
    );
    res.json({ success: true, cancelled: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.generateDcEWayBill = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const body = req.body || {};
    const dcRes = await pool.query('SELECT irn FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1', [dcNumber]);
    if (!dcRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const ewbData = {
      transporterName: body.transporter_name || body.transporterName,
      vehicleNo: body.vehicle_number || body.vehicleNo,
      distance: body.distance_km || body.distance,
      mode_of_transport: body.mode_of_transport || 'road',
    };
    const result = await generateEWayBill({
      dcNumber,
      ewbData,
      userId: req.user?.user_id,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDcEInvoiceStatus = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const dcRes = await pool.query(
      `SELECT dc_number, irn, irn_generated_at, qr_code_url,
              eway_bill_number, eway_bill_valid_till, invoice_sent_at,
              customer_name, customer_id, gst_number
       FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [dcNumber]
    );
    if (!dcRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const row = dcRes.rows[0];
    const isSandbox = process.env.ZOHO_GSP_SANDBOX !== 'false';
    res.json({
      success: true,
      dc_number: dcNumber,
      irn: row.irn,
      irn_generated_at: row.irn_generated_at,
      qr_code_url: row.qr_code_url,
      eway_bill_number: row.eway_bill_number,
      eway_bill_valid_till: row.eway_bill_valid_till,
      invoice_sent_at: row.invoice_sent_at,
      isSandbox,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.sendEInvoiceEmail = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const { to_email, cc_emails } = req.body || {};
    const ctx = await fetchDcContext(dcNumber);
    if (!ctx) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    if (!ctx.head.irn) {
      return res.status(400).json({ success: false, message: 'Generate E-Invoice first' });
    }
    const pdfPath = ctx.head.pdf_path || await generateDocumentPdf({
      docType: 'delivery_challan',
      docNumber: dcNumber,
      header: {
        customer_name: ctx.customer.name,
        customer_email: ctx.customer.email,
        gst_number: ctx.customer.gst_no,
      },
      lines: ctx.lineItems,
    });
    const attachments = [];
    const pdfAbs = path.join(__dirname, '..', pdfPath);
    if (fs.existsSync(pdfAbs)) attachments.push(pdfAbs);
    if (ctx.head.qr_code_url) {
      const qrAbs = path.join(__dirname, '..', ctx.head.qr_code_url.replace(/^\//, ''));
      if (fs.existsSync(qrAbs)) attachments.push(qrAbs);
    }
    const to = to_email || ctx.customer.email;
    const transport = require('../services/salesManagementPdfService');
    const sent = await emailDocument({
      to,
      cc: Array.isArray(cc_emails) ? cc_emails.join(',') : cc_emails,
      subject: `E-Invoice for DC ${dcNumber} — IRN ${ctx.head.irn}`,
      text: `E-Invoice generated for delivery challan ${dcNumber}.\nIRN: ${ctx.head.irn}`,
      pdfRelativePath: pdfPath,
    });
    await pool.query(
      `UPDATE delivery_challan_lines
       SET invoice_sent_at = NOW(), invoice_sent_by = $1
       WHERE dc_number = $2`,
      [req.user?.user_id || null, dcNumber]
    );
    res.json({ success: true, email_sent: sent });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
