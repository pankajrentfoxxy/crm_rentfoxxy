const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const {
  getDeliveryChallanLines,
  computeGstBreakdown,
  resolveDcBilling,
  resolveSupplyStateFromAddress,
} = require('../services/salesManagementService');
const {
  isSaleDc,
  isNewCustomerFirstOrder,
  requiresInvoiceCompliance,
  requiresEwayBill,
  buildSaleCompliance,
  normalizeVehicleNumber,
  canUploadSaleDcCompliance,
  computeDcGrandTotal,
  sendAccountsSaleDcEmail,
  ACCOUNTS_EMAIL,
} = require('../services/saleDcComplianceService');
const { generateDocumentPdf } = require('../services/salesManagementPdfService');
const { safeLogSalesOrderActivity, ACTIVITY_TYPES } = require('../services/salesOrderActivityService');

/** Dispatch / accounts / DC editors — upload docs or send accounts mail. */
exports.checkSaleDcComplianceUpload = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (req.user.role === 'super_admin') return next();
    if (!req.permissionCache) req.permissionCache = {};
    const allowed = await canUploadSaleDcCompliance(req.user, req.permissionCache);
    if (allowed) return next();
    return res.status(403).json({
      success: false,
      message: 'Permission denied — requires Dispatch or E-Invoice upload access',
    });
  } catch (error) {
    console.error('checkSaleDcComplianceUpload:', error);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  }
};

function relativeUploadPath(absPath) {
  const rel = path.relative(path.join(__dirname, '..'), absPath).replace(/\\/g, '/');
  return rel.startsWith('uploads/') ? rel : `uploads/${rel.replace(/^uploads\//, '')}`;
}

/**
 * POST multipart: einvoice_number, eway_bill_number (if >50k),
 * einvoice_pdf, eway_bill_pdf (optional file fields).
 */
exports.uploadSaleDcCompliance = async (req, res) => {
  const dcNumber = req.params.dcNumber;
  const body = req.body || {};
  const einvoiceNumber = String(body.einvoice_number || '').trim();
  const ewayBillNumber = String(body.eway_bill_number || '').trim();

  try {
    const lines = await getDeliveryChallanLines(dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const head = lines[0];

    let quotationType = null;
    if (head.sales_order_number) {
      const qtRes = await pool.query(
        `SELECT quotation_type FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
        [head.sales_order_number]
      );
      quotationType = qtRes.rows[0]?.quotation_type || null;
    }

    const firstOrder = await isNewCustomerFirstOrder(pool, head.customer_id, head.sales_order_number);
    if (!requiresInvoiceCompliance(head.entity_code, quotationType, firstOrder)) {
      return res.status(400).json({
        success: false,
        message: 'E-Invoice upload applies to Sale DCs and new-customer first orders only',
      });
    }

    const { subtotal } = await resolveDcBilling(dcNumber, lines);
    const totals = computeGstBreakdown({
      subtotal,
      shipping: head.shiping_charges,
      security: head.security_amount,
      supplyState: resolveSupplyStateFromAddress(head.customer_shipping_address, head.supply_state),
    });
    const needsEway = requiresEwayBill(subtotal);

    const files = req.files || {};
    const einvoiceFile = files.einvoice_pdf?.[0] || files.einvoice_pdf;
    const ewayFile = files.eway_bill_pdf?.[0] || files.eway_bill_pdf;

    const hasExistingEinvPdf = Boolean(head.einvoice_pdf_path);
    const hasExistingEwbPdf = Boolean(head.eway_bill_pdf_path);

    if (!einvoiceNumber && !head.einvoice_number && !head.irn) {
      return res.status(400).json({ success: false, message: 'E-Invoice number is required' });
    }
    if (!einvoiceFile && !hasExistingEinvPdf && !head.qr_code_url) {
      return res.status(400).json({ success: false, message: 'E-Invoice PDF or image is required' });
    }
    if (needsEway) {
      if (!ewayBillNumber && !head.eway_bill_number) {
        return res.status(400).json({
          success: false,
          message: `E-Way Bill number is required — DC laptop value exceeds ₹50,000 (₹${Number(subtotal).toLocaleString('en-IN')})`,
        });
      }
      if (!ewayFile && !hasExistingEwbPdf) {
        return res.status(400).json({ success: false, message: 'E-Way Bill PDF or image is required for this DC value' });
      }
    }

    const einvoicePdfPath = einvoiceFile ? relativeUploadPath(einvoiceFile.path) : head.einvoice_pdf_path;
    const ewayPdfPath = ewayFile ? relativeUploadPath(ewayFile.path) : head.eway_bill_pdf_path;
    const finalEinvNum = einvoiceNumber || head.einvoice_number || head.irn || null;
    const finalEwbNum = needsEway ? (ewayBillNumber || head.eway_bill_number || null) : (head.eway_bill_number || null);

    await pool.query(
      `UPDATE delivery_challan_lines SET
          einvoice_number = $1,
          einvoice_pdf_path = COALESCE($2, einvoice_pdf_path),
          einvoice_uploaded_at = NOW(),
          einvoice_uploaded_by = $3,
          eway_bill_number = $4,
          eway_bill_pdf_path = CASE WHEN $5::boolean THEN COALESCE($6, eway_bill_pdf_path) ELSE eway_bill_pdf_path END,
          updated_at = NOW()
        WHERE dc_number = $7`,
      [
        finalEinvNum,
        einvoicePdfPath,
        req.user?.user_id || null,
        finalEwbNum,
        needsEway,
        ewayPdfPath,
        dcNumber,
      ]
    );

    const updated = await getDeliveryChallanLines(dcNumber);
    const canUpload = await canUploadSaleDcCompliance(req.user, req.permissionCache);
    const compliance = buildSaleCompliance(
      { ...updated[0], quotation_type: quotationType },
      totals,
      req.user?.role,
      { canUpload, canSendMail: canUpload, isFirstCustomerOrder: firstOrder },
    );

    if (head.sales_order_number) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: head.sales_order_number,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'einvoice_uploaded',
        description: `E-Invoice documents uploaded for ${dcNumber}${needsEway && finalEwbNum ? ` (E-Way: ${finalEwbNum})` : ''}.`,
        metadata: { dc_number: dcNumber, einvoice_number: finalEinvNum, eway_bill_number: finalEwbNum },
        user: req.user,
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: needsEway
        ? 'E-Invoice and E-Way Bill saved. DC PDF is now available to the team.'
        : 'E-Invoice saved. DC PDF is now available to the team.',
      sale_compliance: compliance,
    });
  } catch (error) {
    console.error('uploadSaleDcCompliance:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.validateSaleVehicleOnCreate = function validateSaleVehicleOnCreate(entityCode, shipBy, group) {
  if (!isSaleDc(entityCode)) return null;
  if (shipBy !== 'by_porter' && shipBy !== 'by_hand') return null;
  const vehicle = normalizeVehicleNumber(group?.vehicle_number);
  if (!vehicle) {
    return 'Vehicle number is required for Porter / Inhouse sale dispatches (E-Way Bill).';
  }
  return null;
};

/** POST — manually send accounts E-Invoice request (dispatch SMTP only). */
exports.sendAccountsNotification = async (req, res) => {
  const dcNumber = req.params.dcNumber;

  try {
    let lines = await getDeliveryChallanLines(dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    let head = lines[0];

    let quotationType = null;
    if (head.sales_order_number) {
      const qtRes = await pool.query(
        `SELECT quotation_type, customer_name FROM sales_order_lines
          WHERE sales_order_number = $1 LIMIT 1`,
        [head.sales_order_number]
      );
      quotationType = qtRes.rows[0]?.quotation_type || null;
      if (!head.customer_name && qtRes.rows[0]?.customer_name) {
        head = { ...head, customer_name: qtRes.rows[0].customer_name };
      }
    }

    const firstOrder = await isNewCustomerFirstOrder(pool, head.customer_id, head.sales_order_number);
    if (!requiresInvoiceCompliance(head.entity_code, quotationType, firstOrder)) {
      return res.status(400).json({
        success: false,
        message: 'Accounts notification applies to Sale DCs and new-customer first orders only',
      });
    }

    let pdfPath = head.pdf_path;
    if (!pdfPath) {
      pdfPath = await generateDocumentPdf({
        docType: 'delivery_challan',
        docNumber: dcNumber,
        header: head,
        lines,
      });
      await pool.query(
        `UPDATE delivery_challan_lines SET pdf_path = $1 WHERE dc_number = $2`,
        [pdfPath, dcNumber]
      );
    }

    const productValue = await computeDcGrandTotal(dcNumber);
    const laptopCount = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    const isSale = isSaleDc(head.entity_code, quotationType);

    const mailResult = await sendAccountsSaleDcEmail({
      dcNumber,
      salesOrderNumber: head.sales_order_number,
      customerName: head.customer_name,
      pdfPath,
      productValue,
      grandTotal: productValue,
      laptopCount,
      isSale,
      isFirstCustomerOrder: firstOrder,
    });

    await pool.query(
      `UPDATE delivery_challan_lines SET
          accounts_notified_at = NOW(),
          accounts_notified_by = $1,
          updated_at = NOW()
        WHERE dc_number = $2`,
      [req.user?.user_id || null, dcNumber]
    );

    lines = await getDeliveryChallanLines(dcNumber);
    head = lines[0];
    const { subtotal } = await resolveDcBilling(dcNumber, lines);
    const totals = computeGstBreakdown({
      subtotal,
      shipping: head.shiping_charges,
      security: head.security_amount,
      supplyState: resolveSupplyStateFromAddress(head.customer_shipping_address, head.supply_state),
    });
    const canSend = await canUploadSaleDcCompliance(req.user, req.permissionCache);
    const saleCompliance = buildSaleCompliance(
      { ...head, quotation_type: quotationType },
      totals,
      req.user?.role,
      { canUpload: canSend, canSendMail: canSend, isFirstCustomerOrder: firstOrder },
    );

    if (head.sales_order_number) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: head.sales_order_number,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'accounts_notified',
        description: `E-Invoice request emailed to ${ACCOUNTS_EMAIL} for ${dcNumber} (from ${mailResult.from}).`,
        metadata: { dc_number: dcNumber, to: mailResult.to, from: mailResult.from },
        user: req.user,
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: `Mail sent to ${ACCOUNTS_EMAIL}${mailResult.cc ? ` (cc ${mailResult.cc})` : ''} from ${mailResult.from}`,
      from: mailResult.from,
      to: mailResult.to,
      sale_compliance: saleCompliance,
    });
  } catch (error) {
    console.error('sendAccountsNotification:', error);
    const status = error.message?.includes('not configured') ? 503 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};
