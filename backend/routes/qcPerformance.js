const express = require('express');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/qcPerformanceController');

// QC inspector performance (migration 423): its own section, seeded to admin,
// manager and floor_manager. View = the dashboard; edit = set targets.
const router = express.Router();
router.use(authMiddleware);

router.get('/', checkSectionPermission('qc_performance', 'view'), ctrl.summary);
router.get('/targets', checkSectionPermission('qc_performance', 'view'), ctrl.getTargets);
router.put('/targets', checkSectionPermission('qc_performance', 'edit'), ctrl.saveTargets);
router.get('/inspector/:userId', checkSectionPermission('qc_performance', 'view'), ctrl.inspector);

module.exports = router;
