const {
  getMasterDashboard,
  getMasterDashboardTab,
  getKpis,
  buildMasterDataExportWorkbook,
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
