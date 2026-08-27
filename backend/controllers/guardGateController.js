const gate = require('../services/guardGateValidationService');

function actorFromReq(req) {
  return {
    user_id: req.user?.user_id,
    name: req.user?.name,
    email: req.user?.email,
    role: req.user?.role,
  };
}

exports.resolve = async (req, res) => {
  try {
    const direction = String(req.body?.direction || req.query?.direction || '').toLowerCase() || null;
    const scan = req.body?.scan || req.body?.code || req.query?.scan || '';
    const result = await gate.resolveScan({
      direction,
      scan,
      user: actorFromReq(req),
    });
    const status = result.ok === false ? 400 : 200;
    return res.status(status).json({ success: result.ok !== false, ...result });
  } catch (err) {
    console.error('guardGate.resolve', err);
    return res.status(500).json({ success: false, message: 'Unable to resolve gate movement.' });
  }
};

exports.scanUnit = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const scan = req.body?.scan || req.body?.code || '';
    const result = await gate.scanUnit({
      sessionId,
      scan,
      user: actorFromReq(req),
    });
    const status = result.ok === false ? 400 : 200;
    return res.status(status).json({ success: result.ok !== false, ...result });
  } catch (err) {
    console.error('guardGate.scanUnit', err);
    return res.status(500).json({ success: false, message: 'Unable to validate laptop.' });
  }
};

exports.confirm = async (req, res) => {
  try {
    const result = await gate.confirmSession({
      sessionId: req.params.sessionId,
      remarks: req.body?.remarks || null,
      user: actorFromReq(req),
    });
    const status = result.ok ? 200 : 400;
    return res.status(status).json({ success: Boolean(result.ok), ...result });
  } catch (err) {
    console.error('guardGate.confirm', err);
    return res.status(500).json({ success: false, message: 'Unable to confirm gate movement.' });
  }
};

exports.getSession = async (req, res) => {
  try {
    const view = await gate.getSession(req.params.sessionId);
    if (!view) return res.status(404).json({ success: false, message: 'Session not found.' });
    return res.json({ success: true, ...view });
  } catch (err) {
    console.error('guardGate.getSession', err);
    return res.status(500).json({ success: false, message: 'Unable to load session.' });
  }
};

exports.dashboard = async (req, res) => {
  try {
    const data = await gate.getDashboard({
      userId: req.user?.user_id,
      role: req.user?.role,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('guardGate.dashboard', err);
    return res.status(500).json({ success: false, message: 'Unable to load gate dashboard.' });
  }
};

exports.history = async (req, res) => {
  try {
    const rows = await gate.getHistory({
      userId: req.user?.user_id,
      role: req.user?.role,
      limit: req.query?.limit,
    });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('guardGate.history', err);
    return res.status(500).json({ success: false, message: 'Unable to load scan history.' });
  }
};
