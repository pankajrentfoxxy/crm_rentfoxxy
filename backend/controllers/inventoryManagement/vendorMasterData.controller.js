const {
  getOverview,
  listLaptops,
  getLaptopColumnValues,
  buildExportWorkbook,
} = require('../../services/masterVendorDataService');

exports.getOverview = async (req, res) => {
  try {
    const data = await getOverview(req.query || {});
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('vendorMasterData.getOverview:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to load vendor master data' });
  }
};

exports.listLaptops = async (req, res) => {
  try {
    const data = await listLaptops(req.query || {});
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('vendorMasterData.listLaptops:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to load vendor laptops' });
  }
};

exports.columnValues = async (req, res) => {
  try {
    const data = await getLaptopColumnValues(req.query || {});
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('vendorMasterData.columnValues:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to load column values' });
  }
};

exports.exportExcel = async (req, res) => {
  try {
    const { buf, filename } = await buildExportWorkbook(req.query || {});
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('vendorMasterData.exportExcel:', err);
    res.status(500).json({ success: false, message: err.message || 'Export failed' });
  }
};
