# RENTFOXXY CRM — PHASE 7 BUILD PROMPT
## Reporting & Analytics — Complete Implementation
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- Extend existing code only. DO NOT rewrite working endpoints.
- Existing reporting:
  - GET /api/analytics/dashboard → analyticsController.getDashboardStats (floor only)
  - GET /api/analytics/team-performance → analyticsController.getTeamPerformance
  - GET /api/reports/technician-performance → reportsController.getTechnicianPerformance (keep as-is)
  - GET /api/leads/reports → leadController.getReports
  - GET /api/finance-overview/dashboard → financeOverviewController (already built Phase 5)
  - recharts already installed in frontend
- All new report endpoints go under /api/reports/ (extend existing route file)
- New analytics endpoints go under /api/analytics/ (extend existing)
- Feature folder: frontend/src/features/reporting/
- Export to Excel: install xlsx if not present: cd backend && npm install xlsx
- Permission sections: reports_access already exists. Add: analytics_dashboard, reports_export
- Design: same as all phases

---

## SECTION 1 — INSTALL

  cd backend && npm install xlsx

---

## SECTION 2 — MIGRATION 070_phase7_reporting.sql

  INSERT INTO permission_sections (section, description, sort_order)
  VALUES
    ('analytics_dashboard', 'Analytics & KPI Dashboard', 400),
    ('reports_export',      'Export Reports to Excel',   401)
  ON CONFLICT (section) DO UPDATE SET description=EXCLUDED.description, sort_order=EXCLUDED.sort_order;

  INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
  VALUES
    ('admin',   'analytics_dashboard', TRUE,FALSE,FALSE,FALSE),
    ('manager', 'analytics_dashboard', TRUE,FALSE,FALSE,FALSE),
    ('admin',   'reports_export',      TRUE,TRUE,FALSE,FALSE),
    ('manager', 'reports_export',      TRUE,TRUE,FALSE,FALSE),
    ('accounts','reports_export',      TRUE,TRUE,FALSE,FALSE)
  ON CONFLICT (role, section) DO NOTHING;

---

## SECTION 3 — BACKEND: NEW ANALYTICS ENDPOINTS

### 3.1 Add to backend/controllers/analyticsController.js

exports.getManagerDashboard — GET /api/analytics/manager-dashboard
Roles: admin, manager

Returns:
{
  revenue: {
    current_month: { invoiced, collected, outstanding },
    last_month:    { invoiced, collected, outstanding },
    last_6_months: [{ month, year, invoiced, collected }]
  },
  inventory: {
    total, qc_passed_available, currently_rented, sold, in_qc, in_repair, qc_failed, utilisation_pct
  },
  leads: {
    total_active, by_status:[{status,count}], converted_this_month, follow_up_overdue
  },
  floor: {
    active_tickets, highlighted, avg_completion_hours, by_stage:[{stage_name,count}]
  },
  support: { open, in_progress, closed_this_month },
  vendor:  { total_active_vendors, pending_bills, pending_bills_amount }
}

SQL patterns:
  revenue.current_month:
    SELECT COALESCE(SUM(grand_total),0) AS invoiced,
           COALESCE(SUM(grand_total) FILTER (WHERE status='paid'),0) AS collected
    FROM customer_invoices
    WHERE invoice_month=EXTRACT(MONTH FROM NOW()) AND invoice_year=EXTRACT(YEAR FROM NOW())

  revenue.last_6_months:
    SELECT invoice_month, invoice_year,
           SUM(grand_total) AS invoiced,
           SUM(grand_total) FILTER (WHERE status='paid') AS collected
    FROM customer_invoices
    WHERE (invoice_year*12+invoice_month) >=
          (EXTRACT(YEAR FROM NOW())::int*12+EXTRACT(MONTH FROM NOW())::int-6)
    GROUP BY invoice_month,invoice_year ORDER BY invoice_year,invoice_month

  inventory:
    SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE qc_status='qc_passed' AND inventory_status='in_stock') AS qc_passed_available,
      COUNT(*) FILTER (WHERE inventory_status='out_stock') AS currently_rented,
      COUNT(*) FILTER (WHERE inventory_status='sold') AS sold,
      COUNT(*) FILTER (WHERE qc_status IN ('qc1','qc2','in_qc')) AS in_qc,
      COUNT(*) FILTER (WHERE qc_status='qc_failed_return_vendor') AS qc_failed
    FROM vendor_serial_numbers WHERE deleted_at IS NULL

  leads by_status:
    SELECT status,COUNT(*) AS count FROM leads
    WHERE status NOT IN ('Gone','Rejected') GROUP BY status

  support: SELECT status,COUNT(*) FROM support_tickets GROUP BY status
  vendor: COUNT from vendor_purchase_orders + SUM from vendor_monthly_bills


exports.getSalesDashboard — GET /api/analytics/sales-dashboard
Roles: admin, manager, sales

For sales role: WHERE assigned_user_id = req.user.user_id
For manager/admin: no filter

Returns:
{
  my_leads: { total, by_status:[{status,count}], follow_up_today, follow_up_overdue },
  quotations: { sent_this_month, approved_this_month, hit_rate_pct },
  conversions: { this_month, last_month },
  monthly_target: null
}

---

## SECTION 4 — BACKEND: NEW REPORT ENDPOINTS

### 4.1 Add to backend/controllers/reportsController.js

Keep existing getTechnicianPerformance. Add:

exports.getRevenueReport — GET /api/reports/revenue
Params: from, to, customer_id?, type? (rental|sale)
Roles: admin, manager, accounts

Returns:
{
  invoices: [{ invoice_number, customer_name, invoice_month, invoice_year,
               subtotal, gst_amount, credit_note_adjustment, grand_total,
               status, invoice_date }],
  totals: { invoiced, collected, outstanding, credit_notes_applied },
  pagination: { page, limit, total, total_pages }
}

SQL:
  SELECT ci.*, c.company_name AS customer_name, c.name AS contact_name
  FROM customer_invoices ci
  LEFT JOIN customers c ON c.customer_id=ci.customer_id
  WHERE ci.invoice_date BETWEEN $from AND $to
  [AND ci.customer_id=$customer_id] [AND quotation_type=$type filtered from DC join]
  ORDER BY ci.invoice_date DESC LIMIT $limit OFFSET $offset


exports.getInventoryUtilisationReport — GET /api/reports/inventory-utilisation
Params: from, to
Roles: admin, manager

Returns:
{
  summary: { total_fleet, avg_utilised_pct },
  by_brand: [{ brand, total, rented, available, in_repair }],
  top_customers: [{ customer_name, laptop_count, monthly_value }]
}

SQL for by_brand:
  SELECT brand,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE inventory_status='out_stock') AS rented,
    COUNT(*) FILTER (WHERE qc_status='qc_passed' AND inventory_status='in_stock') AS available
  FROM vendor_serial_numbers WHERE deleted_at IS NULL
  GROUP BY brand ORDER BY total DESC

SQL for top_customers:
  SELECT c.company_name AS customer_name,
    COUNT(DISTINCT dcl.serial_number) AS laptop_count,
    SUM(sol.rate) AS monthly_value
  FROM delivery_challan_lines dcl
  JOIN customers c ON c.customer_id=dcl.customer_id
  LEFT JOIN sales_order_lines sol ON sol.sales_order_number=dcl.sales_order_number AND sol.brand=dcl.brand
  WHERE dcl.status='delivered'
  GROUP BY c.customer_id, c.company_name
  ORDER BY laptop_count DESC LIMIT 10


exports.getLeadConversionReport — GET /api/reports/lead-conversion
Params: from, to, assigned_to?
Roles: admin, manager

Returns:
{
  funnel: [{ status, count, pct_of_total }],
  by_salesperson: [{ user_name, total_leads, converted, lost,
                     conversion_rate_pct, avg_days_to_convert }],
  avg_days_per_stage: [{ status, avg_days }],
  sources: [{ source, count, converted, conversion_rate_pct }]
}

SQL for by_salesperson:
  SELECT u.name AS user_name,
    COUNT(l.lead_id) AS total_leads,
    COUNT(l.lead_id) FILTER (WHERE l.status IN ('Deal','Demo')) AS converted,
    COUNT(l.lead_id) FILTER (WHERE l.status IN ('Gone','Rejected')) AS lost,
    ROUND(AVG(EXTRACT(EPOCH FROM (l.converted_at-l.created_at))/86400)
      FILTER (WHERE l.converted_at IS NOT NULL)::numeric, 1) AS avg_days_to_convert
  FROM leads l
  LEFT JOIN users u ON u.user_id=l.assigned_user_id
  WHERE l.created_at BETWEEN $from AND $to
  GROUP BY u.user_id, u.name ORDER BY converted DESC


exports.getSalespersonReport — GET /api/reports/salesperson
Params: from, to, user_id?
Roles: admin, manager (all), sales (own only via WHERE assigned_user_id=req.user.user_id)

Returns:
{
  salespeople: [{
    user_id, name, role,
    leads: { total, active, converted, lost },
    quotations: { sent, approved, rejected, hit_rate_pct },
    follow_ups: { scheduled, overdue }
  }]
}


exports.getCollectionsReport — GET /api/reports/collections
Params: month, year, customer_id?
Roles: admin, manager, accounts

Returns:
{
  summary: { total_invoiced, total_collected, outstanding, overdue },
  by_customer: [{ customer_name, invoiced, collected, outstanding,
                  oldest_unpaid_date, status }],
  monthly_trend: [{ month, year, invoiced, collected }]
}

SQL for by_customer:
  SELECT c.company_name AS customer_name,
    COALESCE(SUM(ci.grand_total),0) AS invoiced,
    COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status='paid'),0) AS collected,
    COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status NOT IN ('paid','cancelled')),0) AS outstanding,
    MIN(ci.invoice_date) FILTER (WHERE ci.status NOT IN ('paid','cancelled')) AS oldest_unpaid_date
  FROM customer_invoices ci
  JOIN customers c ON c.customer_id=ci.customer_id
  WHERE ci.invoice_year=$year [AND ci.invoice_month=$month if provided]
  GROUP BY c.customer_id, c.company_name
  ORDER BY outstanding DESC


exports.getVendorSpendReport — GET /api/reports/vendor-spend
Params: from, to, vendor_id?
Roles: admin, manager, accounts

Returns:
{
  vendors: [{ vendor_name, po_type, total_bills, total_payable,
              total_paid, debit_adjustments, net_payable }],
  monthly_trend: [{ month, year, total_payable }],
  debit_notes_total: N
}

SQL for vendors:
  SELECT v.business_name AS vendor_name,
    vpo.po_type,
    COUNT(vmb.bill_id) AS total_bills,
    COALESCE(SUM(vmb.total_payable),0) AS total_payable,
    COALESCE(SUM(vmb.total_payable) FILTER (WHERE vmb.status='paid'),0) AS total_paid,
    COALESCE(SUM(vmb.debit_note_adjustment),0) AS debit_adjustments
  FROM vendor_monthly_bills vmb
  JOIN vendors v ON v.vendor_id=vmb.vendor_id
  LEFT JOIN vendor_purchase_orders vpo ON vpo.vendor_id=vmb.vendor_id
  WHERE vmb.bill_date BETWEEN $from AND $to
  GROUP BY v.vendor_id, v.business_name, vpo.po_type
  ORDER BY total_payable DESC


exports.exportToExcel — POST /api/reports/export
Body: { report_type, filters }
Roles: admin, manager, accounts

report_type values: revenue | inventory | lead_conversion | salesperson |
                    collections | vendor_spend | technician_performance

Implementation:
  const XLSX = require('xlsx');
  1. Call matching data-fetch function with filters
  2. ws = XLSX.utils.json_to_sheet(rows)
  3. wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName)
  4. Set col widths: ws['!cols'] = columns.map(h=>({wch:Math.max(h.length,15)}))
  5. buf = XLSX.write(wb, {type:'buffer', bookType:'xlsx'})
  6. res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  7. res.setHeader('Content-Disposition', `attachment; filename="${report_type}_${date}.xlsx"`)
  8. res.send(buf)


### 4.2 Extend backend/routes/reports.js

  const analytics = require('../controllers/analyticsController');

  // Analytics
  router.get('/manager-dashboard', authMiddleware, checkRole('admin','manager'), analytics.getManagerDashboard);
  router.get('/sales-dashboard', authMiddleware, checkRole('admin','manager','sales'), analytics.getSalesDashboard);

  // Reports
  router.get('/revenue', authMiddleware, checkRole('admin','manager','accounts'), ctrl.getRevenueReport);
  router.get('/inventory-utilisation', authMiddleware, checkRole('admin','manager'), ctrl.getInventoryUtilisationReport);
  router.get('/lead-conversion', authMiddleware, checkRole('admin','manager'), ctrl.getLeadConversionReport);
  router.get('/salesperson', authMiddleware, checkRole('admin','manager','sales'), ctrl.getSalespersonReport);
  router.get('/collections', authMiddleware, checkRole('admin','manager','accounts'), ctrl.getCollectionsReport);
  router.get('/vendor-spend', authMiddleware, checkRole('admin','manager','accounts'), ctrl.getVendorSpendReport);
  router.post('/export', authMiddleware, checkRole('admin','manager','accounts'), ctrl.exportToExcel);

---

## SECTION 5 — FRONTEND: REPORTING FEATURE

### 5.1 Folder structure: frontend/src/features/reporting/

  reporting/
    ReportingApp.jsx
    reportingApi.js
    reportingUtils.js
    pages/
      ManagerDashboardPage.jsx
      SalesDashboardPage.jsx
      RevenueReportPage.jsx
      InventoryReportPage.jsx
      LeadConversionReportPage.jsx
      SalespersonReportPage.jsx
      CollectionsReportPage.jsx
      VendorSpendReportPage.jsx
      TechnicianReportPage.jsx
    components/
      MetricCard.jsx
      ChartCard.jsx
      ReportFilters.jsx
      ExportButton.jsx
      DataTable.jsx


### 5.2 reportingApi.js

  export const getManagerDashboard  = ()  => api.get('/api/analytics/manager-dashboard');
  export const getSalesDashboard    = ()  => api.get('/api/analytics/sales-dashboard');
  export const getRevenueReport     = (p) => api.get('/api/reports/revenue', {params:p});
  export const getInventoryReport   = (p) => api.get('/api/reports/inventory-utilisation', {params:p});
  export const getLeadConversion    = (p) => api.get('/api/reports/lead-conversion', {params:p});
  export const getSalespersonReport = (p) => api.get('/api/reports/salesperson', {params:p});
  export const getCollectionsReport = (p) => api.get('/api/reports/collections', {params:p});
  export const getVendorSpendReport = (p) => api.get('/api/reports/vendor-spend', {params:p});
  export const getTechnicianReport  = (p) => api.get('/api/reports/technician-performance', {params:p});
  export const exportReport = (d) => api.post('/api/reports/export', d, {responseType:'blob'});


### 5.3 reportingUtils.js

  export const inr = (n) => `₹${Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
  export const monthLabel = (m,y) => {
    const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${M[(m||1)-1]} ${y||''}`;
  };
  export const trend = (cur,prev) => {
    if(!prev||prev===0) return null;
    const pct=((cur-prev)/prev*100).toFixed(1);
    return {pct:Math.abs(pct),up:cur>=prev};
  };
  export const defaultRange = () => {
    const to=new Date(); const from=new Date();
    from.setDate(from.getDate()-30);
    return {from:from.toISOString().slice(0,10), to:to.toISOString().slice(0,10)};
  };


### 5.4 MetricCard.jsx

Props: title, value, subtitle?, trend?{pct,up}, icon?, color?('blue'|'green'|'amber'|'red'|'purple')

Card layout:
  bg-white rounded-xl border border-gray-100 shadow-sm p-5
  Left: title (text-sm text-gray-500), value (text-2xl font-bold colored), subtitle (text-xs text-gray-400)
  Right: icon in colored circle bg
  Bottom: trend arrow ↑ (green) / ↓ (red) with "X.X% vs last period"


### 5.5 ChartCard.jsx

Props: title, subtitle?, children (recharts), onExport?()

Layout:
  bg-white rounded-xl border border-gray-100 shadow-sm p-5
  Header: title + optional "Export ↓" link
  Body: div style={{height:260}} containing recharts component


### 5.6 ReportFilters.jsx

Props: filters (obj), onChange (fn), fields (['dateRange','month','year','type','customer','vendor','user'])

Render a flex-wrap gap-3 row of filter controls based on fields array:
  dateRange: From/To date inputs
  month: select 1-12 (Jan-Dec)
  year: select 2024-2027
  type: select All/Rental/Sale
  Reset button (clears to defaultRange)


### 5.7 ExportButton.jsx

Props: reportType (string), filters (obj), label?

On click: call exportReport({report_type:reportType, filters})
  → responseType blob → create object URL → trigger download
  → filename: reportType_YYYY-MM-DD.xlsx
  → Show loading spinner while downloading
  → toast.success on done, toast.error on fail

Styling: bg-green-600 text-white px-4 py-2 rounded-lg text-sm flex gap-2 items-center


### 5.8 DataTable.jsx

Props: columns [{key,label,render?,sortable?}], rows [], loading, emptyText?

Features:
  - Loading: 5 skeleton rows (animate-pulse gray bars)
  - Empty: centered message
  - Sort: click sortable column header → toggle asc/desc → show ↑/↓
  - Rows: border-b hover:bg-gray-50, cells p-3 text-gray-700
  - Mobile: overflow-x-auto wrapper


### 5.9 ManagerDashboardPage.jsx

Route: /reports/manager-dashboard  |  Roles: admin, manager

On mount: fetch getManagerDashboard()

Layout (full-width, max-w-7xl mx-auto p-4 space-y-6):

Row 1 — header:
  Title "Manager Dashboard" | subtitle current date
  ExportButton reportType="revenue" (exports current month revenue)

Row 2 — 4 MetricCards in grid:
  [Monthly Invoiced: inr(revenue.current_month.invoiced)] color=blue trend vs last_month
  [Collected: inr(revenue.current_month.collected)] color=green trend vs last_month
  [Outstanding: inr(revenue.current_month.outstanding)] color=amber
  [Active Leads: leads.total_active] color=purple

Row 3 — 2 charts side-by-side (grid-cols-2 gap-4):
  Left: ChartCard "Revenue — Last 6 Months"
    recharts BarChart data=revenue.last_6_months
    Two Bar components: Invoiced (fill #2563EB) + Collected (fill #16A34A)
    XAxis dataKey uses monthLabel(month,year)
    YAxis tickFormatter: (v)=>`₹${(v/100000).toFixed(1)}L`
    Tooltip formatter: inr(value)
    Legend

  Right: ChartCard "Inventory Status"
    recharts PieChart
    Pie data=[
      {name:'Available', value:inventory.qc_passed_available, fill:'#16A34A'},
      {name:'Rented',    value:inventory.currently_rented,    fill:'#2563EB'},
      {name:'In QC',     value:inventory.in_qc,               fill:'#D97706'},
      {name:'In Repair', value:inventory.in_repair,           fill:'#EA580C'},
      {name:'QC Failed', value:inventory.qc_failed,           fill:'#DC2626'},
    ]
    cx="50%" cy="50%" outerRadius=90 label
    Legend at bottom

Row 4 — 2 charts side-by-side:
  Left: ChartCard "Lead Pipeline"
    recharts BarChart layout="vertical" data=leads.by_status
    XAxis type="number", YAxis type="category" dataKey="status"
    Bar fill per status: Pending=#6B7280 Cold=#3B82F6 Warm=#F59E0B Hot=#EF4444
                         Deal=#16A34A Demo=#8B5CF6

  Right: 4 small MetricCards in 2x2 grid:
    [Follow-ups Overdue: leads.follow_up_overdue] color=red
    [Converted This Month: leads.converted_this_month] color=green
    [Open Support: support.open] color=amber
    [Highlighted Floor Tickets: floor.highlighted] color=red

Row 5 — 2 sections side-by-side:
  Left: ChartCard "Floor — Tickets by Stage"
    recharts BarChart data=floor.by_stage (stage_name, count)
    Single Bar fill #6366F1

  Right: "Vendor Bills Pending" (DataTable)
    columns: Vendor | Month | Amount | Status
    rows: vendor.pending_bills_list (fetch separately or include in dashboard)
    max 5 rows shown + "View all" link to /vendor-billing/bills


### 5.10 SalesDashboardPage.jsx

Route: /reports/sales-dashboard  |  Roles: admin, manager, sales

On mount: fetch getSalesDashboard()

If sales role: show "My Performance" — own data only
If manager/admin: show all salespeople OR own view with user dropdown

Row 1 — 4 MetricCards:
  My Active Leads | Follow-ups Today | Follow-ups Overdue (red) | Converted This Month

Row 2 — ChartCard "My Leads by Status"
  recharts BarChart horizontal leads.my_leads.by_status
  Same color coding as Manager Dashboard

Row 3 — 3 MetricCards:
  Quotations Sent (month) | Quotations Approved | Hit Rate: N%

Row 4 — (admin/manager only) DataTable "Team Overview"
  Fetch getSalespersonReport() for all users
  Columns: Salesperson | Active Leads | Converted | Quotations | Hit Rate | Overdue Follow-ups


### 5.11 RevenueReportPage.jsx

Route: /reports/revenue

Filters: dateRange, type, customer (text search or dropdown)
Apply button triggers data fetch.

Row 1: ReportFilters component (fields=['dateRange','type'])
Row 2: 4 MetricCards from totals (Invoiced, Collected, Outstanding, Credit Notes)
Row 3: ChartCard "Monthly Revenue Trend"
  recharts AreaChart (smooth, two areas: invoiced blue + collected green)
  (group invoices by month for the chart data)
Row 4: DataTable
  Columns: Invoice # | Customer | Month | Type | Subtotal | GST | Credit Adj | Total | Status | Date
  Sortable: Customer, Total, Date, Status
Row 5: ExportButton reportType="revenue"


### 5.12 InventoryReportPage.jsx

Route: /reports/inventory

Filters: dateRange

Row 1: ReportFilters (fields=['dateRange'])
Row 2: 4 MetricCards: Total Fleet | Available | Rented | Utilisation %
Row 3: 2 charts:
  Left: PieChart current status
  Right: DataTable "By Brand" (Brand | Total | Available | Rented | In Repair)
Row 4: DataTable "Top Rental Customers" (Customer | Laptops | Monthly Value)
Row 5: ExportButton reportType="inventory"


### 5.13 LeadConversionReportPage.jsx

Route: /reports/lead-conversion

Filters: dateRange, user (assigned_to dropdown — admin/manager only)

Row 1: ReportFilters (fields=['dateRange'])
Row 2: ChartCard "Lead Funnel"
  Custom funnel: horizontal bars decreasing in width
  Steps: All Leads → Cold+Warm+Hot → Hot → Deal/Demo
  Show count and % at each step
  Use recharts BarChart with custom label renderer

Row 3: DataTable "By Salesperson"
  Columns: Name | Total | Converted | Lost | Conv Rate% | Avg Days
  Sortable: Converted desc by default

Row 4: 2 DataTables side-by-side:
  Left: "By Source" (Source | Total | Converted | Conv Rate%)
  Right: "Avg Time per Stage" (Stage | Avg Days)

Row 5: ExportButton reportType="lead_conversion"


### 5.14 SalespersonReportPage.jsx

Route: /reports/salesperson

Filters: dateRange, user (admin/manager sees dropdown, sales sees own only)

Each salesperson shown as a card:
  Header: Name + Role badge
  Grid of 6 numbers:
    Total Leads | Active | Converted | Lost | Quotations Sent | Hit Rate %
  Progress bar: conversion rate visualised

ExportButton reportType="salesperson"


### 5.15 CollectionsReportPage.jsx

Route: /reports/collections

Filters: month selector + year selector

Row 1: ReportFilters (fields=['month','year'])
Row 2: 4 MetricCards: Invoiced | Collected | Outstanding | Overdue
Row 3: ChartCard "Collections Trend"
  recharts BarChart stacked: Collected (green) + Outstanding (red) per month
Row 4: DataTable "By Customer"
  Columns: Customer | Invoiced | Collected | Outstanding | Oldest Unpaid | Status
  Sorted by Outstanding desc
  Outstanding cell: red text if > 0
Row 5: ExportButton reportType="collections"


### 5.16 VendorSpendReportPage.jsx

Route: /reports/vendor-spend

Filters: dateRange, vendor dropdown

Row 1: ReportFilters (fields=['dateRange'])
Row 2: 4 MetricCards: Total Payable | Total Paid | Outstanding | Debit Adjustments
Row 3: ChartCard "Monthly Vendor Spend" (recharts BarChart — one bar per month)
Row 4: DataTable
  Columns: Vendor | PO Type | Bills | Total Payable | Paid | Debit Adj | Net Payable
Row 5: ExportButton reportType="vendor_spend"


### 5.17 TechnicianReportPage.jsx

Route: /reports/technician

Wraps the existing Reports component (already fully built):

  import Reports from '../../../components/Reports';
  import api from '../../../utils/api';

  export default function TechnicianReportPage() {
    return (
      <div className="p-4 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Technician Performance</h1>
          <p className="text-sm text-gray-500 mt-1">
            Floor team work logs, stage durations, QC pass rates
          </p>
        </div>
        <Reports api={api} />
      </div>
    );
  }


### 5.18 ReportingApp.jsx

  import { Routes, Route, Navigate } from 'react-router-dom';
  // import all page components

  export default function ReportingApp() {
    return (
      <Routes>
        <Route index element={<Navigate to="manager-dashboard" replace />} />
        <Route path="manager-dashboard"   element={<ManagerDashboardPage />} />
        <Route path="sales-dashboard"     element={<SalesDashboardPage />} />
        <Route path="revenue"             element={<RevenueReportPage />} />
        <Route path="inventory"           element={<InventoryReportPage />} />
        <Route path="lead-conversion"     element={<LeadConversionReportPage />} />
        <Route path="salesperson"         element={<SalespersonReportPage />} />
        <Route path="collections"         element={<CollectionsReportPage />} />
        <Route path="vendor-spend"        element={<VendorSpendReportPage />} />
        <Route path="technician"          element={<TechnicianReportPage />} />
      </Routes>
    );
  }

---

## SECTION 6 — ROUTING & SIDEBAR

### 6.1 Add to frontend/src/routes/index.jsx

  import ReportingApp from '../features/reporting/ReportingApp';

  {
    path: '/reports/*',
    element: (
      <ProtectedRoute section="analytics_dashboard" action="view">
        <Layout><ReportingApp /></Layout>
      </ProtectedRoute>
    )
  }

### 6.2 Update frontend/src/config/menuConfig.js

Add Reports & Analytics accordion AFTER Support, BEFORE Settings:

  export const reportsMenuItems = [
    { icon: BarChart2,  label:'Manager Dashboard',  path:'/reports/manager-dashboard', section:'analytics_dashboard' },
    { icon: TrendingUp, label:'Sales Dashboard',    path:'/reports/sales-dashboard',   section:'analytics_dashboard' },
    { icon: DollarSign, label:'Revenue',             path:'/reports/revenue',           section:'reports_access' },
    { icon: Package,    label:'Inventory',           path:'/reports/inventory',         section:'reports_access' },
    { icon: Users,      label:'Lead Conversion',    path:'/reports/lead-conversion',   section:'reports_access' },
    { icon: UserCheck,  label:'Salesperson',        path:'/reports/salesperson',       section:'reports_access' },
    { icon: CreditCard, label:'Collections',        path:'/reports/collections',       section:'reports_access' },
    { icon: Building2,  label:'Vendor Spend',       path:'/reports/vendor-spend',      section:'reports_access' },
    { icon: Wrench,     label:'Technician',         path:'/reports/technician',        section:'reports_access' },
  ];

  In MENU_GROUPS add:
  {
    type: 'reportsAccordion',
    label: 'Reports & Analytics',
    icon: BarChart2,
    section: 'analytics_dashboard',
    children: reportsMenuItems
  }

REMOVE from sidebar: standalone "Manager Dashboard" link and standalone "Reports" link
(they are now inside the accordion).

---

## SECTION 7 — ROLE ACCESS MATRIX

| Report                | admin | manager | accounts | sales     | floor_manager |
|-----------------------|-------|---------|----------|-----------|---------------|
| Manager Dashboard     |  YES  |   YES   |    NO    |    NO     |      NO       |
| Sales Dashboard       |  YES  |   YES   |    NO    | YES (own) |      NO       |
| Revenue               |  YES  |   YES   |   YES    |    NO     |      NO       |
| Inventory             |  YES  |   YES   |    NO    |    NO     |     YES       |
| Lead Conversion       |  YES  |   YES   |    NO    |    NO     |      NO       |
| Salesperson           |  YES  |   YES   |    NO    | YES (own) |      NO       |
| Collections           |  YES  |   YES   |   YES    |    NO     |      NO       |
| Vendor Spend          |  YES  |   YES   |   YES    |    NO     |      NO       |
| Technician            |  YES  |   YES   |    NO    |    NO     |     YES       |
| Export Excel          |  YES  |   YES   |   YES    |    NO     |      NO       |

Enforce in both backend (checkRole) and frontend (PermissionGate + sidebar section check).
For sales role: getSalespersonReport and getSalesDashboard must filter WHERE assigned_user_id=req.user.user_id.

---

## SECTION 8 — BUILD ORDER

1. cd backend && npm install xlsx
2. Run migration 070_phase7_reporting.sql
3. Add getManagerDashboard + getSalesDashboard to analyticsController.js
4. Add all 6 report functions + exportToExcel to reportsController.js
5. Extend backend/routes/reports.js with all new routes
6. Create frontend/src/features/reporting/reportingApi.js
7. Create frontend/src/features/reporting/reportingUtils.js
8. Create components: MetricCard, ChartCard, ReportFilters, ExportButton, DataTable
9. Create ManagerDashboardPage (most complex — do first, test backend endpoint)
10. Create SalesDashboardPage
11. Create RevenueReportPage
12. Create InventoryReportPage
13. Create LeadConversionReportPage
14. Create SalespersonReportPage
15. Create CollectionsReportPage
16. Create VendorSpendReportPage
17. Create TechnicianReportPage (simplest — wraps existing)
18. Create ReportingApp.jsx
19. Update frontend/src/routes/index.jsx
20. Update frontend/src/config/menuConfig.js (add accordion, remove orphan items)

---

## SECTION 9 — QUALITY CHECKLIST

Backend:
  [ ] Migration 070 runs clean
  [ ] analytics_dashboard + reports_export in Settings → Role Permissions
  [ ] GET /api/analytics/manager-dashboard returns all 6 sections with correct data
  [ ] revenue.last_6_months returns exactly 6 entries with correct month labels
  [ ] inventory query counts from vendor_serial_numbers (not a different table)
  [ ] sales-dashboard filters by user_id for sales role
  [ ] GET /api/reports/revenue supports pagination (page, limit params)
  [ ] GET /api/reports/collections groups by customer with correct outstanding calc
  [ ] POST /api/reports/export returns valid .xlsx binary for all 7 types
  [ ] Excel column headers correct, auto-sized columns applied

Frontend:
  [ ] ManagerDashboardPage loads without error (all 6 API sections consumed)
  [ ] Revenue bar chart: two bars per month (Invoiced + Collected), correct colors
  [ ] Inventory pie chart: 5 slices, correct colors, legend visible
  [ ] Lead funnel bar chart: horizontal, color-coded by status
  [ ] Floor stage chart: one bar per stage
  [ ] SalesDashboardPage: sales role sees only own data
  [ ] ReportFilters component: date range inputs trigger refetch on Apply
  [ ] DataTable: click column header sorts data (asc/desc toggle)
  [ ] DataTable: loading skeleton shows while fetching
  [ ] ExportButton: downloads .xlsx file with correct filename
  [ ] TechnicianReportPage: existing Reports component renders correctly
  [ ] Reports accordion in sidebar shows correct items per role
  [ ] Old standalone "Manager Dashboard" and "Reports" removed from sidebar
  [ ] All pages mobile-responsive at 375px

---

## SECTION 10 — NAMING REFERENCE

  Feature folder:    reporting  (not reports, not analytics)
  Route prefix:      /reports/
  Analytics prefix:  /api/analytics/   (manager-dashboard, sales-dashboard)
  Reports prefix:    /api/reports/     (revenue, collections, etc.)
  Export endpoint:   POST /api/reports/export
  report_type values: revenue | inventory | lead_conversion | salesperson |
                      collections | vendor_spend | technician_performance
  Permission:        analytics_dashboard, reports_export, reports_access
  Excel MIME:        application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

---

End of Phase 7 prompt.
This is the final core feature phase.
After Phase 7 is verified, remaining work:
  - Production deployment config
  - Subdomain setup (crm / vendor / customer .rentfoxxy.com)
  - SSL certificates
  - Performance optimisation and DB indexing review
