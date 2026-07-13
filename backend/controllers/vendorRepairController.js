const pool = require('../config/db');
const svc = require('../services/vendorRepairDcService');
const { validateIndianMobile, normalizeIndianMobile } = require('../utils/phoneValidation');
const path = require('path');
const fs = require('fs');

function requireWarehouse(req, res, next) {
  if (svc.WAREHOUSE_ROLES.has(req.user.role)) return next();
  return res.status(403).json({ success: false, message: 'Warehouse or admin access required' });
}

const { pickSpecFilters } = require('../utils/inventorySpecFilter');

exports.listDiagnosisFailed = async (req, res) => {
  try {
    await svc.ensureVendorRepairSchema();
    const data = await svc.listDiagnosisFailedTickets({
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      ...pickSpecFilters(req.query),
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load diagnosis failed tickets' });
  }
};

exports.createOutForRepair = async (req, res) => {
  const contactMobileRaw = req.body.contact_mobile || req.body.contactMobile;
  if (contactMobileRaw != null && String(contactMobileRaw).trim()) {
    const phoneError = validateIndianMobile(contactMobileRaw, { label: 'Contact mobile' });
    if (phoneError) return res.status(400).json({ success: false, message: phoneError });
  }
  const normalizedContactMobile = contactMobileRaw != null && String(contactMobileRaw).trim()
    ? normalizeIndianMobile(contactMobileRaw)
    : null;
  const client = await pool.connect();
  try {
    await svc.ensureVendorRepairSchema();
    await client.query('BEGIN');
    const result = await svc.createOutForRepairDc(client, {
      ticketIds: req.body.ticket_ids || req.body.ticketIds,
      vendorId: req.body.vendor_id || req.body.vendorId,
      vendorName: req.body.vendor_name || req.body.vendorName,
      vendorAddress: req.body.vendor_address || req.body.vendorAddress,
      vendorBillingAddress: req.body.vendor_billing_address || req.body.vendorBillingAddress,
      billingAddress: req.body.billing_address || req.body.billingAddress,
      shippingAddress: req.body.shipping_address || req.body.shippingAddress,
      contactPerson: req.body.contact_person || req.body.contactPerson,
      contactMobile: normalizedContactMobile,
      expectedReturnDate: req.body.expected_return_date || req.body.expectedReturnDate,
      remarks: req.body.remarks,
      warehouseName: req.body.warehouse_name || req.body.warehouseName,
      warehouseAddress: req.body.warehouse_address || req.body.warehouseAddress,
      itemRemarks: req.body.item_remarks || req.body.itemRemarks || {},
      ship_by: req.body.ship_by || req.body.shipBy,
      dispatch_mode: req.body.dispatch_mode || req.body.dispatchMode,
      courier_name: req.body.courier_name || req.body.courierName,
      awb_number: req.body.awb_number || req.body.awbNumber,
      courier_tracking_url: req.body.courier_tracking_url || req.body.courierTrackingUrl,
      porter_tracking_id: req.body.porter_tracking_id || req.body.porterTrackingId,
      porter_order_id: req.body.porter_order_id || req.body.porterOrderId,
      porter_booking_url: req.body.porter_booking_url || req.body.porterBookingUrl,
      delivery_person_id: req.body.delivery_person_id || req.body.deliveryPersonId,
      actorUserId: req.user.user_id,
      actorName: req.user.name,
    });
    await client.query('COMMIT');
    res.json({ success: true, message: 'Vendor repair DC created', ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message || 'Failed to create vendor repair DC' });
  } finally {
    client.release();
  }
};

exports.getCompanyDefaults = async (_req, res) => {
  try {
    const { formatCompanyBlock } = require('../utils/companyDefaults');
    res.json({ success: true, billing_address: formatCompanyBlock() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load company defaults' });
  }
};

exports.listVendorRepairDcs = async (req, res) => {
  try {
    const result = await svc.listVendorRepairDcs({
      search: req.query.search,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      ...pickSpecFilters(req.query),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load vendor repair DCs' });
  }
};

exports.getVendorRepairDc = async (req, res) => {
  try {
    const dc = await svc.getVendorRepairDc(req.params.dcNumber);
    if (!dc) return res.status(404).json({ success: false, message: 'Vendor repair DC not found' });
    res.json({ success: true, data: dc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load DC' });
  }
};

exports.updateDispatchDetails = async (req, res) => {
  const client = await pool.connect();
  try {
    await svc.ensureVendorRepairSchema();
    await client.query('BEGIN');
    const result = await svc.updateVendorRepairDispatchDetails(client, {
      dcNumber: req.params.dcNumber,
      body: req.body,
      actorUserId: req.user.user_id,
    });
    await client.query('COMMIT');
    res.json({ success: true, message: 'Dispatch details updated', ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message || 'Update failed' });
  } finally {
    client.release();
  }
};

exports.markDeliveredToVendor = async (req, res) => {
  const client = await pool.connect();
  const dcNumber = req.params.dcNumber;
  let result = null;
  try {
    await svc.ensureVendorRepairSchema();
    await client.query('BEGIN');
    result = await svc.markDeliveredToVendor(client, {
      dcNumber,
      actorUserId: req.user.user_id,
      actorName: req.user.name || req.user.email,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ success: false, message: err.message || 'Failed to mark delivered' });
  } finally {
    client.release();
  }

  let pdfPath = null;
  if (result && !result.already_delivered) {
    try {
      const { generateVendorRepairPdf } = require('../services/vendorRepairPdfService');
      pdfPath = await generateVendorRepairPdf(dcNumber);
    } catch (pdfErr) {
      console.error('[vendorRepair] delivered PDF failed:', pdfErr.message);
    }
  }

  const msg = result?.already_delivered ? 'Already marked delivered to vendor' : 'Marked delivered to vendor';
  res.json({ success: true, message: msg, pdf_path: pdfPath, ...result });
};

exports.signDispatch = async (req, res) => {
  const client = await pool.connect();
  let dcNumber = req.params.dcNumber;
  let result = null;
  try {
    await svc.ensureVendorRepairSchema();
    await client.query('BEGIN');
    result = await svc.signDispatchDc(client, {
      dcNumber,
      warehouseEsign: req.body.warehouse_esign,
      vendorEsign: req.body.vendor_esign,
      dispatchBody: req.body,
      dispatchPod: req.body.dispatch_pod || req.body.dispatch_pod_data || null,
      actorUserId: req.user.user_id,
      actorName: req.user.name || req.user.email,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ success: false, message: err.message || 'Dispatch signing failed' });
  } finally {
    client.release();
  }

  let pdfPath = null;
  if (result && !result.already_dispatched) {
    try {
      const { generateVendorRepairPdf } = require('../services/vendorRepairPdfService');
      pdfPath = await generateVendorRepairPdf(dcNumber);
    } catch (pdfErr) {
      console.error('[vendorRepair] dispatch PDF failed:', pdfErr.message);
    }
  }

  const msg = result?.already_dispatched ? 'Already dispatched' : 'Dispatched to vendor';
  res.json({ success: true, message: msg, pdf_path: pdfPath, ...result });
};

exports.receiveBack = async (req, res) => {
  const client = await pool.connect();
  const dcNumber = req.params.dcNumber;
  let result = null;
  try {
    await svc.ensureVendorRepairSchema();
    await client.query('BEGIN');
    result = await svc.receiveFromVendor(client, {
      dcNumber,
      ticketIds: req.body.ticket_ids || req.body.ticketIds || null,
      receiveItems: req.body.items || req.body.receive_items || null,
      warehouseEsign: req.body.warehouse_esign,
      vendorEsign: req.body.vendor_esign,
      actorUserId: req.user.user_id,
      actorName: req.user.name || req.user.email,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ success: false, message: err.message || 'Receive back failed' });
  } finally {
    client.release();
  }

  let receivePdfPath = null;
  if (result?.received_item_ids?.length) {
    try {
      const dc = await svc.getVendorRepairDc(dcNumber);
      const allReceivedIds = (dc?.items || [])
        .filter((i) => ['received', 'replacement_received'].includes(i.item_status))
        .map((i) => i.id);
      const receiveDcNumber = result.receive_dc_number || dc?.receive_dc_number;
      const { generateVendorRepairReceivePdf } = require('../services/vendorRepairPdfService');
      receivePdfPath = await generateVendorRepairReceivePdf(
        dcNumber,
        receiveDcNumber || `${dcNumber}-R01`,
        allReceivedIds.length ? allReceivedIds : result.received_item_ids
      );
      if (receivePdfPath) {
        await pool.query(
          `UPDATE vendor_repair_delivery_challans SET receive_pdf_path = $2, updated_at = NOW() WHERE dc_number = $1`,
          [dcNumber, receivePdfPath]
        );
      }
    } catch (pdfErr) {
      console.error('[vendorRepair] receive PDF failed:', pdfErr.message);
    }
  }

  const msg = result.status === 'returned'
    ? 'All laptops received — moved to Floor Manager'
    : `Received ${result.tickets_updated} laptop(s) — ${result.items_pending} still out for repair`;
  res.json({ success: true, message: msg, receive_pdf_path: receivePdfPath, ...result });
};

/** POST /vendor-repair/inventory/erp/:serialId/receive-back — legacy ERP out_for_repare units */
exports.receiveErpRepairBack = async (req, res) => {
  const client = await pool.connect();
  try {
    await svc.ensureVendorRepairSchema();
    await client.query('BEGIN');
    const result = await svc.receiveErpRepairBack(client, {
      serialId: req.params.serialId,
      actorUserId: req.user.user_id,
      actorName: req.user.name,
      createFloorTicket: req.body.create_floor_ticket !== false,
    });
    await client.query('COMMIT');
    const msg = result.ticket_id
      ? `Received — moved to QC Process. Floor ticket #${result.ticket_id} created.`
      : 'Received — moved to QC Process.';
    res.json({ success: true, message: msg, data: result });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message || 'Receive failed' });
  } finally {
    client.release();
  }
};

exports.downloadReceivePdf = async (req, res) => {
  try {
    await svc.ensureVendorRepairSchema();
    const dc = await svc.getVendorRepairDc(req.params.dcNumber);
    if (!dc?.receive_pdf_path) {
      const { generateVendorRepairReceivePdf } = require('../services/vendorRepairPdfService');
      const itemIds = (dc?.items || []).filter((i) => ['received', 'replacement_received'].includes(i.item_status)).map((i) => i.id);
      if (!itemIds.length) return res.status(404).json({ success: false, message: 'Receive PDF not found' });
      const rel = await generateVendorRepairReceivePdf(req.params.dcNumber, dc.receive_dc_number || `${req.params.dcNumber}-R01`, itemIds);
      if (!rel) return res.status(404).json({ success: false, message: 'PDF not found' });
      const abs = path.join(__dirname, '../uploads', rel);
      return res.download(abs, path.basename(abs));
    }
    const abs = path.join(__dirname, '../uploads', dc.receive_pdf_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, message: 'PDF file missing' });
    res.download(abs, path.basename(abs));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'PDF download failed' });
  }
};

exports.listVendorPortalRepairDcs = async (req, res) => {
  try {
    await svc.ensureVendorRepairSchema();
    const vendorId = req.vendor?.vendor_id;
    const { rows } = await pool.query(
      `SELECT d.*,
              (SELECT json_agg(json_build_object(
                'id', i.id, 'ttspl_id', i.ttspl_id, 'serial_number', i.serial_number,
                'configuration', i.configuration, 'item_remarks', i.item_remarks,
                'item_status', i.item_status, 'receive_dc_number', i.receive_dc_number
              ) ORDER BY i.id)
               FROM vendor_repair_dc_items i WHERE i.dc_number = d.dc_number) AS items
         FROM vendor_repair_delivery_challans d
        WHERE d.vendor_id = $1
        ORDER BY d.created_at DESC
        LIMIT 100`,
      [vendorId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load repair challans' });
  }
};

exports.downloadPdf = async (req, res) => {
  try {
    await svc.ensureVendorRepairSchema();
    const dcNumber = req.params.dcNumber;
    const { generateVendorRepairPdf } = require('../services/vendorRepairPdfService');
    const rel = await generateVendorRepairPdf(dcNumber);
    if (!rel) return res.status(404).json({ success: false, message: 'PDF not found' });
    const abs = path.join(__dirname, '../uploads', rel);
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, message: 'PDF file missing' });
    const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="VRDC_${safe}.pdf"`);
    res.download(abs, `VRDC_${safe}.pdf`);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'PDF download failed' });
  }
};

exports.listOutForRepairInventory = async (req, res) => {
  try {
    const result = await svc.listOutForRepairInventory({
      search: req.query.search,
      vendor: req.query.vendor,
      dcNumber: req.query.dc_number || req.query.dcNumber,
      page: req.query.page,
      limit: req.query.limit,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      brand: req.query.brand,
      model: req.query.model,
      processor: req.query.processor,
      generation: req.query.generation,
      ram: req.query.ram,
      storage: req.query.storage,
      screen_size: req.query.screen_size,
      gpu: req.query.gpu,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load out for repair inventory' });
  }
};

exports.getOutForRepairInventoryCount = async (req, res) => {
  try {
    const count = await svc.countOutForRepairInventory();
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load count' });
  }
};

exports.exportOutForRepairExcel = async (req, res) => {
  try {
    const { data } = await svc.listOutForRepairInventory({
      search: req.query.search,
      vendor: req.query.vendor,
      dcNumber: req.query.dc_number || req.query.dcNumber,
      page: 1,
      limit: 5000,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      brand: req.query.brand,
      model: req.query.model,
      processor: req.query.processor,
      generation: req.query.generation,
      ram: req.query.ram,
      storage: req.query.storage,
      screen_size: req.query.screen_size,
      gpu: req.query.gpu,
    });
    const XLSX = require('xlsx');
    const rows = (data || []).map((r) => ({
      Source: r.source === 'erp' ? 'ERP / Legacy' : 'Vendor DC',
      TTSPL: r.ttspl_id || '',
      'Serial Number': r.serial_number || '',
      Brand: r.brand || '',
      Model: r.model || '',
      Configuration: r.configuration || '',
      'Ticket ID': r.ticket_id || '',
      'Vendor Name': r.vendor_name || '',
      'Vendor Address': r.vendor_address || '',
      'DC Number': r.dc_number || r.dc_label || '',
      'Out Date': r.out_date || '',
      'Expected Return': r.expected_return_date || '',
      Status: r.current_status || 'Out for Repair',
      Remarks: r.remarks || '',
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Out for Repair');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="out_for_repair_inventory.xlsx"');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Export failed' });
  }
};

exports.exportOutForRepairPdf = async (req, res) => {
  try {
    const { data } = await svc.listOutForRepairInventory({
      search: req.query.search,
      vendor: req.query.vendor,
      dcNumber: req.query.dc_number || req.query.dcNumber,
      page: 1,
      limit: 500,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      brand: req.query.brand,
      model: req.query.model,
      processor: req.query.processor,
      generation: req.query.generation,
      ram: req.query.ram,
      storage: req.query.storage,
      screen_size: req.query.screen_size,
      gpu: req.query.gpu,
    });
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="out_for_repair_inventory.pdf"');
    doc.pipe(res);
    doc.fontSize(16).text('Out for Repair — Inventory', { align: 'center' });
    doc.moveDown();
    doc.fontSize(9);
    (data || []).forEach((r, idx) => {
      doc.text(
        `${idx + 1}. ${r.ttspl_id || '—'} | SN ${r.serial_number || '—'} | ${r.vendor_name || '—'} | DC ${r.dc_number || '—'} | Out ${r.out_date || '—'}`
      );
    });
    if (!data?.length) doc.text('No laptops currently out for repair.');
    doc.end();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'PDF export failed' });
  }
};

exports.requireWarehouse = requireWarehouse;
