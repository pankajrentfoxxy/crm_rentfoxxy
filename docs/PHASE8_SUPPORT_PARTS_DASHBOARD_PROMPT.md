# RENTFOXXY CRM — PHASE 8 BUILD PROMPT
## Support Module Rebuild + Parts in Inventory + Dashboard Replacement
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- This phase has THREE independent tasks. Build them in order.
- Do NOT change existing backend support routes or controllers — the support
  backend is comprehensive and works well. Only enhance the frontend.
- Parts: move existing /parts page into inventory-management feature,
  keep all existing /api/parts/* backend routes unchanged.
- Dashboard: replace the generic /dashboard page with the Manager KPI view.
- Design system: same as all previous phases (Primary #2563EB etc.)
- No new migrations needed for this phase.

---

## TASK A — DASHBOARD REPLACEMENT

The current /dashboard page shows generic floor stats ("Total Laptop on Floor",
"Active Users", "Avg Hour", "Completed") which is not useful as a landing page.

### A.1 Replace frontend/src/pages/Dashboard.jsx

Replace the entire file content. The new Dashboard is role-aware:

For admin / manager role:
  Redirect to /reports/manager-dashboard
  (Do this with useEffect + navigate, not a permanent redirect,
   so the /dashboard URL still works)

For sales role:
  Show a sales-focused landing:
  - Fetch GET /api/analytics/sales-dashboard
  - Row 1: 4 MetricCards (Active Leads, Follow-ups Today, Follow-ups Overdue, Conversions)
  - Row 2: Lead pipeline quick links (buttons to /lead-crm/leads?status=Hot etc.)
  - Row 3: Recent activity (last 5 leads updated)

For accounts role:
  Show finance landing:
  - Fetch GET /api/finance-overview/dashboard
  - Row 1: 4 MetricCards (Draft Invoices, Sent Unpaid, Vendor Bills Pending, E-Invoice Queue)
  - Quick links: Customer Invoices, Vendor Bills, E-Invoice Queue

For warehouse / floor_manager / technician / qc role:
  Keep showing the current floor stats but use the new Phase 7 floor data:
  - Fetch GET /api/analytics/dashboard (existing)
  - Show: Active tickets by stage (same as current but styled with Phase 7 design system)
  - Quick links: Floor Pipeline, QC Queue, Inventory

For support role:
  Show support landing:
  - Fetch GET /api/support/dashboard
  - Row 1: 4 stat cards (Open, Overdue, Resolved Today, Pending Pickups)
  - Quick link: /support/tickets/new

Implementation:
  import { useAuth } from '../context/AuthContext';
  import { useEffect } from 'react';
  import { useNavigate } from 'react-router-dom';

  const ROLE_REDIRECTS = {
    admin:   '/reports/manager-dashboard',
    manager: '/reports/manager-dashboard',
  };

  export default function Dashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const role = user?.role;

    useEffect(() => {
      if (ROLE_REDIRECTS[role]) {
        navigate(ROLE_REDIRECTS[role], { replace: true });
      }
    }, [role, navigate]);

    if (ROLE_REDIRECTS[role]) return null; // redirect in progress

    if (role === 'sales')     return <SalesDashboard />;
    if (role === 'accounts')  return <AccountsDashboard />;
    if (role === 'support')   return <SupportDashboard />;
    return <FloorDashboard />; // warehouse, technician, qc, floor_manager
  }

Each sub-dashboard (SalesDashboard, AccountsDashboard, SupportDashboard,
FloorDashboard) is a component defined in the same file.
Use MetricCard from ../features/reporting/components/MetricCard.
Keep it clean — no recharts needed here, just cards and quick links.

### A.2 Update sidebar "Dashboard" link

In frontend/src/config/menuConfig.js, the Dashboard link points to /dashboard.
Keep it as-is — admin/manager will be auto-redirected to /reports/manager-dashboard.
Sales/accounts/support/floor roles will see their role-specific dashboard.

---

## TASK B — PARTS SECTION (move to Inventory Management)

The existing Parts page is at /parts and linked from Floor Pipeline sidebar.
It needs to:
1. Move to /inventory-management/parts
2. Be redesigned with the Phase 7/8 design system
3. Add missing features: low stock alerts, category filter, usage history

### B.1 Create new Parts page

File: frontend/src/features/inventory-management/pages/PartsPage.jsx

This REPLACES the existing components/PartsInventory.jsx (which is ugly).
The backend stays the same (/api/parts/*).

Design:

HEADER:
  Title "Parts Inventory"
  Subtitle "Track spare parts, RAM, storage, and consumables"
  Right: [+ Add Part] button (blue) | [Adjust Stock] (outline)

SUMMARY CARDS (4):
  [Total Parts: N types]
  [Low Stock: N items] (amber, clickable to filter)
  [Out of Stock: N] (red)
  [Total Stock Value: ₹X,XX,XXX] (sum of quantity × cost)

FILTER BAR:
  Search input (part name)
  Category dropdown: All | RAM | Storage | Display | Battery | Keyboard |
                     Motherboard | Cooling | Power | Body | General | Other
  Stock status: All | In Stock | Low Stock (< 5 units) | Out of Stock (0 units)
  [Clear filters] link

PARTS TABLE (DataTable):
Columns:
  Part Name | Category | In Stock | Min Threshold | Unit Cost | Total Value |
  Location | Vendor | Actions

  In Stock column:
    > 10: green badge
    2-10: amber badge
    0-1: red badge "LOW" or "OUT"
  
  Min Threshold: show as text, editable inline
  Total Value: quantity × cost, formatted as ₹X,XXX
  
  Actions: Edit | Adjust Stock | View Usage | Archive

ADD PART DRAWER (slides in from right, 480px):
  Part Name*
  Category* (dropdown)
  Description (textarea)
  Initial Quantity (number, min 0)
  Min Threshold (low stock alert at this level, default 5)
  Unit Cost (₹)
  Location Code (e.g. "Shelf A-3", "Bin 12")
  Vendor / Supplier (text)
  Notes
  [Cancel] [Add Part]

ADJUST STOCK MODAL:
  Part: [name] (pre-filled, read-only)
  Current Stock: N
  Adjustment Type:
    + Add Stock (received new parts)
    - Consume (used in repair)
    = Set Exact (stocktake correction)
  Quantity: number input
  Reason: text input (required for consume/set actions)
  [Cancel] [Adjust]
  
  On submit: calls PUT /api/parts/:id/quantity with { quantity: delta }
  For "Set Exact": delta = newValue - currentValue

USAGE HISTORY MODAL (per part):
  Title: "Usage history — [Part Name]"
  Fetch: GET /api/tickets with filter for parts used (parts_used JSONB array)
  Table: Date | Ticket # | TTSPL ID | Technician | Quantity Used
  If no history: "No usage recorded yet."
  Note: This uses existing ticket parts data — display only, no new endpoint needed.

LOW STOCK ALERT BANNER (shown at top of page when any part has low stock):
  Amber banner: "⚠ N parts are running low on stock. [View low stock items]"
  Clicking filters to low stock view automatically.

### B.2 Update sidebar — move Parts

In frontend/src/config/menuConfig.js:

REMOVE Parts from floorAccordionChildren (Floor & Quality section).

ADD Parts to inventoryAccordionChildren (Inventory Management section):
  { label: 'Parts Inventory', path: '/inventory-management/parts', section: 'parts_inventory' }

### B.3 Add route for new parts page

In the inventory management routes (or wherever inventory routes are defined):
  { path: '/inventory-management/parts', element: <PartsPage /> }

Add import in the inventory routes file.

The old /parts route: keep it as a redirect to /inventory-management/parts
so existing bookmarks still work:
  { path: '/parts', element: <Navigate to="/inventory-management/parts" replace /> }

---

## TASK C — SUPPORT MODULE REBUILD

The existing support module works functionally but needs:
1. Integration into the main CRM design system
2. A proper Dashboard page with KPIs and charts
3. Better ticket list with filters, status tabs, priority
4. Link to TTSPL history for each ticket
5. Customer context panel showing their active laptops

The existing support.css + SupportShell + SupportTicketDetail etc. are kept.
Only ADD new components and ENHANCE existing pages.

### C.1 New file: frontend/src/features/support-module/pages/SupportOverviewPage.jsx

This is the new main support landing page replacing the basic SupportDashboard.

Route: /support (redirects to /support/overview) OR make it the index route.

Update SupportShell.jsx to add 'overview' as a route/nav item:
  Add NavItem: { to: 'overview', icon: LayoutDashboard, label: 'Overview' }
  Make it the default view when navigating to /support.

SupportOverviewPage content:

ROW 1 — KPI cards (fetch GET /api/support/badges + /api/support/dashboard):
  [Open Tickets: N]     color=blue
  [Overdue (>48h): N]   color=red, with sub "Needs immediate attention"
  [Resolved Today: N]   color=green
  [Pending Pickups: N]  color=amber
  [Replacements Active: N] color=purple
  [Avg Resolution: Nh]  color=gray

ROW 2 — Two sections side by side:
  Left: "Tickets by Type" — recharts PieChart
    complaint | replacement | pickup | loan
    Each slice colored: complaint=blue, replacement=purple, pickup=amber, loan=teal
  
  Right: "Recent Tickets" table
    Columns: # | Customer | Type | Status | Age | Assigned To
    Last 8 tickets, newest first
    Each row links to ticket detail
    Status badges: open=blue, progress=amber, replacement=purple, closed=green

ROW 3 — Two sections:
  Left: "Overdue Tickets" list (if any)
    Each item: Customer name | Issue | Hours overdue (red) | [View] button
    If none: green banner "No overdue tickets"
  
  Right: "Unassigned Tickets" list (if any)
    Each item: Customer | Type | Created | [Assign] button
    Assign opens inline dropdown of support technicians
    If none: green banner "All tickets assigned"

ROW 4 — Technician Workload table:
  Fetch GET /api/support/technicians (already exists)
  Columns: Technician | Active | Overdue | Resolved Today | Status
  Show as compact table

### C.2 Enhance SupportTicketList.jsx

Current version: basic search + list. Needs:

STATUS TABS at top (with count badges):
  All | Open | In Progress | Overdue | Pending Pickup | Closed

FILTER BAR below tabs:
  Type: All | Complaint | Replacement | Pickup | Loan
  Priority: All | High | Normal
  Assigned To: All | Unassigned | Me | [specific technician]
  Customer: search input
  Date range: From / To

TABLE columns (replace current minimal list):
  # | Customer | Type badge | Status badge | Priority | TTSPL ID |
  Issue Category | Created | Age | Assigned To | Actions

  Type badges: complaint=blue, replacement=purple, pickup=amber, loan=teal
  Age column: "2h ago", "3 days" — red if > 48h
  TTSPL ID: monospace blue, clickable → opens TtsplHistoryDrawer
  Actions: View | Assign (if unassigned) | Close (support_lead only)

BULK ACTIONS (when rows selected):
  Assign selected → dropdown of technicians
  Export CSV (calls GET /api/support/tickets/export)

### C.3 Enhance SupportTicketDetail.jsx

The existing component is functional but add:

CUSTOMER CONTEXT PANEL (new right sidebar section):
  "Customer's Active Laptops"
  Fetch GET /api/customer-management/customers/:customerId/laptops
  List up to 5 laptops: TTSPL ID + Config + Status
  Each TTSPL: clickable → opens TtsplHistoryDrawer
  If ticket already has ttspl_id: highlight that laptop

TIMELINE PANEL enhancement:
  The existing ItemStepper shows workflow steps.
  Beneath it, add a simple activity log:
  [datetime] [actor] [action]
  e.g. "10:30 AM · Ravi Kumar · Added comment: Screen cracked on left side"
       "09:15 AM · System · Ticket created from customer portal"
       "Yesterday · Priya · Work done logged"

LINK TO TTSPL HISTORY:
  If ticket.ttspl_id is set, show a button:
  [View TTSPL History: TTSPL045] → opens TtsplHistoryDrawer (imported from floor-pipeline)

### C.4 New file: frontend/src/features/support-module/pages/SupportStatsPage.jsx

Route: /support/stats (add to SupportShell nav, visible to support_lead + manager + admin)

Simple stats page (no recharts needed — use DataTable):

  Filters: date range (last 30 days by default)

  Section 1: "Resolution Time"
    Avg time to close: N hours
    Median time: N hours
    By technician: DataTable (Technician | Tickets | Avg Hours | <48h Rate%)

  Section 2: "Issue Categories"
    DataTable: Category | Count | Resolved | Open | Avg Hours
    Sorted by Count desc

  Section 3: "Customer Repeat Tickets"
    DataTable: Customer | Total Tickets | Resolved | Repeat Rate %
    Sorted by Total desc

  Data source: existing /api/support/tickets endpoint with filters
  (No new backend endpoint needed — aggregate on frontend using the
  existing data, or add a lightweight endpoint to reportsController:
  GET /api/reports/support-stats?from=&to=)

  Add to reportsController.js:
  exports.getSupportStats = async (req, res) => {
    const { from, to } = resolveDateRange(req.query);
    // Query support_ticket_items (or tickets table) with date filter
    // Return: avg_resolution_hours, median_resolution_hours,
    //         by_technician[{name, tickets, avg_hours, under48h_pct}]
    //         by_category[{label, count, resolved, open, avg_hours}]
    //         repeat_customers[{customer_name, total, resolved, repeat_rate}]
  }
  Add route: router.get('/support-stats', authMiddleware,
    checkRole('admin','manager','support'), ctrl.getSupportStats);

### C.5 Update SupportShell.jsx navigation

Current nav items: dashboard, tickets, pending-assign, overdue, pickups,
complaints, my-tickets, my-resolved, technicians, settings, new

ADD these items:
  { to: 'overview', icon: LayoutDashboard, label: 'Overview', badge: badges?.open_total }
  { to: 'stats', icon: BarChart2, label: 'Stats & Reports' }
    (only shown to support_lead, manager, admin)

REORDER nav to:
  Overview (new)
  All Tickets
  My Tickets
  Pending Assign
  Overdue
  Pickups
  Complaints
  My Resolved
  ─── divider ───
  Stats & Reports (new)
  Technicians
  Settings

### C.6 Minor: Link TtsplHistoryDrawer in support

In SupportTicketDetail.jsx, add import:
  import TtsplHistoryDrawer from '../../floor-pipeline/components/TtsplHistoryDrawer';

Add state: const [historyOpen, setHistoryOpen] = useState(false);

Show button if ticket has ttspl_id:
  <button onClick={() => setHistoryOpen(true)}
    className="flex items-center gap-1 text-sm text-blue-600 hover:underline">
    <Laptop className="w-4 h-4" /> View TTSPL History: {ticket.ttspl_id}
  </button>
  <TtsplHistoryDrawer ttsplId={ticket.ttspl_id} open={historyOpen}
    onClose={() => setHistoryOpen(false)} />

---

## SECTION — BUILD ORDER

Build in this exact order:

TASK A (Dashboard replacement):
1. Replace frontend/src/pages/Dashboard.jsx with role-aware version

TASK B (Parts in Inventory):
2. Create frontend/src/features/inventory-management/pages/PartsPage.jsx
3. Update frontend/src/config/menuConfig.js:
   - Remove Parts from Floor & Quality children
   - Add Parts Inventory to Inventory Management children
4. Add /inventory-management/parts route to inventory routes file
5. Add /parts redirect to /inventory-management/parts in routes

TASK C (Support rebuild):
6. Create frontend/src/features/support-module/pages/SupportOverviewPage.jsx
7. Add getSupportStats to backend/controllers/reportsController.js
8. Add route: GET /api/reports/support-stats to backend/routes/reports.js
9. Create frontend/src/features/support-module/pages/SupportStatsPage.jsx
10. Update frontend/src/components/support/SupportShell.jsx:
    - Add overview + stats nav items
    - Add routes for overview and stats pages
11. Update frontend/src/components/support/SupportTicketList.jsx:
    - Status tabs + filter bar + enhanced table columns
12. Update frontend/src/components/support/SupportTicketDetail.jsx:
    - Customer context panel + TTSPL history button + activity log

FINAL FIXES (from Phase 7 gap):
13. In frontend/src/config/menuConfig.js: fix reportsMenuItems sections
    to use 'reports_access' not 'reports' for revenue/inventory/collections/
    salesperson/lead-conversion/vendor-spend/technician items

---

## SECTION — QUALITY CHECKLIST

TASK A:
  [ ] /dashboard with admin/manager role → auto-redirects to /reports/manager-dashboard
  [ ] /dashboard with sales role → shows SalesDashboard with lead KPIs
  [ ] /dashboard with accounts role → shows AccountsDashboard with finance KPIs
  [ ] /dashboard with support/warehouse/floor roles → shows floor stats
  [ ] No loading text "Loading dashboard..." for roles that redirect

TASK B:
  [ ] /inventory-management/parts loads parts from /api/parts
  [ ] Summary cards: total types, low stock count (< 5), out of stock count, total value
  [ ] Low stock banner shows when any part below threshold
  [ ] Category filter + stock status filter both work
  [ ] Add Part drawer has all fields, saves correctly
  [ ] Adjust Stock modal handles add/consume/set-exact correctly
  [ ] Stock badge colors: green (>10), amber (2-10), red (0-1)
  [ ] /parts → redirects to /inventory-management/parts
  [ ] "Parts" removed from Floor & Quality sidebar section
  [ ] "Parts Inventory" appears in Inventory Management sidebar section

TASK C:
  [ ] /support → shows Overview page (not old dashboard)
  [ ] Overview: 6 KPI cards load from API
  [ ] Overview: Pie chart (ticket by type) renders
  [ ] Overview: Recent tickets table shows 8 rows
  [ ] Overview: Overdue + Unassigned sections show correctly
  [ ] Ticket list: status tabs with counts work
  [ ] Ticket list: type/priority/assigned-to filters work
  [ ] Ticket list: TTSPL ID column shows for tickets with ttspl_id
  [ ] Ticket detail: customer's active laptops shown in right panel
  [ ] Ticket detail: TTSPL History button opens TtsplHistoryDrawer
  [ ] Stats page: loads correctly for support_lead/manager/admin
  [ ] Support nav: Overview at top, Stats & Reports added
  [ ] Phase 7 sidebar fix: reportsMenuItems use 'reports_access' section

---

## SECTION — NAMING REFERENCE

  New parts route:     /inventory-management/parts
  Old parts redirect:  /parts → /inventory-management/parts
  Parts sidebar label: "Parts Inventory" (not just "Parts")
  Support overview:    /support/overview
  Support stats:       /support/stats
  Dashboard role map:  admin+manager → /reports/manager-dashboard
                       sales → inline SalesDashboard
                       accounts → inline AccountsDashboard
                       others → inline FloorDashboard
  Stock status levels: in_stock (>10 green), low_stock (2-10 amber),
                       critical (1 red), out_of_stock (0 red "OUT")

---

End of Phase 8 prompt.
After Phase 8, the CRM is feature-complete.
Final step: production deployment guide (Phase 9).
