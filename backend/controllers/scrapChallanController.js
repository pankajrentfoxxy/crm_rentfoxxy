const pool = require('../config/db');
const svc = require('../services/scrapChallanService');

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

function challanParam(req) {
  return req.params.challanNumber || req.params.dcNumber;
}

exports.requireWarehouse = requireWarehouse;

exports.listScrapChallans = async (req, res) => {
  try {
    const data = await svc.listScrapChallans({
      search: req.query.search,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to list scrap challans' });
  }
};

exports.getScrapChallan = async (req, res) => {
  try {
    const challan = await svc.getScrapChallan(challanParam(req));
    if (!challan) return res.status(404).json({ success: false, message: 'Scrap challan not found' });
    res.json({ success: true, data: challan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load scrap challan' });
  }
};

exports.createScrapChallan = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.createScrapChallan(client, {
      instanceIds: req.body.instance_ids || req.body.instanceIds || [],
      recipientVendorId: req.body.recipient_vendor_id || req.body.recipientVendorId,
      recipientName: req.body.recipient_name || req.body.recipientName,
      recipientAddress: req.body.recipient_address || req.body.recipientAddress,
      contactPerson: req.body.contact_person || req.body.contactPerson,
      contactMobile: req.body.contact_mobile || req.body.contactMobile,
      billingAddress: req.body.billing_address || req.body.billingAddress,
      remarks: req.body.remarks,
      itemRemarks: req.body.item_remarks || req.body.itemRemarks || {},
      ...actor(req),
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ success: false, message: err.message || 'Failed to create scrap challan' });
  } finally {
    client.release();
  }
};

exports.dispatchScrapChallan = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.dispatchScrapChallan(client, {
      challanNumber: challanParam(req),
      warehouseEsign: req.body.warehouse_esign || req.body.warehouseEsign,
      recipientEsign: req.body.recipient_esign || req.body.recipientEsign,
      dispatchBody: req.body,
      ...actor(req),
    });
    await client.query('COMMIT');
    res.json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ success: false, message: err.message || 'Failed to dispatch scrap challan' });
  } finally {
    client.release();
  }
};

exports.cancelDraftScrapChallan = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.cancelDraftScrapChallan(client, {
      challanNumber: challanParam(req),
      actorUserId: actor(req).actorUserId,
    });
    await client.query('COMMIT');
    res.json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ success: false, message: err.message || 'Failed to cancel scrap challan' });
  } finally {
    client.release();
  }
};

exports.downloadPdf = async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const challanNumber = challanParam(req);
    const { generateScrapChallanPdf } = require('../services/scrapChallanPdfService');
    const rel = await generateScrapChallanPdf(challanNumber);
    if (!rel) return res.status(404).json({ success: false, message: 'Scrap challan not found' });
    const abs = path.join(__dirname, '../uploads', rel);
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, message: 'PDF file missing' });
    const safe = String(challanNumber).replace(/[^\w-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="SCRAP_${safe}.pdf"`);
    res.download(abs, `SCRAP_${safe}.pdf`);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'PDF download failed' });
  }
};
