const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const {
  nextDocumentNumber,
  generateToken,
  listQuotationsGrouped,
  getQuotationLines,
  listSalesOrdersGrouped,
  getSalesOrderLines,
  listDeliveryChallansGrouped,
  getDeliveryChallanLines,
  listReturnDeliveryChallans,
  getQuotationRemainingQty,
  getSalesOrderRemainingQty,
  getOperationCounts,
  searchAvailableInventory,
} = require('../services/salesManagementService');
const { generateDocumentPdf } = require('../services/salesManagementPdfService');
const { emailDocument } = require('../services/salesManagementPdfService');
const { createSalesOrderQcTicket } = require('../services/grnTicketService');
const { logTtsplEvent } = require('../services/ttsplAuditService');
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
    ? billingRaw
    : {
        name: row.name,
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
    email: row.email,
    phone: row.phone,
    gst_no: row.gst_no,
    address: row.address,
    billing_address: billing,
    shipping_addresses: shippingList,
  };
}

async function fetchCatalogAttributeOptions() {
  const defaults = {
    processors: [],
    generations: [],
    rams: [],
    storages: [],
    gpus: ['Integrated', '2GB', '4GB', '6GB', '8GB'],
    screen_sizes: ['11.6"', '13.3"', '14"', '15.6"', '17.3"'],
    brands: [],
    models: [],
  };
  try {
    const [catalog, gpuRes, screenRes] = await Promise.all([
      pool.query(
        `SELECT DISTINCT brand, model, processor, generation, ram, storage
         FROM laptop_catalog WHERE active = true ORDER BY brand, model`
      ),
      pool.query(`SELECT DISTINCT gpu FROM inventory WHERE gpu IS NOT NULL AND gpu != '' ORDER BY gpu`).catch(() => ({ rows: [] })),
      pool.query(`SELECT DISTINCT screen_size FROM inventory WHERE screen_size IS NOT NULL AND screen_size != '' ORDER BY screen_size`).catch(() => ({ rows: [] })),
    ]);
    const rows = catalog.rows || [];
    return {
      brands: [...new Set(rows.map((r) => r.brand).filter(Boolean))],
      models: [...new Set(rows.map((r) => r.model).filter(Boolean))],
      processors: [...new Set(rows.map((r) => r.processor).filter(Boolean))],
      generations: [...new Set(rows.map((r) => r.generation).filter(Boolean))],
      rams: [...new Set(rows.map((r) => r.ram).filter(Boolean))],
      storages: [...new Set(rows.map((r) => r.storage).filter(Boolean))],
      gpus: gpuRes.rows.length ? gpuRes.rows.map((r) => r.gpu) : defaults.gpus,
      screen_sizes: screenRes.rows.length ? screenRes.rows.map((r) => r.screen_size) : defaults.screen_sizes,
      catalog_rows: rows,
    };
  } catch {
    return defaults;
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
      pool.query(`SELECT customer_id, name, email, phone, gst_no, address, details FROM customers ORDER BY name ASC LIMIT 500`),
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

    const quotationNumber = body.quotation_number || (await nextDocumentNumber('quotation'));
    const token = generateToken();
    const shipping = parseJsonField(body.customer_shipping_address);
    const billing = parseJsonField(body.customer_billing_address);

    await client.query('BEGIN');
    for (const item of lineItems) {
      await client.query(
        `INSERT INTO sales_quotations (
          quotation_number, customer_id, customer_name, customer_email, customer_mobile,
          customer_shipping_address, customer_billing_address, gst_number, supply_state,
          security_amount, shiping_charges, quotation_type, brand, model_name, processor,
          generation, ram, storage, gpu, screen_size, quantity, main_quantity, rate,
          locking_period, battery_charger_warranty, technical_warranty, remark, status, token, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'pending',$28,$29)`,
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
        ]
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
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const updaterName = req.user?.name || req.user?.username || req.user?.email || 'Admin';
    const result = await pool.query(
      `UPDATE sales_quotations SET status = $1, status_updated_by_id = $2, status_updated_by_name = $3, updated_at = NOW()
       WHERE quotation_number = $4 RETURNING quotation_number`,
      [status, req.user?.user_id, updaterName, req.params.quotationNumber]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Quotation not found' });
    }
    res.json({ success: true, message: 'Status updated' });
  } catch (error) {
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
      pool.query(`SELECT customer_id, name, email, phone, gst_no, address, details FROM customers ORDER BY name ASC LIMIT 500`),
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
    const billing = parseJsonField(body.customer_billing_address);

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
          body.customer_id,
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
    const billing = parseJsonSafe(header.customer_billing_address);
    const shipping = parseJsonSafe(header.customer_shipping_address);
    const shippableLines = lines.filter((line) => Number(line.quantity) > 0);
    const existingDc = await pool.query(
      `SELECT dc_number FROM delivery_challan_lines WHERE sales_order_number = $1 LIMIT 1`,
      [salesOrderNumber]
    );
    const [dcNumber, deliveryPersons, catalog] = await Promise.all([
      existingDc.rows[0]?.dc_number || nextDocumentNumber('delivery_challan'),
      pool.query(`SELECT user_id, name, email FROM users WHERE status = 'active' ORDER BY name ASC LIMIT 100`),
      fetchCatalogAttributeOptions(),
    ]);
    res.json({
      success: true,
      sales_order_number: salesOrderNumber,
      quotation_number: header.quotation_number,
      quotation_type: header.quotation_type,
      branch: header.branch,
      security_amount: header.security_amount,
      shiping_charges: header.shiping_charges,
      customer_id: header.customer_id,
      customer_name: header.customer_name,
      customer_email: header.customer_email,
      customer_mobile: header.customer_mobile,
      gst_number: header.gst_number,
      supply_state: header.supply_state,
      billing_address: billing,
      shipping_address: shipping,
      sales_order_lines: shippableLines,
      dc_number: dcNumber,
      remaining_qty: await getSalesOrderRemainingQty(salesOrderNumber),
      delivery_persons: deliveryPersons.rows.map((u) => ({
        id: u.user_id,
        name: u.name || u.email,
      })),
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

    const dcNumber = body.challan_number || body.dc_number || (await nextDocumentNumber('delivery_challan'));
    const shipping = parseJsonField(body.customer_shipping_address);
    const billing = parseJsonField(body.customer_billing_address);

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
          supply_state, security_amount, shiping_charges, branch, customer_billing_address,
          customer_shipping_address, brand, model_name, quantity, main_qty, serial_number, ship_by,
          courier_name, awb_number, delivery_person_id, remarks, status, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'pending',$24)`,
        [
          dcNumber,
          body.sales_order_number,
          body.quotation_number,
          body.customer_id || null,
          body.customer_name,
          body.email || body.customer_email,
          body.GST_number || body.gst_number,
          body.supply_state,
          body.security_amount || 0,
          body.shiping_charges || 0,
          body.branch,
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
        await client.query(
          `UPDATE vendor_serial_numbers
           SET inventory_status = 'out_stock', updated_at = NOW()
           WHERE serial_number = ANY($1::text[])
              OR serial_id = ANY($2::int[])`,
          [serialNumbers, serialIds.length ? serialIds : [-1]]
        );
      }
    }
    if (!inserted) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Select quantity and serial numbers for at least one line' });
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Delivery challan created', dc_number: dcNumber });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('storeDeliveryChallan:', error);
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
    const orders = await listReturnDeliveryChallans();
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.ensureSalesManagementSchema = async () => {
  for (const file of ['042_sales_management_module.sql', '043_operation_management_extras.sql', '044_quotation_demo_type.sql']) {
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
    const totalValue = lines.reduce((s, l) => s + Number(l.rate || 0) * Number(l.quantity || 0), 0);
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

    for (const s of serials) {
      let serialRow = null;
      if (s.serialId) {
        const r = await client.query(
          `SELECT serial_id, serial_number, inventory_asset_code, brand, processor, ram, storage, qc_status
           FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
          [s.serialId]
        );
        serialRow = r.rows[0];
      }
      if (!serialRow && s.serialNumber) {
        const r = await client.query(
          `SELECT serial_id, serial_number, inventory_asset_code, brand, processor, ram, storage, qc_status
           FROM vendor_serial_numbers WHERE serial_number = $1 AND deleted_at IS NULL LIMIT 1`,
          [s.serialNumber]
        );
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
        processor: serialRow.processor,
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

    await pool.query(
      `UPDATE delivery_challan_lines SET
        dispatch_mode = $1,
        ship_by = $2,
        courier_name = $3,
        awb_number = $4,
        porter_booking_id = $5,
        delivery_person_id = $6,
        estimated_delivery = $7,
        status = 'in_transit',
        updated_at = NOW()
       WHERE dc_number = $8`,
      [
        dispatchMode,
        dispatchMode === 'inhouse' ? 'by_hand' : 'by_courier',
        body.courier_name || null,
        body.awb_number || null,
        body.porter_booking_id || null,
        toNullableInt(body.delivery_person_id),
        body.estimated_delivery || null,
        dcNumber,
      ]
    );

    const serials = await collectDcSerials(dcNumber);
    for (const s of serials) {
      const ttspl = s.ttsplId || s.serialNumber;
      await logTtsplEvent({
        ttsplId: ttspl,
        vendorSerialId: s.serialId,
        eventType: 'dispatched',
        description: `DC ${dcNumber} dispatched (${dispatchMode})`,
        metadata: { dc_number: dcNumber, dispatch_mode: dispatchMode },
        actorUserId: req.user.user_id,
        actorName: req.user.name,
      });
    }

    res.json({ success: true, message: 'Dispatch updated', status: 'in_transit' });
  } catch (error) {
    console.error('updateDcDispatch:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markDcDelivered = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const body = req.body || {};
    await pool.query(
      `UPDATE delivery_challan_lines SET
        status = 'delivered',
        delivered_at = NOW(),
        delivered_by = $1,
        delivery_location = $2,
        pod_image_url = $3,
        delivery_completed_at = NOW(),
        updated_at = NOW()
       WHERE dc_number = $4`,
      [req.user.user_id, body.delivery_location || null, body.pod_image_url || null, dcNumber]
    );

    const serials = await collectDcSerials(dcNumber);
    const serialNumbers = serials.map((s) => s.serialNumber).filter(Boolean);
    const serialIds = serials.map((s) => s.serialId).filter(Boolean);
    if (serialNumbers.length) {
      await pool.query(
        `UPDATE vendor_serial_numbers SET inventory_status = 'dispatched', updated_at = NOW()
         WHERE serial_number = ANY($1::text[]) OR serial_id = ANY($2::int[])`,
        [serialNumbers, serialIds.length ? serialIds : [-1]]
      );
    }

    res.json({ success: true, message: 'Marked as delivered' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markDcRejected = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const reason = req.body?.rejection_reason || req.body?.reason;
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'rejection_reason is required' });
    }
    await pool.query(
      `UPDATE delivery_challan_lines SET
        status = 'rejected',
        rejection_reason = $1,
        updated_at = NOW()
       WHERE dc_number = $2`,
      [reason.trim(), dcNumber]
    );

    const serials = await collectDcSerials(dcNumber);
    const serialNumbers = serials.map((s) => s.serialNumber).filter(Boolean);
    const serialIds = serials.map((s) => s.serialId).filter(Boolean);
    if (serialNumbers.length) {
      await pool.query(
        `UPDATE vendor_serial_numbers SET inventory_status = 'in_stock', updated_at = NOW()
         WHERE serial_number = ANY($1::text[]) OR serial_id = ANY($2::int[])`,
        [serialNumbers, serialIds.length ? serialIds : [-1]]
      );
    }

    res.json({ success: true, message: 'Delivery marked as rejected' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
    const customers = await pool.query(`SELECT customer_id, name, email, phone, gst_no, address, details FROM customers WHERE customer_id = $1`, [req.params.customerId]);
    res.json({
      success: true,
      message: 'Shipping address added',
      customer: normalizeCustomerForQuotation(customers.rows[0]),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
