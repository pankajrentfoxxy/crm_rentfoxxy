const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/bluedartAwbTrackingController');

const cp = checkSectionPermission;
const view = cp('bluedart_awb_tracking', 'view');
const edit = cp('bluedart_awb_tracking', 'edit');

router.use(authMiddleware);

router.get('/status', view, ctrl.getStatus);
router.get('/registry', view, ctrl.listRegistry);
router.get('/track', view, ctrl.track);
router.post('/track', view, ctrl.track);
router.post('/sync-pending', edit, ctrl.syncPending);

module.exports = router;
