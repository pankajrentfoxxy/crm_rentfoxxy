const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const {
  nextDocumentNumber,
  nextFinancialYearNumber,
  peekFinancialYearNumber,
  computeGstBreakdown,
  resolveSupplyStateFromAddress,
  resolveDcBilling,
  entityForQuotationType,
  generateToken,
  sumSoSecurityAmount,
  computeDcSecurityFromSerials,
  recalcSoSecurityIfOneMonthRental,
  syncDcSecurityForSo,
  listQuotationsGrouped,
  getQuotationLines,
  listSalesOrdersGrouped,
  listCustomersForOrderScope,
  getSalesOrderLines,
  getSalesOrderSupportMeta,
  listDeliveryChallansGrouped,
  getDeliveryChallanLines,
  listReturnDeliveryChallans,
  listReturnDcLaptopExportRows,
  getReturnDcDetail,
  getQuotationRemainingQty,
  getSalesOrderRemainingQty,
  getSalesOrderFulfillmentCounts,
  deriveSalesOrderListStatus,
  getSalesOrderDispatchDate,
  getOperationCounts,
  searchAvailableInventory,
  assertSalesOrderVisibleToUser,
  getDcSerialRateLookup,
  lookupSerialRate,
  lookupSerialRemark,
  resolveSoLineRemarksForLines,
  entityDocType,
} = require('../services/salesManagementService');
const { generateDocumentPdf } = require('../services/salesManagementPdfService');
const { emailDocument } = require('../services/salesManagementPdfService');
const {
  sendSalesQuotationEmail,
  assertQuotationSendFields,
  assertLeadAllowsQuotationSend,
} = require('../services/salesQuotationEmailService');
const {
  isSaleDc,
  isNewCustomerFirstOrder,
  requiresInvoiceCompliance,
  requiresDemoEwayCompliance,
  buildDemoEwayCompliance,
  canManageDcEwayBill,
  buildSaleCompliance,
  assertCanDownloadSaleDcPdf,
  normalizeVehicleNumber,
  canUploadSaleDcCompliance,
} = require('../services/saleDcComplianceService');
const { validateSaleVehicleOnCreate } = require('../controllers/saleDcComplianceController');
const { createSalesOrderQcTicket } = require('../services/grnTicketService');
const { logTtsplEvent } = require('../services/ttsplAuditService');
const replacementFlow = require('../services/supportReplacementFlowService');
const supportServiceDcService = require('../services/supportServiceDcService');
const { regenerateReturnDcPdf, regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');
const { isRestrictedToAssigned, scopeUserId, salesOrderScopeSection, resolveSalesOrderListOrderType, assertReplacementSalesOrderAccessIfScoped } = require('../services/dataScopeService');
const {
  ACTIVITY_TYPES,
  safeLogSalesOrderActivity,
  listSalesOrderActivities,
} = require('../services/salesOrderActivityService');
const {
  isAssignmentEditable,
  listAssignmentHistory,
  updateDcAssignment: applyDcAssignmentChange,
  resolveTechnicianId,
} = require('../services/dcAssignmentService');
const {
  resolveHsnForPersist,
  resolveHsnForDisplay,
  canOverrideHsn,
  normalizeHsnCode,
} = require('../constants/hsnDefaults');
const {
  resolveHsnFromSalesOrder,
  resolveTxnTypeForDc,
} = require('../utils/hsnDocResolve');
const {
  customerTypeSqlCondition,
  customerTypeFilterForQuotation,
  isCustomerEligibleForQuotation,
  customerTypeMismatchMessage,
} = require('../utils/customerType');
const {
  appendCustomerTypeCondition,
  isCustomerTypeAllowed,
} = require('../services/customerAccessScope');
const { hasPermission } = require('../services/permissionService');

/**
 * Resolve a vendor_serial_numbers.serial_id from a parsed DC serial entry,
 * by explicit id first then by serial number / TTSPL code.
 */
async function resolveSerialId(client, s) {
  if (s.serialId) return s.serialId;
  const key = s.serialNumber || s.ttsplId;
  if (!key) return null;
  const r = await client.query(
    `SELECT serial_id FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (serial_number = $1 OR inventory_asset_code = $1 OR extra->>'ttspl_id' = $1)
      LIMIT 1`,
    [key]
  );
  return r.rows[0]?.serial_id || null;
}

/** Fetch DC-level context needed to drive inventory transitions. */
async function getDcContext(client, dcNumber) {
  const r = await client.query(
    `SELECT dcl.customer_id, dcl.entity_code, dcl.dispatch_mode, dcl.sales_order_number,
            COALESCE(sol.quotation_type, sq.quotation_type, 'rental') AS quotation_type
       FROM delivery_challan_lines dcl
       LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
       LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
      WHERE dcl.dc_number = $1
      LIMIT 1`,
    [dcNumber]
  );
  return r.rows[0] || {};
}

/** First customer rental invoice that includes this DC in line_items (on-DC-create / on-delivery). */
async function findRentalInvoiceForDc(dcNumber) {
  if (!dcNumber) return null;
  const r = await pool.query(
    `SELECT ci.invoice_id, ci.invoice_number, ci.status, ci.invoice_month, ci.invoice_year,
            ci.grand_total, ci.pdf_path, ci.invoice_date, ci.from_date, ci.to_date
       FROM customer_invoices ci
      WHERE EXISTS (
              SELECT 1
                FROM jsonb_array_elements(COALESCE(ci.line_items, '[]'::jsonb)) elem
               WHERE elem->>'dc_number' = $1
            )
      ORDER BY ci.created_at ASC, ci.invoice_id ASC
      LIMIT 1`,
    [String(dcNumber)]
  );
  return r.rows[0] || null;
}
function parseJsonSafe(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Keep linked outbound DC header rows aligned when an SO line config changes. */
async function syncDcLinesFromSoLine(db, {
  lineId,
  salesOrderNumber,
  brand,
  modelName,
  oldBrand,
  oldModelName,
}) {
  await db.query(
    `UPDATE delivery_challan_lines dcl
        SET brand = $1,
            model_name = $2,
            updated_at = NOW(),
            pdf_path = NULL
      WHERE dcl.sales_order_number = $3
        AND COALESCE(dcl.movement_type, 'outbound') <> 'return'
        AND (
          dcl.dc_number IN (
            SELECT DISTINCT sos.dc_number
              FROM sales_order_serials sos
             WHERE sos.line_id = $4
               AND sos.sales_order_number = $3
               AND sos.status <> 'removed'
               AND sos.dc_number IS NOT NULL
          )
          OR dcl.dc_number IN (
            SELECT DISTINCT vsn.current_dc_number
              FROM sales_order_serials sos
              JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
             WHERE sos.line_id = $4
               AND sos.sales_order_number = $3
               AND sos.status <> 'removed'
               AND vsn.current_dc_number IS NOT NULL
          )
          OR (
            LOWER(TRIM(COALESCE(dcl.brand, ''))) = LOWER(TRIM($5))
            AND LOWER(TRIM(COALESCE(dcl.model_name, ''))) = LOWER(TRIM($6))
          )
        )`,
    [brand, modelName, salesOrderNumber, lineId, oldBrand || '', oldModelName || '']
  );
}

/** Regenerate SO PDF and every linked DC PDF (rates/GST pull live from SO lines). */
async function regenerateSoAndLinkedDcPdfs(salesOrderNumber) {
  const soLines = await getSalesOrderLines(salesOrderNumber);
  let soPdfPath = null;
  if (soLines.length) {
    soPdfPath = await generateDocumentPdf({
      docType: 'sales_order',
      docNumber: salesOrderNumber,
      header: soLines[0],
      lines: soLines,
    });
    await pool.query(
      `UPDATE sales_order_lines SET pdf_path = $1 WHERE sales_order_number = $2`,
      [soPdfPath, salesOrderNumber]
    );
  }
  const dcRes = await pool.query(
    `SELECT DISTINCT dc_number FROM delivery_challan_lines WHERE sales_order_number = $1`,
    [salesOrderNumber]
  );
  const dcPdfs = [];
  for (const { dc_number: dcNumber } of dcRes.rows) {
    const pdfPath = await regenerateDcPdfForNumber(dcNumber);
    if (pdfPath) dcPdfs.push({ dc_number: dcNumber, pdf_path: pdfPath });
  }
  return { so_pdf_path: soPdfPath, dc_pdfs: dcPdfs };
}

/** Regenerate a single DC PDF from current delivery_challan_lines (assignee, dates, specs). */
async function regenerateDcPdfForNumber(dcNumber) {
  const lines = await getDeliveryChallanLines(dcNumber);
  if (!lines.length) return null;
  const pdfPath = await generateDocumentPdf({
    docType: 'delivery_challan',
    docNumber: dcNumber,
    header: lines[0] || {},
    lines,
  });
  await pool.query(
    `UPDATE delivery_challan_lines SET pdf_path = $1, updated_at = NOW() WHERE dc_number = $2`,
    [pdfPath, dcNumber]
  );
  return pdfPath;
}

function normalizeCustomerForQuotation(row) {
  const details = parseJsonSafe(row.details, {}) || {};
  const billingRaw = details.billing_address || details.billing;
  const billing = typeof billingRaw === 'object' && billingRaw
    ? { ...billingRaw, name: row.company_name || billingRaw.name || row.name }
    : {
        name: row.company_name || row.name,
        phone: row.phone,
        country: 'India',
        state: details.state || '',
        city: details.city || '',
        zip_code: details.zip_code || '',
        address: row.address || details.address || '',
      };

  let shippingList = details.shipping_address || details.shipping_addresses || [];
  if (typeof shippingList === 'string') shippingList = parseJsonSafe(shippingList, []);
  if (!Array.isArray(shippingList)) shippingList = [];

  return {
    customer_id: row.customer_id,
    name: row.name,
    company_name: row.company_name || null,
    email: row.email,
    phone: row.phone,
    gst_no: row.gst_no,
    address: row.address,
    customer_type: row.customer_type || 'both',
    billing_address: billing,
    shipping_addresses: shippingList,
  };
}

/** Asset dropdowns from Settings → Asset Configuration (DB), plus legacy procured rows. */
async function fetchCatalogAttributeOptions() {
  const { getAssetCatalogForApi } = require('../services/assetConfigurationService');
  return getAssetCatalogForApi({ includeLegacyRows: true });
}

const parseJsonField = (value) => {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const toNullableInt = (value) => {
  if (value === '' || value == null) return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
};

function parseSerialEntries(raw) {
  if (!raw) return [];
  const parsed = parseJsonField(raw);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter(Boolean).map((entry) => {
    const parts = String(entry).split('|');
    const serialId = /^\d+$/.test(parts[0]) ? parseInt(parts[0], 10) : null;
    const serialNumber = parts[1] || parts[0];
    const ttsplId = parts[2] || null;
    return { serialId, serialNumber, ttsplId, raw: entry };
  });
}

async function getDcLines(dcNumber) {
  return getDeliveryChallanLines(dcNumber);
}

async function collectDcSerials(dcNumber) {
  const lines = await getDcLines(dcNumber);
  const serials = [];
  for (const line of lines) {
    for (const s of parseSerialEntries(line.serial_number)) {
      serials.push({ ...s, line_id: line.id, sales_order_number: line.sales_order_number });
    }
  }
  return serials;
}

const normalizeLineItems = (body) => {
  if (Array.isArray(body.line_items) && body.line_items.length) {
    return body.line_items.map((item) => ({
      line_id: item.line_id ?? item.id ?? null,
      brand: item.brand || '',
      model_name: item.model_name || item.model || '',
      processor: item.processor || '',
      generation: item.generation || '',
      ram: item.ram || '',
      storage: item.storage || '',
      gpu: item.gpu || '',
      screen_size: item.screen_size || '',
      quantity: Number(item.quantity || 1),
      rate: Number(item.rate || 0),
      locking_period: toNullableInt(item.locking_period),
      technical_warranty: toNullableInt(item.technical_warranty),
      battery_charger_warranty: toNullableInt(item.battery_charger_warranty),
      remark: item.remark ?? item.remarks ?? null,
    }));
  }
  const count = Math.max(
    ...['quantity', 'Processor', 'processor', 'brand', 'brands', 'remarks', 'remark', 'line_id'].map((key) => {
      const value = body[key];
      return Array.isArray(value) ? value.length : 0;
    })
  );
  if (!count) return [];
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      line_id: (body.line_id || [])[i] || null,
      brand: (body.brand || body.brands || [])[i] || '',
      model_name: (body.Model || body.model_name || [])[i],
      processor: (body.Processor || body.processor || [])[i],
      generation: (body.Generation || body.generation || [])[i],
      ram: (body.RAM || body.ram || [])[i],
      storage: (body.Storage || body.storage || [])[i],
      gpu: (body.GPU || body.gpu || [])[i],
      screen_size: (body.Screen_size || body.screen_size || [])[i],
      quantity: Number((body.quantity || [])[i] || 1),
      rate: Number((body.rate || [])[i] || 0),
      locking_period: toNullableInt((body.locking_period || [])[i]),
      technical_warranty: toNullableInt((body.technical_warranty || [])[i]),
      battery_charger_warranty: toNullableInt((body.battery_charger_warranty || [])[i]),
      remark: (body.remarks || body.remark || [])[i] ?? null,
    });
  }
  return items;
};

exports.getAddQuotationMeta = async (req, res) => {
  try {
    const typeFilter = String(
      req.query.customer_type || req.query.for_order || req.query.quotation_type || ''
    ).trim().toLowerCase();
    const mapped = typeFilter
      ? customerTypeFilterForQuotation(typeFilter === 'sales' || typeFilter === 'sale' ? 'sales' : typeFilter)
      : null;
    const typeSql = mapped ? customerTypeSqlCondition(mapped) : null;

    // Role-based Customer Access scope (all/sales/rental)
    const scopeParams = [];
    const scopeConds = [];
    appendCustomerTypeCondition(req.allowedCustomerTypes, scopeConds, scopeParams);

    const [customersRes, quotationNumber, catalog] = await Promise.all([
      pool.query(
        `SELECT customer_id, name, company_name, email, phone, gst_no, address, details, customer_type
           FROM customers c
          WHERE COALESCE(c.status, 1) = 1
            ${typeSql ? `AND ${typeSql}` : ''}
            ${scopeConds.length ? `AND ${scopeConds[0]}` : ''}
          ORDER BY company_name ASC NULLS LAST, name ASC
          LIMIT 500`,
        scopeParams
      ),
      nextDocumentNumber('quotation'),
      fetchCatalogAttributeOptions(),
    ]);
    res.json({
      success: true,
      quotation_number: quotationNumber,
      customers: customersRes.rows.map(normalizeCustomerForQuotation),
      catalog,
    });
  } catch (error) {
    console.error('getAddQuotationMeta:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listQuotations = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const data = await listQuotationsGrouped({
      page,
      limit,
      search: req.query.search || '',
      status: req.query.status,
      source_lead_id: req.query.source_lead_id,
    });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('listQuotations:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getQuotation = async (req, res) => {
  try {
    const lines = await getQuotationLines(req.params.quotationNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }
    res.json({
      success: true,
      quotation_number: req.params.quotationNumber,
      lines,
      remaining_qty: await getQuotationRemainingQty(req.params.quotationNumber),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.storeQuotation = async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body;
    const lineItems = normalizeLineItems(body);
    if (!lineItems.length) {
      return res.status(400).json({ success: false, message: 'At least one line item is required' });
    }

    const contactName = String(body.contact_name || body.customer_name || '').trim();
    const companyName = String(body.company_name || body.customer_name || '').trim();
    const phone = String(body.customer_mobile || body.phone || '').trim();
    if (!contactName) {
      return res.status(400).json({ success: false, message: 'Customer name is required' });
    }
    if (!companyName) {
      return res.status(400).json({ success: false, message: 'Company name is required' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone is required' });
    }
    const leadBlock = await assertLeadAllowsQuotationSend(toNullableInt(body.source_lead_id));
    if (leadBlock) {
      return res.status(400).json({ success: false, message: leadBlock });
    }

    const quoteEntity = entityForQuotationType(body.quotation_type || 'rental');
    const quotationNumber = body.quotation_number
      || (await nextDocumentNumber(entityDocType('quotation', quoteEntity)));
    const token = generateToken();
    const shipping = parseJsonField(body.customer_shipping_address);
    let billing = parseJsonField(body.customer_billing_address);
    if (billing && companyName) {
      billing = { ...billing, name: companyName };
    }
    const supplyState = resolveSupplyStateFromAddress(shipping, body.supply_state);

    const quotationType = body.quotation_type || 'rental';
    const quoteCustomerId = toNullableInt(body.customer_id);
    if (quoteCustomerId) {
      const custRes = await pool.query(
        `SELECT customer_id, customer_type, status FROM customers WHERE customer_id = $1 LIMIT 1`,
        [quoteCustomerId]
      );
      if (!custRes.rows.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid customer_id (${quoteCustomerId}). Please reselect customer and try again.`,
        });
      }
      if (Number(custRes.rows[0].status ?? 1) !== 1) {
        return res.status(400).json({
          success: false,
          message: 'This customer is inactive and cannot be used on a quotation. Activate the customer first.',
        });
      }
      if (!isCustomerEligibleForQuotation(custRes.rows[0].customer_type, quotationType)) {
        return res.status(400).json({
          success: false,
          message: customerTypeMismatchMessage(custRes.rows[0].customer_type, quotationType),
        });
      }
      if (!isCustomerTypeAllowed(req.allowedCustomerTypes, custRes.rows[0].customer_type)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: customer is outside your Customer Access scope',
        });
      }
    }

    await client.query('BEGIN');
    for (const item of lineItems) {
      await client.query(
        `INSERT INTO sales_quotations (
          quotation_number, customer_id, customer_name, customer_email, customer_mobile,
          customer_shipping_address, customer_billing_address, gst_number, supply_state,
          security_amount, shiping_charges, quotation_type, brand, model_name, processor,
          generation, ram, storage, gpu, screen_size, quantity, main_quantity, rate,
          locking_period, battery_charger_warranty, technical_warranty, remark, status, token,
          created_by, source_lead_id, company_name, contact_name
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'pending',$28,$29,$30,$31,$32)`,
        [
          quotationNumber,
          quoteCustomerId || null,
          companyName,
          body.email || body.customer_email || null,
          phone,
          shipping ? JSON.stringify(shipping) : null,
          billing ? JSON.stringify(billing) : null,
          body.GST_number || body.gst_number,
          supplyState,
          body.security_amount || 0,
          body.shiping_charges || 0,
          body.quotation_type || 'rental',
          item.brand,
          item.model_name,
          item.processor,
          item.generation,
          item.ram,
          item.storage,
          item.gpu,
          item.screen_size,
          item.quantity,
          item.quantity,
          item.rate,
          item.locking_period,
          item.battery_charger_warranty,
          item.technical_warranty,
          item.remark,
          token,
          req.user?.user_id,
          toNullableInt(body.source_lead_id),
          companyName,
          contactName,
        ]
      );
    }
    await client.query(
      `UPDATE sales_quotations SET entity_code = $1 WHERE quotation_number = $2`,
      [quoteEntity, quotationNumber]
    );

    // Security: 'one_month_rental' = sum(rate x qty) of all lines; 'none' = 0.
    const qSecurityType = String(body.security_type || 'none').toLowerCase();
    if (qSecurityType === 'one_month_rental') {
      const oneMonth = lineItems.reduce((s, it) => s + (Number(it.rate || 0) * Number(it.quantity || 1)), 0);
      await client.query(
        `UPDATE sales_quotations SET security_amount = $1, security_type = 'one_month_rental' WHERE quotation_number = $2`,
        [oneMonth, quotationNumber]
      );
    } else {
      await client.query(
        `UPDATE sales_quotations SET security_type = 'none' WHERE quotation_number = $1`,
        [quotationNumber]
      );
    }
    await client.query('COMMIT');

    const savedLines = await getQuotationLines(quotationNumber);
    const header = savedLines[0] || {};
    try {
      const pdfPath = await generateDocumentPdf({
        docType: 'quotation',
        docNumber: quotationNumber,
        header,
        lines: savedLines,
      });
      await pool.query(`UPDATE sales_quotations SET pdf_path = $1 WHERE quotation_number = $2`, [pdfPath, quotationNumber]);
    } catch (pdfErr) {
      console.warn('Quotation PDF skipped:', pdfErr.message);
    }

    res.status(201).json({ success: true, message: 'Quotation created', quotation_number: quotationNumber });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('storeQuotation:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.updateQuotationStatus = async (req, res) => {
  try {
    const { status, email, cc } = req.body;
    if (!['pending', 'sent', 'accepted', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const quotationNumber = req.params.quotationNumber;
    const lines = await getQuotationLines(quotationNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }
    const updaterName = req.user?.name || req.user?.username || req.user?.email || 'Admin';

    if (status === 'sent') {
      const result = await sendSalesQuotationEmail({
        quotationNumber,
        lines,
        toEmail: email,
        cc,
        user: req.user,
      });
      return res.json({
        success: true,
        message: `Quotation sent to ${result.to} from ${result.from}`,
        ...result,
      });
    }

    await pool.query(
      `UPDATE sales_quotations SET status = $1, status_updated_by_id = $2, status_updated_by_name = $3, updated_at = NOW()
       WHERE quotation_number = $4`,
      [status, req.user?.user_id, updaterName, quotationNumber]
    );

    res.json({
      success: true,
      message: 'Status updated',
    });
  } catch (error) {
    console.error('updateQuotationStatus:', error);
    const statusCode = /required|not found|can be sent/i.test(error.message || '') ? 400 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.sendQuotationEmail = async (req, res) => {
  try {
    const quotationNumber = req.params.quotationNumber;
    const lines = await getQuotationLines(quotationNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }
    const fieldError = assertQuotationSendFields(lines[0]);
    if (fieldError) {
      return res.status(400).json({ success: false, message: fieldError });
    }
    const result = await sendSalesQuotationEmail({
      quotationNumber,
      lines,
      toEmail: req.body?.email || req.body?.to,
      cc: req.body?.cc,
      user: req.user,
    });
    res.json({
      success: true,
      message: `Quotation sent to ${result.to} from ${result.from}`,
      ...result,
    });
  } catch (error) {
    console.error('sendQuotationEmail:', error);
    const statusCode = /required|not found|can be sent|not configured/i.test(error.message || '') ? 400 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.getAddSalesOrderMeta = async (req, res) => {
  try {
    const salesOrderNumber = await peekFinancialYearNumber('sales_order');
    const quotationNumber = req.query.quotation_number;
    const entityScope = String(req.query.entity_scope || '').toLowerCase();
    let quotationLines = [];
    if (quotationNumber) {
      quotationLines = await getQuotationLines(quotationNumber);
    }
    const scopeParams = [];
    const scopeConds = [];
    appendCustomerTypeCondition(req.allowedCustomerTypes, scopeConds, scopeParams, 'customer_type');
    const customers = entityScope === 'sale' || entityScope === 'rental'
      ? await listCustomersForOrderScope(entityScope, req.allowedCustomerTypes)
      : (await pool.query(
        `SELECT customer_id, name, company_name, email, phone, gst_no, address, details, customer_type
           FROM customers WHERE COALESCE(status, 1) = 1
           ${scopeConds.length ? `AND ${scopeConds[0]}` : ''}
           ORDER BY company_name ASC NULLS LAST, name ASC LIMIT 500`,
        scopeParams
      )).rows;
    res.json({
      success: true,
      sales_order_number: salesOrderNumber,
      quotation_number: quotationNumber || null,
      quotation_lines: quotationLines,
      customers: customers.map(normalizeCustomerForQuotation),
      entity_scope: entityScope || null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listSalesOrders = async (req, res) => {
  try {
    const scopeSection = salesOrderScopeSection(req.query.entity_scope);
    const assignedOnly = await isRestrictedToAssigned(req, scopeSection);
    const assignedUserId = assignedOnly ? scopeUserId(req.user) : null;
    const restrictDispatchWorkflow = req.user?.role === 'dispatch' && assignedOnly;
    if (!req.permissionCache) req.permissionCache = {};
    const orderType = await resolveSalesOrderListOrderType(
      req.user,
      req.query.order_type || '',
      req.permissionCache
    );
    const data = await listSalesOrdersGrouped({
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
      search: req.query.search || '',
      assignedUserId,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      customerId: req.query.customer_id || null,
      status: req.query.status || '',
      entityScope: req.query.entity_scope || '',
      orderType,
      viewerRole: req.user?.role || null,
      viewerUserId: req.user?.user_id || null,
      restrictDispatchWorkflow,
    });
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSalesOrder = async (req, res) => {
  try {
    if (!req.dispatchSoAccess) {
      await assertSalesOrderVisibleToUser(req.params.salesOrderNumber, req.user);
      if (!req.permissionCache) req.permissionCache = {};
      await assertReplacementSalesOrderAccessIfScoped(
        req.params.salesOrderNumber,
        req.user,
        req.permissionCache
      );
    }
    const lines = await getSalesOrderLines(req.params.salesOrderNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    res.json({
      success: true,
      sales_order_number: req.params.salesOrderNumber,
      lines,
      remaining_qty: await getSalesOrderRemainingQty(req.params.salesOrderNumber),
    });
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.storeSalesOrder = async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body;
    const lineItems = normalizeLineItems(body);
    if (!lineItems.length) {
      return res.status(400).json({ success: false, message: 'At least one line item is required' });
    }

    const salesOrderNumber = await nextFinancialYearNumber('sales_order');
    const quotationNumber = body.is_without_quotation ? 'N/A' : (body.quotation_number || 'N/A');
    const shipping = parseJsonField(body.customer_shipping_address);
    let billing = parseJsonField(body.customer_billing_address);
    if (billing && body.customer_name) {
      billing = { ...billing, name: body.customer_name };
    }
    const supplyState = resolveSupplyStateFromAddress(shipping, body.supply_state);
    const customerId = toNullableInt(body.customer_id);
    const isWfh = body.is_wfh === true || body.is_wfh === 'true' || body.is_wfh === 1;
    const shippingCharge = Number(body.shiping_charges || 0) || 0;
    if (isWfh && shippingCharge <= 0) {
      return res.status(400).json({
        success: false,
        message: 'WFH sales orders require shipping charges greater than zero (GST applies on shipping).',
      });
    }
    // Map SO shipping address into per-line delivery_address shape used by Addresses / DC.
    let lineDeliveryAddress = null;
    if (shipping && typeof shipping === 'object') {
      const name = String(shipping.name || '').trim();
      const phone = String(shipping.phone || shipping.mobile || '').trim();
      const address = String(shipping.address || '').trim();
      const city = String(shipping.city || '').trim();
      const state = String(shipping.state || '').trim();
      const pincode = String(shipping.pincode || shipping.zip_code || '').trim();
      if (isWfh && (!name || !phone || !address || !city || !state || !pincode)) {
        return res.status(400).json({
          success: false,
          message: 'WFH requires Name, Phone, Address, City, State and Pincode on the WFH address.',
        });
      }
      lineDeliveryAddress = {
        name,
        phone,
        address,
        city,
        state,
        pincode,
        landmark: String(shipping.landmark || '').trim() || undefined,
        employee_name: String(body.wfh_employee_name || shipping.employee_name || '').trim() || undefined,
        employee_phone: String(body.wfh_employee_phone || shipping.employee_phone || '').trim() || undefined,
      };
    } else if (isWfh) {
      return res.status(400).json({
        success: false,
        message: 'WFH requires a complete WFH delivery address.',
      });
    }

    if (customerId) {
      const customerExists = await pool.query(
        `SELECT customer_id, customer_type, status FROM customers WHERE customer_id = $1 LIMIT 1`,
        [customerId]
      );
      if (!customerExists.rows.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid customer_id (${customerId}). Please reselect customer and try again.`,
        });
      }
      if (Number(customerExists.rows[0].status ?? 1) !== 1) {
        return res.status(400).json({
          success: false,
          message: 'This customer is inactive and cannot be used on a sales order. Activate the customer first.',
        });
      }
      const soQuotationType = body.quotation_type || 'rental';
      if (!isCustomerEligibleForQuotation(customerExists.rows[0].customer_type, soQuotationType)) {
        return res.status(400).json({
          success: false,
          message: customerTypeMismatchMessage(customerExists.rows[0].customer_type, soQuotationType),
        });
      }
      if (!isCustomerTypeAllowed(req.allowedCustomerTypes, customerExists.rows[0].customer_type)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: customer is outside your Customer Access scope',
        });
      }
    }

    await client.query('BEGIN');
    const soQuotationTypeForHsn = body.quotation_type || 'rental';
    for (const item of lineItems) {
      const lineHsn = resolveHsnForPersist({
        quotationType: soQuotationTypeForHsn,
        override: item.hsn_code ?? item.hsnCode ?? body.hsn_code,
        role: req.user?.role,
      });
      await client.query(
        `INSERT INTO sales_order_lines (
          sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile,
          customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount,
          shiping_charges, quotation_type, branch, brand, model_name, processor, generation, ram, storage,
          gpu, screen_size, quantity, main_qty, rate, locking_period, battery_charger_warranty,
          technical_warranty, remark, status, token, created_by, hsn_code,
          is_wfh, delivery_address, delivery_notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'pending',$30,$31,$32,$33,$34::jsonb,$35)`,
        [
          salesOrderNumber,
          quotationNumber,
          customerId,
          body.customer_name,
          body.email || body.customer_email,
          body.customer_mobile,
          shipping ? JSON.stringify(shipping) : null,
          billing ? JSON.stringify(billing) : null,
          body.GST_number || body.gst_number,
          supplyState,
          body.security_amount || 0,
          shippingCharge,
          soQuotationTypeForHsn,
          body.branch || 'rentfoxxy',
          item.brand,
          item.model_name,
          item.processor,
          item.generation,
          item.ram,
          item.storage,
          item.gpu,
          item.screen_size,
          item.quantity,
          item.quantity,
          item.rate,
          item.locking_period,
          item.technical_warranty,
          item.battery_charger_warranty,
          item.remark,
          generateToken(),
          req.user?.user_id,
          lineHsn,
          isWfh,
          lineDeliveryAddress ? JSON.stringify(lineDeliveryAddress) : null,
          body.delivery_notes != null ? String(body.delivery_notes) : null,
        ]
      );
    }
    // Tag the owning entity (Sales -> gorefurbo, Rental/Demo -> rentfoxxy).
    await client.query(
      `UPDATE sales_order_lines SET entity_code = $1 WHERE sales_order_number = $2`,
      [entityForQuotationType(body.quotation_type || 'rental', body.branch), salesOrderNumber]
    );

    // Security: 'one_month_rental' auto-computes from the sum of each line's
    // monthly rate x qty (server-authoritative). 'none' = 0.
    const securityType = String(body.security_type || 'none').toLowerCase();
    if (securityType === 'one_month_rental') {
      await client.query(
        `UPDATE sales_order_lines
            SET security_amount = ROUND((COALESCE(rate, 0) * COALESCE(main_qty, quantity, 1))::numeric, 2),
                security_type = 'one_month_rental'
          WHERE sales_order_number = $1`,
        [salesOrderNumber]
      );
    } else {
      await client.query(
        `UPDATE sales_order_lines SET security_type = 'none' WHERE sales_order_number = $1`,
        [salesOrderNumber]
      );
    }

    const dispatchWf = require('../services/dispatchWorkflowService');
    const wfStart = await dispatchWf.startWorkflow(client, {
      salesOrderNumber,
      quotationType: body.quotation_type || 'rental',
      user: req.user,
    });

    await client.query('COMMIT');

    if (wfStart?.notifyUserId) {
      await dispatchWf.postStartWorkflowNotifications({
        salesOrderNumber,
        notifyUserId: wfStart.notifyUserId,
        assigneeName: wfStart.assigneeName,
      });
    }

    const savedLines = await getSalesOrderLines(salesOrderNumber);
    const header = savedLines[0] || {};
    try {
      const pdfPath = await generateDocumentPdf({
        docType: 'sales_order',
        docNumber: salesOrderNumber,
        header,
        lines: savedLines,
      });
      await pool.query(`UPDATE sales_order_lines SET pdf_path = $1 WHERE sales_order_number = $2`, [pdfPath, salesOrderNumber]);
      if (header.customer_email) {
        await emailDocument({
          to: header.customer_email,
          subject: `Sales Order ${salesOrderNumber}`,
          text: `Your sales order ${salesOrderNumber} has been created.`,
          pdfRelativePath: pdfPath,
        });
      }
    } catch (pdfErr) {
      console.warn('Sales order PDF/email skipped:', pdfErr.message);
    }

    res.status(201).json({ success: true, message: 'Sales order created', sales_order_number: salesOrderNumber });

    await safeLogSalesOrderActivity({
      salesOrderNumber,
      activityType: ACTIVITY_TYPES.SALES_ORDER,
      action: 'created',
      description: `${req.user?.name || 'User'} created Sales Order ${salesOrderNumber}.`,
      user: req.user,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('storeSalesOrder:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

/** PATCH /sales-orders/:soNumber — Edit rental/sale SO before any DC is created. */
exports.updateSalesOrder = async (req, res) => {
  const client = await pool.connect();
  try {
    const soNumber = req.params.soNumber || req.params.salesOrderNumber;
    const body = req.body || {};
    const lineItems = normalizeLineItems(body);
    if (!lineItems.length) {
      return res.status(400).json({ success: false, message: 'At least one line item is required' });
    }

    await client.query('BEGIN');

    const existingRes = await client.query(
      `SELECT id, status, quotation_type, quotation_number, customer_id
         FROM sales_order_lines
        WHERE sales_order_number = $1
        ORDER BY id ASC
        FOR UPDATE`,
      [soNumber]
    );
    if (!existingRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    if (existingRes.rows.every((r) => String(r.status || '').toLowerCase() === 'cancelled')) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Sales order is cancelled' });
    }

    await assertReplacementSalesOrderAccessIfScoped(soNumber, req.user, req.permissionCache);

    const dcRes = await client.query(
      `SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines WHERE sales_order_number = $1`,
      [soNumber]
    );
    if (Number(dcRes.rows[0]?.c || 0) > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Cannot edit: a delivery challan has already been created for this sales order.',
      });
    }

    const head = existingRes.rows[0];
    const supportMeta = await getSalesOrderSupportMeta(soNumber);
    if (supportMeta.is_replacement_order) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'Replacement sales orders cannot be edited from this screen.',
      });
    }

    const shipping = parseJsonField(body.customer_shipping_address);
    let billing = parseJsonField(body.customer_billing_address);
    if (billing && body.customer_name) {
      billing = { ...billing, name: body.customer_name };
    }
    const supplyState = resolveSupplyStateFromAddress(
      shipping,
      body.supply_state || head.supply_state
    );
    const shippingJson = shipping ? JSON.stringify(shipping) : null;
    const billingJson = billing ? JSON.stringify(billing) : null;
    const customerId = body.customer_id != null && body.customer_id !== ''
      ? toNullableInt(body.customer_id)
      : head.customer_id;

    const attachedByLine = {};
    const attachedRes = await client.query(
      `SELECT line_id, COUNT(*)::int AS n
         FROM sales_order_serials
        WHERE sales_order_number = $1 AND status <> 'removed'
        GROUP BY line_id`,
      [soNumber]
    );
    attachedRes.rows.forEach((r) => {
      attachedByLine[r.line_id] = Number(r.n || 0);
    });

    const keptLineIds = new Set();
    for (const item of lineItems) {
      const qty = Number(item.quantity || 1);
      if (!Number.isInteger(qty) || qty < 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Each line quantity must be at least 1' });
      }
      if (!item.brand || !item.processor || !item.generation || !item.ram || !item.storage) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Each line requires brand, processor, generation, RAM, and storage',
        });
      }
      const rate = Number(item.rate || 0);
      if (!Number.isFinite(rate) || rate <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Each line requires a positive rate' });
      }

      const lineId = item.line_id ? parseInt(item.line_id, 10) : null;
      if (lineId) {
        const existingLine = existingRes.rows.find((r) => r.id === lineId);
        if (!existingLine) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: `Invalid line id ${lineId}` });
        }
        const attachedCount = attachedByLine[lineId] || 0;
        if (qty < attachedCount) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: `Quantity cannot be less than attached units (${attachedCount}).`,
          });
        }
        await client.query(
          `UPDATE sales_order_lines SET
             brand = $1, model_name = $2, processor = $3, generation = $4,
             ram = $5, storage = $6, gpu = $7, screen_size = $8,
             quantity = $9, main_qty = $9, rate = $10,
             locking_period = $11, technical_warranty = $12,
             battery_charger_warranty = $13, remark = $14,
             updated_at = NOW()
           WHERE id = $15 AND sales_order_number = $16`,
          [
            item.brand, item.model_name, item.processor, item.generation,
            item.ram, item.storage, item.gpu || null, item.screen_size || null,
            qty, +rate.toFixed(2),
            item.locking_period, item.technical_warranty, item.battery_charger_warranty,
            item.remark, lineId, soNumber,
          ]
        );
        keptLineIds.add(lineId);
      } else {
        const soQuotationType = body.quotation_type || head.quotation_type || 'rental';
        const lineHsn = resolveHsnForPersist({
          quotationType: soQuotationType,
          override: item.hsn_code ?? item.hsnCode ?? body.hsn_code,
          role: req.user?.role,
        });
        const ins = await client.query(
          `INSERT INTO sales_order_lines (
             sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile,
             customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount,
             shiping_charges, quotation_type, branch, brand, model_name, processor, generation, ram, storage,
             gpu, screen_size, quantity, main_qty, rate, locking_period, battery_charger_warranty,
             technical_warranty, remark, status, token, created_by, hsn_code
           ) SELECT
             $1, quotation_number, customer_id, customer_name, customer_email, customer_mobile,
             customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount,
             shiping_charges, quotation_type, branch, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11,
             $12, $13, $14, $15, 'pending', $16, created_by, $17
             FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1
           RETURNING id`,
          [
            soNumber,
            item.brand, item.model_name, item.processor, item.generation,
            item.ram, item.storage, item.gpu || null, item.screen_size || null,
            qty, +rate.toFixed(2),
            item.locking_period, item.battery_charger_warranty, item.technical_warranty,
            item.remark, generateToken(), lineHsn,
          ]
        );
        keptLineIds.add(ins.rows[0].id);
      }
    }

    for (const row of existingRes.rows) {
      if (keptLineIds.has(row.id)) continue;
      const attachedCount = attachedByLine[row.id] || 0;
      if (attachedCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Cannot remove a line that has laptops attached. Detach them first.',
        });
      }
      await client.query(
        `DELETE FROM sales_order_lines WHERE id = $1 AND sales_order_number = $2`,
        [row.id, soNumber]
      );
    }

    await client.query(
      `UPDATE sales_order_lines SET
         customer_id = COALESCE($1, customer_id),
         customer_name = COALESCE($2, customer_name),
         customer_email = COALESCE($3, customer_email),
         customer_mobile = COALESCE($4, customer_mobile),
         gst_number = COALESCE($5, gst_number),
         supply_state = $6,
         shiping_charges = COALESCE($7, shiping_charges),
         customer_shipping_address = COALESCE($8::jsonb, customer_shipping_address),
         customer_billing_address = COALESCE($9::jsonb, customer_billing_address),
         is_wfh = $10,
         delivery_address = COALESCE($11::jsonb, delivery_address),
         updated_at = NOW()
       WHERE sales_order_number = $12`,
      [
        customerId,
        body.customer_name ?? null,
        body.email || body.customer_email || null,
        body.customer_mobile ?? null,
        body.GST_number || body.gst_number || null,
        supplyState,
        body.shiping_charges != null ? Number(body.shiping_charges) || 0 : null,
        shippingJson,
        billingJson,
        body.is_wfh === true || body.is_wfh === 'true' || body.is_wfh === 1,
        (() => {
          if (!shipping || typeof shipping !== 'object') return null;
          const name = String(shipping.name || '').trim();
          const phone = String(shipping.phone || shipping.mobile || '').trim();
          const address = String(shipping.address || '').trim();
          const city = String(shipping.city || '').trim();
          const state = String(shipping.state || '').trim();
          const pincode = String(shipping.pincode || shipping.zip_code || '').trim();
          if (!name && !address) return null;
          return JSON.stringify({
            name,
            phone,
            address,
            city,
            state,
            pincode,
            landmark: String(shipping.landmark || '').trim() || undefined,
            employee_name: String(body.wfh_employee_name || shipping.employee_name || '').trim() || undefined,
            employee_phone: String(body.wfh_employee_phone || shipping.employee_phone || '').trim() || undefined,
          });
        })(),
        soNumber,
      ]
    );

    const securityType = String(body.security_type || 'none').toLowerCase();
    if (securityType === 'one_month_rental') {
      await client.query(
        `UPDATE sales_order_lines
            SET security_amount = ROUND((COALESCE(rate, 0) * COALESCE(main_qty, quantity, 1))::numeric, 2),
                security_type = 'one_month_rental'
          WHERE sales_order_number = $1`,
        [soNumber]
      );
    } else if (body.security_amount != null || body.security_type != null) {
      await client.query(
        `UPDATE sales_order_lines
            SET security_amount = COALESCE($1, security_amount),
                security_type = 'none'
          WHERE sales_order_number = $2`,
        [body.security_amount != null ? Number(body.security_amount) || 0 : null, soNumber]
      );
    }

    await client.query('COMMIT');

    let pdfPath = null;
    try {
      const regen = await regenerateSoAndLinkedDcPdfs(soNumber);
      pdfPath = regen.so_pdf_path;
    } catch (pdfErr) {
      console.warn('SO PDF regeneration after update:', pdfErr.message);
    }

    res.json({
      success: true,
      message: 'Sales order updated',
      sales_order_number: soNumber,
      pdf_path: pdfPath,
    });

    await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.SALES_ORDER,
      action: 'updated',
      description: `${req.user?.name || 'User'} updated Sales Order ${soNumber}.`,
      user: req.user,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    console.error('updateSalesOrder:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.getAddDeliveryChallanMeta = async (req, res) => {
  try {
    const salesOrderNumber = req.query.sales_order_number;
    if (!salesOrderNumber) {
      return res.status(400).json({ success: false, message: 'sales_order_number is required' });
    }
    const lines = await getSalesOrderLines(salesOrderNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    const header = lines[0];
    let billing = parseJsonSafe(header.customer_billing_address);
    let shipping = parseJsonSafe(header.customer_shipping_address);

    // Resolve customer details from the customers table when the SO snapshot is
    // incomplete (older SOs stored customer_id but not name/billing).
    let customerRow = null;
    if (header.customer_id) {
      const cRes = await pool.query(
        `SELECT customer_id, name, company_name, email, phone, whatsapp_number,
                gst_no, billing_address, billing_city, billing_state, billing_pincode, details
           FROM customers WHERE customer_id = $1`,
        [header.customer_id]
      );
      customerRow = cRes.rows[0] || null;
    }
    if ((!billing || !billing.address) && customerRow) {
      const cb = parseJsonSafe(customerRow.billing_address);
      billing = (cb && (cb.address || cb.city)) ? cb : {
        name: customerRow.company_name || customerRow.name,
        phone: customerRow.phone,
        gst_number: customerRow.gst_no,
        address: typeof customerRow.billing_address === 'string' ? customerRow.billing_address : '',
        city: customerRow.billing_city,
        state: customerRow.billing_state,
        zip_code: customerRow.billing_pincode,
        country: 'India',
      };
    }
    if (!shipping && customerRow) {
      const details = parseJsonSafe(customerRow.details, {}) || {};
      const sa = Array.isArray(details.shipping_address) ? details.shipping_address.slice(-1)[0] : null;
      if (sa) shipping = sa;
    }
    const shippableLines = lines.filter((line) => Number(line.quantity) > 0);
    const existingDc = await pool.query(
      `SELECT dc_number FROM delivery_challan_lines WHERE sales_order_number = $1 LIMIT 1`,
      [salesOrderNumber]
    );
    const [dcNumber, deliveryPersons, deliveryTechnicians, catalog] = await Promise.all([
      existingDc.rows[0]?.dc_number || peekFinancialYearNumber('delivery_challan'),
      pool.query(`SELECT user_id, name, email FROM users WHERE status = 'active' ORDER BY name ASC LIMIT 100`),
      pool.query(`SELECT technician_id, user_id, first_name, last_name, phone, email, is_active
                    FROM delivery_technicians WHERE is_active = TRUE
                   ORDER BY first_name, last_name`).catch(() => ({ rows: [] })),
      fetchCatalogAttributeOptions(),
    ]);

    // Laptops the warehouse already attached to this SO (new flow). The DC is
    // generated from these — no re-selection of serials.
    const attachedRes = await pool.query(
      `SELECT sos.allocation_id, sos.line_id, sos.serial_id, sos.ttspl_id, sos.serial_number,
              sos.qc_status, sos.status, sos.delivery_address, sos.is_wfh, sos.delivery_notes,
              COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
              COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
              COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
              COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
              COALESCE(vsn.extra->>'storage', vpd.storage) AS storage,
              COALESCE(vsn.extra->>'gpu', vpd.gpu) AS gpu,
              COALESCE(vsn.extra->>'screen_size', vpd.screen_size) AS screen_size
         FROM sales_order_serials sos
         LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
         LEFT JOIN vendor_product_details vpd ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
        WHERE sos.sales_order_number = $1 AND sos.status = 'attached'
        ORDER BY sos.allocation_id ASC`,
      [salesOrderNumber]
    ).catch(() => ({ rows: [] }));
    const attachedSerials = attachedRes.rows;
    res.json({
      success: true,
      sales_order_number: salesOrderNumber,
      quotation_number: header.quotation_number,
      quotation_type: header.quotation_type,
      branch: header.branch,
      security_amount: header.security_amount,
      shiping_charges: header.shiping_charges,
      customer_id: header.customer_id,
      customer_name: header.customer_name || customerRow?.company_name || customerRow?.name || '',
      customer_email: header.customer_email || customerRow?.email || '',
      customer_mobile: header.customer_mobile || customerRow?.phone || customerRow?.whatsapp_number || '',
      gst_number: header.gst_number || customerRow?.gst_no || '',
      supply_state: header.supply_state,
      billing_address: billing,
      shipping_address: shipping,
      sales_order_lines: shippableLines,
      attached_serials: attachedSerials,
      use_attached: attachedSerials.length > 0,
      all_attached_qc_passed: attachedSerials.length > 0 && attachedSerials.every((a) => a.qc_status === 'passed'),
      dc_number: dcNumber,
      remaining_qty: await getSalesOrderRemainingQty(salesOrderNumber),
      delivery_persons: deliveryPersons.rows.map((u) => ({
        id: u.user_id,
        name: u.name || u.email,
      })),
      delivery_technicians: deliveryTechnicians.rows,
      catalog,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listDeliveryChallans = async (req, res) => {
  try {
    const assignedOnly = await isRestrictedToAssigned(req, 'dispatch')
      || await isRestrictedToAssigned(req, 'delivery_challans');
    const assignedUserId = assignedOnly ? scopeUserId(req.user) : null;
    const data = await listDeliveryChallansGrouped({
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
      search: req.query.search || '',
      status: req.query.status || '',
      dcPurpose: req.query.dc_purpose || req.query.purpose || '',
      assignedUserId,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
    });
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDcCourierTracking = async (req, res) => {
  try {
    const lines = await getDeliveryChallanLines(req.params.dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const head = lines[0];
    const { splitAwbTokens } = require('../utils/bluedartAwbUtils');

    const unitsRes = await pool.query(
      `SELECT id, allocation_id, serial_id, serial_number, ttspl_id, courier_name,
              awb_number, weight, remarks, status, tracking_status, tracking_status_type,
              tracking_synced_at, received_by, delivered_at
         FROM dc_shipment_units
        WHERE dc_number = $1
        ORDER BY id ASC`,
      [req.params.dcNumber]
    ).catch(() => ({ rows: [] }));
    const units = unitsRes.rows || [];

    const awbNumbers = units.length
      ? [...new Set(units.map((u) => String(u.awb_number || '').trim()).filter((a) => /^\d{8,}$/.test(a)))]
      : splitAwbTokens(head.awb_number);

    if (!awbNumbers.length) {
      return res.status(400).json({ success: false, message: 'No AWB number on this delivery challan' });
    }

    const bluedartTracking = require('../services/bluedartTrackingService');
    const rawTrackings = await bluedartTracking.trackAwbs(awbNumbers);
    const byAwb = new Map(rawTrackings.map((t) => [String(t.awb_number || '').trim(), t]));

    const trackings = (units.length ? units : awbNumbers.map((awb) => ({ awb_number: awb }))).map((unit) => {
      const awb = String(unit.awb_number || '').trim();
      const t = byAwb.get(awb) || {};
      const scans = Array.isArray(t.scans) ? t.scans : [];
      const locationFromScan = scans.find((s) => s?.location)?.location || scans[0]?.location || null;
      const laptopLabel = unit.ttspl_id || unit.serial_number
        ? `${unit.ttspl_id || ''}${unit.ttspl_id && unit.serial_number ? ' / ' : ''}${unit.serial_number || ''}`.trim()
        : null;
      return {
        laptop: laptopLabel,
        serial_number: unit.serial_number || null,
        ttspl_id: unit.ttspl_id || null,
        allocation_id: unit.allocation_id || null,
        courier_name: unit.courier_name || head.courier_name || 'BlueDart',
        awb_number: awb || null,
        status: t.status || unit.tracking_status || null,
        status_type: t.status_type || unit.tracking_status_type || null,
        status_date: t.status_date || null,
        status_time: t.status_time || null,
        last_updated: [t.status_date, t.status_time].filter(Boolean).join(' ') || null,
        current_location: locationFromScan || t.destination || t.origin || null,
        received_by: t.received_by || unit.received_by || null,
        unit_status: unit.status || null,
        found: t.found !== false,
        origin: t.origin || null,
        destination: t.destination || null,
        expected_delivery: t.expected_delivery || null,
        scans,
      };
    });

    // Persist live tracking onto shipment units (best-effort)
    for (const row of trackings) {
      if (!row.awb_number) continue;
      const delivered = bluedartTracking.isDeliveredShipment(row);
      await pool.query(
        `UPDATE dc_shipment_units
            SET tracking_status = $2,
                tracking_status_type = $3,
                tracking_synced_at = NOW(),
                received_by = COALESCE($4, received_by),
                status = CASE WHEN $5 THEN 'delivered' ELSE status END,
                delivered_at = CASE WHEN $5 THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
                updated_at = NOW()
          WHERE dc_number = $1 AND awb_number = $6`,
        [
          req.params.dcNumber,
          row.status,
          row.status_type,
          row.received_by,
          delivered,
          row.awb_number,
        ]
      ).catch(() => {});
    }

    return res.json({
      success: true,
      data: {
        dc_number: req.params.dcNumber,
        courier_name: head.courier_name || null,
        courier_tracking_url: head.courier_tracking_url || null,
        awb_number: awbNumbers.join(','),
        awb_numbers: awbNumbers,
        tracking: trackings[0] || null,
        trackings,
        shipment_units: units,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

/** Manual trigger: BlueDart TNT bulk sync for undelivered AWBs. */
exports.runBluedartAwbSync = async (req, res) => {
  try {
    const bluedartTracking = require('../services/bluedartTrackingService');
    if (!bluedartTracking.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'BlueDart tracking is not configured on the server',
      });
    }
    const dryRun = String(req.query.dry_run || req.body?.dry_run || '') === '1'
      || req.body?.dry_run === true;
    const { syncUndeliveredAwbs, isSyncRunning } = require('../services/bluedartAwbSyncService');
    if (isSyncRunning()) {
      return res.status(409).json({ success: false, message: 'BlueDart AWB sync already running' });
    }
    const summary = await syncUndeliveredAwbs({ dryRun });
    return res.json({ success: !!summary.success, data: summary });
  } catch (error) {
    console.error('runBluedartAwbSync:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Prefer final overlay PDF, then fixed/multi/updated, then raw BlueDart label. */
function findSavedWaybillPdfFile(awb) {
  const { splitAwbTokens } = require('../utils/bluedartAwbUtils');
  const tokens = splitAwbTokens(awb);
  if (tokens.length > 1) {
    return findSavedWaybillPdfFile(tokens[0]);
  }
  awb = tokens[0] || String(awb || '').trim();
  if (!awb) return null;
  const dir = path.join(__dirname, '..', 'uploads', 'bluedart');
  if (!fs.existsSync(dir)) return null;
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf') && f.includes(awb));
  const prefer = [`_final`, `_fixed`, `_updated`, `_multi`];
  for (const suffix of prefer) {
    const exact = `waybill_${awb}${suffix}.pdf`;
    if (all.includes(exact)) return path.join(dir, exact);
    const match = all.filter((f) => f.includes(suffix) && f.startsWith(`waybill_${awb}`)).sort();
    if (match.length) return path.join(dir, match[match.length - 1]);
  }
  const printCopies = all.filter((f) => f.startsWith(`waybill_print_${awb}`)).sort();
  if (printCopies.length) return path.join(dir, printCopies[printCopies.length - 1]);
  const raw = all.filter((f) => (
    f.startsWith(`waybill_${awb}`)
    && !f.includes('_multi')
    && !f.includes('_updated')
    && !f.includes('_fixed')
    && !f.includes('_final')
  )).sort();
  if (raw.length) return path.join(dir, raw[raw.length - 1]);
  return null;
}

async function listDcAwbShipments(dcNumber, head = {}) {
  const { splitAwbTokens } = require('../utils/bluedartAwbUtils');
  const unitsRes = await pool.query(
    `SELECT id, allocation_id, serial_id, serial_number, ttspl_id, courier_name, awb_number
       FROM dc_shipment_units
      WHERE dc_number = $1
      ORDER BY id ASC`,
    [dcNumber]
  ).catch(() => ({ rows: [] }));

  const fromUnits = (unitsRes.rows || [])
    .map((u) => ({
      id: u.id,
      allocation_id: u.allocation_id || null,
      serial_id: u.serial_id || null,
      serial_number: u.serial_number || null,
      ttspl_id: u.ttspl_id || null,
      courier_name: u.courier_name || head.courier_name || 'BlueDart',
      awb_number: String(u.awb_number || '').trim(),
    }))
    .filter((u) => /^\d{8,}$/.test(u.awb_number));

  const source = fromUnits.length
    ? fromUnits
    : splitAwbTokens(head.awb_number).map((awb) => ({
      id: null,
      allocation_id: null,
      serial_id: null,
      serial_number: null,
      ttspl_id: null,
      courier_name: head.courier_name || 'BlueDart',
      awb_number: awb,
    }));

  return source.map((row) => ({
    ...row,
    pdf_available: Boolean(findSavedWaybillPdfFile(row.awb_number)),
  }));
}

async function mergeWaybillPdfBuffers(absPaths) {
  const { PDFDocument } = require('pdf-lib');
  const out = await PDFDocument.create();
  for (const abs of absPaths) {
    const bytes = fs.readFileSync(abs);
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((page) => out.addPage(page));
  }
  return Buffer.from(await out.save());
}

async function resolveDcPrimarySerial(dcNumber) {
  const r = await pool.query(
    `SELECT COALESCE(NULLIF(split_part(sn.entry, '|', 2), ''), sn.entry) AS serial_token,
            NULLIF(split_part(sn.entry, '|', 3), '') AS ttspl_token,
            NULLIF(split_part(sn.entry, '|', 1), '') AS serial_id_token
       FROM delivery_challan_lines dcl
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE
           WHEN jsonb_typeof(to_jsonb(dcl.serial_number)) = 'array' THEN to_jsonb(dcl.serial_number)
           WHEN dcl.serial_number IS NULL THEN '[]'::jsonb
           ELSE jsonb_build_array(dcl.serial_number::text)
         END
       ) AS sn(entry)
      WHERE dcl.dc_number = $1
      LIMIT 1`,
    [dcNumber]
  ).catch(() => ({ rows: [] }));
  const row = r.rows[0];
  if (!row) return { serialNumber: null, ttsplId: null };

  let serialNumber = row.serial_token || null;
  let ttsplId = row.ttspl_token || null;
  const sid = row.serial_id_token && /^\d+$/.test(row.serial_id_token) ? Number(row.serial_id_token) : null;
  if (sid) {
    const v = await pool.query(
      `SELECT serial_number, inventory_asset_code FROM vendor_serial_numbers WHERE serial_id = $1`,
      [sid]
    ).catch(() => ({ rows: [] }));
    if (v.rows[0]) {
      serialNumber = v.rows[0].serial_number || serialNumber;
      ttsplId = v.rows[0].inventory_asset_code || ttsplId;
    }
  } else if (serialNumber && !ttsplId) {
    const v = await pool.query(
      `SELECT serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (serial_number = $1 OR inventory_asset_code = $1)
        LIMIT 1`,
      [serialNumber]
    ).catch(() => ({ rows: [] }));
    if (v.rows[0]) {
      serialNumber = v.rows[0].serial_number || serialNumber;
      ttsplId = v.rows[0].inventory_asset_code || ttsplId;
    }
  }
  return { serialNumber, ttsplId };
}

async function buildAndSavePrintableWaybillPdf({
  awbNumber,
  creditReferenceNo,
  result = {},
  dcNumber = null,
  serialNumber = null,
  ttsplId = null,
  pickupDate = null,
  pickupTime = null,
}) {
  const courierPdf = require('../services/courierWaybillPdfService');

  let serial = serialNumber;
  let ttspl = ttsplId;
  if (dcNumber && (!serial || !ttspl)) {
    const primary = await resolveDcPrimarySerial(dcNumber);
    serial = serial || primary.serialNumber;
    ttspl = ttspl || primary.ttsplId;
  }

  const referenceId = courierPdf.buildShipmentReference({
    serialNumber: serial,
    ttsplId: ttspl,
    fallback: creditReferenceNo || result.credit_reference_no,
  });

  const pdfBuffer = result.pdf_buffer || null;
  if (!pdfBuffer || !pdfBuffer.length) {
    const err = new Error('BlueDart did not return AWBPrintContent — updated PDF cannot be built');
    err.status = 502;
    throw err;
  }

  const printed = await courierPdf.generateMultiCopyWaybillFromApiPdf(pdfBuffer, awbNumber, {
    pickupDate: pickupDate || result.pickup_date || result.ShipmentPickupDate || new Date(),
    pickupTime: pickupTime || result.pickup_time || '1530',
  });

  return {
    pdf_path: printed.pdf_path,
    reference_id: referenceId,
    serial_number: serial,
    ttspl_id: ttspl,
    pickup_date_display: printed.pickup_date_display,
  };
}

/** Preview / generate BlueDart AWB before or while creating a DC (does not attach to a DC row). */
exports.generateBluedartWaybill = async (req, res) => {
  try {
    const bluedartWaybill = require('../services/bluedartWaybillService');
    const courierPdf = require('../services/courierWaybillPdfService');
    if (!bluedartWaybill.isWaybillConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'BlueDart waybill is not configured on the server',
      });
    }
    const body = req.body || {};
    const serialNumber = body.serial_number || body.serialNumber || null;
    const ttsplId = body.ttspl_id || body.ttsplId || null;
    const creditRef = body.credit_reference_no || body.creditReferenceNo
      || courierPdf.buildShipmentReference({
        serialNumber,
        ttsplId,
        fallback: `RFX${Date.now().toString(36).toUpperCase()}`,
      });

    const result = await bluedartWaybill.generateWayBill({
      consignee: body.consignee || {},
      services: {
        ...(body.services || {}),
        pdfOutputNotRequired: false,
      },
      creditReferenceNo: creditRef,
    });

    const printed = await buildAndSavePrintableWaybillPdf({
      awbNumber: result.awb_number,
      creditReferenceNo: creditRef,
      consignee: body.consignee || {},
      services: body.services || {},
      result,
      itemName: body.services?.itemName,
      serialNumber,
      ttsplId,
      dcNumber: body.dc_number || null,
      salesOrderNumber: body.sales_order_number || null,
    });

    bluedartWaybill.saveWaybillPdf(result.awb_number, result.pdf_buffer);

    const { pdf_buffer: _buf, raw: _raw, ...safe } = result;
    const pdfPath = printed.pdf_path;

    const wantDownload = String(req.query.download || '') === '1'
      || body.download_pdf === true
      || String(req.headers.accept || '').includes('application/pdf');

    if (wantDownload && pdfPath) {
      const abs = path.join(__dirname, '..', pdfPath);
      if (fs.existsSync(abs)) {
        return res.download(abs, `Waybill_${result.awb_number}.pdf`);
      }
    }

    return res.json({
      success: true,
      data: {
        ...safe,
        credit_reference_no: creditRef,
        reference_id: printed.reference_id,
        serial_number: printed.serial_number,
        ttspl_id: printed.ttspl_id,
        pdf_path: pdfPath,
        pdf_url: pdfPath ? `/${String(pdfPath).replace(/^\//, '')}` : null,
        pdf_saved: Boolean(pdfPath),
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message,
      details: error.details || undefined,
    });
  }
};

/** Download a previously saved printable waybill PDF by AWB number. */
exports.downloadBluedartWaybillPdfByAwb = async (req, res) => {
  try {
    const awb = String(req.params.awb || req.query.awb || '').trim();
    if (!awb) {
      return res.status(400).json({ success: false, message: 'AWB number required' });
    }
    const abs = findSavedWaybillPdfFile(awb);
    if (!abs) {
      return res.status(404).json({
        success: false,
        message: `No saved PDF for AWB ${awb}. Generate the waybill again.`,
      });
    }
    return res.download(abs, `Waybill_${awb}.pdf`);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/** Generate BlueDart AWB for an existing DC and save awb_number on all lines. */
exports.generateDcBluedartAwb = async (req, res) => {
  try {
    const result = await generateAndPersistDcBluedartAwb(req.params.dcNumber, req.body || {});
    return res.json({
      success: true,
      message: (result.awb_numbers && result.awb_numbers.length > 1)
      ? `${result.awb_numbers.length} AWBs (${result.awb_number}) saved on ${req.params.dcNumber}`
      : `AWB ${result.awb_number} saved on ${req.params.dcNumber}`,
      data: {
        dc_number: req.params.dcNumber,
        ...result,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message,
      details: error.details || undefined,
      data: error.data || undefined,
    });
  }
};

/**
 * Generate BlueDart waybill for a DC, persist AWB + label PDF path.
 * Used by API and auto-generate on BlueDart DC create.
 */
async function generateOneDcUnitWaybill({
  dcNumber,
  head,
  consignee,
  body,
  serialNumber,
  ttsplId,
  processor,
  generation,
  brand,
  modelName,
  pieceCount = 1,
  declaredValueOverride = null,
}) {
  const bluedartWaybill = require('../services/bluedartWaybillService');
  const courierPdf = require('../services/courierWaybillPdfService');
  const { lookupDeclaredValueForUnit } = require('../constants/bluedartDeclaredValue');

  const creditRef = body.credit_reference_no && !serialNumber && !ttsplId
    ? body.credit_reference_no
    : courierPdf.buildShipmentReference({
      serialNumber,
      ttsplId,
      fallback: bluedartWaybill.uniqueCreditRef(
        `DC${String(dcNumber).replace(/[^A-Za-z0-9]/g, '').slice(-12)}`
      ),
    });

  let declaredValue = declaredValueOverride != null
    ? declaredValueOverride
    : body.services?.declaredValue;
  if (declaredValue == null || declaredValue === '' || Number(declaredValue) <= 0) {
    const unitVal = await lookupDeclaredValueForUnit(processor, generation, modelName);
    if (unitVal != null) declaredValue = unitVal;
    else if (Number(head.security_amount) > 0) declaredValue = Number(head.security_amount);
  }

  const itemName = [brand || head.brand, modelName || head.model_name].filter(Boolean).join(' ') || 'LAPTOP';
  const pcs = Math.max(1, Number(pieceCount) || 1);
  const result = await bluedartWaybill.generateWayBill({
    consignee,
    services: {
      ...(body.services || {}),
      pieceCount: pcs,
      actualWeight: body.services?.actualWeight || (2.5 * pcs).toFixed(2),
      declaredValue,
      pdfOutputNotRequired: false,
      itemName,
    },
    creditReferenceNo: creditRef,
  });

  const printed = await buildAndSavePrintableWaybillPdf({
    awbNumber: result.awb_number,
    creditReferenceNo: creditRef,
    consignee,
    services: {
      ...(body.services || {}),
      pieceCount: pcs,
      declaredValue,
      itemName,
    },
    result,
    dcNumber,
    salesOrderNumber: head.sales_order_number || null,
    itemName,
    serialNumber,
    ttsplId,
  });

  bluedartWaybill.saveWaybillPdf(result.awb_number, result.pdf_buffer);

  const { pdf_buffer: _buf, raw: _raw, ...safe } = result;
  return {
    ...safe,
    credit_reference_no: creditRef,
    reference_id: printed.reference_id,
    serial_number: printed.serial_number || serialNumber || null,
    ttspl_id: printed.ttspl_id || ttsplId || null,
    bluedart_awb_pdf_path: printed.pdf_path,
    pdf_path: printed.pdf_path,
    pdf_saved: Boolean(printed.pdf_path),
  };
}

/**
 * Generate BlueDart waybill(s) for a DC and persist AWB + label PDF path.
 * Default: one AWB per laptop, stored comma-separated on the DC.
 * Pass body.single_shipment=true for legacy one-AWB multi-piece.
 */
async function generateAndPersistDcBluedartAwb(dcNumber, body = {}) {
  const bluedartWaybill = require('../services/bluedartWaybillService');
  const { splitAwbTokens, joinAwbTokens } = require('../utils/bluedartAwbUtils');
  const { sumDeclaredValueForUnits } = require('../constants/bluedartDeclaredValue');
  if (!bluedartWaybill.isWaybillConfigured()) {
    const err = new Error('BlueDart waybill is not configured on the server');
    err.status = 503;
    throw err;
  }

  const lines = await getDeliveryChallanLines(dcNumber);
  if (!lines.length) {
    const err = new Error('Delivery challan not found');
    err.status = 404;
    throw err;
  }
  const head = lines[0];
  const existingAwbs = splitAwbTokens(head.awb_number);
  if (existingAwbs.length && !body.force) {
    const err = new Error(`DC already has AWB ${head.awb_number}. Pass force=true to generate another.`);
    err.status = 409;
    err.data = {
      awb_number: head.awb_number,
      awb_numbers: existingAwbs,
      bluedart_awb_pdf_path: head.bluedart_awb_pdf_path || null,
    };
    throw err;
  }

  const shipping = parseJsonSafe(head.customer_shipping_address) || {};
  const consignee = {
    name: body.consignee?.name || shipping.name || head.customer_name,
    mobile: body.consignee?.mobile || shipping.phone || shipping.mobile || head.d_customer_mobile,
    address: body.consignee?.address
      || [shipping.address, shipping.city, shipping.state].filter(Boolean).join(', ')
      || shipping.address,
    pincode: body.consignee?.pincode || shipping.pincode || shipping.zip_code,
    email: body.consignee?.email || shipping.email || head.email,
    gst: body.consignee?.gst || head.gst_number,
    attention: body.consignee?.attention || shipping.name || head.customer_name,
  };

  const dcSerials = await collectDcSerials(dcNumber);
  const units = [];
  if (dcSerials.length) {
    for (const s of dcSerials) {
      let processor = null;
      let generation = null;
      let brand = null;
      let modelName = null;
      if (s.serialId) {
        const sr = await pool.query(
          `SELECT extra->>'processor' AS processor,
                  extra->>'generation' AS generation,
                  extra->>'brand' AS brand,
                  COALESCE(extra->>'model', extra->>'model_name') AS model_name
             FROM vendor_serial_numbers WHERE serial_id = $1`,
          [s.serialId]
        ).catch(() => ({ rows: [] }));
        processor = sr.rows[0]?.processor || null;
        generation = sr.rows[0]?.generation || null;
        brand = sr.rows[0]?.brand || null;
        modelName = sr.rows[0]?.model_name || null;
      }
      units.push({
        serialNumber: s.serialNumber || null,
        ttsplId: s.ttsplId || null,
        processor,
        generation,
        brand,
        modelName,
      });
    }
  } else {
    for (const line of lines) {
      const qty = Math.max(1, Number(line.quantity || line.main_qty || 1) || 1);
      for (let i = 0; i < qty; i += 1) {
        units.push({
          serialNumber: null,
          ttsplId: null,
          processor: line.processor || null,
          generation: line.generation || null,
          brand: line.brand || null,
          modelName: line.model_name || null,
        });
      }
    }
  }
  if (!units.length) units.push({ serialNumber: null, ttsplId: null });

  const singleShipment = body.single_shipment === true || body.singleShipment === true;

  async function persistAwb(awbNumber, pdfPath, extra = {}) {
    await pool.query(
      `UPDATE delivery_challan_lines
          SET courier_name = COALESCE(NULLIF(TRIM(courier_name), ''), 'BlueDart'),
              awb_number = $2,
              bluedart_awb_pdf_path = COALESCE($3, bluedart_awb_pdf_path),
              ship_by = COALESCE(ship_by, 'by_courier'),
              dispatch_mode = COALESCE(dispatch_mode, 'courier'),
              updated_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber, awbNumber, pdfPath]
    );
    return extra;
  }

  // Legacy one AWB for all pieces
  if (singleShipment) {
    const unit = units[0];
    const pieceCount = body.services?.pieceCount
      || lines.reduce((sum, l) => sum + (Number(l.quantity || l.main_qty || 1) || 0), 0)
      || units.length
      || 1;
    const declaredValue = body.services?.declaredValue
      || await sumDeclaredValueForUnits(units.map((u) => ({ processor: u.processor, generation: u.generation, model: u.modelName })))
      || (Number(head.security_amount) > 0 ? Number(head.security_amount) : null);
    const one = await generateOneDcUnitWaybill({
      dcNumber,
      head,
      consignee,
      body,
      serialNumber: unit.serialNumber,
      ttsplId: unit.ttsplId,
      processor: unit.processor,
      generation: unit.generation,
      brand: unit.brand,
      modelName: unit.modelName,
      pieceCount,
      declaredValueOverride: declaredValue,
    });
    await persistAwb(one.awb_number, one.pdf_path);
    return { ...one, awb_numbers: [one.awb_number], per_laptop: false };
  }

  // One laptop → one AWB (also covers single-unit DCs)
  if (units.length === 1) {
    const unit = units[0];
    const one = await generateOneDcUnitWaybill({
      dcNumber,
      head,
      consignee,
      body,
      serialNumber: unit.serialNumber,
      ttsplId: unit.ttsplId,
      processor: unit.processor,
      generation: unit.generation,
      brand: unit.brand,
      modelName: unit.modelName,
      pieceCount: 1,
    });
    await persistAwb(one.awb_number, one.pdf_path);
    return { ...one, awb_numbers: [one.awb_number], per_laptop: true };
  }

  // Multi-laptop DC → one AWB per laptop, comma-separated
  const generated = [];
  const errors = [];
  for (const unit of units) {
    try {
      const one = await generateOneDcUnitWaybill({
        dcNumber,
        head,
        consignee,
        body: { ...body, credit_reference_no: undefined, services: { ...(body.services || {}), pieceCount: 1, declaredValue: undefined } },
        serialNumber: unit.serialNumber,
        ttsplId: unit.ttsplId,
        processor: unit.processor,
        generation: unit.generation,
        brand: unit.brand,
        modelName: unit.modelName,
        pieceCount: 1,
      });
      generated.push(one);
    } catch (err) {
      errors.push({
        serial_number: unit.serialNumber,
        ttspl_id: unit.ttsplId,
        message: err.message,
      });
      console.error(`BlueDart AWB failed for ${unit.ttsplId || unit.serialNumber}:`, err.message);
    }
  }

  if (!generated.length) {
    const err = new Error(errors[0]?.message || 'Failed to generate BlueDart AWBs for DC laptops');
    err.status = 502;
    err.details = errors;
    throw err;
  }

  const awbNumbers = generated.map((g) => g.awb_number);
  const joined = joinAwbTokens(awbNumbers);
  const firstPdf = generated.find((g) => g.pdf_path)?.pdf_path || null;
  await persistAwb(joined, firstPdf);

  for (const g of generated) {
    await pool.query(
      `UPDATE dc_shipment_units
          SET awb_number = $2,
              courier_name = COALESCE(NULLIF(TRIM(courier_name), ''), 'BlueDart'),
              updated_at = NOW()
        WHERE dc_number = $1
          AND (
            ($3::text IS NOT NULL AND ttspl_id = $3)
            OR ($4::text IS NOT NULL AND serial_number = $4)
          )`,
      [dcNumber, g.awb_number, g.ttspl_id || null, g.serial_number || null]
    ).catch(() => {});
  }

  return {
    awb_number: joined,
    awb_numbers: awbNumbers,
    shipments: generated.map((g) => ({
      awb_number: g.awb_number,
      serial_number: g.serial_number,
      ttspl_id: g.ttspl_id,
      pdf_path: g.pdf_path,
      credit_reference_no: g.credit_reference_no,
    })),
    bluedart_awb_pdf_path: firstPdf,
    pdf_path: firstPdf,
    pdf_saved: Boolean(firstPdf),
    per_laptop: true,
    errors: errors.length ? errors : undefined,
  };
}


function isBlueDartCourierName(name) {
  return /bluedart|blue\s*dart/i.test(String(name || ''));
}

/** After rental/sale DC create: auto AWB when courier is BlueDart (or blank courier on by_courier). */
async function maybeAutoGenerateBluedartAwbForDc(dcNumber, { shipBy, courierName, awbNumber } = {}) {
  if (String(shipBy || '').toLowerCase() !== 'by_courier') return null;
  if (awbNumber) return null;
  const courier = String(courierName || '').trim();
  if (courier && !isBlueDartCourierName(courier)) return null;
  try {
    return await generateAndPersistDcBluedartAwb(dcNumber, {});
  } catch (err) {
    console.error(`Auto BlueDart AWB failed for ${dcNumber}:`, err.message);
    return { error: err.message };
  }
}

/** Cancel BlueDart AWB by number (does not require a DC). */
exports.cancelBluedartWaybill = async (req, res) => {
  try {
    const bluedartWaybill = require('../services/bluedartWaybillService');
    if (!bluedartWaybill.isWaybillConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'BlueDart waybill is not configured on the server',
      });
    }
    const awb = req.body?.awb_number || req.body?.AWBNo || req.body?.awb;
    const result = await bluedartWaybill.cancelWayBill(awb);
    return res.json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message,
      details: error.details || undefined,
    });
  }
};

/** Cancel BlueDart AWB on a DC and clear awb_number. */
exports.cancelDcBluedartAwb = async (req, res) => {
  try {
    const bluedartWaybill = require('../services/bluedartWaybillService');
    const { splitAwbTokens } = require('../utils/bluedartAwbUtils');
    if (!bluedartWaybill.isWaybillConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'BlueDart waybill is not configured on the server',
      });
    }

    const dcNumber = req.params.dcNumber;
    const lines = await getDeliveryChallanLines(dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const head = lines[0];
    const raw = String(req.body?.awb_number || head.awb_number || '').trim();
    const awbs = splitAwbTokens(raw);
    if (!awbs.length) {
      return res.status(400).json({ success: false, message: 'No AWB number on this delivery challan' });
    }

    const results = [];
    const errors = [];
    for (const awb of awbs) {
      try {
        results.push(await bluedartWaybill.cancelWayBill(awb));
      } catch (err) {
        errors.push({ awb_number: awb, message: err.message });
      }
    }

    await pool.query(
      `UPDATE delivery_challan_lines
          SET awb_number = NULL,
              bluedart_awb_pdf_path = NULL,
              updated_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber]
    );

    return res.json({
      success: true,
      message: `Cancelled ${results.length}/${awbs.length} AWB(s) and cleared from ${dcNumber}`,
      data: {
        dc_number: dcNumber,
        awb_numbers: awbs,
        results,
        errors: errors.length ? errors : undefined,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message,
      details: error.details || undefined,
    });
  }
};

/** Update e-Way Bill details on an existing BlueDart AWB (no DC required). */
exports.updateBluedartEwayBill = async (req, res) => {
  try {
    const bluedartWaybill = require('../services/bluedartWaybillService');
    if (!bluedartWaybill.isWaybillConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'BlueDart waybill is not configured on the server',
      });
    }
    const body = req.body || {};
    const result = await bluedartWaybill.updateEwayBill({
      awbNumber: body.awb_number || body.Waybillnumber || body.awb,
      eWaybillNumber: body.eway_bill_number || body.eWaybillNumber,
      eWaybillDate: body.eway_bill_date || body.eWaybillDate,
      invoiceNumber: body.invoice_number || body.InvoiceNumber,
      invoiceDate: body.invoice_date || body.InvoiceDate,
      sellerGstNo: body.seller_gst_no || body.SellerGSTNo,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message,
      details: error.details || undefined,
    });
  }
};

/**
 * Push DC e-Way Bill + invoice onto the BlueDart AWB (UpdateEwayBill).
 * Prefills from DC when body fields are omitted.
 */
exports.updateDcBluedartEwayBill = async (req, res) => {
  try {
    const bluedartWaybill = require('../services/bluedartWaybillService');
    if (!bluedartWaybill.isWaybillConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'BlueDart waybill is not configured on the server',
      });
    }

    const dcNumber = req.params.dcNumber;
    const lines = await getDeliveryChallanLines(dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const head = lines[0];
    const body = req.body || {};

    const awb = String(body.awb_number || head.awb_number || '').trim();
    if (!awb) {
      return res.status(400).json({
        success: false,
        message: 'No BlueDart AWB on this delivery challan — generate AWB first',
      });
    }

    const ewbNo = String(body.eway_bill_number || head.eway_bill_number || '').trim();
    if (!ewbNo) {
      return res.status(400).json({
        success: false,
        message: 'E-Way Bill number is required (generate/upload on DC first, or pass eway_bill_number)',
      });
    }

    const invoiceNumber = String(
      body.invoice_number
      || head.einvoice_number
      || body.InvoiceNumber
      || dcNumber
    ).trim();

    const result = await bluedartWaybill.updateEwayBill({
      awbNumber: awb,
      eWaybillNumber: ewbNo,
      eWaybillDate: body.eway_bill_date || head.eway_bill_valid_till || body.eWaybillDate || new Date(),
      invoiceNumber,
      invoiceDate: body.invoice_date
        || head.einvoice_uploaded_at
        || head.irn_generated_at
        || head.created_at
        || new Date(),
      sellerGstNo: body.seller_gst_no || body.SellerGSTNo,
    });

    return res.json({
      success: true,
      message: `E-Way Bill ${ewbNo} updated on BlueDart AWB ${awb}`,
      data: {
        dc_number: dcNumber,
        ...result,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message,
      details: error.details || undefined,
    });
  }
};

exports.getDeliveryChallan = async (req, res) => {
  try {
    const lines = await getDeliveryChallanLines(req.params.dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }

    const dcNumber = req.params.dcNumber;
    const son = lines[0]?.sales_order_number;
    const serialLookup = (son && dcNumber) ? await getDcSerialRateLookup(dcNumber, son) : null;

    // Resolve full laptop specs for every attached serial. Migrated units often
    // have empty extra/vendor_product_details, so fall back to the inventory
    // table (the authoritative spec store for legacy stock).
    // Same priority as SO Laptops tab: serial/QC hardware first, then inventory,
    // then ordered SO line only as last resort (never overwrite distinct units).
    const specSelect = `
      SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code,
             COALESCE(
               NULLIF(TRIM(vsn.extra->>'brand'), ''),
               NULLIF(TRIM(vsn.grn_received_config->>'brand'), ''),
               NULLIF(TRIM(vpd.brand), ''),
               NULLIF(TRIM(inv.brand), '')
             ) AS brand,
             COALESCE(
               NULLIF(TRIM(vsn.extra->>'model'), ''),
               NULLIF(TRIM(vsn.extra->>'model_name'), ''),
               NULLIF(TRIM(vsn.grn_received_config->>'model'), ''),
               NULLIF(TRIM(vpd.model), ''),
               NULLIF(TRIM(inv.model), '')
             ) AS model,
             COALESCE(
               NULLIF(TRIM(vsn.extra->>'processor'), ''),
               NULLIF(TRIM(vsn.grn_received_config->>'processor'), ''),
               NULLIF(TRIM(vpd.processor), ''),
               NULLIF(TRIM(inv.processor), '')
             ) AS processor,
             COALESCE(
               NULLIF(TRIM(vsn.extra->>'generation'), ''),
               NULLIF(TRIM(vsn.grn_received_config->>'generation'), ''),
               NULLIF(TRIM(vpd.generation), ''),
               NULLIF(TRIM(inv.generation), '')
             ) AS generation,
             COALESCE(
               NULLIF(TRIM(vsn.extra->>'ram'), ''),
               NULLIF(TRIM(vsn.grn_received_config->>'ram'), ''),
               NULLIF(TRIM(vpd.ram), ''),
               NULLIF(TRIM(inv.ram), '')
             ) AS ram,
             COALESCE(
               NULLIF(TRIM(vsn.extra->>'storage'), ''),
               NULLIF(TRIM(vsn.extra->>'ssd'), ''),
               NULLIF(TRIM(vsn.grn_received_config->>'storage'), ''),
               NULLIF(TRIM(vpd.storage), ''),
               NULLIF(TRIM(inv.storage), '')
             ) AS storage,
             COALESCE(
               NULLIF(TRIM(vsn.extra->>'gpu'), ''),
               NULLIF(TRIM(vpd.gpu), ''),
               NULLIF(TRIM(inv.gpu), '')
             ) AS gpu,
             COALESCE(
               NULLIF(TRIM(vsn.extra->>'screen_size'), ''),
               NULLIF(TRIM(vpd.screen_size), ''),
               NULLIF(TRIM(inv.screen_size), '')
             ) AS screen_size,
             vsn.inventory_status
      FROM vendor_serial_numbers vsn
      LEFT JOIN vendor_product_details vpd
        ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
      LEFT JOIN LATERAL (
        SELECT i.brand, i.model, i.processor, i.generation, i.ram, i.storage, i.gpu, i.screen_size
        FROM inventory i
        WHERE i.serial_number = vsn.serial_number
           OR i.machine_number = vsn.serial_number
           OR i.machine_number = vsn.inventory_asset_code
        LIMIT 1
      ) inv ON TRUE
      WHERE vsn.deleted_at IS NULL
        AND (vsn.serial_id = ANY($1::int[]) OR vsn.serial_number = ANY($2::text[]) OR vsn.inventory_asset_code = ANY($2::text[]))`;

    for (const line of lines) {
      const entries = parseSerialEntries(line.serial_number);
      const ids = entries.map((e) => e.serialId).filter(Boolean);
      const nums = entries.flatMap((e) => [e.serialNumber, e.ttsplId].filter(Boolean));
      let details = [];
      if (ids.length || nums.length) {
        const r = await pool.query(specSelect, [ids.length ? ids : [-1], nums.length ? nums : ['']]);
        details = r.rows;
      }
      line.serials_detail = entries.map((e) => {
        const d = details.find((x) =>
          (e.serialId && x.serial_id === e.serialId)
          || (e.serialNumber && x.serial_number === e.serialNumber)
          || (e.ttsplId && x.inventory_asset_code === e.ttsplId)) || {};
        const dcLineRemark = (line.remarks || '').trim();
        const soRemark = serialLookup
          ? lookupSerialRemark(serialLookup, {
            serialId: e.serialId,
            serialNumber: e.serialNumber,
            ttspl: e.ttsplId,
          })
          : '';
        const priced = serialLookup
          ? lookupSerialRate(serialLookup, {
            serialId: e.serialId,
            serialNumber: e.serialNumber,
            ttspl: e.ttsplId,
          })
          : null;
        const remark = dcLineRemark || soRemark;
        return {
          ttspl: d.inventory_asset_code || e.ttsplId || e.serialNumber,
          serial_number: d.serial_number || e.serialNumber,
          brand: d.brand || priced?.brand || line.brand || '',
          model: d.model || priced?.model_name || line.model_name || '',
          processor: d.processor || priced?.processor || '',
          generation: d.generation || priced?.generation || '',
          ram: d.ram || priced?.ram || '',
          storage: d.storage || priced?.storage || '',
          gpu: d.gpu || priced?.gpu || '',
          screen_size: d.screen_size || priced?.screen_size || '',
          status: d.inventory_status || '',
          remark,
        };
      });
      if (!(line.remarks || '').trim() && line.serials_detail.length) {
        const uniq = [...new Set(line.serials_detail.map((u) => u.remark).filter(Boolean))];
        if (uniq.length) line.remarks = uniq.join('; ');
      }
    }

    // Price the DC from linked SO allocations (line_id → rate) or fall back to
    // brand/model matching on the DC header row.
    const { billingLines, subtotal } = await resolveDcBilling(req.params.dcNumber, lines);
    const head = lines[0];
    const totals = computeGstBreakdown({
      subtotal,
      shipping: head.shiping_charges,
      security: head.security_amount,
      supplyState: resolveSupplyStateFromAddress(head.customer_shipping_address, head.supply_state),
    });

    let assignmentHistory = [];
    try {
      assignmentHistory = await listAssignmentHistory(req.params.dcNumber);
    } catch (histErr) {
      console.warn('dc assignment history:', histErr.message);
    }

    const lineStatuses = [...new Set(lines.map((l) => String(l.status || '').toLowerCase()))];
    const assignmentEditable = lineStatuses.length > 0
      && lineStatuses.every((s) => isAssignmentEditable(s));

    let soQuotationType = null;
    if (son) {
      try {
        const qtRes = await pool.query(
          `SELECT quotation_type FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
          [son]
        );
        soQuotationType = qtRes.rows[0]?.quotation_type || null;
      } catch (_) { /* ignore */ }
    }
    const headLine = lines[0] || {};
    const dcTxn = await resolveTxnTypeForDc(pool, {
      salesOrderNumber: son || headLine.sales_order_number,
      originalDcNumber: headLine.original_dc_number,
      entityCode: headLine.entity_code,
      quotationType: soQuotationType,
    });
    for (const line of lines) {
      line.hsn_code = resolveHsnForDisplay(line.hsn_code, {
        quotationType: soQuotationType,
        transactionType: soQuotationType ? undefined : dcTxn,
      });
    }

    const firstCustomerOrder = await isNewCustomerFirstOrder(
      pool,
      headLine.customer_id,
      son || headLine.sales_order_number
    );
    const needsInvoice = requiresInvoiceCompliance(headLine.entity_code, soQuotationType, firstCustomerOrder);
    const isSale = isSaleDc(headLine.entity_code, soQuotationType);
    const productValue = Number(totals?.subtotal ?? 0);
    const needsDemoEway = requiresDemoEwayCompliance(soQuotationType, firstCustomerOrder, productValue);
    let sale_compliance = null;
    let demo_eway_compliance = null;
    let can_download_pdf = true;
    if (needsInvoice) {
      const canDispatchAction = req.user?.role === 'super_admin'
        || await canUploadSaleDcCompliance(req.user, req.permissionCache);
      sale_compliance = buildSaleCompliance(
        { ...headLine, quotation_type: soQuotationType },
        totals,
        req.user?.role,
        {
          canUpload: canDispatchAction,
          canSendMail: canDispatchAction,
          isFirstCustomerOrder: firstCustomerOrder,
        }
      );
      can_download_pdf = sale_compliance.can_download_pdf;
      if (!can_download_pdf) {
        for (const line of lines) {
          line.pdf_path = null;
        }
      }
    } else if (needsDemoEway) {
      const canUploadEway = req.user?.role === 'super_admin'
        || await canManageDcEwayBill(req.user, req.permissionCache);
      demo_eway_compliance = buildDemoEwayCompliance(
        { ...headLine, quotation_type: soQuotationType },
        totals,
        req.user?.role,
        {
          canUpload: canUploadEway,
          canRequest: true,
          isFirstCustomerOrder: firstCustomerOrder,
        }
      );
      can_download_pdf = demo_eway_compliance.can_download_pdf;
      if (!can_download_pdf) {
        for (const line of lines) {
          line.pdf_path = null;
        }
      }
    }

    let rental_invoice = null;
    if (!isSale) {
      try {
        rental_invoice = await findRentalInvoiceForDc(dcNumber);
      } catch (invErr) {
        console.warn('DC rental invoice lookup:', invErr.message);
      }
    }

    const shipmentUnits = await listDcAwbShipments(dcNumber, headLine);

    const { userCanViewDeliveryRegisterOtp } = require('../services/deliveryOtpAccess');
    const canViewOtp = await userCanViewDeliveryRegisterOtp(req.user, req.permissionCache);
    const deliveryOtp = headLine.otp_code || headLine.d_otp || headLine.delivery_otp || null;
    const warehouseReturnOtp = headLine.warehouse_return_otp || null;
    if (!canViewOtp) {
      for (const line of lines) {
        delete line.otp_code;
        delete line.d_otp;
        delete line.delivery_otp;
        delete line.warehouse_return_otp;
      }
    }

    res.json({
      success: true,
      dc_number: req.params.dcNumber,
      can_view_otp: canViewOtp,
      otp_code: canViewOtp ? deliveryOtp : undefined,
      warehouse_return_otp: canViewOtp ? warehouseReturnOtp : undefined,
      lines,
      billing_lines: billingLines,
      totals,
      assignment_editable: assignmentEditable,
      assignment_history: assignmentHistory,
      is_sale: isSale,
      is_first_customer_order: firstCustomerOrder,
      requires_invoice_compliance: needsInvoice,
      requires_demo_eway: needsDemoEway,
      sale_compliance,
      demo_eway_compliance,
      can_download_pdf,
      rental_invoice,
      shipment_units: shipmentUnits,
      awb_numbers: shipmentUnits.map((u) => u.awb_number),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.storeDeliveryChallan = async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body;
    const count = Math.max(
      ...['quantity', 'brand', 'Model', 'serial_number'].map((key) => {
        const value = body[key];
        return Array.isArray(value) ? value.length : 0;
      })
    );
    if (!count) {
      return res.status(400).json({ success: false, message: 'At least one line is required' });
    }

    if (body.sales_order_number) {
      const soCancelled = await pool.query(
        `SELECT 1 FROM sales_order_lines WHERE sales_order_number = $1 AND status = 'cancelled' LIMIT 1`,
        [body.sales_order_number]
      );
      if (soCancelled.rows.length) {
        return res.status(409).json({
          success: false,
          message: 'This sales order is cancelled. A delivery challan cannot be created.',
        });
      }
    }

    // Determine the owning entity from the linked SO/quotation type.
    const typeRes = await pool.query(
      `SELECT COALESCE(sol.quotation_type, sq.quotation_type, 'rental') AS quotation_type,
              sol.shiping_charges
         FROM sales_order_lines sol
         LEFT JOIN sales_quotations sq ON sq.quotation_number = sol.quotation_number
        WHERE sol.sales_order_number = $1
        LIMIT 1`,
      [body.sales_order_number]
    );
    const quotationType = typeRes.rows[0]?.quotation_type || body.quotation_type || 'rental';
    const entityCode = entityForQuotationType(quotationType);
    // Carry the SO's shipping onto the DC when the form didn't supply one.
    const dcShipping = body.shiping_charges != null && body.shiping_charges !== ''
      ? Number(body.shiping_charges) || 0
      : Number(typeRes.rows[0]?.shiping_charges || 0);

    // Creating a DC with delivery info = the product is dispatched. Map the
    // ship-by selection to the canonical dispatch mode.
    const shipBy = body.ship_by || (body.dispatch_mode === 'inhouse' ? 'by_hand' : body.dispatch_mode);
    const dispatchMode = shipBy === 'by_hand' ? 'inhouse'
      : shipBy === 'by_porter' ? 'porter'
        : shipBy === 'by_courier' ? 'courier'
          : (body.dispatch_mode || 'courier');

    const dcNumber = body.challan_number || body.dc_number
      || (await nextFinancialYearNumber('delivery_challan'));
    const shipping = parseJsonField(body.customer_shipping_address);
    const billing = parseJsonField(body.customer_billing_address);
    let supplyState = resolveSupplyStateFromAddress(shipping, body.supply_state);
    if (!supplyState && body.sales_order_number) {
      const soRes = await pool.query(
        `SELECT supply_state, customer_shipping_address
           FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1`,
        [body.sales_order_number]
      );
      if (soRes.rows.length) {
        supplyState = resolveSupplyStateFromAddress(
          soRes.rows[0].customer_shipping_address,
          soRes.rows[0].supply_state
        );
      }
    }

    // Pro-rata security: the SO security_amount is the TOTAL across all laptops on
    // the order. A DC for a subset of laptops only carries its share, so the
    // customer is not over-charged when a single SO is split into multiple DCs.
    let thisDcSerialCount = 0;
    for (let i = 0; i < count; i++) {
      const s = (body.serial_number || [])[i];
      const list = Array.isArray(s) ? s : (s ? [s] : []);
      thisDcSerialCount += list.length;
    }
    let dcSecurity = Number(body.security_amount || 0);
    if (body.sales_order_number) {
      const soLinesForSec = await getSalesOrderLines(body.sales_order_number);
      const securityType = String(soLinesForSec[0]?.security_type || '').toLowerCase();
      if (securityType === 'one_month_rental' && thisDcSerialCount > 0) {
        let matched = 0;
        dcSecurity = 0;
        for (let i = 0; i < count; i++) {
          const model = (body.Model || body.model_name || [])[i];
          const processor = (body.Processor || body.processor || [])[i];
          const generation = (body.Generation || body.generation || [])[i];
          const serials = (body.serial_number || [])[i];
          const serialList = Array.isArray(serials) ? serials : (serials ? [serials] : []);
          const soLine = soLinesForSec.find((l) =>
            String(l.model_name || '') === String(model || '')
            && String(l.processor || '') === String(processor || '')
            && String(l.generation || '') === String(generation || '')
          );
          if (soLine) {
            matched += serialList.length;
            dcSecurity += computeDcSecurityFromSerials(
              serialList.map(() => ({ line_id: soLine.id })),
              soLinesForSec
            );
          }
        }
        dcSecurity = +Number(dcSecurity || 0).toFixed(2);
        if (!matched) {
          const totalSecurity = sumSoSecurityAmount(soLinesForSec);
          const totalAttached = Number((await pool.query(
            `SELECT COUNT(*)::int AS n FROM sales_order_serials
              WHERE sales_order_number = $1 AND status <> 'removed'`,
            [body.sales_order_number]
          )).rows[0]?.n || 0);
          dcSecurity = totalAttached > 0
            ? Math.round((totalSecurity / totalAttached) * thisDcSerialCount * 100) / 100
            : totalSecurity;
        }
      } else {
        const secRes = await pool.query(
          `SELECT MAX(sol.security_amount) AS security_amount,
                  (SELECT COUNT(*) FROM sales_order_serials sos
                    WHERE sos.sales_order_number = $1 AND sos.status <> 'removed') AS total_attached
             FROM sales_order_lines sol WHERE sol.sales_order_number = $1`,
          [body.sales_order_number]
        );
        const totalSecurity = Number(secRes.rows[0]?.security_amount || body.security_amount || 0);
        const totalAttached = Number(secRes.rows[0]?.total_attached || 0);
        dcSecurity = (totalAttached > 0 && thisDcSerialCount > 0)
          ? Math.round((totalSecurity / totalAttached) * thisDcSerialCount * 100) / 100
          : totalSecurity;
      }
    }

    await client.query('BEGIN');
    let inserted = 0;
    for (let i = 0; i < count; i++) {
      const qty = Number((body.quantity || [])[i] || 0);
      const serials = (body.serial_number || [])[i];
      if (qty <= 0 || !serials || (Array.isArray(serials) && !serials.length)) continue;

      const model = (body.Model || body.model_name || [])[i];
      const processor = (body.Processor || body.processor || [])[i];
      const generation = (body.Generation || body.generation || [])[i];
      const brand = (body.brand || [])[i] || '';

      await client.query(
        `UPDATE sales_order_lines SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
         WHERE sales_order_number = $2 AND model_name = $3 AND processor = $4 AND generation = $5`,
        [qty, body.sales_order_number, model, processor, generation]
      );

      const dcLineHsn = await resolveHsnFromSalesOrder(client, body.sales_order_number, {
        role: req.user?.role,
        override: (body.hsn_code || [])[i] ?? body.hsn_code,
      });
      await client.query(
        `INSERT INTO delivery_challan_lines (
          dc_number, sales_order_number, quotation_number, customer_id, customer_name, email, gst_number,
          supply_state, security_amount, shiping_charges, branch, entity_code, customer_billing_address,
          customer_shipping_address, brand, model_name, quantity, main_qty, serial_number, ship_by,
          courier_name, awb_number, delivery_person_id, remarks, status, created_by,
          courier_tracking_url, porter_tracking_id, porter_order_id, porter_booking_url, hsn_code
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'pending',$25,$26,$27,$28,$29,$30)`,
        [
          dcNumber,
          body.sales_order_number,
          body.quotation_number,
          body.customer_id || null,
          body.customer_name,
          body.email || body.customer_email,
          body.GST_number || body.gst_number,
          supplyState,
          dcSecurity,
          dcShipping,
          body.branch || entityCode,
          entityCode,
          billing ? JSON.stringify(billing) : null,
          shipping ? JSON.stringify(shipping) : null,
          brand,
          model,
          qty,
          toNullableInt((body.main_qty || [])[i]) ?? qty,
          JSON.stringify(serials),
          body.ship_by,
          body.courier_name || null,
          body.awb_number || null,
          toNullableInt(body.delivery_person_id),
          (body.remarks || body.remark || [])[i] || null,
          req.user?.user_id,
          shipBy === 'by_courier' ? (body.courier_tracking_url || null) : null,
          shipBy === 'by_porter' ? (body.porter_tracking_id || null) : null,
          shipBy === 'by_porter' ? (body.porter_order_id || null) : null,
          shipBy === 'by_porter' ? (body.porter_booking_url || null) : null,
          dcLineHsn,
        ]
      );
      inserted += 1;

      const serialNumbers = [];
      const serialList = Array.isArray(serials) ? serials : [serials];
      for (const serial of serialList) {
        const parts = String(serial).split('|');
        const sn = parts[1] || parts[0];
        if (sn) serialNumbers.push(sn);
      }
      if (serialNumbers.length) {
        const serialIds = [];
        for (const serial of serialList) {
          const parts = String(serial).split('|');
          if (parts[0] && /^\d+$/.test(parts[0])) serialIds.push(Number(parts[0]));
        }
        await client.query(
          `UPDATE vendor_product_inventory
           SET status = 'out_stock', updated_at = NOW()
           WHERE serial_number = ANY($1::text[])
              OR serial_id = ANY($2::int[])`,
          [serialNumbers, serialIds.length ? serialIds : [-1]]
        );
        // DC created: reserved/in_stock -> dispatch_ready (in_transit is set at gate submit).
        for (let k = 0; k < serialList.length; k += 1) {
          const parts = String(serialList[k]).split('|');
          const sId = (parts[0] && /^\d+$/.test(parts[0])) ? Number(parts[0]) : null;
          const serialId = await resolveSerialId(client, {
            serialId: sId, serialNumber: parts[1] || parts[0], ttsplId: parts[2] || null,
          });
          if (!serialId) continue;
          const { resolveSerialRentRate } = require('../services/serialRentRateService');
          const rentMonthlyRate = await resolveSerialRentRate(client, serialId, dcNumber);
          try {
            await inventorySM.markDispatchReady(client, serialId, {
              dcNumber,
              customerId: body.customer_id || null,
              entityCode,
              dispatchMode,
              rentMonthlyRate,
              actorUserId: req.user?.user_id,
              actorName: req.user?.name,
            });
          } catch (rErr) {
            await client.query(
              `UPDATE vendor_serial_numbers SET inventory_status = 'dispatch_ready', current_dc_number = $2,
                      dispatch_mode = $3,
                      rent_monthly_rate = COALESCE($4, rent_monthly_rate),
                      updated_at = NOW()
               WHERE serial_id = $1`,
              [serialId, dcNumber, dispatchMode, rentMonthlyRate]
            );
          }
        }
      }
    }
    if (!inserted) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Select quantity and serial numbers for at least one line' });
    }

    // New flow: any SO-attached allocation whose serial was placed on this DC
    // (reserveForDc set current_dc_number) is now committed to the DC.
    if (body.sales_order_number) {
      await client.query(
        `UPDATE sales_order_serials sos
           SET status = 'dispatched', dc_number = $1, updated_at = NOW()
          FROM vendor_serial_numbers vsn
         WHERE sos.serial_id = vsn.serial_id
           AND sos.sales_order_number = $2 AND sos.status = 'attached'
           AND vsn.current_dc_number = $1`,
        [dcNumber, body.sales_order_number]
      );

      // Mirror the SO-level QC result into dc_qc_tickets so the DC's QC tab and
      // the dispatch gate (assertDcQcComplete) reflect the already-done QC.
      await client.query(
        `INSERT INTO dc_qc_tickets (dc_number, sales_order_number, ticket_id, ttspl_id, serial_id, status)
         SELECT sos.dc_number, sos.sales_order_number, sos.qc_ticket_id, sos.ttspl_id, sos.serial_id,
                CASE WHEN sos.qc_status = 'passed' THEN 'qc_passed' ELSE 'pending' END
           FROM sales_order_serials sos
          WHERE sos.dc_number = $1 AND sos.status = 'dispatched'
            AND NOT EXISTS (
              SELECT 1 FROM dc_qc_tickets d WHERE d.dc_number = sos.dc_number AND d.serial_id = sos.serial_id
            )`,
        [dcNumber]
      );
    }

    // DC created: waiting at warehouse gate. Guard submit sets in_transit + dispatched_at.
    await client.query(
      `UPDATE delivery_challan_lines
         SET status = 'dispatch_ready', dispatch_mode = $2, updated_at = NOW()
       WHERE dc_number = $1 AND status = 'pending'`,
      [dcNumber, dispatchMode]
    );

    const dispatchWf = require('../services/dispatchWorkflowService');
    if (body.sales_order_number) {
      await dispatchWf.onDcGenerated(client, {
        salesOrderNumber: body.sales_order_number,
        dcNumber,
        user: req.user,
      });
    }

    await client.query('COMMIT');

    // Generate the entity-branded DC PDF and store its path.
    let pdfPath = null;
    try {
      const dcLines = await getDeliveryChallanLines(dcNumber);
      const head = dcLines[0] || {};
      pdfPath = await generateDocumentPdf({
        docType: 'delivery_challan',
        docNumber: dcNumber,
        header: head,
        lines: dcLines,
      });
      await pool.query(`UPDATE delivery_challan_lines SET pdf_path = $1 WHERE dc_number = $2`, [pdfPath, dcNumber]);
    } catch (pdfErr) {
      console.error('DC PDF generation failed:', pdfErr.message);
    }

    // Post-commit: first rental invoice starts when the laptop actually leaves
    // the warehouse (guard gate submit → in_transit). DC create is dispatch_ready.

    // Post-commit: auto BlueDart AWB + label PDF when courier is BlueDart.
    let bluedartAwb = null;
    bluedartAwb = await maybeAutoGenerateBluedartAwbForDc(dcNumber, {
      shipBy: body.ship_by || (dispatchMode === 'courier' ? 'by_courier' : null),
      courierName: body.courier_name,
      awbNumber: body.awb_number,
    });

    res.status(201).json({
      success: true,
      message: 'Delivery challan created',
      dc_number: dcNumber,
      pdf_path: pdfPath,
      bluedart_awb: bluedartAwb && !bluedartAwb.error ? bluedartAwb : undefined,
      bluedart_awb_error: bluedartAwb?.error || undefined,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('storeDeliveryChallan:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/sales-management/create-dcs-by-address  (Phase 15)
 * Creates ONE DC per delivery-address group from QC-passed attached serials.
 * Business rule: one DC = one delivery address = one shipment.
 */
exports.createDcsByAddress = async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body || {};
    const { sales_order_number, ship_by, dc_groups } = body;

    if (!sales_order_number) {
      return res.status(400).json({ success: false, message: 'sales_order_number required' });
    }
    if (!Array.isArray(dc_groups) || !dc_groups.length) {
      return res.status(400).json({ success: false, message: 'dc_groups required' });
    }
    if (!['by_courier', 'by_porter', 'by_hand'].includes(ship_by)) {
      return res.status(400).json({ success: false, message: 'Invalid or missing ship_by' });
    }

    // Rule: one serial cannot appear in two groups.
    const seen = new Set();
    for (const g of dc_groups) {
      for (const id of (g.allocation_ids || [])) {
        if (seen.has(id)) {
          return res.status(400).json({
            success: false,
            message: `Laptop allocation ${id} appears in multiple DC groups. Each laptop can only be in one DC.`,
          });
        }
        seen.add(id);
      }
    }

    const allAllocationIds = dc_groups.flatMap((g) => (g.allocation_ids || []).map((n) => Number(n)));
    if (!allAllocationIds.length) {
      return res.status(400).json({ success: false, message: 'No laptops selected' });
    }

    // Validate allocations: attached to this SO and QC-passed.
    const allocRes = await client.query(
      `SELECT sos.allocation_id, sos.serial_id, sos.line_id, sos.qc_status, sos.status, sos.qc_ticket_id,
              sos.ttspl_id, sos.serial_number,
              vsn.serial_number AS vsn_serial, vsn.inventory_asset_code AS ttspl_id_vsn,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'brand'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'brand'), ''),
                NULLIF(TRIM(vpd.brand), ''),
                NULLIF(TRIM(inv.brand), ''),
                ''
              ) AS brand,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'model'), ''),
                NULLIF(TRIM(vsn.extra->>'model_name'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'model'), ''),
                NULLIF(TRIM(vpd.model), ''),
                NULLIF(TRIM(inv.model), ''),
                ''
              ) AS model,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'processor'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'processor'), ''),
                NULLIF(TRIM(vpd.processor), ''),
                NULLIF(TRIM(inv.processor), ''),
                ''
              ) AS processor,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'generation'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'generation'), ''),
                NULLIF(TRIM(vpd.generation), ''),
                NULLIF(TRIM(inv.generation), ''),
                ''
              ) AS generation,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'ram'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'ram'), ''),
                NULLIF(TRIM(vpd.ram), ''),
                NULLIF(TRIM(inv.ram), ''),
                ''
              ) AS ram,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'storage'), ''),
                NULLIF(TRIM(vsn.extra->>'ssd'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'storage'), ''),
                NULLIF(TRIM(vpd.storage), ''),
                NULLIF(TRIM(inv.storage), ''),
                ''
              ) AS storage
         FROM sales_order_serials sos
         LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
         LEFT JOIN vendor_product_details vpd ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
         LEFT JOIN LATERAL (
           SELECT i.brand, i.model, i.processor, i.generation, i.ram, i.storage
             FROM inventory i
            WHERE i.serial_number = vsn.serial_number
               OR i.machine_number = vsn.serial_number
               OR i.machine_number = vsn.inventory_asset_code
            LIMIT 1
         ) inv ON TRUE
        WHERE sos.allocation_id = ANY($1::int[])
          AND sos.sales_order_number = $2
          AND sos.status = 'attached'`,
      [allAllocationIds, sales_order_number]
    );

    if (allocRes.rows.length !== allAllocationIds.length) {
      const found = allocRes.rows.map((r) => r.allocation_id);
      const missing = allAllocationIds.filter((id) => !found.includes(id));
      return res.status(400).json({
        success: false,
        message: `Some laptops are not attached or already dispatched: ${missing.join(', ')}`,
      });
    }
    const notPassed = allocRes.rows.filter((r) => r.qc_status !== 'passed');
    if (notPassed.length) {
      return res.status(400).json({
        success: false,
        message: `Laptops must pass Dispatch QC before DC creation: ${notPassed.map((r) => r.ttspl_id || r.serial_number).join(', ')}`,
      });
    }

    // Hardware script verification (dispatch_qc_capture_tokens) is optional for DC
    // creation: Dispatch QC already marks qc_status=passed. Requiring a matched
    // capture token blocked every SO completed through the normal QC flow.

    const soLines = await getSalesOrderLines(sales_order_number);
    if (!soLines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    if (soLines.every((l) => String(l.status).toLowerCase() === 'cancelled')) {
      return res.status(409).json({
        success: false,
        message: 'This sales order is cancelled. A delivery challan cannot be created.',
      });
    }
    const soHead = soLines[0];
    const entityCode = soHead.entity_code || entityForQuotationType(soHead.quotation_type || 'rental');
    const dispatchMode = ship_by === 'by_hand' ? 'inhouse'
      : ship_by === 'by_porter' ? 'porter' : 'courier';

    // Billing address (snapshot or resolved from customer).
    let billing = parseJsonSafe(soHead.customer_billing_address);
    if ((!billing || !billing.address) && soHead.customer_id) {
      const cRes = await client.query(
        `SELECT billing_address, billing_city, billing_state, billing_pincode,
                name, company_name, phone, gst_no
           FROM customers WHERE customer_id = $1`,
        [soHead.customer_id]
      );
      if (cRes.rows.length) {
        const c = cRes.rows[0];
        billing = {
          name: c.company_name || c.name, phone: c.phone, address: c.billing_address,
          city: c.billing_city, state: c.billing_state, pincode: c.billing_pincode, gst_number: c.gst_no,
        };
      }
    }

    // Pro-rata security uses the SO's TOTAL laptops (attached + already dispatched)
    // so each laptop's share is stable across partial dispatches.
    const totalRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM sales_order_serials
        WHERE sales_order_number = $1 AND status <> 'removed'`,
      [sales_order_number]
    );
    const totalSoUnits = Number(totalRes.rows[0]?.n || allAllocationIds.length) || 1;
    const totalShipping = Number(soHead.shiping_charges || 0);

    const allocMap = {};
    allocRes.rows.forEach((r) => { allocMap[r.allocation_id] = r; });

    const createdDcNumbers = [];
    await client.query('BEGIN');

    for (const group of dc_groups) {
      const ids = (group.allocation_ids || []).map((n) => Number(n));
      if (!ids.length) continue;

      const dcNumber = await nextFinancialYearNumber('delivery_challan', client);
      const groupSerials = ids.map((id) => allocMap[id]).filter(Boolean);
      const deliveryAddress = group.delivery_address
        || parseJsonSafe(soHead.customer_shipping_address) || billing || null;
      const groupSupplyState = resolveSupplyStateFromAddress(deliveryAddress, soHead.supply_state);

      const groupSize = ids.length;
      const groupSecurity = computeDcSecurityFromSerials(groupSerials, soLines);
      const groupShipping = Math.round((totalShipping / totalSoUnits) * groupSize * 100) / 100;

      const groupAwb = group.awb_number || body.awb_number || null;
      const groupAwbPdf = group.bluedart_awb_pdf_path || body.bluedart_awb_pdf_path || null;
      const groupDeliveryPersonId = group.delivery_person_id || body.delivery_person_id || null;
      const groupVehicleNumber = normalizeVehicleNumber(group.vehicle_number || body.vehicle_number) || null;
      const laptopShipments = Array.isArray(group.laptop_shipments) ? group.laptop_shipments : [];

      // Prefer joined AWBs from per-laptop mapping when present
      const shipmentAwbs = laptopShipments
        .map((s) => String(s?.awb_number || '').trim())
        .filter((a) => /^\d{8,}$/.test(a));
      const resolvedGroupAwb = shipmentAwbs.length
        ? [...new Set(shipmentAwbs)].join(',')
        : groupAwb;

      const vehicleErr = validateSaleVehicleOnCreate(entityCode, ship_by, {
        ...group,
        vehicle_number: groupVehicleNumber,
      });
      if (vehicleErr) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: vehicleErr });
      }

      const serialTokens = groupSerials.map((s) =>
        `${s.serial_id || ''}|${s.serial_number || s.vsn_serial || ''}|${s.ttspl_id || s.ttspl_id_vsn || ''}`
      );

      const uniqueBrands = [...new Set(groupSerials.map((s) => s.brand).filter(Boolean))];
      const uniqueModels = [...new Set(groupSerials.map((s) => s.model).filter(Boolean))];
      const dcBrand = uniqueBrands.length === 1
        ? uniqueBrands[0]
        : (uniqueBrands.length > 1 ? uniqueBrands.join(', ') : '');
      const dcModel = uniqueModels.length === 1
        ? uniqueModels[0]
        : (uniqueModels.length > 1 ? 'Multiple configurations' : '');

      const groupLineIds = [...new Set(groupSerials.map((s) => s.line_id).filter(Boolean))];
      const groupRemarks = (await resolveSoLineRemarksForLines(groupLineIds)).filter(Boolean);
      const dcRemarks = [...new Set(groupRemarks)].join('; ') || null;

      const soLineHsns = groupLineIds
        .map((lid) => {
          const soLine = soLines.find((l) => Number(l.id) === Number(lid));
          return String(soLine?.hsn_code || '').trim();
        })
        .filter(Boolean);
      const dcHsn = soLineHsns[0]
        || resolveHsnForPersist({
          quotationType: soHead.quotation_type || 'rental',
          role: req.user?.role,
          override: group.hsn_code || body.hsn_code,
        });

      await client.query(
        `INSERT INTO delivery_challan_lines (
          dc_number, sales_order_number, quotation_number, customer_id, customer_name,
          email, gst_number, supply_state, security_amount, shiping_charges, branch,
          entity_code, customer_billing_address, customer_shipping_address,
          brand, model_name, quantity, main_qty, serial_number,
          ship_by, courier_name, awb_number, bluedart_awb_pdf_path, courier_tracking_url,
          porter_tracking_id, porter_order_id, porter_booking_url,
          delivery_person_id, vehicle_number, dispatch_mode, dispatched_at,
          remarks, status, created_by, hsn_code
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
          $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,NULL,
          $31,'dispatch_ready',$32,$33
        )`,
        [
          dcNumber, sales_order_number, soHead.quotation_number, soHead.customer_id || null,
          soHead.customer_name, soHead.customer_email, soHead.gst_number, groupSupplyState,
          groupSecurity, groupShipping, entityCode, entityCode,
          billing ? JSON.stringify(billing) : null,
          deliveryAddress ? JSON.stringify(deliveryAddress) : null,
          dcBrand, dcModel,
          groupSize, groupSize, JSON.stringify(serialTokens),
          ship_by,
          ship_by === 'by_courier' ? (group.courier_name || body.courier_name || 'BlueDart') : null,
          ship_by === 'by_courier' ? resolvedGroupAwb : null,
          ship_by === 'by_courier' ? groupAwbPdf : null,
          ship_by === 'by_courier' ? (group.courier_tracking_url || body.courier_tracking_url || null) : null,
          ship_by === 'by_porter' ? (group.porter_tracking_id || body.porter_tracking_id || null) : null,
          ship_by === 'by_porter' ? (group.porter_order_id || body.porter_order_id || null) : null,
          ship_by === 'by_porter' ? (group.porter_booking_url || body.porter_booking_url || null) : null,
          ship_by === 'by_hand' && groupDeliveryPersonId ? Number(groupDeliveryPersonId) : null,
          groupVehicleNumber,
          dispatchMode, dcRemarks, req.user?.user_id, dcHsn,
        ]
      );

      // Per-laptop courier / AWB mapping
      await client.query(`
        CREATE TABLE IF NOT EXISTS dc_shipment_units (
          id SERIAL PRIMARY KEY,
          dc_number TEXT NOT NULL,
          allocation_id INTEGER,
          serial_id INTEGER,
          serial_number TEXT,
          ttspl_id TEXT,
          courier_name TEXT DEFAULT 'BlueDart',
          awb_number TEXT,
          weight NUMERIC(10, 2),
          remarks TEXT,
          tracking_status TEXT,
          tracking_status_type TEXT,
          tracking_synced_at TIMESTAMPTZ,
          received_by TEXT,
          delivered_at TIMESTAMPTZ,
          status TEXT NOT NULL DEFAULT 'in_transit',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch(() => {});

      const shipmentByAlloc = new Map(
        laptopShipments.map((s) => [Number(s.allocation_id), s])
      );
      for (const s of groupSerials) {
        const mapped = shipmentByAlloc.get(Number(s.allocation_id)) || {};
        await client.query(
          `INSERT INTO dc_shipment_units (
             dc_number, allocation_id, serial_id, serial_number, ttspl_id,
             courier_name, awb_number, weight, remarks, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'dispatch_ready')`,
          [
            dcNumber,
            s.allocation_id || null,
            s.serial_id || null,
            s.serial_number || s.vsn_serial || mapped.serial_number || null,
            s.ttspl_id || s.ttspl_id_vsn || mapped.ttspl_id || null,
            mapped.courier_name || group.courier_name || body.courier_name || 'BlueDart',
            mapped.awb_number || null,
            mapped.weight != null && mapped.weight !== '' ? Number(mapped.weight) : null,
            mapped.remarks || null,
          ]
        );
      }

      // Commit the SO allocations to this DC.
      await client.query(
        `UPDATE sales_order_serials
            SET status = 'dispatched', dc_number = $1, updated_at = NOW()
          WHERE allocation_id = ANY($2::int[])`,
        [dcNumber, ids]
      );

      // Reflect dispatch in legacy product inventory view.
      const groupSerialIds = groupSerials.map((s) => s.serial_id).filter(Boolean);
      const groupSerialNos = groupSerials.map((s) => s.serial_number || s.vsn_serial).filter(Boolean);
      if (groupSerialIds.length || groupSerialNos.length) {
        await client.query(
          `UPDATE vendor_product_inventory
              SET status = 'out_stock', updated_at = NOW()
            WHERE serial_id = ANY($1::int[]) OR serial_number = ANY($2::text[])`,
          [groupSerialIds.length ? groupSerialIds : [-1], groupSerialNos.length ? groupSerialNos : ['']]
        );
      }

      // DC created: reserved -> dispatch_ready. Guard submit sets in_transit.
      for (const s of groupSerials) {
        if (!s.serial_id) continue;
        const { resolveSerialRentRate } = require('../services/serialRentRateService');
        const rentMonthlyRate = await resolveSerialRentRate(client, s.serial_id, dcNumber);
        try {
          await inventorySM.markDispatchReady(client, s.serial_id, {
            dcNumber, customerId: soHead.customer_id || null, entityCode, dispatchMode,
            rentMonthlyRate,
            actorUserId: req.user?.user_id, actorName: req.user?.name,
          });
        } catch (rErr) {
          await client.query(
            `UPDATE vendor_serial_numbers
                SET inventory_status = 'dispatch_ready', current_dc_number = $1,
                    dispatch_mode = $2,
                    rent_monthly_rate = COALESCE($4, rent_monthly_rate),
                    updated_at = NOW()
              WHERE serial_id = $3`,
            [dcNumber, dispatchMode, s.serial_id, rentMonthlyRate]
          );
        }
      }

      // Mirror QC into dc_qc_tickets so the DC's QC gate reflects done QC.
      await client.query(
        `INSERT INTO dc_qc_tickets (dc_number, sales_order_number, ticket_id, ttspl_id, serial_id, status)
         SELECT $1::text, sos.sales_order_number, sos.qc_ticket_id, sos.ttspl_id, sos.serial_id, 'qc_passed'
           FROM sales_order_serials sos
          WHERE sos.allocation_id = ANY($2::int[])
            AND sos.qc_ticket_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM dc_qc_tickets d WHERE d.dc_number = $1 AND d.serial_id = sos.serial_id
            )`,
        [dcNumber, ids]
      );

      createdDcNumbers.push(dcNumber);
      await replacementFlow.tagReplacementOutboundDc(client, dcNumber, sales_order_number);
      const dispatchWf = require('../services/dispatchWorkflowService');
      await dispatchWf.onDcGenerated(client, {
        salesOrderNumber: sales_order_number,
        dcNumber,
        user: req.user,
      });
    }

    if (!createdDcNumbers.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No DCs were created' });
    }

    await client.query('COMMIT');

    // Generate branded PDFs (best-effort, after commit).
    for (const dcNumber of createdDcNumbers) {
      try {
        const dcLines = await getDeliveryChallanLines(dcNumber);
        const pdfPath = await generateDocumentPdf({
          docType: 'delivery_challan', docNumber: dcNumber, header: dcLines[0] || {}, lines: dcLines,
        });
        await pool.query(`UPDATE delivery_challan_lines SET pdf_path = $1 WHERE dc_number = $2`, [pdfPath, dcNumber]);
      } catch (pdfErr) {
        console.error(`DC PDF generation failed (${dcNumber}):`, pdfErr.message);
      }
    }

    // First rental invoice starts when guard submits (in_transit), not at DC create.

    // Post-commit: auto BlueDart AWB + label PDF for courier BlueDart DCs without AWB.
    const bluedartResults = [];
    for (const dcNumber of createdDcNumbers) {
      try {
        const dcLines = await getDeliveryChallanLines(dcNumber);
        const head = dcLines[0] || {};
        const awbOut = await maybeAutoGenerateBluedartAwbForDc(dcNumber, {
          shipBy: head.ship_by || ship_by,
          courierName: head.courier_name || body.courier_name,
          awbNumber: head.awb_number || null,
        });
        if (awbOut) bluedartResults.push({ dc_number: dcNumber, ...awbOut });
      } catch (awbErr) {
        console.error(`createDcsByAddress auto BlueDart (${dcNumber}):`, awbErr.message);
        bluedartResults.push({ dc_number: dcNumber, error: awbErr.message });
      }
    }

    res.status(201).json({
      success: true,
      dc_numbers: createdDcNumbers,
      dcs_created: createdDcNumbers.length,
      first_dc: createdDcNumbers[0],
      message: `${createdDcNumbers.length} DC(s) created: ${createdDcNumbers.join(', ')}`,
      bluedart_awbs: bluedartResults.length ? bluedartResults : undefined,
    });

    for (const dcNumber of createdDcNumbers) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: sales_order_number,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'dc_created',
        description: `${dcNumber} was generated — dispatch ready for warehouse gate.`,
        metadata: { dc_number: dcNumber },
        user: req.user,
      });
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('createDcsByAddress:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

// Edit an existing DC in place (same DC number). Super Admin only.
// Updates the shared header fields across all lines and regenerates the PDF.
exports.updateDeliveryChallan = async (req, res) => {
  const dcNumber = req.params.dcNumber;
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query(
      'SELECT 1 FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1', [dcNumber]
    );
    if (!exists.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }

    const billing = b.customer_billing_address != null
      ? JSON.stringify(parseJsonSafe(b.customer_billing_address, b.customer_billing_address)) : null;
    const shipping = b.customer_shipping_address != null
      ? JSON.stringify(parseJsonSafe(b.customer_shipping_address, b.customer_shipping_address)) : null;

    await client.query(
      `UPDATE delivery_challan_lines SET
         customer_name = COALESCE($1, customer_name),
         email = COALESCE($2, email),
         gst_number = COALESCE($3, gst_number),
         supply_state = COALESCE($4, supply_state),
         customer_billing_address = COALESCE($5::jsonb, customer_billing_address),
         customer_shipping_address = COALESCE($6::jsonb, customer_shipping_address),
         ship_by = COALESCE($7, ship_by),
         courier_name = COALESCE($8, courier_name),
         awb_number = COALESCE($9, awb_number),
         remarks = COALESCE($10, remarks),
         updated_at = NOW()
       WHERE dc_number = $11`,
      [
        b.customer_name ?? null, b.email ?? b.customer_email ?? null,
        b.gst_number ?? b.GST_number ?? null, b.supply_state ?? null,
        billing, shipping,
        b.ship_by ?? null, b.courier_name ?? null, b.awb_number ?? null,
        b.remarks ?? null, dcNumber,
      ]
    );
    await client.query('COMMIT');

    // Regenerate the PDF so it reflects the edits (same DC number).
    let pdfPath = null;
    try {
      const dcLines = await getDeliveryChallanLines(dcNumber);
      pdfPath = await generateDocumentPdf({
        docType: 'delivery_challan', docNumber: dcNumber, header: dcLines[0] || {}, lines: dcLines,
      });
      await pool.query(`UPDATE delivery_challan_lines SET pdf_path = $1 WHERE dc_number = $2`, [pdfPath, dcNumber]);
    } catch (pdfErr) {
      console.error('DC PDF regeneration failed:', pdfErr.message);
    }

    res.json({ success: true, message: 'Delivery challan updated', dc_number: dcNumber, pdf_path: pdfPath });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateDeliveryChallan:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.getOperationCounts = async (req, res) => {
  try {
    const role = req.user?.role || null;
    const userId = req.user?.user_id || null;
    const isDispatch = role === 'dispatch';
    const [restrictDispatchSale, restrictDispatchRental] = isDispatch
      ? await Promise.all([
        isRestrictedToAssigned(req, 'sales_orders_sale'),
        isRestrictedToAssigned(req, 'sales_orders_rental'),
      ])
      : [false, false];
    const counts = await getOperationCounts({
      role,
      userId,
      restrictDispatchSale,
      restrictDispatchRental,
      restrictDispatchAll: restrictDispatchSale && restrictDispatchRental,
    });
    res.json({ success: true, counts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAvailableSerials = async (req, res) => {
  try {
    const serials = await searchAvailableInventory({
      brand: req.query.brand,
      model_name: req.query.model_name || req.query.model,
      processor: req.query.processor,
      generation: req.query.generation,
      ram: req.query.ram,
      storage: req.query.storage,
      quotation_type: req.query.quotation_type,
      search: req.query.search,
      limit: req.query.limit,
    });
    res.json({ success: true, serials });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendDeliveryOtp = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const body = req.body || {};
    const lines = await getDeliveryChallanLines(dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const first = lines[0];
    const customerEmail = body.email || first.email || null;
    const customerName = body.name || first.customer_name || null;
    const otp = String(Math.floor(100000 + Math.random() * 900000));

    await pool.query(
      `UPDATE delivery_challan_lines
          SET otp_code = $1, otp_sent_at = NOW(), otp_verified_at = NULL,
              d_otp = $1, delivery_otp_sent_at = NOW(),
              d_customer_email = COALESCE($2, d_customer_email, email),
              d_customer_name = COALESCE($3, d_customer_name, customer_name),
              updated_at = NOW()
        WHERE dc_number = $4`,
      [otp, customerEmail, customerName, dcNumber]
    );

    if (customerEmail) {
      try {
        await emailDocument({
          to: customerEmail,
          subject: `Delivery OTP for ${dcNumber}`,
          text: `Your delivery OTP is ${otp}`,
          pdfRelativePath: null,
        });
      } catch (mailErr) {
        console.error('Customer OTP email failed:', mailErr.message);
      }
    }

    const salesEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    if (salesEmail) {
      try {
        const { normalizeDeliveryAddress } = require('../utils/deliveryAddressUtils');
        const shipping = normalizeDeliveryAddress(first.customer_shipping_address) || {};
        const addressText = [shipping.address, shipping.city, shipping.state, shipping.pincode || shipping.zip_code]
          .filter(Boolean).join(', ');
        await emailDocument({
          to: salesEmail,
          subject: `Delivery OTP — ${dcNumber} — ${first.customer_name || ''}`.trim(),
          text:
            `DC: ${dcNumber}\n`
            + `Customer: ${first.customer_name || ''}\n`
            + `Address: ${addressText || '—'}\n\n`
            + `OTP: ${otp}\n\n`
            + `(Share this OTP verbally with the customer at delivery.)`,
          pdfRelativePath: null,
        });
      } catch (mailErr) {
        console.error('Sales OTP email failed:', mailErr.message);
      }
    }

    const { userCanViewDeliveryRegisterOtp } = require('../services/deliveryOtpAccess');
    const payload = {
      success: true,
      message: customerEmail
        ? 'OTP sent to customer and sales email.'
        : 'OTP generated and emailed to sales.',
    };
    if (await userCanViewDeliveryRegisterOtp(req.user)) payload.otp_visible = otp;
    res.json(payload);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifyDeliveryOtp = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const { otp } = req.body;
    const result = await pool.query(
      `SELECT COALESCE(otp_code, d_otp) AS stored_otp
         FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [dcNumber]
    );
    if (!result.rows.length || result.rows[0].stored_otp !== String(otp)) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    await pool.query(
      `UPDATE delivery_challan_lines
          SET otp_verified_at = COALESCE(otp_verified_at, NOW()),
              d_otp_verified_at = COALESCE(d_otp_verified_at, NOW()),
              updated_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber]
    );
    res.json({ success: true, message: 'OTP verified' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.submitDeliveryRegister = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const { delivered_serial_numbers, rejected_serial_numbers, submitted_remark, status } = req.body;
    await pool.query(
      `UPDATE delivery_challan_lines SET
         delivered_serial_numbers = $1,
         rejected_serial_numbers = $2,
         submitted_remark = $3,
         status = COALESCE($4, 'delivered'),
         delivery_completed_at = NOW(),
         updated_at = NOW()
       WHERE dc_number = $5`,
      [
        JSON.stringify(delivered_serial_numbers || []),
        JSON.stringify(rejected_serial_numbers || []),
        submitted_remark || null,
        status || 'delivered',
        dcNumber,
      ]
    );
    res.json({ success: true, message: 'Delivery register updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.assignReturnDcNumber = async (req, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    const returnDcNumber = await nextDocumentNumber('return_dc');
    const result = await pool.query(
      `UPDATE support_tickets SET return_dc_number = $1, complaint_type = COALESCE(complaint_type, 'pickup'), updated_at = NOW()
       WHERE id = $2 RETURNING id, return_dc_number`,
      [returnDcNumber, ticketId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    res.json({ success: true, return_dc_number: returnDcNumber, ticket: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listReturnDeliveryChallans = async (req, res) => {
  try {
    const data = await listReturnDeliveryChallans({
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 25, 100),
      search: req.query.search || '',
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      status: req.query.status || req.query.tab || 'all',
    });
    res.json({
      success: true,
      ...data,
      rows: data.return_dcs,
      orders: data.return_dcs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.exportReturnDcLaptops = async (req, res) => {
  try {
    const status = req.query.status || req.query.tab || 'in_transit';
    const rows = await listReturnDcLaptopExportRows({
      search: req.query.search || '',
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      status,
    });

    const fmtDate = (d) => {
      if (!d) return '';
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return '';
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      return `${dd}-${mm}-${dt.getFullYear()}`;
    };

    const columnOrder = [
      'TTSPL',
      'Serial Number',
      'Brand',
      'Model',
      'Customer',
      'City',
      'State',
      'Pincode',
      'Pickup Address',
      'Current Location',
      'Dispatch Mode',
      'Assigned To',
      'Courier / AWB',
      'RDC Number',
      'Original DC',
      'SO Number',
      'Pickup Type',
      'RDC Status',
      'Pickup Date',
      'Created',
    ];

    const orderedRows = rows.map((r) => {
      const courierAwb = [r.courier_name, r.awb_number, r.porter_tracking_id].filter(Boolean).join(' · ');
      return {
        TTSPL: r.ttspl || '',
        'Serial Number': r.serial_number || '',
        Brand: r.brand || '',
        Model: r.model || '',
        Customer: r.customer_name || '',
        City: r.city || '',
        State: r.state || '',
        Pincode: r.pincode || '',
        'Pickup Address': r.address || '',
        'Current Location': r.current_location || '',
        'Dispatch Mode': r.dispatch_mode || r.pickup_method || '',
        'Assigned To': r.assignee_name || '',
        'Courier / AWB': courierAwb,
        'RDC Number': r.return_dc_number || '',
        'Original DC': r.original_dc_number || '',
        'SO Number': r.sales_order_number || '',
        'Pickup Type': r.pickup_type || '',
        'RDC Status': r.rdc_status || '',
        'Pickup Date': fmtDate(r.pickup_date),
        Created: fmtDate(r.created_at),
      };
    });

    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(orderedRows, { header: columnOrder });
    ws['!cols'] = columnOrder.map((h) => ({
      wch: h === 'Current Location' || h === 'Pickup Address' ? 48 : h === 'Customer' ? 28 : 16,
    }));
    XLSX.utils.book_append_sheet(wb, ws, 'In Transit Laptops');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const stamp = new Date().toISOString().slice(0, 10);
    const fileStatus = String(status).replace(/[^a-z0-9_]/gi, '_') || 'in_transit';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="return_dc_${fileStatus}_laptops_${stamp}.xlsx"`);
    res.send(buf);
  } catch (error) {
    console.error('exportReturnDcLaptops:', error);
    res.status(500).json({ success: false, message: error.message || 'Export failed' });
  }
};

exports.getReturnDcDetail = async (req, res) => {
  try {
    const rdcNumber = String(req.params.rdcNumber || '').trim();
    const detail = await getReturnDcDetail(rdcNumber);
    if (!detail) {
      return res.status(404).json({ success: false, message: 'Return DC not found' });
    }
    res.json({ success: true, ...detail });
  } catch (error) {
    console.error('getReturnDcDetail:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load Return DC detail' });
  }
};

exports.regenerateReturnDcPdf = async (req, res) => {
  try {
    const rdcNumber = String(req.params.rdcNumber || '').trim();
    const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');
    const pdfPath = await regenerateReturnDcPdfByRdc(pool, rdcNumber);
    if (!pdfPath) {
      return res.status(404).json({ success: false, message: 'Return DC not found or PDF could not be generated' });
    }
    res.json({ success: true, pdf_path: pdfPath, return_dc_number: rdcNumber });
  } catch (error) {
    console.error('regenerateReturnDcPdf:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to regenerate PDF' });
  }
};

const resolveUploadAbsolutePath = (relativePath) => {
  if (!relativePath) return null;
  const clean = String(relativePath).replace(/^\//, '');
  const candidates = [
    path.join(__dirname, '..', clean),
    path.join(__dirname, '..', '..', clean),
  ];
  for (const abs of candidates) {
    if (fs.existsSync(abs)) return abs;
  }
  return null;
};

exports.downloadReturnDcPdf = async (req, res) => {
  try {
    const rdcNumber = String(req.params.rdcNumber || '').trim();
    const row = await pool.query(
      `SELECT pdf_path FROM delivery_challan_lines
        WHERE dc_number = $1 AND movement_type = 'return'
        LIMIT 1`,
      [rdcNumber]
    );
    let pdfPath = row.rows[0]?.pdf_path;
    if (!pdfPath) {
      pdfPath = await regenerateReturnDcPdfByRdc(pool, rdcNumber);
    }
    if (!pdfPath) {
      return res.status(404).json({ success: false, message: 'Return DC PDF not found' });
    }
    const abs = resolveUploadAbsolutePath(pdfPath);
    if (!abs) {
      return res.status(404).json({ success: false, message: 'PDF file missing on disk' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(abs)}"`);
    return res.sendFile(abs);
  } catch (error) {
    console.error('downloadReturnDcPdf:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to download PDF' });
  }
};

/**
 * Generate a Return DC for a support pickup ticket as a delivery_challan_lines row
 * (movement_type='return') so it rides the SAME delivery flow. Pickup mode:
 *   technician -> dispatch_mode 'inhouse', delivery_person_id = technician user
 *                 (appears in My Deliveries / Technician Bucket)
 *   courier / porter -> warehouse uploads POD via the Delivery Register.
 * On POD completion the unit re-enters QC + a credit note is raised.
 */
exports.generateReturnDc = async (req, res) => {
  const client = await pool.connect();
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    const body = req.body || {};
    const {
      pickup_mode = 'technician', technician_user_id = null,
      courier_name = null, awb_number = null,
    } = body;
    const dispatchMode = { technician: 'inhouse', courier: 'courier', porter: 'porter' }[pickup_mode] || 'inhouse';

    const tRes = await client.query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
    if (!tRes.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const t = tRes.rows[0];
    if (t.return_dc_number) {
      return res.status(400).json({ success: false, message: `Return DC already generated (${t.return_dc_number})` });
    }

    // Prefer open pickup items; if none (migrated/completed pre-CRM pickups),
    // backfill from any pickup item that still lacks a Return DC.
    let itemsRes = await client.query(
      `SELECT * FROM support_ticket_items
        WHERE ticket_id = $1 AND item_type = 'pickup'
          AND status NOT IN ('resolved','closed','inventory_updated')
          AND return_dc_number IS NULL
        ORDER BY id ASC`,
      [ticketId]
    );
    let isBackfill = false;
    if (!itemsRes.rows.length) {
      itemsRes = await client.query(
        `SELECT * FROM support_ticket_items
          WHERE ticket_id = $1 AND item_type = 'pickup'
            AND return_dc_number IS NULL
          ORDER BY id ASC`,
        [ticketId]
      );
      isBackfill = itemsRes.rows.length > 0;
    }
    if (!itemsRes.rows.length) {
      return res.status(400).json({ success: false, message: 'No pickup items without Return DC on this ticket' });
    }

    const entries = [];
    let firstSpec = {};
    let brand = null;
    let modelName = null;
    for (const it of itemsRes.rows) {
      const code = it.ttspl_id || it.unique_serial_number || it.serial_number;
      if (!code) continue;
      // Prefer inventory_asset_code match so duplicate TTSPL aliases don't win.
      const sr = await client.query(
        `SELECT serial_id, serial_number, inventory_asset_code, extra
           FROM vendor_serial_numbers
          WHERE deleted_at IS NULL
            AND (
              inventory_asset_code = $1
              OR serial_number = $1
              OR extra->>'ttspl_id' = $1
              OR extra->>'unique_product_serial' = $1
            )
          ORDER BY
            CASE WHEN inventory_asset_code = $1 THEN 0 ELSE 1 END,
            CASE WHEN serial_number = $1 THEN 0 ELSE 1 END,
            serial_id ASC
          LIMIT 1`,
        [code]
      );
      const s = sr.rows[0];
      if (s) {
        entries.push(`${s.serial_id}|${s.serial_number}|${s.inventory_asset_code || code}`);
        if (!firstSpec.brand) firstSpec = s.extra || {};
      } else {
        entries.push(`|${code}|${code}`);
      }
      if (!brand) brand = it.brand || null;
      if (!modelName) modelName = it.model || null;
    }
    if (!entries.length) return res.status(400).json({ success: false, message: 'No serials resolved for pickup' });

    const firstItem = itemsRes.rows[0];
    const rdc = await nextDocumentNumber('return_dc');
    const pickupAddr = (typeof t.pickup_address === 'string' ? JSON.parse(t.pickup_address) : t.pickup_address) || {};
    const rawDeliveryPersonId = dispatchMode === 'inhouse' && technician_user_id
      ? parseInt(technician_user_id, 10)
      : (firstItem.assigned_to || firstItem.pickup_assigned_to || null);
    const deliveryPersonId = rawDeliveryPersonId
      ? await resolveTechnicianId(client, rawDeliveryPersonId)
      : null;

    const rdcTxn = await resolveTxnTypeForDc(client, {
      salesOrderNumber: t.sales_order_number || null,
      originalDcNumber: t.dc_number || null,
    });
    const rdcHsn = resolveHsnForPersist({
      transactionType: rdcTxn,
      role: req.user?.role,
      override: body.hsn_code,
    });
    const rdcEntity = entityForQuotationType(rdcTxn === 'sale' ? 'sales' : 'rental');

    // Completed pickups get a delivered RDC with timestamps copied from the item.
    const dcStatus = isBackfill && (firstItem.warehouse_received_at || firstItem.picked_up_at || firstItem.resolved_at)
      ? 'delivered'
      : 'in_transit';
    const itemDispatchMode = firstItem.pickup_method === 'courier' ? 'courier'
      : firstItem.pickup_method === 'porter' ? 'porter'
      : (firstItem.pickup_method === 'technician' || firstItem.pickup_method === 'inhouse') ? 'inhouse'
      : dispatchMode;

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO delivery_challan_lines
         (dc_number, movement_type, support_ticket_id, customer_id, customer_name, email,
          customer_shipping_address, brand, model_name, quantity, serial_number,
          dispatch_mode, delivery_person_id, courier_name, awb_number, status,
          dispatched_at, delivered_at, return_to_warehouse_at,
          created_by, created_at, updated_at,
          sales_order_number, original_dc_number, entity_code, hsn_code,
          remarks, dc_purpose)
       VALUES ($1,'return',$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,
               COALESCE($16::timestamptz, NOW()), $17::timestamptz, $18::timestamptz,
               $19, COALESCE($20::timestamptz, NOW()), NOW(),
               $21,$22,$23,$24,$25,'standard')`,
      [
        rdc, ticketId, t.customer_id, t.customer_name, t.ticket_email || null,
        JSON.stringify(pickupAddr),
        brand || firstSpec.brand || null,
        modelName || firstSpec.model || firstSpec.model_name || null,
        entries.length, JSON.stringify(entries),
        itemDispatchMode, deliveryPersonId,
        courier_name || firstItem.pickup_courier_name || null,
        awb_number || firstItem.pickup_awb || null,
        dcStatus,
        firstItem.picked_up_at || firstItem.visited_at || firstItem.created_at || null,
        dcStatus === 'delivered' ? (firstItem.customer_otp_verified_at || firstItem.picked_up_at || firstItem.resolved_at || null) : null,
        dcStatus === 'delivered' ? (firstItem.warehouse_received_at || firstItem.resolved_at || null) : null,
        req.user?.user_id || firstItem.warehouse_received_by || firstItem.assigned_to || null,
        firstItem.created_at || null,
        t.sales_order_number || null, t.dc_number || null, rdcEntity, rdcHsn,
        firstItem.remarks || (isBackfill ? 'Return DC backfilled for pre-CRM / completed pickup' : null),
      ]
    );
    await client.query(
      `UPDATE support_tickets
          SET return_dc_number = $1, complaint_type = COALESCE(complaint_type, 'pickup'),
              ticket_category = COALESCE(ticket_category, 'pickup'),
              status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
              updated_at = NOW()
        WHERE id = $2`,
      [rdc, ticketId]
    );
    // Link ALL pickup items missing RDC (open or completed backfill).
    await client.query(
      `UPDATE support_ticket_items SET
         return_dc_number = $1,
         customer_otp_code = COALESCE(
           customer_otp_code, otp_code,
           LPAD((floor(random() * 1000000))::int::text, 6, '0')
         ),
         customer_otp_sent_at = COALESCE(customer_otp_sent_at, NOW()),
         pickup_type = COALESCE(
           pickup_type,
           CASE WHEN source_item_id IS NOT NULL THEN 'repair' ELSE 'return' END
         ),
         pickup_method = COALESCE(NULLIF(pickup_method, ''), $3),
         pickup_assigned_to = COALESCE(pickup_assigned_to, assigned_to),
         updated_at = NOW()
       WHERE ticket_id = $2 AND item_type = 'pickup'
         AND return_dc_number IS NULL`,
      [rdc, ticketId, firstItem.pickup_method || 'technician']
    );
    await client.query('COMMIT');

    try {
      await regenerateReturnDcPdfByRdc(pool, rdc);
    } catch (pdfErr) {
      console.error('[sales] return DC pdf (generate):', pdfErr.message);
    }

    res.json({
      success: true,
      return_dc_number: rdc,
      dispatch_mode: itemDispatchMode,
      delivery_person_id: deliveryPersonId,
      backfill: isBackfill,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('generateReturnDc:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.ensureSalesManagementSchema = async () => {
  for (const file of [
    '042_sales_management_module.sql',
    '043_operation_management_extras.sql',
    '044_quotation_demo_type.sql',
    '061_phase4_sales_pipeline.sql',
    '065_quotation_lead_link.sql',
    '066_quotation_sent_status.sql',
    '149_so_dc_line_hsn.sql',
  ]) {
    const sqlPath = path.join(__dirname, '../migrations', file);
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
  }
};

exports.recordPayment = async (req, res) => {
  try {
    const soNumber = req.params.soNumber;
    const body = req.body || {};
    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    const paymentType = body.payment_type;
    const allowed = ['advance', 'security_deposit', 'monthly', 'partial', 'final'];
    if (!allowed.includes(paymentType)) {
      return res.status(400).json({ success: false, message: 'Invalid payment_type' });
    }
    const soLines = await getSalesOrderLines(soNumber);
    if (!soLines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    const customerId = soLines[0].customer_id || null;
    const result = await pool.query(
      `INSERT INTO sales_order_payments
        (sales_order_number, customer_id, payment_type, amount, payment_date, payment_mode, reference_number, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING payment_id`,
      [
        soNumber,
        customerId,
        paymentType,
        amount,
        body.payment_date || new Date().toISOString().slice(0, 10),
        body.payment_mode || 'bank_transfer',
        body.reference_number || null,
        body.notes || null,
        req.user.user_id,
      ]
    );
    res.status(201).json({
      success: true,
      payment_id: result.rows[0].payment_id,
      message: 'Payment recorded',
    });

    await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.PAYMENT,
      action: 'payment_added',
      description: `₹${amount.toLocaleString('en-IN')} payment recorded by ${req.user?.name || 'User'}.`,
      metadata: {
        payment_id: result.rows[0].payment_id,
        amount,
        payment_type: paymentType,
        payment_mode: body.payment_mode || 'bank_transfer',
      },
      remarks: body.notes || null,
      user: req.user,
    });
  } catch (error) {
    console.error('recordPayment:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listPayments = async (req, res) => {
  try {
    const soNumber = req.params.soNumber;
    const { rows } = await pool.query(
      `SELECT p.*, u.name AS recorded_by_name
       FROM sales_order_payments p
       LEFT JOIN users u ON u.user_id = p.recorded_by
       WHERE p.sales_order_number = $1
       ORDER BY p.payment_date DESC, p.payment_id DESC`,
      [soNumber]
    );
    const totals = rows.reduce(
      (acc, r) => {
        const amt = Number(r.amount) || 0;
        acc.total_paid += amt;
        if (r.payment_type === 'advance') acc.total_advance += amt;
        if (r.payment_type === 'security_deposit') acc.total_security += amt;
        return acc;
      },
      { total_paid: 0, total_advance: 0, total_security: 0 }
    );
    res.json({ success: true, payments: rows, ...totals });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSoWithPayments = async (req, res) => {
  try {
    const soNumber = req.params.soNumber;
    if (!req.dispatchSoAccess) {
      await assertSalesOrderVisibleToUser(soNumber, req.user);
      if (!req.permissionCache) req.permissionCache = {};
      await assertReplacementSalesOrderAccessIfScoped(soNumber, req.user, req.permissionCache);
    }
    const lines = await getSalesOrderLines(soNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    const canViewPayments = req.user?.role === 'super_admin'
      || await hasPermission(req.user.user_id, req.user.role, 'payment_records', 'can_view', req.permissionCache);
    let paymentRows = [];
    if (canViewPayments) {
      const payRes = await pool.query(
        `SELECT * FROM sales_order_payments WHERE sales_order_number = $1 ORDER BY payment_date DESC`,
        [soNumber]
      );
      paymentRows = payRes.rows;
    }
    const dcRes = await pool.query(
      `SELECT DISTINCT ON (dc_number) dc_number, status, created_at, ship_by, dispatch_mode, dispatched_at
       FROM delivery_challan_lines WHERE sales_order_number = $1 ORDER BY dc_number, id DESC`,
      [soNumber]
    );
    const attachedRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM sales_order_serials
        WHERE sales_order_number = $1 AND status = 'attached'`,
      [soNumber]
    );
    const fulfillment = await getSalesOrderFulfillmentCounts(soNumber);
    const dispatchMeta = await getSalesOrderDispatchDate(soNumber);
    let totalValue = 0;
    let laptopQty = fulfillment.laptop_qty || 0;
    lines.forEach((l) => {
      const qty = Number(l.main_qty || l.quantity || 0) || 0;
      if (!laptopQty) laptopQty += qty;
      l.amount = +(Number(l.rate || 0) * qty).toFixed(2);
      totalValue += l.amount;
      l.hsn_code = resolveHsnForDisplay(l.hsn_code, { quotationType: l.quotation_type });
    });
    const totalPaid = canViewPayments
      ? paymentRows.reduce((s, p) => s + Number(p.amount || 0), 0)
      : null;
    const soSecurity = sumSoSecurityAmount(lines);
    const gstOnShipping = lines.some((l) => l.is_wfh === true || l.is_wfh === 't' || l.is_wfh === 1);
    const totals = computeGstBreakdown({
      subtotal: totalValue,
      shipping: lines[0].shiping_charges,
      security: soSecurity,
      supplyState: resolveSupplyStateFromAddress(lines[0].customer_shipping_address, lines[0].supply_state),
      gstOnShipping,
    });
    const soStatus = deriveSalesOrderListStatus({
      status: lines.every((l) => String(l.status).toLowerCase() === 'cancelled') ? 'cancelled' : (lines[0].status || 'pending'),
      laptop_qty: laptopQty,
      delivered_count: fulfillment.delivered_count,
      dispatched_count: fulfillment.dispatched_count,
      pending_qty: fulfillment.pending_qty,
    });
    const supportMeta = await getSalesOrderSupportMeta(soNumber);
    // Refusal branch, derived from the challan state — no new SO status column.
    const rejectionSvc = require('../services/deliveryRejectionService');
    const dcCancelEligibility = await rejectionSvc
      .getSoCancelDcEligibility(pool, soNumber)
      .catch(() => null);
    res.json({
      success: true,
      sales_order_number: soNumber,
      status: soStatus,
      refusal_status: refusalStatusLabel(soStatus, dcCancelEligibility),
      dc_cancel_eligibility: dcCancelEligibility,
      can_cancel: soStatus !== 'cancelled' && (dcCancelEligibility?.can_cancel !== false),
      is_replacement_order: supportMeta.is_replacement_order,
      support_ticket_id: supportMeta.support_ticket_id,
      laptop_qty: laptopQty,
      attached_count: Number(attachedRes.rows[0]?.c || fulfillment.attached_count || 0),
      delivered_count: fulfillment.delivered_count,
      dispatched_count: fulfillment.dispatched_count,
      pending_qty: fulfillment.pending_qty,
      dispatch_date: dispatchMeta.dispatch_date,
      last_dispatch_date: dispatchMeta.last_dispatch_date,
      lines,
      ...(canViewPayments ? { payments: paymentRows } : {}),
      delivery_challans: dcRes.rows,
      totals,
      summary: {
        total_value: totalValue,
        laptop_qty: laptopQty,
        attached_count: fulfillment.attached_count,
        delivered_count: fulfillment.delivered_count,
        dispatched_count: fulfillment.dispatched_count,
        pending_qty: fulfillment.pending_qty,
        dispatch_date: dispatchMeta.dispatch_date,
        last_dispatch_date: dispatchMeta.last_dispatch_date,
        ...(canViewPayments ? {
          total_paid: totalPaid,
          balance_due: Math.max(0, totalValue - totalPaid),
        } : {}),
        security_amount: soSecurity,
        status: soStatus,
        ...totals,
      },
    });
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Derived label for the customer-refusal branch:
 *   Dispatched -> Customer Refused -> Waiting for Warehouse Receipt -> Warehouse Received -> Cancelled
 * Expressed from the existing challan state instead of a new SO status column, so the
 * successful branch (Dispatched -> Customer Accepted -> ... -> Order Completed) is unchanged
 * and reads `null` here.
 */
function refusalStatusLabel(soStatus, eligibility) {
  if (!eligibility?.has_dc) return null;
  if (soStatus === 'cancelled') {
    return eligibility.all_refused_and_received ? 'Cancelled after Customer Refusal' : null;
  }
  if (eligibility.awaiting_warehouse_count > 0) return 'Customer Refused — Waiting for Warehouse Receipt';
  if (eligibility.all_refused_and_received) return 'Customer Refused — Warehouse Received';
  return null;
}

// Cancel a sales order. Sets every line's status to 'cancelled' so the SO is
// excluded from the downstream workflow (DC creation is blocked while cancelled).
// Refused once any delivery challan exists for the SO (already dispatched) — with one
// exception: if every challan line was refused by the customer AND received back at the
// warehouse, nothing is out with a customer or a delivery person, so the order can close.
// Releases all attached laptops back to inventory when cancelled.
exports.cancelSalesOrder = async (req, res) => {
  const client = await pool.connect();
  try {
    const soNumber = req.params.soNumber;
    const rejectionSvc = require('../services/deliveryRejectionService');
    await rejectionSvc.ensureDeliveryRejectionSchema();
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT status FROM sales_order_lines WHERE sales_order_number = $1`,
      [soNumber]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    if (existing.rows.every((r) => String(r.status).toLowerCase() === 'cancelled')) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Sales order is already cancelled' });
    }

    // A challan on the SO locks cancellation, unless the whole DC footprint came back
    // through the customer-refusal branch (refused + warehouse-received). Units still with
    // the delivery person, awaiting warehouse receipt, or delivered keep the original lock.
    const dcEligibility = await rejectionSvc.getSoCancelDcEligibility(client, soNumber);
    if (!dcEligibility.can_cancel) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: dcEligibility.awaiting_warehouse_count > 0
          ? 'Cannot cancel: refused units are still awaiting warehouse receipt. Receive them back at the warehouse first.'
          : 'Cannot cancel: a delivery challan has already been created for this sales order.',
        dc_cancel_eligibility: dcEligibility,
      });
    }

    const attachedRes = await client.query(
      `SELECT allocation_id, serial_id, qc_ticket_id, sales_order_number
         FROM sales_order_serials
        WHERE sales_order_number = $1 AND status = 'attached'
        FOR UPDATE`,
      [soNumber]
    );

    for (const alloc of attachedRes.rows) {
      if (alloc.serial_id) {
        try {
          await inventorySM.backToStock(client, alloc.serial_id, {
            reason: `Sales order ${soNumber} cancelled`,
            actorUserId: req.user?.user_id,
            actorName: req.user?.name,
          });
        } catch (_) { /* tolerate non-canonical inventory state */ }
      }
      if (alloc.qc_ticket_id) {
        // A 'return_qc' ticket is the warehouse's re-entry inspection of a laptop that is
        // already physically back (customer-refusal branch). That work is independent of
        // the sales order, so only the order's own pre-dispatch QC ticket is cancelled.
        await client.query(
          `UPDATE tickets SET status = 'cancelled', updated_at = NOW()
            WHERE ticket_id = $1 AND status NOT IN ('completed','cancelled')
              AND COALESCE(ticket_type, '') <> 'return_qc'`,
          [alloc.qc_ticket_id]
        );
      }
      await client.query(
        `UPDATE sales_order_serials SET status = 'removed', updated_at = NOW() WHERE allocation_id = $1`,
        [alloc.allocation_id]
      );
    }

    await client.query(
      `UPDATE sales_order_lines SET status = 'cancelled' WHERE sales_order_number = $1`,
      [soNumber]
    );

    const wfCancel = await client.query(
      `UPDATE dispatch_workflow
          SET status = 'cancelled', updated_at = NOW()
        WHERE sales_order_number = $1
          AND status = 'waiting_acceptance'
        RETURNING id, assigned_user_id`,
      [soNumber]
    );

    await client.query('COMMIT');

    if (wfCancel.rows[0]) {
      try {
        const { emitCancelled } = require('../services/dispatchSocketService');
        await emitCancelled(soNumber, wfCancel.rows[0].assigned_user_id);
      } catch (err) {
        console.error('dispatch socket cancelled emit failed:', err.message);
      }
    }

    const released = attachedRes.rows.length;
    const afterRefusal = dcEligibility.has_dc && dcEligibility.all_refused_and_received;
    res.json({
      success: true,
      message: released
        ? `Sales order cancelled — ${released} laptop${released === 1 ? '' : 's'} released to inventory`
        : 'Sales order cancelled',
      status: 'cancelled',
      released_serials: released,
      cancelled_after_customer_refusal: afterRefusal,
    });

    await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.SALES_ORDER,
      action: 'cancelled',
      description: afterRefusal
        ? `${req.user?.name || 'User'} cancelled Sales Order ${soNumber} after customer refusal and warehouse receipt.`
        : `${req.user?.name || 'User'} cancelled Sales Order ${soNumber}.`,
      remarks: released ? `${released} laptop(s) released to inventory` : null,
      metadata: afterRefusal
        ? {
          cancelled_after_customer_refusal: true,
          dc_count: dcEligibility.dc_count,
          dc_line_count: dcEligibility.dc_line_count,
        }
        : {},
      user: req.user,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('cancelSalesOrder:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.getSoLineCancelEligibility = async (req, res) => {
  const lineId = parseInt(req.params.lineId, 10);
  if (!Number.isFinite(lineId)) {
    return res.status(400).json({ success: false, message: 'Invalid line id' });
  }
  try {
    const { getLineCancelEligibility } = require('../services/soPartialCancelService');
    const eligibility = await getLineCancelEligibility(pool, lineId);
    res.json({ success: true, eligibility });
  } catch (error) {
    console.error('getSoLineCancelEligibility:', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.partialCancelSoLine = async (req, res) => {
  const lineId = parseInt(req.params.lineId, 10);
  const { cancel_qty: cancelQty, reason } = req.body || {};
  if (!Number.isFinite(lineId)) {
    return res.status(400).json({ success: false, message: 'Invalid line id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { partialCancelSoLine } = require('../services/soPartialCancelService');
    const result = await partialCancelSoLine(client, {
      lineId,
      cancelQty,
      reason: reason ? String(reason).trim() : null,
      actorUserId: req.user?.user_id,
      actorName: req.user?.name,
    });
    await client.query('COMMIT');

    const released = result.released_serials?.length || 0;
    const slotOnly = result.pending_slot_reduction || 0;
    let message = `Cancelled ${result.cancelled_qty} unit(s) on ${result.sales_order_number}.`;
    if (released) message += ` ${released} laptop(s) released to inventory.`;
    else if (slotOnly) message += ' Order quantity reduced (no laptops were attached).';

    res.json({ success: true, message, ...result });

    await safeLogSalesOrderActivity({
      salesOrderNumber: result.sales_order_number,
      activityType: ACTIVITY_TYPES.SALES_ORDER,
      action: 'partial_cancel',
      description: `${req.user?.name || 'User'} partially cancelled ${result.cancelled_qty} unit(s) on line #${lineId}.`,
      remarks: reason || null,
      metadata: {
        line_id: lineId,
        cancelled_qty: result.cancelled_qty,
        released_serials: result.released_serials,
        before: result.before,
        after: result.after,
      },
      user: req.user,
    });

    try {
      const n = result.sales_order_number;
      const lines = await getSalesOrderLines(n);
      if (lines.length) {
        const { dispatch_date: dispatchDate } = await getSalesOrderDispatchDate(n);
        const pdf = await generateDocumentPdf({
          docType: 'sales_order',
          docNumber: n,
          header: { ...lines[0], dispatch_date: dispatchDate },
          lines,
        });
        await pool.query(
          `UPDATE sales_order_lines SET pdf_path = $1 WHERE sales_order_number = $2`,
          [pdf, n]
        );
      }
    } catch (pdfErr) {
      console.error('partialCancelSoLine pdf:', pdfErr.message);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('partialCancelSoLine:', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

// (Re)generate the branded PDF for a quotation / SO / DC and return its path.
exports.regenerateQuotationPdf = async (req, res) => {
  try {
    const n = req.params.quotationNumber;
    const lines = await getQuotationLines(n);
    if (!lines.length) return res.status(404).json({ success: false, message: 'Quotation not found' });
    const pdf = await generateDocumentPdf({ docType: 'quotation', docNumber: n, header: lines[0], lines });
    await pool.query(`UPDATE sales_quotations SET pdf_path = $1 WHERE quotation_number = $2`, [pdf, n]);
    res.json({ success: true, pdf_path: pdf });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.regenerateSalesOrderPdf = async (req, res) => {
  try {
    const n = req.params.salesOrderNumber;
    const lines = await getSalesOrderLines(n);
    if (!lines.length) return res.status(404).json({ success: false, message: 'Sales order not found' });
    const { dispatch_date: dispatchDate } = await getSalesOrderDispatchDate(n);
    const pdf = await generateDocumentPdf({
      docType: 'sales_order',
      docNumber: n,
      header: { ...lines[0], dispatch_date: dispatchDate },
      lines,
    });
    await pool.query(`UPDATE sales_order_lines SET pdf_path = $1 WHERE sales_order_number = $2`, [pdf, n]);
    await safeLogSalesOrderActivity({
      salesOrderNumber: n,
      activityType: ACTIVITY_TYPES.DOCUMENT,
      action: 'pdf_generated',
      description: `Sales Order PDF regenerated by ${req.user?.name || 'User'}.`,
      user: req.user,
    });
    res.json({ success: true, pdf_path: pdf });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.regenerateDcPdf = async (req, res) => {
  try {
    const n = req.params.dcNumber;
    await assertCanDownloadSaleDcPdf(req.user, n);
    const pdf = await regenerateDcPdfForNumber(n);
    if (!pdf) return res.status(404).json({ success: false, message: 'DC not found' });
    res.json({ success: true, pdf_path: pdf });
  } catch (e) {
    const status = e.message?.includes('E-Invoice must be uploaded') ? 403 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

/** Download saved printable waybill PDF for this DC (one AWB, or all merged). */
exports.downloadDcBluedartAwbPdf = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const lines = await getDeliveryChallanLines(dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const head = lines[0];
    const { splitAwbTokens } = require('../utils/bluedartAwbUtils');
    const shipments = await listDcAwbShipments(dcNumber, head);
    const allowedAwbs = new Set([
      ...shipments.map((s) => s.awb_number),
      ...splitAwbTokens(head.awb_number),
    ]);
    const requestedAwb = String(req.query.awb || '').trim();
    const wantAll = String(req.query.all || '') === '1';

    const resolveAbs = (awb) => {
      const found = findSavedWaybillPdfFile(awb);
      return found && fs.existsSync(found) ? found : null;
    };

    if (requestedAwb) {
      if (!/^\d{8,}$/.test(requestedAwb) || !allowedAwbs.has(requestedAwb)) {
        return res.status(404).json({
          success: false,
          message: `AWB ${requestedAwb} is not on this delivery challan`,
        });
      }
      const oneAbs = resolveAbs(requestedAwb);
      if (!oneAbs) {
        return res.status(404).json({
          success: false,
          message: `Waybill PDF not stored yet for AWB ${requestedAwb}`,
          data: { awb_number: requestedAwb },
        });
      }
      return res.download(oneAbs, `Waybill_${requestedAwb}.pdf`);
    }

    const uniqueAwbs = [...new Set(
      (shipments.length ? shipments.map((s) => s.awb_number) : splitAwbTokens(head.awb_number))
    )];
    const foundPdfs = uniqueAwbs
      .map((awb) => ({ awb, abs: resolveAbs(awb) }))
      .filter((row) => row.abs);

    if ((wantAll || uniqueAwbs.length > 1) && foundPdfs.length > 1) {
      const buf = await mergeWaybillPdfBuffers(foundPdfs.map((row) => row.abs));
      const safeDc = String(dcNumber).replace(/[^\w.-]+/g, '-');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Waybill_${safeDc}_all.pdf"`);
      return res.send(buf);
    }

    if (foundPdfs.length === 1) {
      return res.download(foundPdfs[0].abs, `Waybill_${foundPdfs[0].awb}.pdf`);
    }

    let pdfRel = uniqueAwbs.length <= 1 ? (head.bluedart_awb_pdf_path || null) : null;
    let abs = null;

    if (pdfRel) {
      abs = path.isAbsolute(pdfRel) ? pdfRel : path.join(__dirname, '..', pdfRel);
      if (!fs.existsSync(abs)) abs = null;
    }

    if (!abs && uniqueAwbs.length === 1) {
      abs = resolveAbs(uniqueAwbs[0]);
      if (abs) {
        pdfRel = path.relative(path.join(__dirname, '..'), abs).replace(/\\/g, '/');
        await pool.query(
          `UPDATE delivery_challan_lines
              SET bluedart_awb_pdf_path = $1, updated_at = NOW()
            WHERE dc_number = $2`,
          [pdfRel, dcNumber]
        ).catch(() => {});
      }
    }

    if (!abs && uniqueAwbs.length === 1 && String(req.query.regenerate || '') === '1') {
      const regenerated = await generateAndPersistDcBluedartAwb(dcNumber, { force: true });
      pdfRel = regenerated.bluedart_awb_pdf_path || regenerated.pdf_path || null;
      if (pdfRel) {
        abs = path.isAbsolute(pdfRel) ? pdfRel : path.join(__dirname, '..', pdfRel);
      }
    }

    if (!abs && !uniqueAwbs.length && !head.awb_number) {
      return res.status(404).json({
        success: false,
        message: 'No BlueDart AWB on this DC — generate AWB first',
      });
    }

    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({
        success: false,
        message: uniqueAwbs.length > 1
          ? 'Waybill PDFs are not stored yet for these AWBs. Generate waybills again.'
          : 'Waybill PDF not stored yet. Click Generate Waybill again, or use regenerate=1',
        data: { awb_number: head.awb_number, awb_numbers: uniqueAwbs },
      });
    }

    return res.download(abs, `Waybill_${uniqueAwbs[0] || head.awb_number || 'AWB'}.pdf`);
  } catch (e) {
    console.error('downloadDcBluedartAwbPdf:', e);
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

/** Download first rental customer invoice PDF linked to this DC (generated at DC create / delivery). */
exports.downloadDcRentalInvoicePdf = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const lines = await getDeliveryChallanLines(dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }

    const ctx = await getDcContext(pool, dcNumber);
    const qt = String(ctx.quotation_type || '').toLowerCase();
    if (qt === 'sale' || qt === 'sales' || qt === 'demo') {
      return res.status(400).json({
        success: false,
        message: 'Rental invoice PDF is only available for rental delivery challans',
      });
    }

    const rentalInvoice = await findRentalInvoiceForDc(dcNumber);
    if (!rentalInvoice) {
      return res.status(404).json({
        success: false,
        message: 'No rental invoice found for this DC yet',
      });
    }

    const billingCtrl = require('./customerBillingController');
    const invRes = await pool.query(
      `SELECT ci.*, c.company_name AS customer_name, c.gst_no AS gst_number
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.customer_id = ci.customer_id
        WHERE ci.invoice_id = $1`,
      [rentalInvoice.invoice_id]
    );
    if (!invRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const invoice = invRes.rows[0];
    const pdfRel = await billingCtrl._generateInvoicePdf(invoice);
    await pool.query(
      `UPDATE customer_invoices SET pdf_path = $1, updated_at = NOW() WHERE invoice_id = $2`,
      [pdfRel, invoice.invoice_id]
    );

    const abs = path.join(__dirname, '..', pdfRel);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ success: false, message: 'Invoice PDF file missing' });
    }
    res.download(abs, `${invoice.invoice_number || `invoice-${invoice.invoice_id}`}.pdf`);
  } catch (e) {
    console.error('downloadDcRentalInvoicePdf:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.createPreDispatchQcTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    const dcNumber = req.params.dcNumber;
    const lines = await getDcLines(dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const serials = await collectDcSerials(dcNumber);
    if (!serials.length) {
      return res.status(400).json({ success: false, message: 'No serials attached to this DC' });
    }

    await client.query('BEGIN');
    const ticketIds = [];
    let created = 0;

    // Specs live in vendor_serial_numbers.extra (jsonb) / vendor_product_details,
    // NOT as columns on vendor_serial_numbers.
    const specSelect = `
      SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.qc_status,
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
        ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
      WHERE vsn.deleted_at IS NULL AND `;

    for (const s of serials) {
      let serialRow = null;
      if (s.serialId) {
        const r = await client.query(`${specSelect} vsn.serial_id = $1`, [s.serialId]);
        serialRow = r.rows[0];
      }
      if (!serialRow && s.serialNumber) {
        const r = await client.query(`${specSelect} vsn.serial_number = $1 LIMIT 1`, [s.serialNumber]);
        serialRow = r.rows[0];
      }
      if (!serialRow) continue;

      const existing = await client.query(
        `SELECT id FROM dc_qc_tickets WHERE dc_number = $1 AND serial_id = $2`,
        [dcNumber, serialRow.serial_id]
      );
      if (existing.rows.length) continue;

      const result = await createSalesOrderQcTicket(client, {
        serialId: serialRow.serial_id,
        ttsplId: serialRow.inventory_asset_code || s.ttsplId,
        serialNumber: serialRow.serial_number,
        brand: serialRow.brand,
        model: serialRow.model,
        processor: serialRow.processor,
        generation: serialRow.generation,
        ram: serialRow.ram,
        storage: serialRow.storage,
        salesOrderNumber: lines[0].sales_order_number,
        dcNumber,
        createdByUserId: req.user.user_id,
      });

      if (!result.ok || !result.ticket_id) continue;

      await client.query(
        `INSERT INTO dc_qc_tickets (dc_number, sales_order_number, ticket_id, ttspl_id, serial_id, status)
         VALUES ($1,$2,$3,$4,$5,'pending')`,
        [
          dcNumber,
          lines[0].sales_order_number,
          result.ticket_id,
          serialRow.inventory_asset_code || s.ttsplId,
          serialRow.serial_id,
        ]
      );

      if (s.line_id) {
        await client.query(
          `UPDATE delivery_challan_lines SET pre_dispatch_qc_ticket_id = $1, updated_at = NOW() WHERE id = $2`,
          [result.ticket_id, s.line_id]
        );
      }

      ticketIds.push(result.ticket_id);
      created += 1;
    }

    await client.query('COMMIT');
    res.json({ success: true, tickets_created: created, ticket_ids: ticketIds });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('createPreDispatchQcTicket:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.getDcQcStatus = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const { rows } = await pool.query(
      `SELECT d.*, t.current_stage_id, s.stage_name, t.status AS ticket_status
       FROM dc_qc_tickets d
       LEFT JOIN tickets t ON t.ticket_id = d.ticket_id
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
       WHERE d.dc_number = $1
       ORDER BY d.id`,
      [dcNumber]
    );
    const tickets = rows.map((r) => ({
      ticket_id: r.ticket_id,
      ttspl_id: r.ttspl_id,
      serial_id: r.serial_id,
      status: r.status,
      stage_name: r.stage_name,
      ticket_status: r.ticket_status,
    }));
    const allPassed = tickets.length > 0 && tickets.every((t) => t.status === 'qc_passed');
    const anyFailed = tickets.some((t) => t.status === 'qc_failed');
    res.json({
      success: true,
      all_passed: allPassed,
      any_failed: anyFailed,
      tickets,
      pending_count: tickets.filter((t) => t.status === 'pending').length,
      total_count: tickets.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

async function assertDcQcComplete(dcNumber) {
  const { rows } = await pool.query(
    `SELECT status FROM dc_qc_tickets WHERE dc_number = $1`,
    [dcNumber]
  );
  if (!rows.length) return { ok: true, skipped: true };
  const incomplete = rows.some((r) => r.status !== 'qc_passed');
  if (incomplete) {
    return {
      ok: false,
      message: 'Pre-dispatch QC not completed. All laptops must pass QC before dispatch.',
    };
  }
  return { ok: true };
}

exports.updateDcAssignment = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const result = await applyDcAssignmentChange({
      dcNumber,
      body: req.body || {},
      user: req.user,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }

    let pdfPath = null;
    try {
      pdfPath = await regenerateDcPdfForNumber(dcNumber);
    } catch (pdfErr) {
      console.warn('DC PDF regeneration after assignment update:', pdfErr.message);
    }

    if (result.sales_order_number && result.activity) {
      const { description, previousLabel, newLabel, previousMeta, nextMeta, reason } = result.activity;
      await safeLogSalesOrderActivity({
        salesOrderNumber: result.sales_order_number,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'assignee_changed',
        description,
        remarks: reason,
        metadata: {
          dc_number: dcNumber,
          previous_assignee: previousLabel,
          new_assignee: newLabel,
          previous_dispatch_mode: previousMeta.dispatch_mode,
          new_dispatch_mode: nextMeta.dispatch_mode,
          previous_estimated_delivery: previousMeta.estimated_delivery,
          new_estimated_delivery: nextMeta.estimated_delivery,
          previous_dispatched_at: previousMeta.dispatched_at,
          new_dispatched_at: nextMeta.dispatched_at,
          pdf_regenerated: Boolean(pdfPath),
        },
        user: req.user,
      });
    }

    res.json({
      success: true,
      message: pdfPath ? 'Assignee updated — DC PDF regenerated' : 'Assignee updated',
      pdf_path: pdfPath,
      data: result.data,
    });
  } catch (error) {
    console.error('updateDcAssignment:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDcDispatch = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const qc = await assertDcQcComplete(dcNumber);
    if (!qc.ok) {
      return res.status(400).json({ success: false, message: qc.message });
    }

    const body = req.body || {};
    const dispatchMode = body.dispatch_mode || 'courier';
    const allowed = ['courier', 'porter', 'inhouse'];
    if (!allowed.includes(dispatchMode)) {
      return res.status(400).json({ success: false, message: 'Invalid dispatch_mode' });
    }

    // KYC gate: a Demo unit may not be dispatched until the customer's KYC is verified.
    const gate = await pool.query(
      `SELECT COALESCE(sol.quotation_type, sq.quotation_type, 'rental') AS quotation_type,
              c.kyc_status, dcl.customer_id
         FROM delivery_challan_lines dcl
         LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
         LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
         LEFT JOIN customers c ON c.customer_id = dcl.customer_id
        WHERE dcl.dc_number = $1 LIMIT 1`,
      [dcNumber]
    );
    const gateRow = gate.rows[0] || {};
    if (String(gateRow.quotation_type).toLowerCase() === 'demo'
        && gateRow.kyc_status !== 'verified') {
      return res.status(400).json({
        success: false,
        message: 'Customer KYC must be verified before dispatching a demo unit.',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // State guard: a DC already dispatched/delivered cannot be re-dispatched.
      const cur = await client.query(
        `SELECT DISTINCT status FROM delivery_challan_lines WHERE dc_number = $1`,
        [dcNumber]
      );
      const statuses = cur.rows.map((r) => r.status);
      if (statuses.some((s) => ['delivered', 'in_transit', 'shipped', 'reached', 'dispatch_ready'].includes(s))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: `DC already ${statuses.join('/')}` });
      }

      // Courier/Porter ride external logistics -> 'shipped'. Inhouse technician
      // picks up and carries -> 'in_transit' (lands in the technician bucket).
      const newStatus = dispatchMode === 'inhouse' ? 'in_transit' : 'shipped';
      const shipByValue = dispatchMode === 'inhouse' ? 'by_hand'
        : dispatchMode === 'porter' ? 'by_porter' : 'by_courier';

      await client.query(
        `UPDATE delivery_challan_lines SET
          dispatch_mode = $1, ship_by = $2, courier_name = $3, awb_number = $4,
          porter_booking_id = $5, delivery_person_id = $6, estimated_delivery = $7,
          porter_tracking_id = $8, porter_order_id = $9, porter_booking_url = $10,
          courier_tracking_url = $11, dispatched_at = NOW(),
          status = $12, updated_at = NOW()
         WHERE dc_number = $13`,
        [
          dispatchMode,
          shipByValue,
          body.courier_name || null,
          body.awb_number || null,
          body.porter_booking_id || body.porter_tracking_id || null,
          toNullableInt(body.delivery_person_id),
          body.estimated_delivery || null,
          body.porter_tracking_id || null,
          body.porter_order_id || null,
          body.porter_booking_url || null,
          body.courier_tracking_url || null,
          newStatus,
          dcNumber,
        ]
      );

      const ctx = await getDcContext(client, dcNumber);
      const serials = await collectDcSerials(dcNumber);
      for (const s of serials) {
        const serialId = await resolveSerialId(client, s);
        if (!serialId) continue;
        // reserved -> in_transit (mark the asset unavailable the moment it ships).
        try {
          await inventorySM.markDispatched(client, serialId, {
            dcNumber,
            customerId: ctx.customer_id || null,
            entityCode: ctx.entity_code || null,
            dispatchMode,
            actorUserId: req.user.user_id,
            actorName: req.user.name,
          });
        } catch (rErr) {
          await client.query(
            `UPDATE vendor_serial_numbers SET inventory_status = 'in_transit', current_dc_number = $2,
                    dispatch_mode = $3, dispatched_at = NOW(), updated_at = NOW()
             WHERE serial_id = $1`,
            [serialId, dcNumber, dispatchMode]
          );
        }
      }

      // Reflect dispatch on the SO serial allocations.
      await client.query(
        `UPDATE sales_order_serials SET status = 'dispatched', dc_number = $1, updated_at = NOW()
          WHERE dc_number = $1 OR serial_id IN (
            SELECT serial_id FROM vendor_serial_numbers
             WHERE current_dc_number = $1 AND deleted_at IS NULL
          )`,
        [dcNumber]
      ).catch(() => {});

      await client.query('COMMIT');
      res.json({ success: true, message: 'Dispatch updated', status: newStatus });

      const soNumber = ctx?.sales_order_number;
      if (soNumber) {
        await safeLogSalesOrderActivity({
          salesOrderNumber: soNumber,
          activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
          action: 'dispatch_started',
          description: `Dispatch started for ${dcNumber}.`,
          metadata: { dc_number: dcNumber, dispatch_mode: dispatchMode, status: newStatus },
          user: req.user,
        });
      }
      return;
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('updateDcDispatch:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Run the inventory + billing + demo side-effects of a delivery, inside an open
 * transaction (caller owns BEGIN/COMMIT). Shared by markDcDelivered and the
 * Phase-13 POD/admin-override delivery endpoints so all paths stay consistent:
 *   reserved/in_transit asset -> on_rent | on_demo | out_stock
 *   rent_start_date / monthly rate captured for rentals
 *   demo deliveries open a demo_agreements record (delivery + 7d decision)
 * Also marks sales_order_serials.status = 'dispatched'.
 */
exports.finalizeDeliveryInventory = async (client, dcNumber, actor = {}) => {
  // Return DCs (movement_type='return') re-enter the return lifecycle instead of
  // the outbound delivered flow: mark returned -> QC re-entry ticket -> credit note.
  const meta = await client.query(
    `SELECT movement_type, support_ticket_id FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
    [dcNumber]
  );
  if (meta.rows[0]?.movement_type === 'return') {
    const serialList = await collectDcSerials(dcNumber);
    const serialIds = [];
    for (const s of serialList) {
      const id = await resolveSerialId(client, s);
      if (id) serialIds.push(id);
    }
    const returnSvc = require('../services/returnCompletionService');
    const processed = await returnSvc.processReturnedSerials(client, {
      serialIds,
      dcNumber,
      supportTicketId: meta.rows[0].support_ticket_id || null,
      actorUserId: actor.user_id,
      actorName: actor.name,
    });
    return { returned: true, processed };
  }

  const replEarly = await replacementFlow.onReplacementOutboundDelivered(client, dcNumber, actor);
  if (replEarly.handled) {
    return { replacement: true, ...replEarly };
  }

  const serviceDcEarly = await supportServiceDcService.onServiceDcDelivered(client, dcNumber, actor);
  if (serviceDcEarly.handled) {
    return { service_dc: true, ...serviceDcEarly };
  }

  const ctx = await getDcContext(client, dcNumber);
  const quotationType = ctx.quotation_type || 'rental';
  const targetStatus = inventorySM.deliveredStatusForType(quotationType);
  const serials = await collectDcSerials(dcNumber);
  const deliveredAt = new Date();
  const demoRows = [];

  const { resolveSerialRentRate } = require('../services/serialRentRateService');

  async function resolveDcSerialRentRate(serialId) {
    if (!['rental', 'demo'].includes(String(quotationType || '').toLowerCase())) return null;
    return resolveSerialRentRate(client, serialId, dcNumber);
  }

  for (const s of serials) {
    const serialId = await resolveSerialId(client, s);
    if (!serialId) continue;
    const sr = await client.query(
      `SELECT dispatch_mode, dispatched_at, inventory_asset_code AS ttspl_id,
              inventory_status, current_dc_number
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serialId]
    );
    const row = sr.rows[0] || {};
    // Skip units already finalized for this DC (e.g. partial POD on multi-line DCs).
    if (
      row.inventory_status === targetStatus
      && String(row.current_dc_number || '') === String(dcNumber)
    ) {
      if (row.inventory_status === inventorySM.STATUS.ON_DEMO) {
        demoRows.push({ serialId, ttsplId: row.ttspl_id });
      }
      await client.query(
        `UPDATE inventory SET status = 'Outward', stage = NULL, updated_at = NOW()
         WHERE machine_number = $1
            OR serial_number = (SELECT serial_number FROM vendor_serial_numbers WHERE serial_id = $2 LIMIT 1)`,
        [row.ttspl_id, serialId]
      ).catch(() => {});
      continue;
    }
    const rentMonthlyRate = await resolveDcSerialRentRate(serialId);
    const result = await inventorySM.markDelivered(client, serialId, {
      quotationType,
      dcNumber,
      customerId: ctx.customer_id || null,
      entityCode: ctx.entity_code || null,
      dispatchMode: row.dispatch_mode || ctx.dispatch_mode || 'courier',
      dispatchedAt: row.dispatched_at || null,
      deliveredAt,
      rentMonthlyRate,
      actorUserId: actor.user_id,
      actorName: actor.name,
      confirmedOnDc: true,
    });
    if (result.to === inventorySM.STATUS.ON_DEMO) {
      demoRows.push({ serialId, ttsplId: row.ttspl_id });
    }
    await client.query(
      `UPDATE inventory SET status = 'Outward', stage = NULL, updated_at = NOW()
       WHERE machine_number = $1
          OR serial_number = (SELECT serial_number FROM vendor_serial_numbers WHERE serial_id = $2 LIMIT 1)`,
      [row.ttspl_id, serialId]
    ).catch(() => {});
    await client.query(
      `UPDATE tickets SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
       WHERE vendor_serial_id = $1 AND status = 'in_progress' AND ticket_type = 'grn_qc'`,
      [serialId]
    ).catch(() => {});
  }

  if (demoRows.length && ctx.customer_id) {
    const decisionDue = new Date(deliveredAt);
    decisionDue.setDate(decisionDue.getDate() + 7);
    for (const d of demoRows) {
      // Guard against duplicates when a partially-delivered DC is finalized again.
      await client.query(
        `INSERT INTO demo_agreements
           (sales_order_number, dc_number, customer_id, serial_id, ttspl_id,
            delivered_at, decision_due_at, decision)
         SELECT
           (SELECT sales_order_number FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1),
           $1, $2, $3, $4, $5, $6, 'pending'
         WHERE NOT EXISTS (
           SELECT 1 FROM demo_agreements
            WHERE dc_number = $1 AND serial_id = $3 AND decision = 'pending'
         )`,
        [dcNumber, ctx.customer_id, d.serialId, d.ttsplId, deliveredAt, decisionDue]
      );
    }
  }

  await client.query(
    `UPDATE sales_order_serials SET status = 'dispatched', dc_number = $1, updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber]
  ).catch(() => {});

  if (ctx.sales_order_number) {
    const dispatchWf = require('../services/dispatchWorkflowService');
    await dispatchWf.onCustomerAsset(client, {
      salesOrderNumber: ctx.sales_order_number,
      dcNumber,
      user: actor,
    });
  }

  return { ctx, deliveredAt };
};

/**
 * Cancel an outbound DC before delivery: mark lines cancelled, release inventory
 * back to in_stock (Ready to Rent or Sell), and re-attach SO serial allocations.
 */
exports.cancelDeliveryChallan = async (req, res) => {
  const client = await pool.connect();
  try {
    const dcNumber = req.params.dcNumber;
    const reason = req.body?.reason || req.body?.cancellation_reason || null;

    const linesRes = await client.query(
      `SELECT id, status, sales_order_number, movement_type, serial_number
         FROM delivery_challan_lines
        WHERE dc_number = $1`,
      [dcNumber]
    );
    if (!linesRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }

    const head = linesRes.rows[0];
    if (String(head.movement_type || '').toLowerCase() === 'return') {
      return res.status(409).json({
        success: false,
        message: 'Return delivery challans cannot be cancelled via this endpoint',
      });
    }

    const statuses = [...new Set(linesRes.rows.map((r) => String(r.status || '').toLowerCase()))];
    if (statuses.includes('cancelled')) {
      return res.status(409).json({ success: false, message: 'Delivery challan is already cancelled' });
    }
    if (statuses.some((s) => ['delivered', 'rejected'].includes(s))) {
      return res.status(409).json({
        success: false,
        message: `Cannot cancel: DC is ${statuses.join('/')}`,
      });
    }

    await client.query('BEGIN');

    const serialEntries = [];
    for (const line of linesRes.rows) {
      for (const s of parseSerialEntries(line.serial_number)) {
        serialEntries.push(s);
      }
    }

    const serialIds = [];
    const serialNumbers = [];
    for (const s of serialEntries) {
      const serialId = await resolveSerialId(client, s);
      if (!serialId) continue;
      serialIds.push(serialId);
      const sn = s.serialNumber || null;
      if (sn) serialNumbers.push(sn);
      try {
        await inventorySM.backToStock(client, serialId, {
          reason: reason || `DC ${dcNumber} cancelled`,
          actorUserId: req.user?.user_id,
          actorName: req.user?.name,
        });
      } catch (_) {
        await client.query(
          `UPDATE vendor_serial_numbers
              SET inventory_status = 'in_stock', current_dc_number = NULL, current_customer_id = NULL,
                  current_entity = NULL, dispatch_mode = NULL, dispatched_at = NULL,
                  updated_at = NOW(), status_changed_at = NOW()
            WHERE serial_id = $1`,
          [serialId]
        );
      }
    }

    if (serialIds.length) {
      await client.query(
        `UPDATE vendor_product_inventory SET status = 'in_stock', updated_at = NOW()
          WHERE serial_id = ANY($1::int[])`,
        [serialIds]
      );
    }
    if (serialNumbers.length) {
      await client.query(
        `UPDATE vendor_product_inventory SET status = 'in_stock', updated_at = NOW()
          WHERE serial_number = ANY($1::text[])`,
        [serialNumbers]
      );
    }

    await client.query(
      `UPDATE sales_order_serials
          SET status = 'attached', dc_number = NULL, updated_at = NOW()
        WHERE dc_number = $1 AND status = 'dispatched'`,
      [dcNumber]
    );

    // Re-reserve units still attached to the SO so they stay off Ready stock and
    // can be picked again in Create DC (one laptop per DC if needed).
    const soNumber = head.sales_order_number;
    if (soNumber && serialIds.length) {
      const soMetaRes = await client.query(
        `SELECT customer_id, entity_code, quotation_type
           FROM sales_order_lines
          WHERE sales_order_number = $1
          ORDER BY id ASC
          LIMIT 1`,
        [soNumber]
      );
      const soMeta = soMetaRes.rows[0] || {};
      const entityCode = soMeta.entity_code || entityForQuotationType(soMeta.quotation_type || 'rental');
      for (const serialId of serialIds) {
        const attached = await client.query(
          `SELECT 1 FROM sales_order_serials
            WHERE serial_id = $1 AND status = 'attached' LIMIT 1`,
          [serialId]
        );
        if (!attached.rows.length) continue;
        await inventorySM.transitionAsset(client, {
          serialId,
          toStatus: inventorySM.STATUS.RESERVED,
          customerId: soMeta.customer_id || null,
          entityCode,
          reason: `Re-reserved after ${dcNumber} cancelled`,
          actorUserId: req.user?.user_id,
          actorName: req.user?.name,
        }).catch(() => {});
      }
    }

    await client.query(`DELETE FROM dc_qc_tickets WHERE dc_number = $1`, [dcNumber]).catch(() => {});

    await client.query(
      `UPDATE delivery_challan_lines SET status = 'cancelled', updated_at = NOW()
        WHERE dc_number = $1`,
      [dcNumber]
    );

    await client.query('COMMIT');

    if (soNumber) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: soNumber,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'dc_cancelled',
        description: `${dcNumber} was cancelled${reason ? `: ${reason}` : ''}. Laptops re-attached to the sales order — create new DC(s) from the SO.`,
        metadata: { dc_number: dcNumber, serial_ids: serialIds },
        remarks: reason,
        user: req.user,
      });
    }

    res.json({
      success: true,
      message: 'Delivery challan cancelled. Laptops are attached on the sales order again — you can create new DC(s).',
      dc_number: dcNumber,
      serials_released: serialIds.length,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('cancelDeliveryChallan:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.markDcDelivered = async (req, res) => {
  const client = await pool.connect();
  try {
    const dcNumber = req.params.dcNumber;
    const body = req.body || {};
    await client.query('BEGIN');

    await client.query(
      `UPDATE delivery_challan_lines SET
        status = 'delivered', delivered_at = NOW(), delivered_by = $1,
        delivery_location = $2, pod_image_url = $3, delivery_completed_at = NOW(),
        updated_at = NOW()
       WHERE dc_number = $4`,
      [req.user.user_id, body.delivery_location || null, body.pod_image_url || null, dcNumber]
    );

    await exports.finalizeDeliveryInventory(client, dcNumber, req.user);

    await client.query('COMMIT');

    // Post-commit: first prorated rental invoice (delivery → month-end). Billing
    // must never roll back a successful delivery; failures are logged and the
    // 1st-of-month cron remains the safety net.
    try {
      const { maybeInvoiceOnRentalDelivery } = require('../services/billingSchedulerService');
      const ctx = await getDcContext(pool, dcNumber);
      await maybeInvoiceOnRentalDelivery({
        customerId: ctx.customer_id || null,
        dcNumber,
        quotationType: ctx.quotation_type || 'rental',
      });
    } catch (billingErr) {
      console.error('markDcDelivered on-delivery invoice:', billingErr.message);
    }

    const soRes = await pool.query(
      `SELECT sales_order_number FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [dcNumber]
    );
    const soNumber = soRes.rows[0]?.sales_order_number;
    if (soNumber) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: soNumber,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'dispatch_completed',
        description: `${dcNumber} marked as delivered.`,
        metadata: { dc_number: dcNumber },
        user: req.user,
      });
    }

    res.json({ success: true, message: 'Marked as delivered' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('markDcDelivered:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

/**
 * Correct delivery date on an already-delivered outbound DC.
 * Updates DC lines, customer asset delivered_at, and rental rent_start_date (billing anchor).
 */
exports.updateDcDeliveryDate = async (req, res) => {
  const client = await pool.connect();
  try {
    const dcNumber = req.params.dcNumber;
    const { parseDeliveredAtInput, rentStartForSerial } = require('../services/deliveryDateService');
    const deliveredAt = parseDeliveredAtInput(req.body?.delivered_at, { required: true });

    await client.query('BEGIN');

    const headRes = await client.query(
      `SELECT status, dispatch_mode
         FROM delivery_challan_lines
        WHERE dc_number = $1
        LIMIT 1`,
      [dcNumber]
    );
    if (!headRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    const head = headRes.rows[0];
    if (String(head.status || '').toLowerCase() !== 'delivered') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Delivery date can only be updated after the DC is marked delivered',
      });
    }

    await client.query(
      `UPDATE delivery_challan_lines
          SET delivered_at = $1, delivery_completed_at = $1, updated_at = NOW()
        WHERE dc_number = $2`,
      [deliveredAt, dcNumber]
    );

    const serials = await collectDcSerials(dcNumber);
    let serialsUpdated = 0;
    for (const s of serials) {
      const serialId = await resolveSerialId(client, s);
      if (!serialId) continue;
      const sr = await client.query(
        `SELECT dispatch_mode, dispatched_at, inventory_status
           FROM vendor_serial_numbers WHERE serial_id = $1`,
        [serialId]
      );
      const row = sr.rows[0] || {};
      const rentStart = rentStartForSerial({
        dispatchMode: row.dispatch_mode || head.dispatch_mode,
        dispatchedAt: row.dispatched_at,
        deliveredAt,
        inventoryStatus: row.inventory_status,
      });
      await client.query(
        `UPDATE vendor_serial_numbers
            SET delivered_at = $1,
                rent_start_date = COALESCE($2, rent_start_date),
                updated_at = NOW()
          WHERE serial_id = $3`,
        [deliveredAt, rentStart ? rentStart.toISOString().slice(0, 10) : null, serialId]
      );
      serialsUpdated += 1;
    }

    await client.query(
      `UPDATE demo_agreements SET delivered_at = $1, updated_at = NOW() WHERE dc_number = $2`,
      [deliveredAt, dcNumber]
    ).catch(() => {});

    const soRes = await client.query(
      `SELECT sales_order_number FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [dcNumber]
    );
    const soNumber = soRes.rows[0]?.sales_order_number;
    if (soNumber) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: soNumber,
        activityType: ACTIVITY_TYPES.DELIVERY_CHALLAN,
        action: 'delivery_date_updated',
        description: `${dcNumber} delivery date updated to ${deliveredAt.toISOString().slice(0, 10)}.`,
        metadata: { dc_number: dcNumber, delivered_at: deliveredAt.toISOString() },
        user: req.user,
      });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Delivery date updated',
      delivered_at: deliveredAt.toISOString(),
      serials_updated: serialsUpdated,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateDcDeliveryDate:', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.markDcRejected = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const reason = req.body?.rejection_reason || req.body?.reason;
    const remarks = req.body?.rejection_remarks || req.body?.remarks;
    const completeReturn = req.body?.complete_return === true;

    const rejectionSvc = require('../services/deliveryRejectionService');
    await rejectionSvc.ensureDeliveryRejectionSchema();

    const headRes = await pool.query(
      `SELECT dispatch_mode, ship_by, status FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [dcNumber]
    );
    const head = headRes.rows[0];
    if (!head) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }

    const isCourier = head.dispatch_mode === 'courier' || head.ship_by === 'by_courier';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Inventory moves only after warehouse return OTP — never on reject alone.
      if (completeReturn === true) {
        const result = await rejectionSvc.rejectCourierAndComplete(client, {
          dcNumber,
          reason,
          remarks,
          actorUserId: req.user.user_id,
          actorName: req.user.name,
        });
        await client.query('COMMIT');
        return res.json({
          success: true,
          message: 'Delivery rejected and returned to warehouse',
          ...result,
        });
      }

      const source = isCourier ? 'warehouse' : 'dispatch';
      const result = await rejectionSvc.markDeliveryRejectedByCustomer(client, {
        dcNumber,
        reason,
        remarks,
        source,
        actorUserId: req.user.user_id,
      });
      await client.query('COMMIT');
      res.json({
        success: true,
        message: isCourier
          ? 'Marked rejected — receive the units back at the warehouse to release the sales order'
          : 'Marked rejected — technician must return the units; warehouse confirms receipt',
        refusal_stage: 'awaiting_warehouse_receipt',
        ...result,
      });

      if (result?.rejected) {
        await rejectionSvc.logRefusalActivity(result.sales_order_numbers, {
          action: 'customer_refused',
          description: `${req.user?.name || 'User'} recorded customer refusal on ${dcNumber}: ${reason}`,
          remarks: remarks || null,
          metadata: {
            dc_number: dcNumber,
            rejection_reason: reason,
            rejection_remarks: remarks || null,
            rejection_source: source,
            units: (result.units || []).map((u) => ({ ttspl: u.ttspl, serial_number: u.serial_number })),
            warehouse_return_pending: true,
          },
          user: req.user,
        });
      }
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('markDcRejected:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------------------------------
// PHASE 13 — Per-serial delivery addresses on the Sales Order
// ----------------------------------------------------------------------------

function sanitizeDeliveryAddress(raw) {
  const a = parseJsonField(raw) || {};
  if (typeof a !== 'object') return null;
  return {
    name: a.name || '',
    phone: a.phone || '',
    address: a.address || '',
    city: a.city || '',
    state: a.state || '',
    pincode: a.pincode || a.zip_code || '',
    landmark: a.landmark || '',
    employee_name: a.employee_name || '',
    employee_phone: a.employee_phone || '',
  };
}

function sanitizeCustomerShippingAddress(raw) {
  const { normalizeDeliveryAddress } = require('../utils/deliveryAddressUtils');
  const a = normalizeDeliveryAddress(parseJsonField(raw)) || {};
  const name = String(a.name || '').trim();
  const phone = String(a.phone || '').trim();
  const address = String(a.address || a.address_line_1 || '').trim();
  const city = String(a.city || '').trim();
  const state = String(a.state || '').trim();
  const zip_code = String(a.zip_code || a.pincode || '').trim();
  if (!name || !phone || !address || !city || !state || !zip_code) return null;
  return {
    name,
    phone,
    address,
    city,
    state,
    zip_code,
    country: a.country || 'India',
  };
}

// PATCH /so-serials/:allocationId/address
exports.updateSoSerialAddress = async (req, res) => {
  try {
    const allocationId = parseInt(req.params.allocationId, 10);
    if (!allocationId) {
      return res.status(400).json({ success: false, message: 'Invalid allocation id' });
    }
    const body = req.body || {};
    const address = sanitizeDeliveryAddress(body.delivery_address);
    const isWfh = body.is_wfh === true || body.is_wfh === 'true';
    const notes = body.delivery_notes != null ? String(body.delivery_notes) : null;

    const r = await pool.query(
      `UPDATE sales_order_serials
          SET delivery_address = $1::jsonb,
              is_wfh = $2,
              delivery_notes = $3,
              updated_at = NOW()
        WHERE allocation_id = $4
        RETURNING allocation_id, delivery_address`,
      [address ? JSON.stringify(address) : null, isWfh, notes, allocationId]
    );
    if (!r.rows.length) {
      return res.status(404).json({ success: false, message: 'Allocation not found' });
    }
    const allocMeta = await pool.query(
      `SELECT sales_order_number, ttspl_id, serial_number FROM sales_order_serials WHERE allocation_id = $1`,
      [allocationId]
    );
    const allocSo = allocMeta.rows[0];
    res.json({ success: true, allocation_id: allocationId, delivery_address: r.rows[0].delivery_address });

    if (allocSo?.sales_order_number) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: allocSo.sales_order_number,
        activityType: ACTIVITY_TYPES.CUSTOMER,
        action: 'shipping_address_updated',
        description: `${req.user?.name || 'User'} updated shipping address for laptop ${allocSo.ttspl_id || allocSo.serial_number || allocationId}.`,
        user: req.user,
      });
    }
  } catch (error) {
    console.error('updateSoSerialAddress:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /so-lines/:lineId/address  (Phase 14)
// Stores a planned delivery address on a sales_order_lines row and propagates it
// to any serials already attached to that line.
exports.updateSoLineAddress = async (req, res) => {
  const client = await pool.connect();
  try {
    const lineId = parseInt(req.params.lineId, 10);
    if (!lineId) {
      return res.status(400).json({ success: false, message: 'Invalid line id' });
    }
    const body = req.body || {};
    const address = sanitizeDeliveryAddress(body.delivery_address);
    const isWfh = body.is_wfh === true || body.is_wfh === 'true';
    const notes = body.delivery_notes != null ? String(body.delivery_notes) : null;

    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE sales_order_lines
          SET delivery_address = $1::jsonb, is_wfh = $2, delivery_notes = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING id, sales_order_number`,
      [address ? JSON.stringify(address) : null, isWfh, notes, lineId]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Sales order line not found' });
    }
    // Propagate to serials already attached to this line.
    await client.query(
      `UPDATE sales_order_serials
          SET delivery_address = $1::jsonb, is_wfh = $2, delivery_notes = $3, updated_at = NOW()
        WHERE line_id = $4 AND status <> 'removed'`,
      [address ? JSON.stringify(address) : null, isWfh, notes, lineId]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Address saved' });

    const soNumber = r.rows[0]?.sales_order_number;
    if (soNumber) {
      await safeLogSalesOrderActivity({
        salesOrderNumber: soNumber,
        activityType: ACTIVITY_TYPES.CUSTOMER,
        action: 'shipping_address_updated',
        description: `${req.user?.name || 'User'} updated shipping address on this Sales Order.`,
        user: req.user,
      });
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateSoLineAddress:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

/** PATCH /so-lines/:lineId/config — Super Admin only. Correct sales-side catalog config / qty. */
exports.updateSoLineConfig = async (req, res) => {
  const client = await pool.connect();
  try {
    const lineId = parseInt(req.params.lineId, 10);
    if (!lineId) {
      return res.status(400).json({ success: false, message: 'Invalid line id' });
    }

    const body = req.body || {};
    const processor = body.processor != null ? String(body.processor).trim() : null;
    const generation = body.generation != null ? String(body.generation).trim() : null;
    const ram = body.ram != null ? String(body.ram).trim() : null;
    const storage = body.storage != null ? String(body.storage).trim() : null;

    if (!processor || !generation || !ram || !storage) {
      return res.status(400).json({
        success: false,
        message: 'processor, generation, ram, and storage are required',
      });
    }

    const hasQuantity = body.quantity != null && body.quantity !== '';
    let quantity = null;
    if (hasQuantity) {
      quantity = parseInt(body.quantity, 10);
      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: 'quantity must be a whole number of at least 1',
        });
      }
    }

    await client.query('BEGIN');

    const lineRes = await client.query(
      `SELECT id, sales_order_number, brand, model_name, processor, generation, ram, storage,
              gpu, screen_size, quantity, main_qty, status
         FROM sales_order_lines WHERE id = $1 FOR UPDATE`,
      [lineId]
    );
    if (!lineRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Sales order line not found' });
    }
    const line = lineRes.rows[0];
    await assertReplacementSalesOrderAccessIfScoped(
      line.sales_order_number,
      req.user,
      req.permissionCache
    );
    if (String(line.status || '').toLowerCase() === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Sales order line is cancelled',
      });
    }

    const attachedRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM sales_order_serials
        WHERE line_id = $1 AND status <> 'removed'`,
      [lineId]
    );
    const attachedCount = Number(attachedRes.rows[0]?.n || 0);

    const brand = body.brand != null ? String(body.brand).trim() : line.brand;
    const modelName = body.model_name != null ? String(body.model_name).trim() : line.model_name;
    const gpu = body.gpu != null ? String(body.gpu).trim() : line.gpu;
    const screenSize = body.screen_size != null ? String(body.screen_size).trim() : line.screen_size;

    const nextQuantity = hasQuantity ? quantity : Number(line.quantity || line.main_qty || 1);
    if (nextQuantity < attachedCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Quantity cannot be less than attached units (${attachedCount}).`,
      });
    }

    const upd = await client.query(
      `UPDATE sales_order_lines
          SET brand = $1, model_name = $2, processor = $3, generation = $4,
              ram = $5, storage = $6, gpu = $7, screen_size = $8,
              quantity = $9, main_qty = $9, updated_at = NOW()
        WHERE id = $10
        RETURNING id, sales_order_number, brand, model_name, processor, generation,
                  ram, storage, gpu, screen_size, quantity, main_qty`,
      [brand, modelName, processor, generation, ram, storage, gpu, screenSize, nextQuantity, lineId]
    );

    await syncDcLinesFromSoLine(client, {
      lineId,
      salesOrderNumber: line.sales_order_number,
      brand,
      modelName,
      oldBrand: line.brand,
      oldModelName: line.model_name,
    });

    await client.query('COMMIT');

    const soNumber = upd.rows[0]?.sales_order_number || line.sales_order_number;
    let pdfPath = null;
    let dcPdfs = [];
    try {
      const regen = await regenerateSoAndLinkedDcPdfs(soNumber);
      pdfPath = regen.so_pdf_path;
      dcPdfs = regen.dc_pdfs;
    } catch (pdfErr) {
      console.warn('SO PDF regeneration after config update:', pdfErr.message);
    }

    const dcCount = dcPdfs.length;
    res.json({
      success: true,
      message: dcCount
        ? `Config updated — SO and ${dcCount} DC PDF(s) regenerated`
        : 'Config updated — SO PDF regenerated',
      line: upd.rows[0],
      pdf_path: pdfPath,
      dc_pdfs: dcPdfs,
    });

    await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.LAPTOP,
      action: 'configuration_updated',
      description: `${req.user?.name || 'User'} updated configuration for ${brand} ${modelName} (${processor}, ${generation}, ${ram}, ${storage}, qty ${nextQuantity}).`,
      metadata: {
        line_id: lineId,
        old: {
          processor: line.processor,
          generation: line.generation,
          ram: line.ram,
          storage: line.storage,
          quantity: line.quantity,
        },
        new: { processor, generation, ram, storage, quantity: nextQuantity },
      },
      user: req.user,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateSoLineConfig:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

/** PATCH /so-lines/:lineId/rate — Super Admin only. Correct monthly rate after SO/DC exist. */
exports.updateSoLineRate = async (req, res) => {
  const client = await pool.connect();
  try {
    const lineId = parseInt(req.params.lineId, 10);
    if (!lineId) {
      return res.status(400).json({ success: false, message: 'Invalid line id' });
    }
    const rate = Number(req.body?.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ success: false, message: 'A positive rate is required' });
    }
    const roundedRate = +rate.toFixed(2);

    await client.query('BEGIN');

    const lineRes = await client.query(
      `SELECT id, sales_order_number, brand, model_name, rate, quantity, main_qty, status
         FROM sales_order_lines WHERE id = $1 FOR UPDATE`,
      [lineId]
    );
    if (!lineRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Sales order line not found' });
    }
    const line = lineRes.rows[0];
    await assertReplacementSalesOrderAccessIfScoped(
      line.sales_order_number,
      req.user,
      req.permissionCache
    );
    if (String(line.status || '').toLowerCase() === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Sales order line is cancelled' });
    }

    const upd = await client.query(
      `UPDATE sales_order_lines SET rate = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, sales_order_number, brand, model_name, rate, quantity, main_qty`,
      [roundedRate, lineId]
    );

    const soNumber = line.sales_order_number;
    const newSecurity = await recalcSoSecurityIfOneMonthRental(client, soNumber);
    if (newSecurity != null) {
      await syncDcSecurityForSo(client, soNumber);
    }

    await client.query('COMMIT');

    let regen = { so_pdf_path: null, dc_pdfs: [] };
    try {
      regen = await regenerateSoAndLinkedDcPdfs(soNumber);
    } catch (pdfErr) {
      console.warn('PDF regeneration after rate update:', pdfErr.message);
    }

    const dcCount = regen.dc_pdfs.length;
    res.json({
      success: true,
      message: dcCount
        ? `Rate updated — SO and ${dcCount} DC PDF(s) regenerated`
        : 'Rate updated — SO PDF regenerated',
      line: upd.rows[0],
      pdf_path: regen.so_pdf_path,
      dc_pdfs: regen.dc_pdfs,
    });

    await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.PRICING,
      action: 'item_price_changed',
      description: `Rate for ${line.brand} ${line.model_name} changed from ₹${line.rate} to ₹${roundedRate} by ${req.user?.name || 'User'}.`,
      metadata: { line_id: lineId, old_rate: line.rate, new_rate: roundedRate },
      user: req.user,
    });
    await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.PRICING,
      action: 'grand_total_updated',
      description: `Grand total recalculated after rate change on this Sales Order.`,
      user: req.user,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateSoLineRate:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

/** PATCH /so-lines/:lineId/hsn — Admin / Super Admin only. Override line HSN/SAC. */
exports.updateSoLineHsn = async (req, res) => {
  const client = await pool.connect();
  try {
    if (!canOverrideHsn(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Only Admin / Super Admin can override HSN' });
    }
    const lineId = parseInt(req.params.lineId, 10);
    if (!lineId) {
      return res.status(400).json({ success: false, message: 'Invalid line id' });
    }
    let hsn;
    try {
      hsn = normalizeHsnCode(req.body?.hsn_code ?? req.body?.hsnCode);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }
    if (!hsn) {
      return res.status(400).json({ success: false, message: 'HSN/SAC code is required' });
    }

    await client.query('BEGIN');
    const lineRes = await client.query(
      `SELECT id, sales_order_number, brand, model_name, hsn_code, quotation_type, status
         FROM sales_order_lines WHERE id = $1 FOR UPDATE`,
      [lineId]
    );
    if (!lineRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Sales order line not found' });
    }
    const line = lineRes.rows[0];
    await assertReplacementSalesOrderAccessIfScoped(
      line.sales_order_number,
      req.user,
      req.permissionCache
    );
    if (String(line.status || '').toLowerCase() === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Sales order line is cancelled' });
    }

    const upd = await client.query(
      `UPDATE sales_order_lines SET hsn_code = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, sales_order_number, brand, model_name, hsn_code, quotation_type`,
      [hsn, lineId]
    );

    // Keep open DC lines for this SO in sync when they still match the old HSN / are blank.
    await client.query(
      `UPDATE delivery_challan_lines
          SET hsn_code = $1, updated_at = NOW(), pdf_path = NULL
        WHERE sales_order_number = $2
          AND COALESCE(movement_type, 'outbound') <> 'return'
          AND (
            hsn_code IS NULL OR TRIM(hsn_code) = ''
            OR hsn_code = $3
          )`,
      [hsn, line.sales_order_number, line.hsn_code || '']
    );

    await client.query('COMMIT');

    let regen = { so_pdf_path: null, dc_pdfs: [] };
    try {
      regen = await regenerateSoAndLinkedDcPdfs(line.sales_order_number);
    } catch (pdfErr) {
      console.warn('PDF regeneration after HSN update:', pdfErr.message);
    }

    res.json({
      success: true,
      message: 'HSN updated — PDFs regenerated',
      line: upd.rows[0],
      pdf_path: regen.so_pdf_path,
      dc_pdfs: regen.dc_pdfs,
    });

    await safeLogSalesOrderActivity({
      salesOrderNumber: line.sales_order_number,
      activityType: ACTIVITY_TYPES.PRICING,
      action: 'hsn_changed',
      description: `HSN for ${line.brand} ${line.model_name} changed from ${line.hsn_code || '—'} to ${hsn} by ${req.user?.name || 'User'}.`,
      metadata: { line_id: lineId, old_hsn: line.hsn_code, new_hsn: hsn },
      user: req.user,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateSoLineHsn:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

/** PATCH /delivery-challans/:dcNumber/hsn — Admin / Super Admin only. */
exports.updateDcHsn = async (req, res) => {
  const client = await pool.connect();
  try {
    if (!canOverrideHsn(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Only Admin / Super Admin can override HSN' });
    }
    const dcNumber = req.params.dcNumber;
    let hsn;
    try {
      hsn = normalizeHsnCode(req.body?.hsn_code ?? req.body?.hsnCode);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }
    if (!hsn) {
      return res.status(400).json({ success: false, message: 'HSN/SAC code is required' });
    }

    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE delivery_challan_lines
          SET hsn_code = $1, updated_at = NOW(), pdf_path = NULL
        WHERE dc_number = $2
        RETURNING id, dc_number, hsn_code, sales_order_number, movement_type`,
      [hsn, dcNumber]
    );
    if (!upd.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }
    await client.query('COMMIT');

    let pdfPath = null;
    try {
      if (String(upd.rows[0].movement_type || '') === 'return') {
        const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');
        pdfPath = await regenerateReturnDcPdfByRdc(pool, dcNumber);
      } else {
        const lines = await getDeliveryChallanLines(dcNumber);
        pdfPath = await generateDocumentPdf({
          docType: 'delivery_challan',
          docNumber: dcNumber,
          header: lines[0],
          lines,
        });
      }
    } catch (pdfErr) {
      console.warn('PDF regeneration after DC HSN update:', pdfErr.message);
    }

    res.json({
      success: true,
      message: 'HSN updated',
      hsn_code: hsn,
      pdf_path: pdfPath,
      lines: upd.rows,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateDcHsn:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

/** PATCH /sales-orders/:soNumber/shipping-address — Super Admin only. */
exports.updateSalesOrderShippingAddress = async (req, res) => {
  const client = await pool.connect();
  try {
    const soNumber = req.params.salesOrderNumber || req.params.soNumber;
    const shipping = sanitizeCustomerShippingAddress(
      req.body?.customer_shipping_address ?? req.body
    );
    if (!shipping) {
      return res.status(400).json({
        success: false,
        message: 'name, phone, address, city, state, and zip_code are required',
      });
    }

    const supplyState = resolveSupplyStateFromAddress(shipping, req.body?.supply_state);
    const shippingJson = JSON.stringify(shipping);

    await client.query('BEGIN');

    const exists = await client.query(
      `SELECT id, status FROM sales_order_lines WHERE sales_order_number = $1 LIMIT 1 FOR UPDATE`,
      [soNumber]
    );
    if (!exists.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    if (String(exists.rows[0].status || '').toLowerCase() === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Sales order is cancelled' });
    }

    await assertReplacementSalesOrderAccessIfScoped(soNumber, req.user, req.permissionCache);

    await client.query(
      `UPDATE sales_order_lines
          SET customer_shipping_address = $1::jsonb,
              supply_state = $2,
              updated_at = NOW()
        WHERE sales_order_number = $3`,
      [shippingJson, supplyState, soNumber]
    );

    await client.query(
      `UPDATE delivery_challan_lines
          SET customer_shipping_address = $1::jsonb,
              supply_state = $2,
              updated_at = NOW()
        WHERE sales_order_number = $3
          AND COALESCE(status, '') NOT IN ('delivered', 'cancelled', 'rejected')`,
      [shippingJson, supplyState, soNumber]
    );

    await client.query('COMMIT');

    let regen = { so_pdf_path: null, dc_pdfs: [] };
    try {
      regen = await regenerateSoAndLinkedDcPdfs(soNumber);
    } catch (pdfErr) {
      console.warn('PDF regeneration after shipping address update:', pdfErr.message);
    }

    const dcCount = regen.dc_pdfs.length;
    res.json({
      success: true,
      message: dcCount
        ? `Shipping address updated — SO and ${dcCount} DC PDF(s) regenerated`
        : 'Shipping address updated — SO PDF regenerated',
      customer_shipping_address: shipping,
      supply_state: supplyState,
      pdf_path: regen.so_pdf_path,
      dc_pdfs: regen.dc_pdfs,
    });

    await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.CUSTOMER,
      action: 'shipping_address_updated',
      description: `${req.user?.name || 'User'} updated the sales order shipping address.`,
      metadata: { supply_state: supplyState },
      user: req.user,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    console.error('updateSalesOrderShippingAddress:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

// PATCH /sales-orders/:soNumber/serial-addresses
exports.bulkUpdateSoSerialAddresses = async (req, res) => {
  const client = await pool.connect();
  try {
    const soNumber = req.params.soNumber;
    const addresses = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
    if (!addresses.length) {
      return res.status(400).json({ success: false, message: 'addresses array is required' });
    }
    await client.query('BEGIN');
    let updated = 0;
    for (const item of addresses) {
      const allocationId = parseInt(item.allocation_id, 10);
      if (!allocationId) continue;
      const address = sanitizeDeliveryAddress(item.delivery_address);
      const isWfh = item.is_wfh === true || item.is_wfh === 'true';
      const notes = item.delivery_notes != null ? String(item.delivery_notes) : null;
      const r = await client.query(
        `UPDATE sales_order_serials
            SET delivery_address = $1::jsonb,
                is_wfh = $2,
                delivery_notes = $3,
                updated_at = NOW()
          WHERE allocation_id = $4 AND sales_order_number = $5`,
        [address ? JSON.stringify(address) : null, isWfh, notes, allocationId, soNumber]
      );
      updated += r.rowCount;
    }
    await client.query('COMMIT');
    res.json({ success: true, updated });

    await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.CUSTOMER,
      action: 'shipping_address_updated',
      description: `${req.user?.name || 'User'} bulk-updated delivery addresses on ${updated} laptop(s).`,
      metadata: { updated_count: updated },
      user: req.user,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('bulkUpdateSoSerialAddresses:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.storeCustomerShippingAddress = async (req, res) => {
  try {
    const { name, phone, state, city, zip_code, address } = req.body;
    if (!name || !phone || !state || !city || !zip_code || !address) {
      return res.status(400).json({ success: false, message: 'All address fields are required' });
    }
    const result = await pool.query(`SELECT customer_id, details, customer_type FROM customers WHERE customer_id = $1`, [req.params.customerId]);
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (!isCustomerTypeAllowed(req.allowedCustomerTypes, result.rows[0].customer_type)) {
      return res.status(403).json({ success: false, message: 'Access denied: customer is outside your Customer Access scope' });
    }
    const details = parseJsonSafe(result.rows[0].details, {}) || {};
    const shipping = Array.isArray(details.shipping_address) ? details.shipping_address : [];
    shipping.push({ name, phone, country: 'India', state, city, zip_code, address });
    details.shipping_address = shipping;
    await pool.query(`UPDATE customers SET details = $1, updated_at = NOW() WHERE customer_id = $2`, [JSON.stringify(details), req.params.customerId]);
    const customers = await pool.query(`SELECT customer_id, name, company_name, email, phone, gst_no, address, details FROM customers WHERE customer_id = $1`, [req.params.customerId]);
    res.json({
      success: true,
      message: 'Shipping address added',
      customer: normalizeCustomerForQuotation(customers.rows[0]),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listSalesOrderActivities = async (req, res) => {
  try {
    const soNumber = req.params.soNumber;
    const lines = await getSalesOrderLines(soNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const data = await listSalesOrderActivities(soNumber, { page, limit });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('listSalesOrderActivities:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.logSalesOrderDocumentActivity = async (req, res) => {
  try {
    const soNumber = req.params.soNumber;
    const lines = await getSalesOrderLines(soNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    const action = String(req.body?.action || '').trim();
    const allowed = new Set(['pdf_downloaded', 'printed', 'shared']);
    if (!allowed.has(action)) {
      return res.status(400).json({ success: false, message: 'Invalid document activity action' });
    }
    const row = await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.DOCUMENT,
      action,
      description: `${req.user?.name || 'User'} ${action.replace(/_/g, ' ')} for Sales Order ${soNumber}.`,
      remarks: req.body?.remarks || null,
      user: req.user,
    });
    res.status(201).json({ success: true, activity: row });
  } catch (error) {
    console.error('logSalesOrderDocumentActivity:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
