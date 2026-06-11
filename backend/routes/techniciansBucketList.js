const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { checkPermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/techniciansBucketController');

const router = express.Router();
const roles = ['admin', 'manager', 'sales', 'super_admin'];

router.use(authMiddleware);
router.use(checkRole(...roles));
router.use(checkPermission('technicians_bucket_list', 'view'));

router.get('/meta', ctrl.getMeta);
router.get('/details', ctrl.fetchDetails);

module.exports = router;
