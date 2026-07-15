const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');

const cp = checkSectionPermission;
const reportsView = cp('reports_access', 'view');

router.get('/technician-performance', authMiddleware, reportsView, reportsController.getTechnicianPerformance);
router.get('/revenue', authMiddleware, reportsView, reportsController.getRevenueReport);
router.get('/inventory-utilisation', authMiddleware, reportsView, reportsController.getInventoryUtilisationReport);
router.get('/lead-conversion', authMiddleware, reportsView, reportsController.getLeadConversionReport);
router.get('/salesperson', authMiddleware, reportsView, reportsController.getSalespersonReport);
router.get('/collections', authMiddleware, reportsView, reportsController.getCollectionsReport);
router.get('/vendor-spend', authMiddleware, reportsView, reportsController.getVendorSpendReport);
router.get('/laptop-report', authMiddleware, reportsView, reportsController.getLaptopReport);
router.get('/laptop-report/tickets', authMiddleware, reportsView, reportsController.getLaptopReportTickets);
router.get('/sales-order-report', authMiddleware, reportsView, reportsController.getSalesOrderReport);
router.get('/sales-order-report/drilldown', authMiddleware, reportsView, reportsController.getSalesOrderReportDrilldown);
router.post('/export', authMiddleware, cp('reports_export', 'create'), reportsController.exportToExcel);
router.get('/support-stats', authMiddleware, reportsView, reportsController.getSupportStats);

module.exports = router;
