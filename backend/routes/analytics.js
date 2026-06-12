const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getTeamPerformance,
  getManagerDashboard,
  getSalesDashboard,
} = require('../controllers/analyticsController');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const cp = checkSectionPermission;

router.use(authMiddleware);

// @route   GET /api/analytics/dashboard
// @desc    Get dashboard statistics
// @access  Private
router.get('/dashboard', getDashboardStats);

// @route   GET /api/analytics/team-performance
// @desc    Get team performance metrics
// @access  Private
router.get('/team-performance', getTeamPerformance);

router.get('/manager-dashboard', cp('analytics_dashboard', 'view'), getManagerDashboard);
router.get('/sales-dashboard', cp('analytics_dashboard', 'view'), getSalesDashboard);

module.exports = router;
