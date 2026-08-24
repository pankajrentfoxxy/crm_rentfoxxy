const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { authMiddleware, checkSectionPermission, checkAnySectionPermission } = require('../middleware/auth');

const cp = checkSectionPermission;
const any = checkAnySectionPermission;

const productionQcView = any(['production_qc_report', 'qc_management'], 'view');

const EXPORT_TYPE_SECTION = {
  revenue: 'report_revenue',
  inventory: 'report_inventory',
  lead_conversion: 'report_lead_conversion',
  salesperson: 'report_salesperson',
  collections: 'report_collections',
  vendor_spend: 'report_vendor_spend',
  laptop: 'report_laptop',
  warehouse_laptops: 'report_warehouse_laptops',
  sales_order: 'report_sales_order',
  support_daily: 'report_support_daily',
  inward_outward: 'report_inward_outward',
};

const exportView = (req, res, next) => {
  const reportType = req.body?.report_type;
  const section = EXPORT_TYPE_SECTION[reportType];
  const sections = ['reports_export'];
  if (section) sections.unshift(section);
  return any(sections, 'view')(req, res, next);
};

router.get('/technician-performance', authMiddleware, cp('report_laptop', 'view'), reportsController.getTechnicianPerformance);
router.get('/revenue', authMiddleware, cp('report_revenue', 'view'), reportsController.getRevenueReport);
router.get('/inventory-utilisation', authMiddleware, cp('report_inventory', 'view'), reportsController.getInventoryUtilisationReport);
router.get('/lead-conversion', authMiddleware, cp('report_lead_conversion', 'view'), reportsController.getLeadConversionReport);
router.get('/salesperson', authMiddleware, cp('report_salesperson', 'view'), reportsController.getSalespersonReport);
router.get('/collections', authMiddleware, cp('report_collections', 'view'), reportsController.getCollectionsReport);
router.get('/vendor-spend', authMiddleware, cp('report_vendor_spend', 'view'), reportsController.getVendorSpendReport);
router.get('/laptop-report', authMiddleware, cp('report_laptop', 'view'), reportsController.getLaptopReport);
router.get('/laptop-report/tickets', authMiddleware, cp('report_laptop', 'view'), reportsController.getLaptopReportTickets);
router.get('/warehouse-laptops/summary', authMiddleware, cp('report_warehouse_laptops', 'view'), require('../controllers/warehouseLaptopReportController').getWarehouseLaptopSummary);
router.get('/warehouse-laptops/list', authMiddleware, cp('report_warehouse_laptops', 'view'), require('../controllers/warehouseLaptopReportController').getWarehouseLaptopList);
router.get('/warehouse-laptops/filters', authMiddleware, cp('report_warehouse_laptops', 'view'), require('../controllers/warehouseLaptopReportController').getWarehouseLaptopFilters);
router.get('/production-qc', authMiddleware, productionQcView, reportsController.getProductionQcReport);
router.get('/production-qc/filters', authMiddleware, productionQcView, reportsController.getProductionQcReportFilters);
router.get('/production-qc/pdf', authMiddleware, productionQcView, reportsController.getProductionQcReportPdf);
router.get('/production-qc/:historyId/pdf', authMiddleware, productionQcView, reportsController.getProductionQcReportDetailPdf);
router.get('/production-qc/:historyId', authMiddleware, productionQcView, reportsController.getProductionQcReportDetail);
router.get('/sales-order-report', authMiddleware, cp('report_sales_order', 'view'), reportsController.getSalesOrderReport);
router.get('/sales-order-report/drilldown', authMiddleware, cp('report_sales_order', 'view'), reportsController.getSalesOrderReportDrilldown);
router.post('/export', authMiddleware, exportView, reportsController.exportToExcel);
router.get('/support-stats', authMiddleware, any(['report_support_daily', 'support_tickets'], 'view'), reportsController.getSupportStats);
router.get('/support-daily-summary', authMiddleware, cp('report_support_daily', 'view'), reportsController.getSupportDailySummary);
router.get('/support-daily-summary/filters', authMiddleware, cp('report_support_daily', 'view'), reportsController.getSupportSummaryFilters);
router.get('/inward-outward-summary', authMiddleware, cp('report_inward_outward', 'view'), reportsController.getInwardOutwardSummary);
router.get('/inward-outward-summary/details', authMiddleware, cp('report_inward_outward', 'view'), reportsController.getInwardOutwardDetails);
router.get('/inward-outward-summary/filters', authMiddleware, cp('report_inward_outward', 'view'), reportsController.getInwardOutwardFilters);

module.exports = router;
