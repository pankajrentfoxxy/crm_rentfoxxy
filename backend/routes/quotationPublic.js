const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');

router.get('/accept/:token', leadController.getQuotationAcceptPreview);
router.post('/accept/:token', leadController.acceptLeadQuotation);

module.exports = router;
