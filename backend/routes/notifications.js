const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const ctrl = require('../controllers/notificationsController');

const router = express.Router();

router.use(authMiddleware);
router.get('/', ctrl.listNotifications);
router.post('/read-all', ctrl.markAllRead);
router.post('/:id/read', ctrl.markRead);

module.exports = router;
