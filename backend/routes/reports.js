const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { authMiddleware, checkRole, checkRoleOrPermission } = require('../middleware/auth');

router.get(
    '/technician-performance',
    authMiddleware,
    checkRoleOrPermission(['admin', 'manager', 'floor_manager'], ['reports_access']),
    reportsController.getTechnicianPerformance
);

router.get(
    '/revenue',
    authMiddleware,
    checkRole('admin', 'manager', 'accounts'),
    reportsController.getRevenueReport
);

router.get(
    '/inventory-utilisation',
    authMiddleware,
    checkRoleOrPermission(['admin', 'manager', 'floor_manager'], ['reports_access']),
    reportsController.getInventoryUtilisationReport
);

router.get(
    '/lead-conversion',
    authMiddleware,
    checkRole('admin', 'manager'),
    reportsController.getLeadConversionReport
);

router.get(
    '/salesperson',
    authMiddleware,
    checkRole('admin', 'manager', 'sales'),
    reportsController.getSalespersonReport
);

router.get(
    '/collections',
    authMiddleware,
    checkRole('admin', 'manager', 'accounts'),
    reportsController.getCollectionsReport
);

router.get(
    '/vendor-spend',
    authMiddleware,
    checkRole('admin', 'manager', 'accounts'),
    reportsController.getVendorSpendReport
);

router.post(
    '/export',
    authMiddleware,
    checkRole('admin', 'manager', 'accounts'),
    reportsController.exportToExcel
);

module.exports = router;
