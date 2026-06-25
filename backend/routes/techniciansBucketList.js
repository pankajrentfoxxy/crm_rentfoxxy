const express = require('express');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/techniciansBucketController');

const router = express.Router();

router.use(authMiddleware);
router.use(checkSectionPermission('technicians_bucket_list', 'view'));

router.get('/meta', ctrl.getMeta);
router.get('/details', ctrl.fetchDetails);

module.exports = router;
