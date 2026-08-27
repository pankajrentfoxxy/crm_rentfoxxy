const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/guardGateController');

const view = checkSectionPermission('guard_gate_checking', 'view');
const create = checkSectionPermission('guard_gate_checking', 'create');

router.use(authMiddleware);

router.get('/dashboard', view, ctrl.dashboard);
router.get('/history', view, ctrl.history);
router.post('/resolve', create, ctrl.resolve);
router.get('/sessions/:sessionId', view, ctrl.getSession);
router.post('/sessions/:sessionId/scan', create, ctrl.scanUnit);
router.post('/sessions/:sessionId/confirm', create, ctrl.confirm);

module.exports = router;
