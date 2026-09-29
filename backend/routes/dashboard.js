const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');
const ctrl = require('../controllers/todayDashboardController');

// The Today dashboard (new UI /carret/home). Read-only; the per-block
// permission checks live in services/todayDashboardService.js.
router.use(authMiddleware);
router.get('/today', ctrl.today);

module.exports = router;
