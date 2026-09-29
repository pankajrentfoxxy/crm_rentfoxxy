/**
 * Which report grant lets a user download a report's Excel (POST /api/reports/export).
 *
 * A user may export a report they may view: the report's own section, or the
 * umbrella `reports_export`. The map is keyed by the `report_type` the exporter
 * (reportsController.exportToExcel) actually handles — before 29 Sep 2026 it
 * used `laptop` / `sales_order` while the exporter reads `technician_performance`
 * / `sales_order_report` / `sales_order_config`, so a user holding only
 * report_sales_order could see the Sales Order report but got 403 on its Excel.
 * Nothing is widened: each type maps to the section its own GET already needs.
 */
const EXPORT_TYPE_SECTION = {
  revenue: 'report_revenue',
  inventory: 'report_inventory',
  lead_conversion: 'report_lead_conversion',
  salesperson: 'report_salesperson',
  collections: 'report_collections',
  vendor_spend: 'report_vendor_spend',
  // GET /reports/technician-performance is guarded by report_laptop.
  technician_performance: 'report_laptop',
  laptop: 'report_laptop',
  warehouse_laptops: 'report_warehouse_laptops',
  // GET /reports/sales-order-report is guarded by report_sales_order.
  sales_order_report: 'report_sales_order',
  sales_order_config: 'report_sales_order',
  sales_order: 'report_sales_order',
  support_daily: 'report_support_daily',
  inward_outward: 'report_inward_outward',
};

/** Sections any one of which allows exporting `reportType` (view action). */
function sectionsForExport(reportType) {
  const own = Object.prototype.hasOwnProperty.call(EXPORT_TYPE_SECTION, reportType)
    ? EXPORT_TYPE_SECTION[reportType]
    : null;
  return own ? [own, 'reports_export'] : ['reports_export'];
}

module.exports = { EXPORT_TYPE_SECTION, sectionsForExport };
