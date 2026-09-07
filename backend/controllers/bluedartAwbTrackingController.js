const bluedartTracking = require('../services/bluedartTrackingService');
const portalSvc = require('../services/bluedartAwbTrackingPortalService');
const { syncUndeliveredAwbs } = require('../services/bluedartAwbSyncService');

exports.getStatus = async (req, res) => {
  try {
    res.json({
      success: true,
      configured: bluedartTracking.isConfigured(),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listRegistry = async (req, res) => {
  try {
    const result = await portalSvc.listRegisteredAwbs({
      search: req.query.search,
      page: Number(req.query.page) || 1,
      limit: Math.min(100, Number(req.query.limit) || 50),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.track = async (req, res) => {
  try {
    const raw = req.body?.awb_numbers ?? req.body?.awb_number ?? req.body?.awb ?? req.query.awb ?? req.query.awb_number;
    const trackings = await portalSvc.trackAwbs(raw);
    res.json({
      success: true,
      configured: bluedartTracking.isConfigured(),
      trackings,
      awb_numbers: trackings.map((t) => t.awb_number).filter(Boolean),
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.syncPending = async (req, res) => {
  try {
    if (!bluedartTracking.isConfigured()) {
      return res.status(503).json({ success: false, message: 'BlueDart tracking is not configured' });
    }
    const summary = await syncUndeliveredAwbs();
    res.json({ success: true, summary });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};
