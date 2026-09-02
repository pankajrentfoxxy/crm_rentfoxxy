const { buildSsoRedirectUrl, fetchPendingCount, verifySsoTokenLocally } = require('../services/taskflowSsoService');

exports.getSsoUrl = async (req, res) => {
  try {
    const url = await buildSsoRedirectUrl(req.user);
    let ssoReady = true;
    let warning = null;
    const token = new URL(url).searchParams.get('token');
    if (token) {
      try {
        verifySsoTokenLocally(token);
      } catch (e) {
        ssoReady = false;
        warning = e.message;
      }
    }
    res.json({ success: true, url, sso_ready: ssoReady, warning });
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
