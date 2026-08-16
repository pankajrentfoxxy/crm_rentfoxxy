'use strict';

const router = require('express').Router();
const { supportPublicRateLimit } = require('../middleware/supportPublicRateLimit');
const ctrl = require('../controllers/supportV2PublicController');

router.use(supportPublicRateLimit({ windowMs: 10 * 60 * 1000, max: 20 }));
router.get('/csat/:token', ctrl.getCsat);
router.post('/csat/:token', ctrl.postCsat);

module.exports = router;
