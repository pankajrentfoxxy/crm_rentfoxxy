const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { authMiddleware, checkSectionPermission } = require('../middleware/auth');

const cp = checkSectionPermission;
const reportsView = cp('reports_access', 'view');
/** Dedicated section; also allow legacy reports/QC viewers. */
const productionQcView = (req, res, next) => {
  const trySections = [
    'production_qc_report',
    'reports_access',
    'reports',
    'qc_management',
  ];
  const { hasPermission } = require('../services/permissionService');
  (async () => {
    try {
      const cache = {};
      for (const section of trySections) {
        // eslint-disable-next-line no-await-in-loop
        if (await hasPermission(req.user.user_id, req.user.role, section, 'can_view', cache)) {
          return next();
        }
      }
      return res.status(403).json({ success: false, message: 'Permission denied' });
    } catch (e) {
      return res.status(500).json({ success: false, message: e.message });
    }
  })();
};

router.get('/technician-performance', authMiddleware, reportsView, reportsController.getTechnicianPerformance);
router.get('/revenue', authMiddleware, reportsView, reportsController.getRevenueReport);
router.get('/inventory-utilisation', authMiddleware, reportsView, reportsController.getInventoryUtilisationReport);
router.get('/lead-conversion', authMiddleware, reportsView, reportsController.getLeadConversionReport);
router.get('/salesperson', authMiddleware, reportsView, reportsController.getSalespersonReport);
router.get('/collections', authMiddleware, reportsView, reportsController.getCollectionsReport);
router.get('/vendor-spend', authMiddleware, reportsView, reportsController.getVendorSpendReport);
router.get('/laptop-report', authMiddleware, reportsView, reportsController.getLaptopReport);
router.get('/laptop-report/tickets', authMiddleware, reportsView, reportsController.getLaptopReportTickets);
router.get('/warehouse-laptops/summary', authMiddleware, reportsView, require('../controllers/warehouseLaptopReportController').getWarehouseLaptopSummary);
router.get('/warehouse-laptops/list', authMiddleware, reportsView, require('../controllers/warehouseLaptopReportController').getWarehouseLaptopList);
router.get('/warehouse-laptops/filters', authMiddleware, reportsView, require('../controllers/warehouseLaptopReportController').getWarehouseLaptopFilters);
router.get('/production-qc', authMiddleware, productionQcView, reportsController.getProductionQcReport);
router.get('/production-qc/filters', authMiddleware, productionQcView, reportsController.getProductionQcReportFilters);
router.get('/production-qc/pdf', authMiddleware, productionQcView, reportsController.getProductionQcReportPdf);
router.get('/production-qc/:historyId/pdf', authMiddleware, productionQcView, reportsController.getProductionQcReportDetailPdf);
router.get('/production-qc/:historyId', authMiddleware, productionQcView, reportsController.getProductionQcReportDetail);
router.get('/sales-order-report', authMiddleware, reportsView, reportsController.getSalesOrderReport);
router.get('/sales-order-report/drilldown', authMiddleware, reportsView, reportsController.getSalesOrderReportDrilldown);
router.post('/export', authMiddleware, reportsView, reportsController.exportToExcel);
router.get('/support-stats', authMiddleware, reportsView, reportsController.getSupportStats);
router.get('/support-daily-summary', authMiddleware, reportsView, reportsController.getSupportDailySummary);
router.get('/support-daily-summary/filters', authMiddleware, reportsView, reportsController.getSupportSummaryFilters);
router.get('/inward-outward-summary', authMiddleware, reportsView, reportsController.getInwardOutwardSummary);
router.get('/inward-outward-summary/details', authMiddleware, reportsView, reportsController.getInwardOutwardDetails);
router.get('/inward-outward-summary/filters', authMiddleware, reportsView, reportsController.getInwardOutwardFilters);

module.exports = router;
