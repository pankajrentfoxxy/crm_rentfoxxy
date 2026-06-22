const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const {
  nextDocumentNumber,
  entityForQuotationType,
  entityDocType,
  generateToken,
  listQuotationsGrouped,
  getQuotationLines,
  listSalesOrdersGrouped,
  getSalesOrderLines,
  listDeliveryChallansGrouped,
  getDeliveryChallanLines,
  listReturnDeliveryChallans,
  getReturnDcDetail,
  getQuotationRemainingQty,
  getSalesOrderRemainingQty,
  getOperationCounts,
  searchAvailableInventory,
} = require('../services/salesManagementService');
const { generateDocumentPdf } = require('../services/salesManagementPdfService');
const { emailDocument } = require('../services/salesManagementPdfService');
const { createSalesOrderQcTicket } = require('../services/grnTicketService');
const { logTtsplEvent } = require('../services/ttsplAuditService');
const inventorySM = require('../services/inventoryStateMachine');
const { regenerateReturnDcPdf } = require('../services/returnDcPdfService');

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
    `SELECT dcl.customer_id, dcl.entity_code, dcl.dispatch_mode,
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
function parseJsonSafe(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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
    billing_address: billing,
    shipping_addresses: shippingList,
  };
}

const FALLBACK_BRANDS = [
  'Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer',
  'MSI', 'Samsung', 'Toshiba', 'Other',
];
const FALLBACK_MODELS = {
  Dell: ['Latitude 3410', 'Latitude 3510', 'Latitude 5410', 'Latitude 5510',
    'Inspiron 14', 'Inspiron 15', 'Vostro 3400', 'Vostro 3500', 'XPS 13', 'Other'],
  HP: ['ProBook 440', 'ProBook 450', 'EliteBook 840', 'Pavilion 14',
    'Pavilion 15', 'Laptop 15s', '250 G8', '255 G8', 'Other'],
  Lenovo: ['ThinkPad E14', 'ThinkPad E15', 'ThinkPad T14', 'IdeaPad 3',
    'IdeaPad 5', 'V14', 'V15', 'Legion 5', 'Other'],
  Apple: ['MacBook Air M1', 'MacBook Air M2', 'MacBook Pro 13',
    'MacBook Pro 14', 'MacBook Pro 16', 'Other'],
  Asus: ['VivoBook 14', 'VivoBook 15', 'ZenBook 14', 'ExpertBook B1', 'Other'],
  Acer: ['Aspire 5', 'Aspire 7', 'Swift 3', 'TravelMate P2', 'Other'],
  Other: ['Other'],
};
const FALLBACK_PROCESSORS = [
  'Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9',
  'AMD Ryzen 3', 'AMD Ryzen 5', 'AMD Ryzen 7',
  'Apple M1', 'Apple M2', 'Apple M3',
];
const FALLBACK_GENERATIONS = [
  '6th Gen', '7th Gen', '8th Gen', '9th Gen', '10th Gen',
  '11th Gen', '12th Gen', '13th Gen', '14th Gen',
];
const FALLBACK_RAM = ['4 GB', '8 GB', '12 GB', '16 GB', '24 GB', '32 GB', '64 GB'];
const FALLBACK_STORAGE = [
  '128 GB SSD', '256 GB SSD', '512 GB SSD', '1 TB SSD',
  '256 GB HDD', '512 GB HDD', '1 TB HDD', '2 TB HDD',
];
const FALLBACK_GPU = [
  'Integrated', 'NVIDIA GTX 1650', 'NVIDIA RTX 3050',
  'NVIDIA RTX 3060', 'NVIDIA RTX 4060', 'AMD Radeon RX', 'Other Dedicated',
];
const FALLBACK_SCREEN_SIZES = ['11.6"', '13.3"', '14"', '15.6"', '16"', '17.3"'];

function applyCatalogFallbacks(catalog) {
  const result = { ...catalog };
  if (!result.brands?.length) result.brands = FALLBACK_BRANDS;
  if (!result.models?.length) result.models = FALLBACK_MODELS;
  if (!result.processors?.length) result.processors = FALLBACK_PROCESSORS;
  if (!result.generations?.length) result.generations = FALLBACK_GENERATIONS;
  if (!result.rams?.length) result.rams = FALLBACK_RAM;
  if (!result.storages?.length) result.storages = FALLBACK_STORAGE;
  if (!result.gpus?.length) result.gpus = FALLBACK_GPU;
  if (!result.screen_sizes?.length) result.screen_sizes = FALLBACK_SCREEN_SIZES;
  return result;
}

async function fetchCatalogAttributeOptions() {
  const defaults = {
    processors: [],
    generations: [],
    rams: [],
    storages: [],
    gpus: [],
    screen_sizes: [],
    brands: [],
    models: [],
    catalog_rows: [],
  };
  try {
    // Config options come from the ACTUAL procured/received product specs
    // (vendor_product_details) UNION the optional laptop_catalog master, so any
    // item received via a PO/GRN is immediately selectable for quotations & SOs.
    const [catalog, gpuRes, screenRes] = await Promise.all([
      pool.query(
        `SELECT DISTINCT brand, model, processor, generation, ram, storage FROM (
           SELECT brand, model, processor, generation, ram, storage
             FROM vendor_product_details
            WHERE COALESCE(model, '') <> ''
           UNION
           SELECT brand, model, processor, generation, ram, storage
             FROM laptop_catalog WHERE active = true
         ) c
         ORDER BY brand, model`
      ),
      pool.query(`SELECT DISTINCT gpu FROM inventory WHERE gpu IS NOT NULL AND gpu != '' ORDER BY gpu`).catch(() => ({ rows: [] })),
      pool.query(`SELECT DISTINCT screen_size FROM inventory WHERE screen_size IS NOT NULL AND screen_size != '' ORDER BY screen_size`).catch(() => ({ rows: [] })),
    ]);
    const rows = catalog.rows || [];
    return applyCatalogFallbacks({
      brands: [...new Set(rows.map((r) => r.brand).filter(Boolean))],
      models: [...new Set(rows.map((r) => r.model).filter(Boolean))],
      processors: [...new Set(rows.map((r) => r.processor).filter(Boolean))],
      generations: [...new Set(rows.map((r) => r.generation).filter(Boolean))],
      rams: [...new Set(rows.map((r) => r.ram).filter(Boolean))],
      storages: [...new Set(rows.map((r) => r.storage).filter(Boolean))],
      gpus: gpuRes.rows.map((r) => r.gpu),
      screen_sizes: screenRes.rows.map((r) => r.screen_size),
      catalog_rows: rows,
    });
  } catch {
    return applyCatalogFallbacks(defaults);
  }
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
  if (Array.isArray(body.line_items) && body.line_items.length) return body.line_items;
  const count = Math.max(
    ...['quantity', 'Processor', 'processor', 'brand', 'brands', 'remarks', 'remark'].map((key) => {
      const value = body[key];
      return Array.isArray(value) ? value.length : 0;
    })
  );
  if (!count) return [];
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
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
    const [customersRes, quotationNumber, catalog] = await Promise.all([
      pool.query(`SELECT customer_id, name, company_name, email, phone, gst_no, address, details FROM customers ORDER BY company_name ASC NULLS LAST, name ASC LIMIT 500`),
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

    const quoteEntity = entityForQuotationType(body.quotation_type || 'rental');
    const quotationNumber = body.quotation_number
      || (await nextDocumentNumber(entityDocType('quotation', quoteEntity)));
    const token = generateToken();
    const shipping = parseJsonField(body.customer_shipping_address);
    let billing = parseJsonField(body.customer_billing_address);
    if (billing && body.customer_name) {
      billing = { ...billing, name: body.customer_name };
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
          created_by, source_lead_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'pending',$28,$29,$30)`,
        [
          quotationNumber,
          body.customer_id || null,
          body.customer_name || null,
          body.email || body.customer_email,
          body.customer_mobile,
          shipping ? JSON.stringify(shipping) : null,
          billing ? JSON.stringify(billing) : null,
          body.GST_number || body.gst_number,
          body.supply_state,
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
      if (header.customer_email) {
        await emailDocument({
          to: header.customer_email,
          subject: `Quotation ${quotationNumber}`,
          text: `Your quotation ${quotationNumber} has been created.`,
          pdfRelativePath: pdfPath,
        });
      }
    } catch (pdfErr) {
      console.warn('Quotation PDF/email skipped:', pdfErr.message);
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
    if (!['pending', 'sent', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const quotationNumber = req.params.quotationNumber;
    const lines = await getQuotationLines(quotationNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }
    const header = lines[0];
    const updaterName = req.user?.name || req.user?.username || req.user?.email || 'Admin';

    await pool.query(
      `UPDATE sales_quotations SET status = $1, status_updated_by_id = $2, status_updated_by_name = $3, updated_at = NOW()
       WHERE quotation_number = $4`,
      [status, req.user?.user_id, updaterName, quotationNumber]
    );

    if (status === 'sent') {
      try {
        let pdfPath = header.pdf_path;
        if (!pdfPath) {
          pdfPath = await generateDocumentPdf({
            docType: 'quotation',
            docNumber: quotationNumber,
            header,
            lines,
          });
          await pool.query(
            `UPDATE sales_quotations SET pdf_path = $1 WHERE quotation_number = $2`,
            [pdfPath, quotationNumber]
          );
        }
        const to = email || header.customer_email;
        if (to) {
          await emailDocument({
            to,
            cc: cc || undefined,
            subject: `Quotation ${quotationNumber}`,
            text: `Please find attached quotation ${quotationNumber}.`,
            pdfRelativePath: pdfPath,
          });
        }
      } catch (sendErr) {
        console.warn('Quotation send email skipped:', sendErr.message);
      }
    }

    res.json({
      success: true,
      message: status === 'sent' ? 'Quotation sent' : 'Status updated',
    });
  } catch (error) {
    console.error('updateQuotationStatus:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAddSalesOrderMeta = async (req, res) => {
  try {
    const salesOrderNumber = await nextDocumentNumber('sales_order');
    const quotationNumber = req.query.quotation_number;
    let quotationLines = [];
    if (quotationNumber) {
      quotationLines = await getQuotationLines(quotationNumber);
    }
    const [customersRes, catalog] = await Promise.all([
      pool.query(`SELECT customer_id, name, company_name, email, phone, gst_no, address, details FROM customers ORDER BY company_name ASC NULLS LAST, name ASC LIMIT 500`),
      fetchCatalogAttributeOptions(),
    ]);
    res.json({
      success: true,
      sales_order_number: salesOrderNumber,
      quotation_number: quotationNumber || null,
      quotation_lines: quotationLines,
      customers: customersRes.rows.map(normalizeCustomerForQuotation),
      catalog,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listSalesOrders = async (req, res) => {
  try {
    const data = await listSalesOrdersGrouped({
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
      search: req.query.search || '',
    });
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSalesOrder = async (req, res) => {
  try {
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

    const salesOrderNumber = body.sales_order_number || (await nextDocumentNumber('sales_order'));
    const quotationNumber = body.is_without_quotation ? 'N/A' : (body.quotation_number || 'N/A');
    const shipping = parseJsonField(body.customer_shipping_address);
    let billing = parseJsonField(body.customer_billing_address);
    if (billing && body.customer_name) {
      billing = { ...billing, name: body.customer_name };
    }
    const customerId = toNullableInt(body.customer_id);

    if (customerId) {
      const customerExists = await pool.query(
        `SELECT 1 FROM customers WHERE customer_id = $1 LIMIT 1`,
        [customerId]
      );
      if (!customerExists.rows.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid customer_id (${customerId}). Please reselect customer and try again.`,
        });
      }
    }

    await client.query('BEGIN');
    for (const item of lineItems) {
      await client.query(
        `INSERT INTO sales_order_lines (
          sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile,
          customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount,
          shiping_charges, quotation_type, branch, brand, model_name, processor, generation, ram, storage,
          gpu, screen_size, quantity, main_qty, rate, locking_period, battery_charger_warranty,
          technical_warranty, remark, status, token, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'pending',$30,$31)`,
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
          body.supply_state,
          body.security_amount || 0,
          body.shiping_charges || 0,
          body.quotation_type || 'rental',
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
        ]
      );
    }
    // Tag the owning entity (Sales -> gorefurbo, Rental/Demo -> rentfoxxy).
    await client.query(
      `UPDATE sales_order_lines SET entity_code = $1 WHERE sales_order_number = $2`,
      [entityForQuotationType(body.quotation_type || 'rental'), salesOrderNumber]
    );

    // Security: 'one_month_rental' auto-computes from the sum of each line's
    // monthly rate x qty (server-authoritative). 'none' = 0.
    const securityType = String(body.security_type || 'none').toLowerCase();
    if (securityType === 'one_month_rental') {
      const oneMonth = lineItems.reduce((s, it) => s + (Number(it.rate || 0) * Number(it.quantity || 1)), 0);
      await client.query(
        `UPDATE sales_order_lines SET security_amount = $1, security_type = 'one_month_rental' WHERE sales_order_number = $2`,
        [oneMonth, salesOrderNumber]
      );
    } else {
      await client.query(
        `UPDATE sales_order_lines SET security_type = 'none' WHERE sales_order_number = $1`,
        [salesOrderNumber]
      );
    }
    await client.query('COMMIT');

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
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('storeSalesOrder:', error);
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
      existingDc.rows[0]?.dc_number || nextDocumentNumber('delivery_challan'),
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
    const data = await listDeliveryChallansGrouped({
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
      search: req.query.search || '',
    });
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDeliveryChallan = async (req, res) => {
  try {
    const lines = await getDeliveryChallanLines(req.params.dcNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }

    // Resolve full laptop specs for every attached serial from the authoritative
    // source (vendor_serial_numbers + vendor_product_details), since the DC line
    // itself only stores brand/model.
    const specSelect = `
      SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code,
             COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
             COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
             COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
             COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
             COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
             COALESCE(vsn.extra->>'storage', vpd.storage) AS storage,
             COALESCE(vsn.extra->>'gpu', vpd.gpu) AS gpu,
             COALESCE(vsn.extra->>'screen_size', vpd.screen_size) AS screen_size,
             vsn.inventory_status
      FROM vendor_serial_numbers vsn
      LEFT JOIN vendor_product_details vpd
        ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
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
        return {
          ttspl: d.inventory_asset_code || e.ttsplId || e.serialNumber,
          serial_number: d.serial_number || e.serialNumber,
          brand: d.brand || line.brand || '',
          model: d.model || line.model_name || '',
          processor: d.processor || '',
          generation: d.generation || '',
          ram: d.ram || '',
          storage: d.storage || '',
          gpu: d.gpu || '',
          screen_size: d.screen_size || '',
          status: d.inventory_status || '',
        };
      });
    }

    res.json({ success: true, dc_number: req.params.dcNumber, lines });
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

    // Determine the owning entity from the linked SO/quotation type.
    const typeRes = await pool.query(
      `SELECT COALESCE(sol.quotation_type, sq.quotation_type, 'rental') AS quotation_type
         FROM sales_order_lines sol
         LEFT JOIN sales_quotations sq ON sq.quotation_number = sol.quotation_number
        WHERE sol.sales_order_number = $1
        LIMIT 1`,
      [body.sales_order_number]
    );
    const quotationType = typeRes.rows[0]?.quotation_type || body.quotation_type || 'rental';
    const entityCode = entityForQuotationType(quotationType);

    // Creating a DC with delivery info = the product is dispatched. Map the
    // ship-by selection to the canonical dispatch mode.
    const shipBy = body.ship_by || (body.dispatch_mode === 'inhouse' ? 'by_hand' : body.dispatch_mode);
    const dispatchMode = shipBy === 'by_hand' ? 'inhouse'
      : shipBy === 'by_porter' ? 'porter'
        : shipBy === 'by_courier' ? 'courier'
          : (body.dispatch_mode || 'courier');

    const dcNumber = body.challan_number || body.dc_number
      || (await nextDocumentNumber(entityDocType('delivery_challan', entityCode)));
    const shipping = parseJsonField(body.customer_shipping_address);
    const billing = parseJsonField(body.customer_billing_address);

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

      await client.query(
        `INSERT INTO delivery_challan_lines (
          dc_number, sales_order_number, quotation_number, customer_id, customer_name, email, gst_number,
          supply_state, security_amount, shiping_charges, branch, entity_code, customer_billing_address,
          customer_shipping_address, brand, model_name, quantity, main_qty, serial_number, ship_by,
          courier_name, awb_number, delivery_person_id, remarks, status, created_by,
          courier_tracking_url, porter_tracking_id, porter_order_id, porter_booking_url
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'pending',$25,$26,$27,$28,$29)`,
        [
          dcNumber,
          body.sales_order_number,
          body.quotation_number,
          body.customer_id || null,
          body.customer_name,
          body.email || body.customer_email,
          body.GST_number || body.gst_number,
          body.supply_state,
          dcSecurity,
          body.shiping_charges || 0,
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
        // Creating the DC dispatches the unit: in_stock/reserved -> in_transit.
        for (let k = 0; k < serialList.length; k += 1) {
          const parts = String(serialList[k]).split('|');
          const sId = (parts[0] && /^\d+$/.test(parts[0])) ? Number(parts[0]) : null;
          const serialId = await resolveSerialId(client, {
            serialId: sId, serialNumber: parts[1] || parts[0], ttsplId: parts[2] || null,
          });
          if (!serialId) continue;
          try {
            await inventorySM.markDispatched(client, serialId, {
              dcNumber,
              customerId: body.customer_id || null,
              entityCode,
              dispatchMode,
              actorUserId: req.user?.user_id,
              actorName: req.user?.name,
            });
          } catch (rErr) {
            // Non-canonical current state: fallback so the DC still forms.
            await client.query(
              `UPDATE vendor_serial_numbers SET inventory_status = 'in_transit', current_dc_number = $2,
                      dispatch_mode = $3, dispatched_at = NOW(), updated_at = NOW()
               WHERE serial_id = $1`,
              [serialId, dcNumber, dispatchMode]
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

    // DC created with delivery info = dispatched. Mark the lines in_transit so
    // there is no separate "dispatch" re-entry step. Courier/Porter then get
    // "Mark Delivered"; technician DCs surface in the delivery-register bucket.
    await client.query(
      `UPDATE delivery_challan_lines
         SET status = 'in_transit', dispatch_mode = $2,
             dispatched_at = COALESCE(dispatched_at, NOW()), updated_at = NOW()
       WHERE dc_number = $1 AND status = 'pending'`,
      [dcNumber, dispatchMode]
    );

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

    res.status(201).json({ success: true, message: 'Delivery challan created', dc_number: dcNumber, pdf_path: pdfPath });
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
      `SELECT sos.allocation_id, sos.serial_id, sos.qc_status, sos.status, sos.qc_ticket_id,
              sos.ttspl_id, sos.serial_number,
              vsn.serial_number AS vsn_serial, vsn.inventory_asset_code AS ttspl_id_vsn,
              COALESCE(vsn.extra->>'brand', vpd.brand, '') AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model, '') AS model,
              COALESCE(vsn.extra->>'processor', vpd.processor, '') AS processor,
              COALESCE(vsn.extra->>'generation', vpd.generation, '') AS generation,
              COALESCE(vsn.extra->>'ram', vpd.ram, '') AS ram,
              COALESCE(vsn.extra->>'storage', vpd.storage, '') AS storage
         FROM sales_order_serials sos
         LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
         LEFT JOIN vendor_product_details vpd ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
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

    const soLines = await getSalesOrderLines(sales_order_number);
    if (!soLines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
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
    const totalSecurity = soLines.reduce((s, l) => s + Number(l.security_amount || 0), 0);

    const allocMap = {};
    allocRes.rows.forEach((r) => { allocMap[r.allocation_id] = r; });

    const createdDcNumbers = [];
    await client.query('BEGIN');

    for (const group of dc_groups) {
      const ids = (group.allocation_ids || []).map((n) => Number(n));
      if (!ids.length) continue;

      const dcNumber = await nextDocumentNumber(entityDocType('delivery_challan', entityCode));
      const groupSerials = ids.map((id) => allocMap[id]).filter(Boolean);
      const deliveryAddress = group.delivery_address
        || parseJsonSafe(soHead.customer_shipping_address) || billing || null;

      const groupSize = ids.length;
      const groupSecurity = Math.round((totalSecurity / totalSoUnits) * groupSize * 100) / 100;

      const groupAwb = group.awb_number || body.awb_number || null;
      const groupDeliveryPersonId = group.delivery_person_id || body.delivery_person_id || null;

      const serialTokens = groupSerials.map((s) =>
        `${s.serial_id || ''}|${s.serial_number || s.vsn_serial || ''}|${s.ttspl_id || s.ttspl_id_vsn || ''}`
      );

      await client.query(
        `INSERT INTO delivery_challan_lines (
          dc_number, sales_order_number, quotation_number, customer_id, customer_name,
          email, gst_number, supply_state, security_amount, shiping_charges, branch,
          entity_code, customer_billing_address, customer_shipping_address,
          brand, model_name, quantity, main_qty, serial_number,
          ship_by, courier_name, awb_number, courier_tracking_url,
          porter_tracking_id, porter_order_id, porter_booking_url,
          delivery_person_id, dispatch_mode, dispatched_at,
          status, created_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
          $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,NOW(),
          'in_transit',$29
        )`,
        [
          dcNumber, sales_order_number, soHead.quotation_number, soHead.customer_id || null,
          soHead.customer_name, soHead.customer_email, soHead.gst_number, soHead.supply_state,
          groupSecurity, 0, entityCode, entityCode,
          billing ? JSON.stringify(billing) : null,
          deliveryAddress ? JSON.stringify(deliveryAddress) : null,
          groupSerials[0]?.brand || '', groupSerials[0]?.model || '',
          groupSize, groupSize, JSON.stringify(serialTokens),
          ship_by,
          ship_by === 'by_courier' ? (body.courier_name || null) : null,
          ship_by === 'by_courier' ? groupAwb : null,
          ship_by === 'by_courier' ? (body.courier_tracking_url || null) : null,
          ship_by === 'by_porter' ? (group.porter_tracking_id || body.porter_tracking_id || null) : null,
          ship_by === 'by_porter' ? (group.porter_order_id || body.porter_order_id || null) : null,
          ship_by === 'by_porter' ? (group.porter_booking_url || body.porter_booking_url || null) : null,
          ship_by === 'by_hand' && groupDeliveryPersonId ? Number(groupDeliveryPersonId) : null,
          dispatchMode, req.user?.user_id,
        ]
      );

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

      // Dispatch each unit through the inventory state machine (fallback: direct).
      for (const s of groupSerials) {
        if (!s.serial_id) continue;
        try {
          await inventorySM.markDispatched(client, s.serial_id, {
            dcNumber, customerId: soHead.customer_id || null, entityCode, dispatchMode,
            actorUserId: req.user?.user_id, actorName: req.user?.name,
          });
        } catch (rErr) {
          await client.query(
            `UPDATE vendor_serial_numbers
                SET inventory_status = 'in_transit', current_dc_number = $1,
                    dispatch_mode = $2, dispatched_at = NOW(), updated_at = NOW()
              WHERE serial_id = $3`,
            [dcNumber, dispatchMode, s.serial_id]
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

    res.status(201).json({
      success: true,
      dc_numbers: createdDcNumbers,
      dcs_created: createdDcNumbers.length,
      first_dc: createdDcNumbers[0],
      message: `${createdDcNumbers.length} DC(s) created: ${createdDcNumbers.join(', ')}`,
    });
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
    const counts = await getOperationCounts();
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
    const { email, name } = req.body;
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await pool.query(
      `UPDATE delivery_challan_lines SET d_otp = $1, d_customer_email = $2, d_customer_name = $3, updated_at = NOW()
       WHERE dc_number = $4`,
      [otp, email, name, dcNumber]
    );
    if (email) {
      await emailDocument({
        to: email,
        subject: `Delivery OTP for ${dcNumber}`,
        text: `Your delivery OTP is ${otp}`,
        pdfRelativePath: null,
      });
    }
    res.json({ success: true, message: 'OTP sent' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifyDeliveryOtp = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const { otp } = req.body;
    const result = await pool.query(
      `SELECT d_otp FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [dcNumber]
    );
    if (!result.rows.length || result.rows[0].d_otp !== String(otp)) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
    await pool.query(
      `UPDATE delivery_challan_lines SET d_otp_verified_at = NOW(), updated_at = NOW() WHERE dc_number = $1`,
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
    const rows = await listReturnDeliveryChallans();
    res.json({ success: true, return_dcs: rows, rows, orders: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
    const {
      pickup_mode = 'technician', technician_user_id = null,
      courier_name = null, awb_number = null,
    } = req.body || {};
    const dispatchMode = { technician: 'inhouse', courier: 'courier', porter: 'porter' }[pickup_mode] || 'inhouse';

    const tRes = await client.query(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
    if (!tRes.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const t = tRes.rows[0];
    if (t.return_dc_number) {
      return res.status(400).json({ success: false, message: `Return DC already generated (${t.return_dc_number})` });
    }

    const itemsRes = await client.query(
      `SELECT * FROM support_ticket_items
        WHERE ticket_id = $1 AND item_type = 'pickup'
          AND status NOT IN ('resolved','closed','inventory_updated')`,
      [ticketId]
    );
    if (!itemsRes.rows.length) {
      return res.status(400).json({ success: false, message: 'No open pickup items on this ticket' });
    }

    const entries = [];
    let firstSpec = {};
    for (const it of itemsRes.rows) {
      const code = it.ttspl_id || it.unique_serial_number || it.serial_number;
      if (!code) continue;
      const sr = await client.query(
        `SELECT serial_id, serial_number, inventory_asset_code, extra
           FROM vendor_serial_numbers
          WHERE deleted_at IS NULL
            AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
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
    }
    if (!entries.length) return res.status(400).json({ success: false, message: 'No serials resolved for pickup' });

    const rdc = await nextDocumentNumber('return_dc');
    const pickupAddr = (typeof t.pickup_address === 'string' ? JSON.parse(t.pickup_address) : t.pickup_address) || {};
    const deliveryPersonId = dispatchMode === 'inhouse' && technician_user_id
      ? parseInt(technician_user_id, 10) : null;

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO delivery_challan_lines
         (dc_number, movement_type, support_ticket_id, customer_id, customer_name, email,
          customer_shipping_address, brand, model_name, quantity, serial_number,
          dispatch_mode, delivery_person_id, courier_name, awb_number, status,
          dispatched_at, created_by, created_at, updated_at)
       VALUES ($1,'return',$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,'in_transit',NOW(),$15,NOW(),NOW())`,
      [
        rdc, ticketId, t.customer_id, t.customer_name, t.ticket_email || null,
        JSON.stringify(pickupAddr), firstSpec.brand || null, firstSpec.model || firstSpec.model_name || null,
        entries.length, JSON.stringify(entries), dispatchMode, deliveryPersonId,
        courier_name, awb_number, req.user?.user_id || null,
      ]
    );
    await client.query(
      `UPDATE support_tickets
          SET return_dc_number = $1, complaint_type = COALESCE(complaint_type, 'pickup'),
              status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
              updated_at = NOW()
        WHERE id = $2`,
      [rdc, ticketId]
    );
    // Link pickup items and mint customer OTP (legacy generate path skipped this).
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
         pickup_method = COALESCE(NULLIF(pickup_method, ''), 'inhouse'),
         pickup_assigned_to = COALESCE(pickup_assigned_to, assigned_to),
         updated_at = NOW()
       WHERE ticket_id = $2 AND item_type = 'pickup'
         AND status NOT IN ('resolved', 'closed', 'inventory_updated')`,
      [rdc, ticketId]
    );
    await client.query('COMMIT');

    try {
      const items = (await pool.query(
        `SELECT * FROM support_ticket_items
          WHERE ticket_id = $1 AND item_type = 'pickup' AND return_dc_number = $2
          ORDER BY id DESC LIMIT 1`,
        [ticketId, rdc]
      )).rows;
      if (items.length) await regenerateReturnDcPdf(pool, items[0]);
    } catch (pdfErr) {
      console.error('[sales] return DC pdf (generate):', pdfErr.message);
    }

    res.json({ success: true, return_dc_number: rdc, dispatch_mode: dispatchMode, delivery_person_id: deliveryPersonId });
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
    const lines = await getSalesOrderLines(soNumber);
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    const payRes = await pool.query(
      `SELECT * FROM sales_order_payments WHERE sales_order_number = $1 ORDER BY payment_date DESC`,
      [soNumber]
    );
    const dcRes = await pool.query(
      `SELECT DISTINCT ON (dc_number) dc_number, status, created_at, ship_by, dispatch_mode
       FROM delivery_challan_lines WHERE sales_order_number = $1 ORDER BY dc_number, id DESC`,
      [soNumber]
    );
    const totalValue = lines.reduce(
      (s, l) => s + Number(l.rate || 0) * Number(l.main_qty || l.quantity || 0), 0
    );
    const totalPaid = payRes.rows.reduce((s, p) => s + Number(p.amount || 0), 0);
    res.json({
      success: true,
      sales_order_number: soNumber,
      lines,
      payments: payRes.rows,
      delivery_challans: dcRes.rows,
      summary: {
        total_value: totalValue,
        total_paid: totalPaid,
        balance_due: Math.max(0, totalValue - totalPaid),
        security_amount: Number(lines[0].security_amount || 0),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
    const pdf = await generateDocumentPdf({ docType: 'sales_order', docNumber: n, header: lines[0], lines });
    await pool.query(`UPDATE sales_order_lines SET pdf_path = $1 WHERE sales_order_number = $2`, [pdf, n]);
    res.json({ success: true, pdf_path: pdf });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.regenerateDcPdf = async (req, res) => {
  try {
    const n = req.params.dcNumber;
    const lines = await getDeliveryChallanLines(n);
    if (!lines.length) return res.status(404).json({ success: false, message: 'DC not found' });
    const pdf = await generateDocumentPdf({ docType: 'delivery_challan', docNumber: n, header: lines[0], lines });
    await pool.query(`UPDATE delivery_challan_lines SET pdf_path = $1 WHERE dc_number = $2`, [pdf, n]);
    res.json({ success: true, pdf_path: pdf });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
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
      if (statuses.some((s) => ['delivered', 'in_transit', 'shipped', 'reached'].includes(s))) {
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
        await inventorySM.markDispatched(client, serialId, {
          dcNumber,
          customerId: ctx.customer_id || null,
          entityCode: ctx.entity_code || null,
          dispatchMode,
          actorUserId: req.user.user_id,
          actorName: req.user.name,
        });
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

  const ctx = await getDcContext(client, dcNumber);
  const quotationType = ctx.quotation_type || 'rental';
  const serials = await collectDcSerials(dcNumber);
  const deliveredAt = new Date();
  const demoRows = [];

  for (const s of serials) {
    const serialId = await resolveSerialId(client, s);
    if (!serialId) continue;
    const sr = await client.query(
      `SELECT dispatch_mode, dispatched_at, inventory_asset_code AS ttspl_id
         FROM vendor_serial_numbers WHERE serial_id = $1`,
      [serialId]
    );
    const row = sr.rows[0] || {};
    const rateRes = await client.query(
      `SELECT sol.rate
         FROM delivery_challan_lines dcl
         JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
        WHERE dcl.dc_number = $1
        ORDER BY (sol.brand = dcl.brand) DESC NULLS LAST
        LIMIT 1`,
      [dcNumber]
    );
    const rentMonthlyRate = quotationType === 'rental'
      ? parseFloat(rateRes.rows[0]?.rate || 0) || null
      : null;
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
    });
    if (result.to === inventorySM.STATUS.ON_DEMO) {
      demoRows.push({ serialId, ttsplId: row.ttspl_id });
    }
  }

  if (demoRows.length && ctx.customer_id) {
    const decisionDue = new Date(deliveredAt);
    decisionDue.setDate(decisionDue.getDate() + 7);
    for (const d of demoRows) {
      await client.query(
        `INSERT INTO demo_agreements
           (sales_order_number, dc_number, customer_id, serial_id, ttspl_id,
            delivered_at, decision_due_at, decision)
         VALUES (
           (SELECT sales_order_number FROM delivery_challan_lines WHERE dc_number=$2 LIMIT 1),
           $2, $3, $4, $5, $6, $7, 'pending')`,
        [null, dcNumber, ctx.customer_id, d.serialId, d.ttsplId, deliveredAt, decisionDue]
      );
    }
  }

  await client.query(
    `UPDATE sales_order_serials SET status = 'dispatched', dc_number = $1, updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber]
  ).catch(() => {});

  return { ctx, deliveredAt };
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
    res.json({ success: true, message: 'Marked as delivered' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('markDcDelivered:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.markDcRejected = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const reason = req.body?.rejection_reason || req.body?.reason;
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'rejection_reason is required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE delivery_challan_lines SET
          status = 'rejected', rejection_reason = $1, updated_at = NOW()
         WHERE dc_number = $2`,
        [reason.trim(), dcNumber]
      );

      const serials = await collectDcSerials(dcNumber);
      for (const s of serials) {
        const serialId = await resolveSerialId(client, s);
        if (!serialId) continue;
        // Delivery rejected at the door — asset comes straight back to stock.
        await inventorySM.backToStock(client, serialId, {
          reason: `DC ${dcNumber} delivery rejected: ${reason.trim()}`,
          actorUserId: req.user.user_id,
          actorName: req.user.name,
        });
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ success: true, message: 'Delivery marked as rejected' });
  } catch (error) {
    console.error('markDcRejected:', error);
    res.status(500).json({ success: false, message: error.message });
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
    res.json({ success: true, allocation_id: allocationId, delivery_address: r.rows[0].delivery_address });
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
        RETURNING id`,
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
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateSoLineAddress:', error);
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
    const result = await pool.query(`SELECT customer_id, details FROM customers WHERE customer_id = $1`, [req.params.customerId]);
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
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
