const router = require('express').Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/taskflowController');

const canView = checkSectionPermission('taskflow', 'view');

router.get('/sso-url', authMiddleware, canView, ctrl.getSsoUrl);
router.get('/pending-count', authMiddleware, canView, ctrl.getPendingCount);

module.exports = router;
