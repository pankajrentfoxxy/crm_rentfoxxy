const pool = require('../config/db');
const svc = require('../services/partVendorRepairService');

function requireWarehouse(req, res, next) {
  if (svc.WAREHOUSE_ROLES.has(req.user.role)) return next();
  return res.status(403).json({ success: false, message: 'Warehouse, procurement, or admin access required' });
}

function actor(req) {
  return {
    actorUserId: req.user?.user_id,
    actorName: req.user?.name || req.user?.email || null,
    actorRole: req.user?.role || null,
  };
}

exports.requireWarehouse = requireWarehouse;

exports.listPartVendorReturns = async (req, res) => {
  try {
    const data = await svc.listPartVendorReturns({
      search: req.query.search,
      status: req.query.status,
      vendorId: req.query.vendor_id,
      page: req.query.page,
      limit: req.query.limit,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to list part vendor returns' });
  }
};

exports.getPartVendorReturnDc = async (req, res) => {
  try {
    const dc = await svc.getPartVendorReturnDc(req.params.dcNumber);
    if (!dc) return res.status(404).json({ success: false, message: 'Part vendor repair DC not found' });
    res.json({ success: true, data: dc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load DC' });
  }
};

exports.createPartVendorReturn = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.createPartVendorReturnDc(client, {
      instanceIds: req.body.instance_ids || req.body.instanceIds || [],
      vendorId: req.body.vendor_id || req.body.vendorId,
      vendorName: req.body.vendor_name || req.body.vendorName,
      vendorAddress: req.body.vendor_address || req.body.vendorAddress,
      vendorBillingAddress: req.body.vendor_billing_address || req.body.vendorBillingAddress,
      shippingAddress: req.body.shipping_address || req.body.shippingAddress,
      contactPerson: req.body.contact_person || req.body.contactPerson,
      contactMobile: req.body.contact_mobile || req.body.contactMobile,
      expectedReturnDate: req.body.expected_return_date || req.body.expectedReturnDate,
      remarks: req.body.remarks,
      warehouseName: req.body.warehouse_name || req.body.warehouseName,
      warehouseAddress: req.body.warehouse_address || req.body.warehouseAddress,
      itemRemarks: req.body.item_remarks || req.body.itemRemarks || {},
      itemPrices: req.body.item_prices || req.body.itemPrices || {},
      itemHsnCodes: req.body.item_hsn_codes || req.body.itemHsnCodes || {},
      ewayBillNumber: req.body.eway_bill_number || req.body.ewayBillNumber,
      ewayBillDate: req.body.eway_bill_date || req.body.ewayBillDate,
      ship_by: req.body.ship_by || req.body.shipBy,
      dispatch_mode: req.body.dispatch_mode || req.body.dispatchMode,
      courier_name: req.body.courier_name || req.body.courierName,
      awb_number: req.body.awb_number || req.body.awbNumber,
      courier_tracking_url: req.body.courier_tracking_url || req.body.courierTrackingUrl,
      porter_tracking_id: req.body.porter_tracking_id || req.body.porterTrackingId,
      porter_order_id: req.body.porter_order_id || req.body.porterOrderId,
      porter_booking_url: req.body.porter_booking_url || req.body.porterBookingUrl,
      delivery_person_id: req.body.delivery_person_id || req.body.deliveryPersonId,
      ...actor(req),
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ success: false, message: err.message || 'Failed to create part return DC' });
  } finally {
    client.release();
  }
};

exports.dispatchPartVendorReturn = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.dispatchPartVendorReturnDc(client, {
      dcNumber: req.params.dcNumber,
      warehouseEsign: req.body.warehouse_esign || req.body.warehouseEsign,
      vendorEsign: req.body.vendor_esign || req.body.vendorEsign,
      dispatchBody: req.body,
      dispatchPod: req.body.dispatch_pod || req.body.dispatchPod,
      ...actor(req),
    });
    await client.query('COMMIT');
    res.json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ success: false, message: err.message || 'Failed to dispatch DC' });
  } finally {
    client.release();
  }
};

exports.receivePartsFromVendor = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.receivePartsFromVendor(client, {
      dcNumber: req.params.dcNumber,
      receiveItems: req.body.receive_items || req.body.receiveItems || [],
      warehouseEsign: req.body.warehouse_esign || req.body.warehouseEsign,
      warehouseSignerName: req.body.warehouse_signer_name || req.body.warehouseSignerName,
      ...actor(req),
    });
    await client.query('COMMIT');
    res.json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ success: false, message: err.message || 'Failed to receive parts' });
  } finally {
    client.release();
  }
};

exports.listQcPending = async (req, res) => {
  try {
    const data = await svc.listQcPendingPartInstances({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to list QC pending parts' });
  }
};

exports.listDefectiveEligible = async (req, res) => {
  try {
    const data = await svc.listDefectiveEligibleForVendorReturn({
      search: req.query.search,
      limit: req.query.limit,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to list defective parts' });
  }
};

exports.passQc = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.passPartVendorRepairQc(client, {
      instanceId: Number(req.params.instanceId),
      notes: req.body.notes,
      ...actor(req),
    });
    await client.query('COMMIT');
    res.json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ success: false, message: err.message || 'QC pass failed' });
  } finally {
    client.release();
  }
};

exports.failQc = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.failPartVendorRepairQc(client, {
      instanceId: Number(req.params.instanceId),
      notes: req.body.notes,
      ...actor(req),
    });
    await client.query('COMMIT');
    res.json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ success: false, message: err.message || 'QC fail failed' });
  } finally {
    client.release();
  }
};

exports.downloadPdf = async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const dcNumber = req.params.dcNumber;
    const { generatePartVendorRepairPdf } = require('../services/vendorRepairPdfService');
    const rel = await generatePartVendorRepairPdf(dcNumber);
    if (!rel) return res.status(404).json({ success: false, message: 'Part vendor repair DC not found' });
    const abs = path.join(__dirname, '../uploads', rel);
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, message: 'PDF file missing' });
    const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="VRDC_PART_${safe}.pdf"`);
    res.download(abs, `VRDC_PART_${safe}.pdf`);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'PDF download failed' });
  }
};
