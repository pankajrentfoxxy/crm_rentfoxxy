const { todayDashboard } = require('../services/todayDashboardService');

/**
 * GET /api/dashboard/today?date=YYYY-MM-DD — read-only. Each block is computed
 * only for sections the user may view (the service checks the matrix), so the
 * route itself needs only a signed-in, active user.
 */
exports.today = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin' && req.user?.status && req.user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Account is not active' });
    }
    const data = await todayDashboard(req, { date: String(req.query.date || '').trim() || null });
    return res.json({ success: true, ...data });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ success: false, message: e.message });
    console.error('today dashboard:', e);
    return res.status(500).json({ success: false, message: 'Could not load the dashboard' });
  }
};
