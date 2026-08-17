const svc = require('../constants/bluedartDeclaredValue');

exports.listBluedartDeclaredValues = async (req, res) => {
  try {
    const includeInactive = String(req.query.include_inactive || 'true') !== 'false';
    const rows = await svc.listDeclaredValueRows({ includeInactive });
    res.json({ success: true, items: rows });
  } catch (e) {
    console.error('listBluedartDeclaredValues', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load declared values' });
  }
};

/** Any authenticated user — used by AWB UI autofill. */
exports.getActiveBluedartDeclaredValueMatrix = async (req, res) => {
  try {
    const rows = await svc.loadActiveMatrix({ force: req.query.refresh === '1' });
    res.json({ success: true, items: rows });
  } catch (e) {
    console.error('getActiveBluedartDeclaredValueMatrix', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load matrix' });
  }
};

exports.createBluedartDeclaredValue = async (req, res) => {
  try {
    const row = await svc.createDeclaredValueRow(req.body || {});
    res.status(201).json({ success: true, item: row });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message || 'Create failed' });
  }
};

exports.updateBluedartDeclaredValue = async (req, res) => {
  try {
    const row = await svc.updateDeclaredValueRow(req.params.id, req.body || {});
    res.json({ success: true, item: row });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message || 'Update failed' });
  }
};

exports.deleteBluedartDeclaredValue = async (req, res) => {
  try {
    await svc.deleteDeclaredValueRow(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message || 'Delete failed' });
  }
};

exports.setBluedartDeclaredValueStatus = async (req, res) => {
  try {
    const active = req.body?.active !== false && req.body?.status !== 'inactive';
    const row = await svc.updateDeclaredValueRow(req.params.id, { active });
    res.json({ success: true, item: row });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message || 'Status update failed' });
  }
};
