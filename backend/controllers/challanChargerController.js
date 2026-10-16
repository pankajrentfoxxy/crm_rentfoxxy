/** Charger with / without on laptop challans (migration 430). */
const pool = require('../config/db');
const svc = require('../services/challanChargerService');
const { inTransaction } = require('../utils/txHandler');
const { hasPermission } = require('../services/permissionService');

exports.get = async (req, res) => {
  try {
    const dc = String(req.query.dc || '').trim();
    if (!dc) return res.status(400).json({ success: false, message: 'Challan number required' });
    const data = await svc.getChallanChargers(pool, dc);
    if (!data) return res.status(404).json({ success: false, message: 'Not a laptop challan' });
    res.json({ success: true, ...data });
  } catch (e) {
    console.error('challan chargers:', e);
    res.status(500).json({ success: false, message: 'Could not load the chargers' });
  }
};

/** Refresh the challan's stored PDF so it shows the charger (best effort). */
async function refreshPdf(dcNumber) {
  try {
    const kind = await svc.challanKind(pool, dcNumber);
    if (kind === 'rdc') await require('../services/returnDcPdfService').regenerateReturnDcPdfByRdc(pool, dcNumber);
    else if (kind === 'dc' || kind === 'sdc') await require('./salesManagementController').regenerateDcPdfForNumber(dcNumber);
    else if (kind === 'vrdc') {
      const rel = await require('../services/vendorRepairPdfService').generateVendorRepairPdf(dcNumber);
      if (rel) await pool.query('UPDATE vendor_repair_delivery_challans SET pdf_path = $2, updated_at = NOW() WHERE dc_number = $1', [dcNumber, rel]);
    }
  } catch (e) {
    console.error('challan charger pdf refresh:', e.message);
  }
}
exports.refreshPdf = refreshPdf;

exports.mark = async (req, res) => {
  await markTx(req, res);
  if (res.statusCode < 400) refreshPdf(String(req.body?.dc_number || '').trim());
};

// Who may set it, per challan (the matrix grants are broad, so not one shared list).
const EDIT_SECTIONS = {
  dc: ['delivery_challans', 'sales_orders'],
  sdc: ['delivery_challans', 'support_tickets'],
  vrdc: ['vendor_repair_dc'],
  rdc: ['support_tickets', 'return_dc', 'delivery_challans'],
};

const markTx = (req, res) => inTransaction(res, async (db, out) => {
  const b = req.body || {};
  // The warehouse check is made only by receiving the Return DC.
  if (b.stage === 'warehouse') return out.status(400).json({ success: false, message: 'Record the charger in "Receive at warehouse".' });
  const kind = await svc.challanKind(db, String(b.dc_number || '').trim());
  if (!kind) return out.status(404).json({ success: false, message: 'Not a laptop challan' });
  let allowed = false;
  for (const sec of EDIT_SECTIONS[kind]) {
    if (await hasPermission(req.user.user_id, req.user.role, sec, 'edit', req.permissionCache)) { allowed = true; break; }
  }
  if (!allowed) return out.status(403).json({ success: false, message: 'You cannot change the charger on this challan.' });
  try {
    const r = await svc.setMark(db, {
      dcNumber: String(b.dc_number || '').trim(),
      assetCode: b.asset_code,
      stage: b.stage,
      charger: b.charger,
      adapterScan: b.adapter_scan,
      cableScan: b.cable_scan,
      note: b.note,
      user: req.user,
      source: b.source || 'manual',
    });
    out.json({ success: true, ...r });
  } catch (e) {
    if (e.status) return out.status(e.status).json({ success: false, message: e.message });
    throw e;
  }
});
