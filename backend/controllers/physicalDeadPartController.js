const pool = require('../config/db');
const svc = require('../services/physicalDeadPartService');

function handleError(res, err) {
  const status = err.status || (String(err.message || '').includes('required') ? 400 : 500);
  if (status >= 500) console.error('physicalDeadParts:', err);
  return res.status(status).json({ success: false, message: err.message || 'Request failed' });
}

function actor(req) {
  return svc.actorFrom(req.user);
}

exports.getCounts = async (_req, res) => {
  try {
    const counts = await svc.getCounts();
    res.json({ success: true, counts });
  } catch (err) {
    handleError(res, err);
  }
};

exports.listParts = async (req, res) => {
  try {
    const data = await svc.listParts({
      status: req.query.status,
      search: req.query.search,
      warehouse: req.query.warehouse,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
};

exports.getPart = async (req, res) => {
  try {
    const part = await svc.getPart(req.params.dpNumber);
    if (!part) return res.status(404).json({ success: false, message: 'Physical part not found' });
    res.json({ success: true, part });
  } catch (err) {
    handleError(res, err);
  }
};

exports.listInwards = async (req, res) => {
  try {
    const data = await svc.listInwards({
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
};

exports.getInward = async (req, res) => {
  try {
    const number = req.params.dcNumber || req.params.inwardNumber;
    const data = await svc.getInward(number);
    if (!data) return res.status(404).json({ success: false, message: 'Inward not found' });
    res.json({ success: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
};

exports.createInward = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.createInward(client, {
      warehouse: req.body?.warehouse,
      inwardDate: req.body?.inward_date,
      inwardReason: req.body?.inward_reason,
      remarks: req.body?.remarks,
      units: req.body?.units,
      actor: actor(req),
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.listOutwards = async (req, res) => {
  try {
    const data = await svc.listOutwards({
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
};

exports.getOutward = async (req, res) => {
  try {
    const number = req.params.dcNumber || req.params.outwardNumber;
    const data = await svc.getOutward(number);
    if (!data) return res.status(404).json({ success: false, message: 'Outward not found' });
    res.json({ success: true, ...data });
  } catch (err) {
    handleError(res, err);
  }
};

exports.createOutward = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await svc.createOutward(client, {
      partIds: req.body?.part_ids,
      receiverType: req.body?.receiver_type,
      receiverName: req.body?.receiver_name,
      receiverContact: req.body?.receiver_contact,
      outwardDate: req.body?.outward_date,
      purpose: req.body?.purpose,
      photoPath: req.body?.photo_path,
      photoPaths: req.body?.photo_paths,
      remarks: req.body?.remarks,
      referenceNumber: req.body?.reference_number,
      actor: actor(req),
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.dispatchOutward = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const number = req.params.dcNumber || req.params.outwardNumber;
    const result = await svc.dispatchOutward(client, {
      outwardNumber: number,
      warehouseEsign: req.body?.warehouse_esign || req.body?.warehouseEsign,
      recipientEsign: req.body?.recipient_esign || req.body?.recipientEsign,
      dispatchBody: req.body,
      actor: actor(req),
    });
    await client.query('COMMIT');
    try {
      const { generatePhysicalOutwardPdf } = require('../services/physicalDeadPartPdfService');
      await generatePhysicalOutwardPdf(number);
    } catch (pdfErr) {
      console.warn('physicalDeadParts PDF skipped:', pdfErr.message);
    }
    const data = await svc.getOutward(number);
    res.json({ success: true, ...result, ...data });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.cancelDraftOutward = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const number = req.params.dcNumber || req.params.outwardNumber;
    const result = await svc.cancelDraftOutward(client, { outwardNumber: number });
    await client.query('COMMIT');
    res.json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.downloadPdf = async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const number = req.params.dcNumber || req.params.outwardNumber;
    const { generatePhysicalOutwardPdf } = require('../services/physicalDeadPartPdfService');
    const rel = await generatePhysicalOutwardPdf(number);
    if (!rel) return res.status(404).json({ success: false, message: 'Outward not found' });
    const abs = path.join(__dirname, '../uploads', rel);
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, message: 'PDF file missing' });
    const safe = String(number).replace(/[^\w-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="POUT_${safe}.pdf"`);
    res.download(abs, `POUT_${safe}.pdf`);
  } catch (err) {
    handleError(res, err);
  }
};

exports.uploadPhotos = async (req, res) => {
  try {
    const files = req.files || (req.file ? [req.file] : []);
    if (!files.length) {
      return res.status(400).json({ success: false, message: 'Photo is required' });
    }
    const paths = files.map((f) => `physical-parts/${f.filename}`);
    res.json({ success: true, paths, path: paths[0] });
  } catch (err) {
    handleError(res, err);
  }
};
