const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getTeamPerformance,
  getManagerDashboard,
  getSalesDashboard,
} = require('../controllers/analyticsController');
const { authMiddleware, checkRole } = require('../middleware/auth');

router.use(authMiddleware);

// @route   GET /api/analytics/dashboard
// @desc    Get dashboard statistics
// @access  Private
router.get('/dashboard', getDashboardStats);

// @route   GET /api/analytics/team-performance
// @desc    Get team performance metrics
// @access  Private
router.get('/team-performance', getTeamPerformance);

router.get('/manager-dashboard', checkRole('admin', 'manager'), getManagerDashboard);
router.get('/sales-dashboard', checkRole('admin', 'manager', 'sales'), getSalesDashboard);

module.exports = router;
