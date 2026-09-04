const { body, param, validationResult } = require('express-validator');
const {
  getMasterDashboard,
  getMasterDashboardTab,
  getKpis,
  getLaptopColumnValues,
  buildMasterDataExportWorkbook,
  setVendorExcludeFromVendorPo,
} = require('../../services/masterDataDashboardService');

exports.getMasterDataKpis = async (req, res) => {
  try {
    const kpis = await getKpis(req.query || {});
    res.json({ success: true, kpis });
  } catch (err) {
    console.error('getMasterDataKpis:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to load master data KPIs' });
  }
};

exports.getMasterDataDashboard = async (req, res) => {
  try {
    const includeKpis = String(req.query.include_kpis || req.query.includeKpis || '').toLowerCase();
    if (includeKpis === '1' || includeKpis === 'true') {
      const data = await getMasterDashboard(req.query || {});
      return res.json({ success: true, ...data });
    }
    const data = await getMasterDashboardTab(req.query || {});
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('getMasterDataDashboard:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to load master data' });
  }
};

exports.getLaptopColumnValues = async (req, res) => {
  try {
    const data = await getLaptopColumnValues(req.query || {});
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('getMasterDataColumnValues:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to load column values' });
  }
};

exports.setVendorExcludeValidators = [
  param('vendorId').isInt({ min: 1 }).toInt(),
  body('exclude_from_vendor_po').isBoolean().toBoolean(),
];

exports.setVendorExcludeFromVendorPo = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Invalid request', errors: errors.array() });
  }
  try {
    const vendor = await setVendorExcludeFromVendorPo(
      req.params.vendorId,
      req.body.exclude_from_vendor_po
    );
    res.json({ success: true, vendor });
  } catch (err) {
    console.error('setVendorExcludeFromVendorPo:', err);
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update vendor PO exclusion',
    });
  }
};

exports.exportMasterDataExcel = async (req, res) => {
  try {
    const { buf, filename } = await buildMasterDataExportWorkbook(req.query || {});
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('exportMasterDataExcel:', err);
    res.status(500).json({ success: false, message: err.message || 'Export failed' });
  }
};
