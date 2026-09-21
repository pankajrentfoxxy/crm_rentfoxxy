const pool = require('../../config/db');
const {
  actorFromReq,
  requireWarehouseRole,
  listEligibleLaptops,
  listEligibleVendors,
  listReturnDcs,
  getReturnDc,
  createReturnDc,
  dispatchReturnDc,
  completeVendorReturn,
  cancelReturnDc,
} = require('../../services/vendorReturnToVendorService');

function handleError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ success: false, message: err.message });
}

exports.listEligibleVendors = async (req, res) => {
  try {
    const data = await listEligibleVendors();
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
};

exports.listEligible = async (req, res) => {
  try {
    const result = await listEligibleLaptops({
      vendorId: req.query.vendor_id,
      poId: req.query.po_id,
      search: req.query.search,
      inventoryStatus: req.query.inventory_status || req.query.status,
      page: Number(req.query.page) || 1,
      limit: Math.min(200, Number(req.query.limit) || 50),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
};

exports.listDcs = async (req, res) => {
  try {
    const result = await listReturnDcs({
      status: req.query.status,
      vendorId: req.query.vendor_id,
      page: Number(req.query.page) || 1,
      limit: Math.min(100, Number(req.query.limit) || 25),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
};

exports.getDc = async (req, res) => {
  try {
    const dc = await getReturnDc(req.params.dcNumber);
    if (!dc) return res.status(404).json({ success: false, message: 'Return DC not found' });
    res.json({ success: true, dc });
  } catch (err) {
    handleError(res, err);
  }
};

exports.createDc = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const body = req.body || {};
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const created = await createReturnDc(client, {
      serialIds: body.serial_ids || body.serialIds || [],
      vendorId: body.vendor_id || body.vendorId,
      poId: body.po_id || body.poId,
      returnReason: body.return_reason || body.returnReason,
      remarks: body.remarks,
      warehouseName: body.warehouse_name,
      warehouseAddress: body.warehouse_address,
      vendorName: body.vendor_name,
      vendorAddress: body.vendor_address,
      billingAddress: body.billing_address,
      shippingAddress: body.shipping_address,
      contactPerson: body.contact_person,
      contactMobile: body.contact_mobile,
      itemReturnReasons: body.item_return_reasons || body.itemReturnReasons || {},
      ...actor,
    });
    await client.query('COMMIT');
    const dc = created?.dc_number ? await getReturnDc(created.dc_number) : null;
    res.status(201).json({ success: true, dc });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.dispatchDc = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const dc = await dispatchReturnDc(client, {
      dcNumber: req.params.dcNumber,
      ...(req.body || {}),
      ...actor,
    });
    await client.query('COMMIT');
    res.json({ success: true, dc });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.completeDc = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const dc = await completeVendorReturn(client, {
      dcNumber: req.params.dcNumber,
      ...actor,
    });
    await client.query('COMMIT');
    res.json({ success: true, dc });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.downloadPdf = async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const dcNumber = req.params.dcNumber;
    const { generateVendorReturnDcPdf } = require('../../services/vendorReturnToVendorPdfService');
    const rel = await generateVendorReturnDcPdf(dcNumber);
    if (!rel) return res.status(404).json({ success: false, message: 'Return DC not found' });
    const abs = path.join(__dirname, '../../uploads', rel);
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, message: 'PDF file missing' });
    const safe = String(dcNumber).replace(/[^\w-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="VRTDC_${safe}.pdf"`);
    res.download(abs, `VRTDC_${safe}.pdf`);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'PDF download failed' });
  }
};

exports.cancelDc = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const dc = await cancelReturnDc(client, {
      dcNumber: req.params.dcNumber,
      ...actor,
    });
    await client.query('COMMIT');
    res.json({ success: true, dc });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

/* ── E-way Bill ──────────────────────────────────────────────────────────── */

const eway = require('../../services/vrtdcEwayComplianceService');

/** Compliance state for one VRTDC — drives the buttons and the gate warning. */
exports.getEwayCompliance = async (req, res) => {
  try {
    const dc = await getReturnDc(req.params.dcNumber);
    if (!dc) return res.status(404).json({ success: false, message: 'Return DC not found' });
    const compliance = await eway.buildVrtdcEwayCompliance(
      dc, dc.items, req.user, req.permissionCache
    );
    res.json({ success: true, compliance });
  } catch (err) {
    handleError(res, err);
  }
};

/** Warehouse asks Accounts for the E-way Bill once the transporter is known. */
exports.requestEwayBill = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const dc = await getReturnDc(dcNumber);
    if (!dc) return res.status(404).json({ success: false, message: 'Return DC not found' });

    const compliance = await eway.buildVrtdcEwayCompliance(dc, dc.items, req.user, req.permissionCache);
    if (!compliance.can_request_eway) {
      return res.status(403).json({ success: false, message: 'Not allowed to request an E-way Bill' });
    }
    if (!compliance.requires_eway_bill) {
      return res.status(400).json({
        success: false,
        message: `Declared value is ${compliance.product_value} — below the `
          + `${compliance.eway_threshold} threshold, so no E-way Bill is needed. `
          + 'Enter the declared values on the laptops if that looks wrong.',
      });
    }
    if (!dc.ship_by) {
      return res.status(400).json({
        success: false,
        message: 'Enter the delivery partner details before requesting the E-way Bill — '
          + 'Accounts needs the transporter and vehicle for the GST portal.',
      });
    }

    const result = await eway.sendAccountsVrtdcEwayEmail({
      dcNumber, head: dc, items: dc.items, actorUserId: req.user?.user_id || null,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
};

/** Accounts records the E-way Bill, which releases the consignment to the gate. */
exports.saveEwayBill = async (req, res) => {
  try {
    const dcNumber = req.params.dcNumber;
    const allowed = await eway.canUploadVrtdcEwayBill(req.user, req.permissionCache);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: 'Only the Accounts team can enter the E-way Bill',
      });
    }
    const file = req.file || (req.files?.eway_bill_pdf || [])[0] || null;
    const rel = file
      ? `vendor-return-eway/${String(dcNumber).replace(/[^\w-]+/g, '_')}/${file.filename}`
      : null;

    const saved = await eway.saveVrtdcEwayBill({
      dcNumber,
      ewayBillNumber: req.body.eway_bill_number,
      ewayBillDate: req.body.eway_bill_date,
      ewayBillPdfPath: rel,
      userId: req.user?.user_id || null,
    });
    res.json({ success: true, ...saved });
  } catch (err) {
    handleError(res, err);
  }
};

/** Multer for the E-way Bill document. Built here so the route file stays declarative. */
exports.createEwayUpload = () => {
  const multer = require('multer');
  const path = require('path');
  const fs = require('fs');
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const safeDc = String(req.params.dcNumber || 'dc').replace(/[^\w-]+/g, '_');
        const dir = path.join(__dirname, '../../uploads/vendor-return-eway', safeDc);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.pdf';
        cb(null, `eway_${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
      if (!ok) return cb(new Error('E-way Bill must be a PDF or an image'));
      cb(null, true);
    },
  });
};
