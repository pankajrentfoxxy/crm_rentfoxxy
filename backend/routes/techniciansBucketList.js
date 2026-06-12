const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { checkPermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/techniciansBucketController');

const router = express.Router();

// Access governed entirely by the role_permissions matrix.
router.use(authMiddleware);
router.use(checkPermission('technicians_bucket_list', 'view'));

router.get('/meta', ctrl.getMeta);
router.get('/details', ctrl.fetchDetails);

module.exports = router;
