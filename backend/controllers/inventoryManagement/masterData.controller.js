const { getMasterDashboard } = require('../../services/masterDataDashboardService');

exports.getMasterDataDashboard = async (req, res) => {
  try {
    const data = await getMasterDashboard(req.query || {});
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('getMasterDataDashboard:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to load master data' });
  }
};
