const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const {
  getDeliveryChallanLines,
  computeGstBreakdown,
  resolveDcBilling,
  resolveSupplyStateFromAddress,
  gstinForDocument,
} = require('../services/salesManagementService');
const {
  isSaleDc,
  isNewCustomerFirstOrder,
  isNewCustomerFirstDc,
  requiresInvoiceCompliance,
  requiresDemoEwayCompliance,
  requiresOutboundEway,
  requiresEwayBill,
  requiresVehicleNumber,
  isOwnVehicleDispatch,
  assetValueForSerialIds,
  buildSaleCompliance,
  buildDemoEwayCompliance,
  normalizeVehicleNumber,
  canUploadSaleDcCompliance,
  canUploadDcValueEway,
  computeDcGrandTotal,
  computeDcAssetValue,
  sendAccountsSaleDcEmail,
  sendAccountsDemoEwayEmail,
  accountsMailBlockedReason,
  markDcEwayRequired,
  ACCOUNTS_EMAIL,
} = require('../services/saleDcComplianceService');
const { generateDocumentPdf } = require('../services/salesManagementPdfService');
const { safeLogSalesOrderActivity, ACTIVITY_TYPES } = require('../services/salesOrderActivityService');
const gstNo = require('../services/gstDocumentNumberService');

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

exports.checkDemoEwayUpload = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (req.user.role === 'super_admin') return next();
    if (!req.permissionCache) req.permissionCache = {};
    const allowed = await canUploadDcValueEway(req.user, req.permissionCache);
    if (allowed) return next();
    return res.status(403).json({
      success: false,
      message: 'Permission denied — requires Accounts E-Way Bill upload access',
    });
  } catch (error) {
    console.error('checkDemoEwayUpload:', error);
    return res.status(500).json({ success: false, message: 'Server error checking permissions' });
  }
};

function parseLineSerials(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter(Boolean).map((entry) => {
    const parts = String(entry).split('|');
    return {
      serial: parts[1] || parts[0] || null,
      ttspl: parts[2] || null,
    };
  });
}

function laptopRowsFromLines(lines) {
  const rows = [];
  for (const line of lines || []) {
    const config = [line.brand, line.model_name || line.model, line.processor, line.generation, line.ram, line.storage]
      .filter(Boolean).join(' · ');
    const serials = Array.isArray(line.serials_detail) && line.serials_detail.length
      ? line.serials_detail.map((d) => ({
        ttspl: d.ttspl || d.inventory_asset_code || null,
        serial: d.serial_number || null,
        config: [d.brand, d.model, d.processor, d.generation, d.ram, d.storage].filter(Boolean).join(' · ') || config,
      }))
      : parseLineSerials(line.serial_number).map((s) => ({ ...s, config }));
    if (serials.length) rows.push(...serials);
    else rows.push({ ttspl: null, serial: null, config });
  }
  return rows;
}

/** A refused upload must not leave its file behind in the served uploads tree. */
function removeUploadedFiles(files = []) {
  for (const f of files) {
    if (f?.path) fs.promises.unlink(f.path).catch(() => {});
  }
}

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

    const firstDc = await isNewCustomerFirstDc(pool, head.customer_id, dcNumber);
    if (!requiresInvoiceCompliance(head.entity_code, quotationType, firstDc, head.dc_purpose)) {
      return res.status(400).json({
        success: false,
        message: 'E-Invoice upload applies to Sale DCs and new-customer first DCs only (not service returns)',
      });
    }

    const { subtotal } = await resolveDcBilling(dcNumber, lines);
    const totals = computeGstBreakdown({
      subtotal,
      shipping: head.shiping_charges,
      security: head.security_amount,
      supplyState: resolveSupplyStateFromAddress(head.customer_shipping_address, head.supply_state, '', gstinForDocument(head)),
    });
    const asset = await computeDcAssetValue(dcNumber, lines);
    const needsEway = requiresEwayBill(asset.total);

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
          message: `E-Way Bill number is required — DC asset value is ₹50,000 or more (₹${Number(asset.total).toLocaleString('en-IN')})`,
        });
      }
      if (!ewayFile && !hasExistingEwbPdf) {
        return res.status(400).json({ success: false, message: 'E-Way Bill PDF or image is required for this DC value' });
      }
    }

    const einvoicePdfPath = einvoiceFile ? relativeUploadPath(einvoiceFile.path) : head.einvoice_pdf_path;
    const ewayPdfPath = ewayFile ? relativeUploadPath(ewayFile.path) : head.eway_bill_pdf_path;

    // MD7: numbers are checked and written under a row lock, in one transaction —
    // a different number than the one on file needs an explicit replace + reason,
    // and a number already on another document is refused.
    const request = gstNo.replaceRequest(body);
    let finalEinvNum;
    let finalEwbNum;
    let einvAction = 'none';
    let ewbAction = 'none';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT einvoice_number, eway_bill_number, irn, customer_id
           FROM delivery_challan_lines WHERE dc_number = $1 ORDER BY id FOR UPDATE`,
        [dcNumber]
      );
      const curEinv = gstNo.firstNonEmpty(locked.rows.map((r) => r.einvoice_number));
      const curEwb = gstNo.firstNonEmpty(locked.rows.map((r) => r.eway_bill_number));
      const curIrn = gstNo.firstNonEmpty(locked.rows.map((r) => r.irn));
      const customerId = locked.rows.find((r) => r.customer_id != null)?.customer_id ?? head.customer_id;

      einvAction = gstNo.checkOverwrite({
        label: 'e-invoice number', docNumber: dcNumber, current: curEinv, next: einvoiceNumber || null, request,
      });
      ewbAction = gstNo.checkOverwrite({
        label: 'e-way bill', docNumber: dcNumber, current: curEwb, next: needsEway ? (ewayBillNumber || null) : null, request,
      });
      if (einvAction !== 'none') {
        await gstNo.lockNumber(client, einvoiceNumber);
        await gstNo.assertInvoiceNumberFree(client, einvoiceNumber, { customerId, exceptDc: dcNumber, request });
      }
      if (ewbAction !== 'none') {
        await gstNo.lockNumber(client, ewayBillNumber);
        await gstNo.assertEwayNumberFree(client, ewayBillNumber, { docType: 'delivery_challan', docNumber: dcNumber });
      }

      finalEinvNum = (einvAction !== 'none' ? einvoiceNumber : null) || curEinv || curIrn || null;
      finalEwbNum = (ewbAction !== 'none' ? ewayBillNumber : null) || curEwb || null;

      await client.query(
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
      const userId = req.user?.user_id || null;
      await gstNo.recordNumberChange(client, {
        docType: 'delivery_challan', docNumber: dcNumber, field: 'einvoice_number', action: einvAction,
        oldValue: curEinv, newValue: finalEinvNum, reason: request.reason, userId,
      });
      await gstNo.recordNumberChange(client, {
        docType: 'delivery_challan', docNumber: dcNumber, field: 'eway_bill_number', action: ewbAction,
        oldValue: curEwb, newValue: finalEwbNum, reason: request.reason, userId,
      });
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      removeUploadedFiles([einvoiceFile, ewayFile]);
      if (gstNo.sendGstNumberError(res, txErr)) return undefined;
      throw txErr;
    } finally {
      client.release();
    }

    const updated = await getDeliveryChallanLines(dcNumber);
    const canUpload = await canUploadSaleDcCompliance(req.user, req.permissionCache);
    const compliance = buildSaleCompliance(
      { ...updated[0], quotation_type: quotationType },
      totals,
      req.user?.role,
      { canUpload, canSendMail: canUpload, isFirstCustomerOrder: firstDc, assetValue: asset.total },
    );

    if (head.sales_order_number) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: head.sales_order_number,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'einvoice_uploaded',
        description: `E-Invoice documents uploaded for ${dcNumber}${needsEway && finalEwbNum ? ` (E-Way: ${finalEwbNum})` : ''}.`
          + (einvAction === 'replace' || ewbAction === 'replace' ? ` Number replaced — reason: ${request.reason}` : ''),
        metadata: {
          dc_number: dcNumber,
          einvoice_number: finalEinvNum,
          eway_bill_number: finalEwbNum,
          einvoice_action: einvAction,
          eway_action: ewbAction,
          replace_reason: einvAction === 'replace' || ewbAction === 'replace' ? request.reason : undefined,
        },
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

/**
 * Rental and demo DCs skip the sale rule above, but an e-way bill still needs a
 * vehicle for Part B once the consignment reaches the threshold and we carry it
 * ourselves. Values the serials off the same processor + generation matrix the
 * DC e-way check uses, since the DC lines do not exist yet at this point.
 */
exports.validateEwayVehicleOnCreate = async function validateEwayVehicleOnCreate(
  db, { shipBy, dispatchMode, serialIds = [], vehicleNumber }
) {
  if (!isOwnVehicleDispatch(shipBy, dispatchMode)) return null;
  if (normalizeVehicleNumber(vehicleNumber)) return null;
  const value = await assetValueForSerialIds(db, serialIds);
  if (!requiresEwayBill(value)) return null;
  return `Vehicle number is required — this DC is valued at ₹${Number(value).toLocaleString('en-IN')} `
    + `and needs an E-Way Bill, which records the vehicle for an inhouse / porter dispatch.`;
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
    const mailBlocked = accountsMailBlockedReason(lines);
    if (mailBlocked) {
      return res.status(409).json({ success: false, message: mailBlocked });
    }

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

    const firstDc = await isNewCustomerFirstDc(pool, head.customer_id, dcNumber);
    if (!requiresInvoiceCompliance(head.entity_code, quotationType, firstDc, head.dc_purpose)) {
      return res.status(400).json({
        success: false,
        message: 'Accounts notification applies to Sale DCs and new-customer first DCs only (not service returns)',
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
      isFirstCustomerOrder: firstDc,
      shipBy: head.ship_by,
      dispatchMode: head.dispatch_mode,
      vehicleNumber: head.vehicle_number,
      userTriggered: true,
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
      supplyState: resolveSupplyStateFromAddress(head.customer_shipping_address, head.supply_state, '', gstinForDocument(head)),
    });
    const canSend = await canUploadSaleDcCompliance(req.user, req.permissionCache);
    const saleCompliance = buildSaleCompliance(
      { ...head, quotation_type: quotationType },
      totals,
      req.user?.role,
      { canUpload: canSend, canSendMail: canSend, isFirstCustomerOrder: firstDc },
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

function dcNeedsValueEway(head, quotationType, firstOrder, productValue) {
  return requiresOutboundEway({ ...head, quotation_type: quotationType }, productValue)
    || requiresDemoEwayCompliance(quotationType, firstOrder, productValue);
}

/** POST — one-time E-Way Bill request to Accounts (outbound DC value > threshold). */
exports.requestDemoEway = async (req, res) => {
  const dcNumber = req.params.dcNumber;
  try {
    const lines = await getDeliveryChallanLines(dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const mailBlocked = accountsMailBlockedReason(lines);
    if (mailBlocked) {
      return res.status(409).json({ success: false, message: mailBlocked });
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
    const asset = await computeDcAssetValue(dcNumber, lines);
    const productValue = asset.total;
    if (!dcNeedsValueEway(head, quotationType, firstOrder, productValue)) {
      return res.status(400).json({
        success: false,
        message: 'E-Way Bill request applies only to outbound DCs above the configured value threshold',
      });
    }
    await markDcEwayRequired(dcNumber, true, productValue);

    const { subtotal: billedSubtotal } = await resolveDcBilling(dcNumber, lines);
    const mailResult = await sendAccountsDemoEwayEmail({
      dcNumber,
      salesOrderNumber: head.sales_order_number,
      customerName: head.customer_name,
      productValue,
      billedValue: billedSubtotal,
      laptops: asset.units.length ? asset.units : laptopRowsFromLines(lines),
      pdfPath: head.pdf_path || null,
      vehicleNumber: normalizeVehicleNumber(head.vehicle_number) || null,
      needsVehicle: requiresVehicleNumber(head, true),
      userTriggered: true,
    });

    await pool.query(
      `UPDATE delivery_challan_lines SET
          accounts_notified_at = NOW(),
          accounts_notified_by = $1,
          updated_at = NOW()
        WHERE dc_number = $2`,
      [req.user?.user_id || null, dcNumber]
    );

    if (head.sales_order_number) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: head.sales_order_number,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'eway_accounts_requested',
        description: `E-Way Bill request emailed to ${ACCOUNTS_EMAIL} for ${dcNumber}${head.accounts_notified_at ? ' (resend)' : ''}.`,
        metadata: { dc_number: dcNumber, to: mailResult.to, from: mailResult.from },
        user: req.user,
      }).catch(() => {});
    }

    const updated = await getDeliveryChallanLines(dcNumber);
    const { subtotal } = await resolveDcBilling(dcNumber, updated);
    const totals = computeGstBreakdown({
      subtotal,
      shipping: updated[0].shiping_charges,
      security: updated[0].security_amount,
      supplyState: resolveSupplyStateFromAddress(
        updated[0].customer_shipping_address, updated[0].supply_state, '', gstinForDocument(updated[0])
      ),
    });
    const canUpload = await canUploadDcValueEway(req.user, req.permissionCache);
    const demoEway = buildDemoEwayCompliance(
      { ...updated[0], quotation_type: quotationType },
      totals,
      req.user?.role,
      {
        canUpload,
        canRequest: true,
        isFirstCustomerOrder: firstOrder,
        assetValue: productValue,
        billedValue: totals.subtotal,
        assetUnits: asset.units,
      },
    );

    return res.json({
      success: true,
      message: head.accounts_notified_at
        ? `Mail resent to ${ACCOUNTS_EMAIL}`
        : `Mail sent to ${ACCOUNTS_EMAIL}`,
      from: mailResult.from,
      to: mailResult.to,
      demo_eway_compliance: demoEway,
    });
  } catch (error) {
    console.error('requestDemoEway:', error);
    const status = error.message?.includes('not configured') ? 503 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

/** POST multipart: eway_bill_number, eway_bill_date, eway_bill_pdf */
exports.uploadDemoEway = async (req, res) => {
  const dcNumber = req.params.dcNumber;
  const body = req.body || {};
  const ewayBillNumber = String(body.eway_bill_number || '').trim();
  const ewayBillDate = String(body.eway_bill_date || '').trim() || null;
  const vehicleNumber = normalizeVehicleNumber(body.vehicle_number || body.vehicleNumber);

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
    const asset = await computeDcAssetValue(dcNumber, lines);
    const productValue = asset.total;
    if (!dcNeedsValueEway(head, quotationType, firstOrder, productValue)) {
      return res.status(400).json({
        success: false,
        message: 'E-Way Bill upload applies only to outbound DCs above the configured value threshold',
      });
    }

    const files = req.files || {};
    const ewayFile = files.eway_bill_pdf?.[0] || files.eway_bill_pdf;
    const hasExistingPdf = Boolean(head.eway_bill_pdf_path);
    if (!ewayBillNumber && !head.eway_bill_number) {
      return res.status(400).json({ success: false, message: 'E-Way Bill number is required' });
    }
    if (!ewayFile && !hasExistingPdf) {
      return res.status(400).json({ success: false, message: 'E-Way Bill document is required' });
    }
    // Part B of the e-way bill needs the vehicle when we carry the goods ourselves.
    const finalVehicle = vehicleNumber || normalizeVehicleNumber(head.vehicle_number);
    if (requiresVehicleNumber(head, true) && !finalVehicle) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle number is required for an inhouse / porter dispatch (E-Way Bill Part B)',
      });
    }

    const ewayPdfPath = ewayFile ? relativeUploadPath(ewayFile.path) : head.eway_bill_pdf_path;

    // MD7: never silently overwrite an e-way bill number; refuse duplicates.
    const request = gstNo.replaceRequest(body);
    let finalNum;
    let ewbAction = 'none';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT eway_bill_number FROM delivery_challan_lines WHERE dc_number = $1 ORDER BY id FOR UPDATE`,
        [dcNumber]
      );
      const curEwb = gstNo.firstNonEmpty(locked.rows.map((r) => r.eway_bill_number));
      ewbAction = gstNo.checkOverwrite({
        label: 'e-way bill', docNumber: dcNumber, current: curEwb, next: ewayBillNumber || null, request,
      });
      if (ewbAction !== 'none') {
        await gstNo.lockNumber(client, ewayBillNumber);
        await gstNo.assertEwayNumberFree(client, ewayBillNumber, { docType: 'delivery_challan', docNumber: dcNumber });
      }
      finalNum = (ewbAction !== 'none' ? ewayBillNumber : null) || curEwb;

      await client.query(
        `UPDATE delivery_challan_lines SET
            eway_bill_number = $1,
            eway_bill_date = COALESCE($2::date, eway_bill_date),
            eway_bill_pdf_path = COALESCE($3, eway_bill_pdf_path),
            eway_bill_uploaded_at = NOW(),
            eway_bill_uploaded_by = $4,
            vehicle_number = COALESCE($6, vehicle_number),
            updated_at = NOW()
          WHERE dc_number = $5`,
        [finalNum, ewayBillDate, ewayPdfPath, req.user?.user_id || null, dcNumber, finalVehicle || null]
      );
      await gstNo.recordNumberChange(client, {
        docType: 'delivery_challan', docNumber: dcNumber, field: 'eway_bill_number', action: ewbAction,
        oldValue: curEwb, newValue: finalNum, reason: request.reason, userId: req.user?.user_id || null,
      });
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      removeUploadedFiles([ewayFile]);
      if (gstNo.sendGstNumberError(res, txErr)) return undefined;
      throw txErr;
    } finally {
      client.release();
    }

    if (head.sales_order_number) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: head.sales_order_number,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'eway_uploaded',
        description: `E-Way Bill ${finalNum} uploaded for ${dcNumber}. DC download enabled.`
          + (ewbAction === 'replace' ? ` Number replaced — reason: ${request.reason}` : ''),
        metadata: {
          dc_number: dcNumber,
          eway_bill_number: finalNum,
          eway_bill_date: ewayBillDate,
          eway_action: ewbAction,
          replace_reason: ewbAction === 'replace' ? request.reason : undefined,
        },
        user: req.user,
      }).catch(() => {});
      await safeLogSalesOrderActivity({
        salesOrderNumber: head.sales_order_number,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'dc_access_enabled',
        description: `DC access enabled for ${dcNumber} after E-Way Bill upload.`,
        metadata: { dc_number: dcNumber },
        user: req.user,
      }).catch(() => {});
    }

    const updated = await getDeliveryChallanLines(dcNumber);
    const { subtotal } = await resolveDcBilling(dcNumber, updated);
    const totals = computeGstBreakdown({
      subtotal,
      shipping: updated[0].shiping_charges,
      security: updated[0].security_amount,
      supplyState: resolveSupplyStateFromAddress(
        updated[0].customer_shipping_address, updated[0].supply_state, '', gstinForDocument(updated[0])
      ),
    });
    const canUpload = await canUploadDcValueEway(req.user, req.permissionCache);
    const demoEway = buildDemoEwayCompliance(
      { ...updated[0], quotation_type: quotationType },
      totals,
      req.user?.role,
      {
        canUpload,
        canRequest: true,
        isFirstCustomerOrder: firstOrder,
        assetValue: productValue,
        billedValue: totals.subtotal,
        assetUnits: asset.units,
      },
    );

    return res.json({
      success: true,
      message: 'E-Way Bill Uploaded',
      demo_eway_compliance: demoEway,
    });
  } catch (error) {
    console.error('uploadDemoEway:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
