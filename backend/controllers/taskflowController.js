const { buildSsoRedirectUrl, fetchPendingCount } = require('../services/taskflowSsoService');

exports.getSsoUrl = async (req, res) => {
  try {
    const url = await buildSsoRedirectUrl(req.user);
    res.json({ success: true, url });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Could not start TaskFlow SSO',
    });
  }
};

exports.getPendingCount = async (req, res) => {
  try {
    const result = await fetchPendingCount(req.user);
    res.json({ success: true, count: result.count, mapped: result.mapped });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Could not load TaskFlow count',
      count: 0,
    });
  }
};
