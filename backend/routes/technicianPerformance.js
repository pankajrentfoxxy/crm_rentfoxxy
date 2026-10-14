const express = require('express');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/technicianPerformanceController');

// Technician performance (migration 415): managers / floor managers view,
// and set targets with edit. Its own section, seeded to named roles only.
const router = express.Router();
router.use(authMiddleware);

router.get('/', checkSectionPermission('technician_performance', 'view'), ctrl.summary);
router.get('/targets', checkSectionPermission('technician_performance', 'view'), ctrl.getTargets);
router.put('/targets', checkSectionPermission('technician_performance', 'edit'), ctrl.saveTargets);
router.get('/technician/:userId', checkSectionPermission('technician_performance', 'view'), ctrl.technician);

module.exports = router;
