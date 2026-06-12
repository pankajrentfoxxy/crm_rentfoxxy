const express = require('express');
const router = express.Router();
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');
const ctrl = require('../controllers/companyController');

const cp = checkSectionPermission;

router.use(authMiddleware);

router.get('/', cp('company_settings', 'view'), ctrl.listCompanies);
router.put('/:code', cp('company_settings', 'edit'), ctrl.updateCompany);

module.exports = router;
