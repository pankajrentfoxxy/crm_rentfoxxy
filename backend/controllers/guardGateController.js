const gate = require('../services/guardGateValidationService');
const report = require('../services/guardGateReportService');

function reportDateArgs(query = {}) {
  const period = String(query.period || query.date || '').trim().toLowerCase();
  const dateFrom = query.date_from || query.dateFrom || '';
  const dateTo = query.date_to || query.dateTo || '';
  if (period === 'all') {
    return { period: 'all', dateFrom: '', dateTo: '' };
  }
  if (dateFrom || dateTo) {
    return { period: '', dateFrom, dateTo };
  }
  return { period: period || 'today', dateFrom: '', dateTo: '' };
}

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
    const dev = process.env.NODE_ENV !== 'production';
    return res.status(500).json({
      success: false,
      message: dev && err.message ? err.message : 'Unable to confirm gate movement.',
    });
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
      search: req.query?.q || req.query?.search || '',
      direction: req.query?.direction || '',
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
      search: req.query?.q || req.query?.search || '',
    });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('guardGate.history', err);
    return res.status(500).json({ success: false, message: 'Unable to load scan history.' });
  }
};

exports.report = async (req, res) => {
  try {
    const dates = reportDateArgs(req.query);
    const data = await report.getReport({
      userId: req.user?.user_id,
      role: req.user?.role,
      period: dates.period,
      dateFrom: dates.dateFrom,
      dateTo: dates.dateTo,
      search: req.query?.q || req.query?.search || '',
      direction: req.query?.direction || '',
      page: req.query?.page,
      limit: req.query?.limit,
      query: req.query,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('guardGate.report', err);
    return res.status(500).json({ success: false, message: 'Unable to load gate report.' });
  }
};

exports.reportColumnValues = async (req, res) => {
  try {
    const dates = reportDateArgs(req.query);
    const values = await report.getColumnValues({
      userId: req.user?.user_id,
      role: req.user?.role,
      period: dates.period,
      dateFrom: dates.dateFrom,
      dateTo: dates.dateTo,
      search: req.query?.q || req.query?.search || '',
      direction: req.query?.direction || '',
      column: req.query?.column || '',
      query: req.query,
    });
    return res.json({ success: true, data: values });
  } catch (err) {
    console.error('guardGate.reportColumnValues', err);
    return res.status(500).json({ success: false, message: 'Unable to load column values.' });
  }
};
