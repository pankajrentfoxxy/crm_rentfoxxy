const svc = require('../services/warehouseLaptopReportService');

exports.getWarehouseLaptopSummary = async (req, res) => {
  try {
    const data = await svc.getWarehouseSummary(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('getWarehouseLaptopSummary error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load warehouse summary' });
  }
};

exports.getWarehouseLaptopList = async (req, res) => {
  try {
    const data = await svc.getWarehouseLaptopListing(req.query);
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('getWarehouseLaptopList error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load warehouse listing' });
  }
};

exports.getWarehouseLaptopFilters = async (req, res) => {
  try {
    const data = await svc.getWarehouseFilterOptions();
    res.json({ success: true, data });
  } catch (error) {
    console.error('getWarehouseLaptopFilters error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load warehouse filters' });
  }
};
