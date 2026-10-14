const express = require('express');
const pool = require('../config/db');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const tech = require('../services/technicianPerformanceService');
const qc = require('../services/qcPerformanceService');

/**
 * My performance (migration 427): the signed-in person's own numbers, from
 * the same services as Floor performance. Never takes a user id — nobody can
 * read anyone else's figures here.
 *
 * GET /api/my-performance?from&to → { technician?, qc? }
 *   technician — when they are a floor technician or have finished laptops
 *   qc         — when they are a QC inspector or have made QC checks
 */
const router = express.Router();
router.use(authMiddleware);

const TECH_ROLES = new Set(['team_member', 'team_lead', 'technician']);

router.get('/', checkSectionPermission('my_performance', 'view'), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const q = { userId, from: req.query.from, to: req.query.to };
    const [t, c] = await Promise.all([tech.technicianDetail(pool, q), qc.inspectorDetail(pool, q)]);
    const withStanding = (d) => ({
      ...d,
      standing: tech.standing(d.totals.correct, d.totals.target),
      eligible: d.totals.target > 0 && d.totals.correct >= d.totals.target,
    });
    const out = { period: t.period };
    if (TECH_ROLES.has(req.user.role) || t.totals.completed || t.totals.reworks) out.technician = withStanding(t);
    if (req.user.role === 'qc' || c.totals.checks) out.qc = withStanding(c);
    res.json({ success: true, data: out });
  } catch (e) {
    if (e instanceof tech.PerformanceError) return res.status(e.status).json({ success: false, message: e.message });
    console.error('myPerformance:', e);
    return res.status(500).json({ success: false, message: 'Could not load your performance' });
  }
});

module.exports = router;
