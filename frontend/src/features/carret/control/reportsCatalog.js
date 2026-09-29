/**
 * Control → Reports: every report the old /reports area offers, on the same
 * endpoints and the same section each endpoint enforces (backend/routes/reports.js,
 * routes/analytics.js). Each entry says how to fetch it, how to turn the answer
 * into blocks (reportsShared.jsx; charts in ReportChart.jsx, each above the
 * table it pictures) and what can be downloaded:
 *   Excel — POST /reports/export (report's own section or reports_export)
 *   PDF   — Production QC (list and per attempt)
 *   CSV   — any table on screen, and the full list behind a paginated table.
 */
import { reportBlob, reportExcel, reportGet } from './controlApi';
import { downloadBlob, fetchAllPages } from './reportsShared';

const iso = (d) => d.toISOString().slice(0, 10);
export const today = () => iso(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const monthStart = () => { const d = new Date(); d.setDate(1); return iso(d); };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m, y) => `${MONTHS[(Number(m) || 1) - 1]} ${y || ''}`.trim();
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const num = (v) => Number(v) || 0;

async function excel(reportType, filters, name) {
  const { data } = await reportExcel(reportType, filters);
  downloadBlob(data, `${name || reportType}_${today()}.xlsx`, XLSX_TYPE);
}
async function pdf(path, params, name) {
  const { data } = await reportBlob(path, params);
  downloadBlob(data, name, 'application/pdf');
}
const get = async (path, params) => (await reportGet(path, params)).data;

const range = [
  { key: 'from', label: 'From', kind: 'date' },
  { key: 'to', label: 'To', kind: 'date' },
];
const last30 = () => ({ from: daysAgo(30), to: today() });
const dateParams = (v) => ({ from: v.from || undefined, to: v.to || undefined });
const allTimeParams = (v) => (v.all_time ? { all_time: 1 } : dateParams(v));

const opt = (list, value, label) => (list || []).map((x) => (typeof x === 'string' ? { value: x, label: x } : { value: String(x[value]), label: x[label] }));

// ------------------------------------------------------------------ drills
const ioDrill = (v, type, title) => ({
  title,
  kind: 'rows',
  csv: `inward_outward_${type}`,
  columns: [
    { key: 'ttspl', label: 'TTSPL' }, { key: 'serial_number', label: 'Serial' }, { key: 'brand', label: 'Brand' },
    { key: 'model', label: 'Model' }, { key: 'processor', label: 'Processor' }, { key: 'generation', label: 'Generation' },
    { key: 'ram', label: 'RAM' }, { key: 'storage', label: 'Storage' }, { key: 'party_type', label: 'Party' },
    { key: 'party_name', label: 'Customer / vendor' }, { key: 'movement_date', label: 'Date', kind: 'date' },
  ],
  load: async () => (await get('/reports/inward-outward-summary/details', { ...ioParams(v), type })).rows || [],
  excel: () => excel('inward_outward', { ...ioParams(v), type, category_label: title }, `inward_outward_${type}`),
});
function ioParams(v) {
  return { ...allTimeParams(v), customer: v.customer || undefined, vendor: v.vendor || undefined };
}

const LAPTOP_TICKET_COLS = [
  { key: 'ticketId', label: 'Ticket' }, { key: 'ttspl', label: 'TTSPL' }, { key: 'serial', label: 'Serial' },
  { key: 'brand', label: 'Brand' }, { key: 'model', label: 'Model' }, { key: 'processor', label: 'Processor' },
  { key: 'generation', label: 'Gen' }, { key: 'ram', label: 'RAM' }, { key: 'ssd', label: 'SSD' },
  { key: 'stage', label: 'Stage' }, { key: 'tech', label: 'Technician' }, { key: 'team', label: 'Team' },
  { key: 'status', label: 'Status' }, { key: 'created', label: 'Created', kind: 'date' },
];
function laptopParams(v) {
  const p = {
    stage: v.stage || undefined,
    team: v.team || undefined,
    technician: v.technician || undefined,
    status: v.status || undefined,
    brand: v.brand || undefined,
    processor: v.processor || undefined,
    search: v.search || undefined,
  };
  if (v.all_time) p.dateMode = 'all';
  else { p.dateMode = 'custom'; p.dateFrom = v.from || today(); p.dateTo = v.to || today(); }
  return p;
}
// Status / technician / configuration lists are ticket rows; QC-failed and
// stage-performance lists have their own shape, so their columns come from the data.
const laptopDrill = (v, title, extra) => ({
  title,
  kind: 'rows',
  csv: 'laptop_report_tickets',
  columns: extra.popup_qc_history_failed || extra.stage_perf_stage ? undefined : LAPTOP_TICKET_COLS,
  load: async () => fetchAllPages(async (page) => {
    const d = await get('/reports/laptop-report/tickets', { ...laptopParams(v), ...extra, page, limit: 500 });
    return { rows: d.rows, totalPages: d.pagination?.totalPages };
  }, 20),
});

const SO_BUCKETS = [
  { key: 'ordered', label: 'Ordered' }, { key: 'attached', label: 'Attached (QC pending)' },
  { key: 'dispatch_qc_done', label: 'Dispatch QC done' }, { key: 'challan_generated', label: 'DC generated' },
  { key: 'dispatched', label: 'Dispatched' }, { key: 'available', label: 'Ready stock' }, { key: 'qc_process', label: 'QC1 / QC2' },
];
function soParams(v) {
  const p = { ram: v.ram || undefined, ssd: v.ssd || undefined };
  if (v.all_time) return { ...p, preset: 'all' };
  return { ...p, preset: 'custom', from: v.from || today(), to: v.to || today() };
}
const soColumns = (v, scope) => [
  { key: 'processor', label: 'Processor' }, { key: 'generation', label: 'Generation' },
  { key: 'ram', label: 'RAM' }, { key: 'ssd', label: 'SSD' },
  ...SO_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    kind: 'num',
    drill: (r) => ({
      title: `${scope === 'sale' ? 'Sale' : 'Rental'} · ${[r.processor, r.generation, r.ram, r.ssd].filter(Boolean).join(' ')} — ${b.label}`,
      kind: 'rows',
      csv: `sales_order_${scope}_${b.key}`,
      load: async () => (await get('/reports/sales-order-report/drilldown', {
        ...soParams(v), scope, bucket: b.key, processor: r.processor, generation: r.generation || 'all', ram: r.ram || v.ram || undefined, ssd: r.ssd || v.ssd || undefined,
      })).items || [],
    }),
  })),
];

// ------------------------------------------------------------------ charts
// The old /reports pages' charts, fed from the same fields (features/reporting/pages/*).
const monthlyChart = (title, rows, series, extra) => ({
  kind: 'chart',
  chart: 'bar',
  title,
  x: 'month',
  xLabel: 'Month',
  money: true,
  series,
  data: (rows || []).map((r) => ({ month: monthLabel(r.month, r.year), ...Object.fromEntries(series.map((s) => [s.key, num(s.from ? s.from(r) : r[s.key])])) })),
  ...extra,
});
const leadChart = (title, rows) => ({
  kind: 'chart', chart: 'hbar', title, x: 'status', xLabel: 'Status', series: [{ key: 'count', label: 'Leads' }],
  data: (rows || []).map((r) => ({ status: r.status || '—', count: num(r.count) })),
});
// Stock slices are lifecycle states, so they wear their family's colour, not a series slot.
const stockDonut = (title, slices) => ({
  kind: 'chart', chart: 'donut', title, x: 'state', xLabel: 'State', series: [{ key: 'laptops', label: 'Laptops' }],
  data: slices.map(([state, laptops, color]) => ({ state, laptops: num(laptops), color })),
});
// Old Revenue page: invoices on screen grouped by month; collected = paid in full.
function revenueTrend(invoices) {
  const byMonth = new Map();
  (invoices || []).forEach((r) => {
    const key = `${r.invoice_year}-${String(r.invoice_month).padStart(2, '0')}`;
    const m = byMonth.get(key) || { key, month: monthLabel(r.invoice_month, r.invoice_year), invoiced: 0, collected: 0 };
    m.invoiced += num(r.grand_total);
    if (r.status === 'paid') m.collected += num(r.grand_total);
    byMonth.set(key, m);
  });
  return {
    kind: 'chart',
    chart: 'area',
    title: 'Monthly trend',
    note: 'From the invoices on this page; collected counts invoices marked paid.',
    x: 'month',
    xLabel: 'Month',
    money: true,
    series: [{ key: 'invoiced', label: 'Invoiced' }, { key: 'collected', label: 'Collected' }],
    data: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}
// Old Lead conversion funnel: every lead → still open → hot → deal / demo.
function leadFunnel(funnel) {
  const by = Object.fromEntries((funnel || []).map((r) => [r.status, num(r.count)]));
  const total = (funnel || []).reduce((t, r) => t + num(r.count), 0);
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const steps = [
    ['All leads', total], ['Cold + warm + hot', (by.Cold || 0) + (by.Warm || 0) + (by.Hot || 0)],
    ['Hot', by.Hot || 0], ['Deal / demo', (by.Deal || 0) + (by.Demo || 0)],
  ];
  return {
    kind: 'chart',
    chart: 'hbar',
    title: 'Lead funnel',
    x: 'step',
    series: [{ key: 'count', label: 'Leads', labelKey: 'label' }],
    data: steps.map(([step, count]) => ({ step, count, pct: pct(count), label: `${count.toLocaleString('en-IN')} · ${pct(count)}%` })),
    columns: [{ key: 'step', label: 'Step' }, { key: 'count', label: 'Leads', kind: 'num' }, { key: 'pct', label: 'Of all leads', kind: 'pct' }],
  };
}

// ------------------------------------------------------------------ catalogue
export const REPORT_GROUPS = ['Dashboards', 'Money', 'Sales', 'Stock & floor', 'Support & movement'];

export const REPORTS = [
  {
    key: 'manager-dashboard',
    label: 'Manager dashboard',
    group: 'Dashboards',
    sections: ['analytics_dashboard'],
    blurb: 'Revenue this and last month, stock, leads, floor, support and vendor bills in one view.',
    filters: [],
    defaults: () => ({}),
    load: async () => (await get('/analytics/manager-dashboard')).data || {},
    blocks: (d) => {
      const rv = d.revenue || {};
      const inv = d.inventory || {};
      const ld = d.leads || {};
      const fl = d.floor || {};
      const sp = d.support || {};
      const vd = d.vendor || {};
      return [
        { kind: 'stats', title: 'Revenue — this month', items: ['invoiced', 'collected', 'outstanding'].map((k) => ({ label: `${k[0].toUpperCase()}${k.slice(1)}`, value: rv.current_month?.[k], kind: 'money' })) },
        { kind: 'stats', title: 'Revenue — last month', items: ['invoiced', 'collected', 'outstanding'].map((k) => ({ label: `${k[0].toUpperCase()}${k.slice(1)}`, value: rv.last_month?.[k], kind: 'money' })) },
        monthlyChart('Invoiced vs collected — last 6 months', rv.last_6_months, [{ key: 'invoiced', label: 'Invoiced' }, { key: 'collected', label: 'Collected' }]),
        { kind: 'table', title: 'Revenue — last 6 months', csv: 'revenue_6_months', rows: rv.last_6_months || [], columns: [{ key: 'm', label: 'Month', value: (r) => monthLabel(r.month, r.year) }, { key: 'invoiced', label: 'Invoiced', kind: 'money' }, { key: 'collected', label: 'Collected', kind: 'money' }] },
        stockDonut('Stock by state', [
          ['Ready (QC passed)', inv.qc_passed_available, 'var(--lc-idle)'], ['Rented', inv.currently_rented, 'var(--lc-earning)'],
          ['In QC', inv.in_qc, 'var(--lc-moving)'], ['In repair / QC failed', num(inv.in_repair) + num(inv.qc_failed), 'var(--lc-offcycle)'],
          ['Sold', inv.sold, 'var(--lc-closed)'],
        ]),
        {
          kind: 'stats',
          title: 'Stock',
          items: [
            { label: 'Laptops', value: inv.total }, { label: 'Ready (QC passed)', value: inv.qc_passed_available },
            { label: 'Rented', value: inv.currently_rented }, { label: 'Sold', value: inv.sold }, { label: 'In QC', value: inv.in_qc },
            { label: 'In repair', value: inv.in_repair }, { label: 'QC failed', value: inv.qc_failed }, { label: 'Utilisation', value: inv.utilisation_pct, kind: 'pct' },
          ],
        },
        { kind: 'stats', title: 'Leads', items: [{ label: 'Active', value: ld.total_active }, { label: 'Converted this month', value: ld.converted_this_month }, { label: 'Follow-ups overdue', value: ld.follow_up_overdue }] },
        leadChart('Lead pipeline', ld.by_status),
        { kind: 'table', title: 'Leads by status', csv: 'leads_by_status', rows: ld.by_status || [], columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Leads', kind: 'num' }] },
        { kind: 'stats', title: 'Floor', items: [{ label: 'Open tickets', value: fl.active_tickets }, { label: 'Highlighted', value: fl.highlighted }, { label: 'Avg. hours to finish', value: fl.avg_completion_hours }] },
        {
          kind: 'chart', chart: 'hbar', title: 'Floor — tickets by stage', x: 'stage', xLabel: 'Stage', catWidth: 160,
          series: [{ key: 'count', label: 'Tickets' }], data: (fl.by_stage || []).map((r) => ({ stage: r.stage_name || '—', count: num(r.count) })),
        },
        { kind: 'table', title: 'Floor by stage', csv: 'floor_by_stage', rows: fl.by_stage || [], columns: [{ key: 'stage_name', label: 'Stage' }, { key: 'count', label: 'Tickets', kind: 'num' }] },
        { kind: 'stats', title: 'Support', items: [{ label: 'Open', value: sp.open }, { label: 'In progress', value: sp.in_progress }, { label: 'Closed this month', value: sp.closed_this_month }] },
        { kind: 'stats', title: 'Vendors', items: [{ label: 'Active vendors', value: vd.total_active_vendors }, { label: 'Bills pending', value: vd.pending_bills }, { label: 'Pending amount', value: vd.pending_bills_amount, kind: 'money' }] },
        { kind: 'table', title: 'Vendor bills pending', csv: 'vendor_bills_pending', rows: vd.pending_bills_list || [], columns: [{ key: 'vendor_name', label: 'Vendor' }, { key: 'm', label: 'Month', value: (r) => monthLabel(r.month, r.year) }, { key: 'amount', label: 'Amount', kind: 'money' }, { key: 'status', label: 'Status' }] },
      ];
    },
    downloads: () => [{ label: 'Revenue this month (Excel)', run: () => excel('revenue', { from: monthStart(), to: today() }, 'revenue_this_month') }],
  },
  {
    key: 'sales-dashboard',
    label: 'Sales dashboard',
    group: 'Dashboards',
    sections: ['analytics_dashboard'],
    blurb: 'Your leads, follow-ups, quotations and conversions.',
    filters: [],
    defaults: () => ({}),
    load: async () => (await get('/analytics/sales-dashboard')).data || {},
    blocks: (d) => [
      { kind: 'stats', title: 'My leads', items: [{ label: 'Leads', value: d.my_leads?.total }, { label: 'Follow-ups today', value: d.my_leads?.follow_up_today }, { label: 'Follow-ups overdue', value: d.my_leads?.follow_up_overdue }] },
      leadChart('My lead pipeline', d.my_leads?.by_status),
      { kind: 'table', title: 'Leads by status', csv: 'my_leads_by_status', rows: d.my_leads?.by_status || [], columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Leads', kind: 'num' }] },
      { kind: 'stats', title: 'Quotations', items: [{ label: 'Sent this month', value: d.quotations?.sent_this_month }, { label: 'Approved this month', value: d.quotations?.approved_this_month }, { label: 'Hit rate', value: d.quotations?.hit_rate_pct, kind: 'pct' }] },
      { kind: 'stats', title: 'Conversions', items: [{ label: 'This month', value: d.conversions?.this_month }, { label: 'Last month', value: d.conversions?.last_month }] },
      d.monthly_target && { kind: 'table', title: 'Monthly target', csv: 'monthly_target', rows: [d.monthly_target] },
    ],
  },
  {
    key: 'revenue',
    label: 'Revenue',
    group: 'Money',
    sections: ['report_revenue'],
    blurb: 'Customer invoices in a date range: invoiced, collected, outstanding, credit notes; by entity.',
    filters: [...range, { key: 'type', label: 'Business', kind: 'select', options: () => [{ value: 'rental', label: 'Rental' }, { value: 'sale', label: 'Sale' }], placeholder: 'All' }],
    defaults: () => ({ ...last30(), type: '' }),
    paged: true,
    load: (v, page) => get('/reports/revenue', { ...dateParams(v), type: v.type || undefined, page, limit: 100 }),
    blocks: (d, v) => [
      { kind: 'stats', title: 'Totals', items: [{ label: 'Invoiced', value: d.totals?.invoiced, kind: 'money' }, { label: 'Collected', value: d.totals?.collected, kind: 'money' }, { label: 'Outstanding', value: d.totals?.outstanding, kind: 'money' }, { label: 'Credit notes', value: d.totals?.credit_notes_applied, kind: 'money' }] },
      revenueTrend(d.invoices),
      { kind: 'table', title: 'By entity', csv: 'revenue_by_entity', rows: d.by_entity || [], columns: [{ key: 'entity_code', label: 'Entity' }, { key: 'invoiced', label: 'Invoiced', kind: 'money' }, { key: 'collected', label: 'Collected', kind: 'money' }, { key: 'outstanding', label: 'Outstanding', kind: 'money' }] },
      {
        kind: 'table',
        title: 'Invoices',
        csv: 'revenue_invoices',
        rows: d.invoices || [],
        pagination: d.pagination && { page: d.pagination.page, totalPages: d.pagination.total_pages, total: d.pagination.total },
        columns: [
          { key: 'invoice_number', label: 'Invoice' }, { key: 'customer_name', label: 'Customer' }, { key: 'm', label: 'Month', value: (r) => monthLabel(r.invoice_month, r.invoice_year) },
          { key: 'subtotal', label: 'Subtotal', kind: 'money' }, { key: 'gst_amount', label: 'GST', kind: 'money' }, { key: 'credit_note_adjustment', label: 'Credit adj.', kind: 'money' },
          { key: 'grand_total', label: 'Total', kind: 'money' }, { key: 'status', label: 'Status' }, { key: 'invoice_date', label: 'Date', kind: 'date' },
        ],
        csvAll: () => fetchAllPages(async (page) => {
          const r = await get('/reports/revenue', { ...dateParams(v), type: v.type || undefined, page, limit: 500 });
          return { rows: r.invoices, totalPages: r.pagination?.total_pages };
        }),
      },
    ],
    downloads: (v) => [{ label: 'Excel', run: () => excel('revenue', { ...dateParams(v), type: v.type || undefined }) }],
  },
  {
    key: 'collections',
    label: 'Collections',
    group: 'Money',
    sections: ['report_collections'],
    blurb: 'Invoiced vs collected per customer for a month or a year, oldest unpaid invoice.',
    filters: [
      { key: 'month', label: 'Month', kind: 'select', placeholder: 'All months', options: () => MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
      { key: 'year', label: 'Year', kind: 'select', options: () => { const y = new Date().getFullYear(); return [y - 2, y - 1, y, y + 1].map((n) => ({ value: String(n), label: String(n) })); } },
    ],
    defaults: () => ({ month: String(new Date().getMonth() + 1), year: String(new Date().getFullYear()) }),
    load: (v) => get('/reports/collections', { month: v.month || undefined, year: v.year || undefined }),
    blocks: (d) => [
      { kind: 'stats', title: 'Summary', items: [{ label: 'Invoiced', value: d.summary?.total_invoiced, kind: 'money' }, { label: 'Collected', value: d.summary?.total_collected, kind: 'money' }, { label: 'Outstanding', value: d.summary?.outstanding, kind: 'money' }, { label: 'Overdue', value: d.summary?.overdue, kind: 'money' }] },
      { kind: 'table', title: 'By customer', csv: 'collections_by_customer', rows: d.by_customer || [], columns: [{ key: 'customer_name', label: 'Customer' }, { key: 'invoiced', label: 'Invoiced', kind: 'money' }, { key: 'collected', label: 'Collected', kind: 'money' }, { key: 'outstanding', label: 'Outstanding', kind: 'money' }, { key: 'oldest_unpaid_date', label: 'Oldest unpaid', kind: 'date' }, { key: 'status', label: 'Status' }] },
      monthlyChart('Collections trend', d.monthly_trend, [
        { key: 'collected', label: 'Collected', color: 'var(--lc-earning)' },
        { key: 'outstanding', label: 'Outstanding', color: 'var(--lc-moving)', from: (r) => Math.max(0, num(r.invoiced) - num(r.collected)) },
      ], { stacked: true }),
      { kind: 'table', title: 'Monthly trend', csv: 'collections_trend', rows: d.monthly_trend || [], columns: [{ key: 'm', label: 'Month', value: (r) => monthLabel(r.month, r.year) }, { key: 'invoiced', label: 'Invoiced', kind: 'money' }, { key: 'collected', label: 'Collected', kind: 'money' }] },
    ],
    downloads: (v) => [{ label: 'Excel', run: () => excel('collections', { month: v.month || undefined, year: v.year || undefined }) }],
  },
  {
    key: 'vendor-spend',
    label: 'Vendor spend',
    group: 'Money',
    sections: ['report_vendor_spend'],
    blurb: 'Vendor bills, payments and debit notes per vendor and by month.',
    filters: range,
    defaults: last30,
    load: (v) => get('/reports/vendor-spend', dateParams(v)),
    blocks: (d) => [
      { kind: 'stats', title: 'Debit notes', items: [{ label: 'Debit notes in range', value: d.debit_notes_total, kind: 'money' }] },
      { kind: 'table', title: 'By vendor', csv: 'vendor_spend', rows: d.vendors || [], columns: [{ key: 'vendor_name', label: 'Vendor' }, { key: 'po_type', label: 'PO type' }, { key: 'total_bills', label: 'Bills', kind: 'num' }, { key: 'total_payable', label: 'Payable', kind: 'money' }, { key: 'total_paid', label: 'Paid', kind: 'money' }, { key: 'debit_adjustments', label: 'Debit adj.', kind: 'money' }, { key: 'net_payable', label: 'Net payable', kind: 'money' }] },
      monthlyChart('Monthly vendor spend', d.monthly_trend, [{ key: 'payable', label: 'Payable', from: (r) => r.total_payable }]),
      { kind: 'table', title: 'Monthly trend', csv: 'vendor_spend_trend', rows: d.monthly_trend || [] },
    ],
    downloads: (v) => [{ label: 'Excel', run: () => excel('vendor_spend', dateParams(v)) }],
  },
  {
    key: 'lead-conversion',
    label: 'Lead conversion',
    group: 'Sales',
    sections: ['report_lead_conversion'],
    blurb: 'Lead funnel, conversion by salesperson and by source, days spent per stage.',
    filters: range,
    defaults: last30,
    load: (v) => get('/reports/lead-conversion', dateParams(v)),
    blocks: (d) => [
      leadFunnel(d.funnel),
      { kind: 'table', title: 'Funnel', csv: 'lead_funnel', rows: d.funnel || [], columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Leads', kind: 'num' }, { key: 'pct_of_total', label: 'Share', kind: 'pct' }] },
      { kind: 'table', title: 'By salesperson', csv: 'lead_conversion_salesperson', rows: d.by_salesperson || [], columns: [{ key: 'user_name', label: 'Salesperson' }, { key: 'total_leads', label: 'Leads', kind: 'num' }, { key: 'converted', label: 'Converted', kind: 'num' }, { key: 'lost', label: 'Lost', kind: 'num' }, { key: 'conversion_rate_pct', label: 'Conversion', kind: 'pct' }, { key: 'avg_days_to_convert', label: 'Avg. days', kind: 'num' }] },
      { kind: 'table', title: 'Days per stage', csv: 'lead_days_per_stage', rows: d.avg_days_per_stage || [], columns: [{ key: 'status', label: 'Status' }, { key: 'avg_days', label: 'Avg. days', kind: 'num' }] },
      { kind: 'table', title: 'Sources', csv: 'lead_sources', rows: d.sources || [], columns: [{ key: 'source', label: 'Source' }, { key: 'count', label: 'Leads', kind: 'num' }, { key: 'converted', label: 'Converted', kind: 'num' }, { key: 'conversion_rate_pct', label: 'Conversion', kind: 'pct' }] },
    ],
    downloads: (v) => [{ label: 'Excel', run: () => excel('lead_conversion', dateParams(v)) }],
  },
  {
    key: 'salesperson',
    label: 'Salesperson',
    group: 'Sales',
    sections: ['report_salesperson'],
    blurb: 'Per salesperson: leads, quotations and hit rate, follow-ups overdue.',
    filters: range,
    defaults: last30,
    load: (v) => get('/reports/salesperson', dateParams(v)),
    blocks: (d) => [{
      kind: 'table',
      title: 'Salespeople',
      csv: 'salesperson',
      rows: (d.salespeople || []).map((s) => ({
        name: s.name, role: s.role, leads: s.leads?.total, active: s.leads?.active, converted: s.leads?.converted, lost: s.leads?.lost,
        sent: s.quotations?.sent, approved: s.quotations?.approved, rejected: s.quotations?.rejected, hit: s.quotations?.hit_rate_pct,
        scheduled: s.follow_ups?.scheduled, overdue: s.follow_ups?.overdue,
      })),
      columns: [
        { key: 'name', label: 'Salesperson' }, { key: 'role', label: 'Role' }, { key: 'leads', label: 'Leads', kind: 'num' }, { key: 'active', label: 'Active', kind: 'num' },
        { key: 'converted', label: 'Converted', kind: 'num' }, { key: 'lost', label: 'Lost', kind: 'num' }, { key: 'sent', label: 'Quotes sent', kind: 'num' },
        { key: 'approved', label: 'Approved', kind: 'num' }, { key: 'rejected', label: 'Rejected', kind: 'num' }, { key: 'hit', label: 'Hit rate', kind: 'pct' },
        { key: 'scheduled', label: 'Follow-ups', kind: 'num' }, { key: 'overdue', label: 'Overdue', kind: 'num' },
      ],
    }],
    downloads: (v) => [{ label: 'Excel', run: () => excel('salesperson', dateParams(v)) }],
  },
  {
    key: 'sales-order-report',
    label: 'Sales order report',
    group: 'Sales',
    sections: ['report_sales_order'],
    blurb: 'Laptops ordered vs attached, dispatch QC, DC, dispatched and ready stock — by processor, generation, RAM and SSD.',
    filters: [
      ...range,
      { key: 'all_time', label: 'Since the CRM started', kind: 'check' },
      { key: 'ram', label: 'RAM', kind: 'select', placeholder: 'Any RAM', options: (o, d) => opt(d?.filter_options?.ram) },
      { key: 'ssd', label: 'SSD', kind: 'select', placeholder: 'Any SSD', options: (o, d) => opt(d?.filter_options?.ssd) },
    ],
    defaults: () => ({ from: today(), to: today(), all_time: true, ram: '', ssd: '' }),
    load: (v) => get('/reports/sales-order-report', soParams(v)),
    blocks: (d, v) => {
      const s = d.summary || {};
      const tiles = (k) => ['ordered', 'attached', 'dispatch_qc', 'challan_generated', 'in_transit', 'delivered'].map((b) => ({ label: b.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), value: s[k]?.[b] }));
      return [
        { kind: 'stats', title: 'Rental (Rentfoxxy)', items: tiles('rental') },
        { kind: 'stats', title: 'Sale (Gorefurbo)', items: tiles('sale') },
        { kind: 'table', title: 'Rental orders by configuration', note: 'Click a number to see the laptops.', csv: 'sales_order_rental', rows: d.rental?.rows || [], columns: soColumns(v, 'rental') },
        { kind: 'table', title: 'Sale orders by configuration', note: 'Click a number to see the laptops.', csv: 'sales_order_sale', rows: d.sale?.rows || [], columns: soColumns(v, 'sale') },
      ];
    },
    downloads: (v) => [
      { label: 'Summary (Excel)', run: () => excel('sales_order_report', soParams(v), 'sales_order_report') },
      { label: 'Rental configs (Excel)', run: () => excel('sales_order_config', { ...soParams(v), scope: 'rental' }, 'sales_order_rental') },
      { label: 'Sale configs (Excel)', run: () => excel('sales_order_config', { ...soParams(v), scope: 'sale' }, 'sales_order_sale') },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory utilisation',
    group: 'Stock & floor',
    sections: ['report_inventory'],
    blurb: 'Fleet by brand (rented, available, in repair) and the customers holding the most laptops.',
    filters: [],
    defaults: () => ({}),
    load: () => get('/reports/inventory-utilisation'),
    blocks: (d) => [
      { kind: 'stats', title: 'Fleet', items: [{ label: 'Laptops', value: d.summary?.total_fleet }, { label: 'Utilised', value: d.summary?.avg_utilised_pct, kind: 'pct' }] },
      stockDonut('Fleet by state', [
        ['Available', (d.by_brand || []).reduce((t, r) => t + num(r.available), 0), 'var(--lc-idle)'],
        ['Rented', (d.by_brand || []).reduce((t, r) => t + num(r.rented), 0), 'var(--lc-earning)'],
        ['In repair', (d.by_brand || []).reduce((t, r) => t + num(r.in_repair), 0), 'var(--lc-offcycle)'],
      ]),
      { kind: 'table', title: 'By brand', csv: 'inventory_by_brand', rows: d.by_brand || [], columns: [{ key: 'brand', label: 'Brand' }, { key: 'total', label: 'Total', kind: 'num' }, { key: 'available', label: 'Available', kind: 'num' }, { key: 'rented', label: 'Rented', kind: 'num' }, { key: 'in_repair', label: 'In repair', kind: 'num' }] },
      { kind: 'table', title: 'Top customers', csv: 'inventory_top_customers', rows: d.top_customers || [], columns: [{ key: 'customer_name', label: 'Customer' }, { key: 'laptop_count', label: 'Laptops', kind: 'num' }, { key: 'monthly_value', label: 'Monthly value', kind: 'money' }] },
    ],
    downloads: () => [{ label: 'Excel', run: () => excel('inventory', {}) }],
  },
  {
    key: 'warehouse-laptops',
    label: 'Warehouse laptops',
    group: 'Stock & floor',
    sections: ['report_warehouse_laptops'],
    blurb: 'Every laptop in the warehouse by where it is — QC, diagnosis, ready, out for repair — with filters.',
    filters: [
      { key: 'search', label: 'Search', kind: 'search', placeholder: 'TTSPL, serial, model' },
      { key: 'current_stage', label: 'Where', kind: 'select', placeholder: 'Anywhere', options: (o) => opt(o?.report_stages, 'key', 'label') },
      { key: 'brand', label: 'Brand', kind: 'select', placeholder: 'Any brand', options: (o) => opt(o?.brands) },
      { key: 'model', label: 'Model', kind: 'searchselect', placeholder: 'Any model', options: (o) => opt(o?.models) },
      { key: 'processor', label: 'Processor', kind: 'searchselect', placeholder: 'Any processor', options: (o) => opt(o?.processors) },
      { key: 'generation', label: 'Generation', kind: 'searchselect', placeholder: 'Any generation', options: (o) => opt(o?.generations) },
      { key: 'ram', label: 'RAM', kind: 'select', placeholder: 'Any RAM', options: (o) => opt(o?.rams) },
      { key: 'storage', label: 'Storage', kind: 'searchselect', placeholder: 'Any storage', options: (o) => opt(o?.storages) },
      { key: 'current_status', label: 'Status', kind: 'select', placeholder: 'Any status', options: (o) => opt(o?.statuses) },
      { key: 'technician_id', label: 'Technician', kind: 'searchselect', placeholder: 'Anyone', options: (o) => opt(o?.technicians, 'user_id', 'name') },
      { key: 'vendor_id', label: 'Vendor', kind: 'searchselect', placeholder: 'Any vendor', options: (o) => opt(o?.vendors, 'vendor_id', 'name') },
    ],
    defaults: () => ({}),
    optionsLoader: async () => (await get('/reports/warehouse-laptops/filters')).data || {},
    paged: true,
    load: async (v, page) => {
      const base = {
        search: v.search || undefined, brand: v.brand || undefined, model: v.model || undefined, processor: v.processor || undefined,
        generation: v.generation || undefined, ram: v.ram || undefined, storage: v.storage || undefined, current_status: v.current_status || undefined,
        technician_id: v.technician_id || undefined, vendor_id: v.vendor_id || undefined,
      };
      const [summary, list] = await Promise.all([
        get('/reports/warehouse-laptops/summary', base),
        get('/reports/warehouse-laptops/list', { ...base, current_stage: v.current_stage || undefined, page, limit: 100 }),
      ]);
      return { summary: summary.data || {}, list: list.data || [], pagination: list.pagination, base: { ...base, current_stage: v.current_stage || undefined } };
    },
    blocks: (d) => [
      {
        kind: 'stats',
        title: 'Where the laptops are',
        items: [
          ['total', 'All'], ['pending_inventory', 'Pending inventory'], ['diagnosis', 'Diagnosis'], ['hardware_software', 'Hardware / software'], ['final_testing', 'Final testing'],
          ['qc1', 'QC1'], ['qc2', 'QC2'], ['ready_to_rent_sell', 'Ready to rent / sell'], ['out_for_repair', 'Out for repair'], ['dead_scrapped', 'Dead / scrapped'], ['other', 'Other'],
        ].map(([k, label]) => ({ label, value: d.summary?.[k] })),
      },
      {
        kind: 'table',
        title: 'Laptops',
        csv: 'warehouse_laptops',
        rows: d.list,
        pagination: d.pagination,
        columns: [
          { key: 'ttspl_number', label: 'TTSPL' }, { key: 'serial_number', label: 'Serial' }, { key: 'brand', label: 'Brand' }, { key: 'model', label: 'Model' },
          { key: 'processor', label: 'Processor' }, { key: 'generation', label: 'Gen' }, { key: 'ram', label: 'RAM' }, { key: 'storage', label: 'Storage' },
          { key: 'bucket', label: 'Where' }, { key: 'current_stage', label: 'Stage' }, { key: 'current_status', label: 'Status' },
          { key: 'technician', label: 'Technician' }, { key: 'qc_user', label: 'QC by' }, { key: 'vendor', label: 'Vendor' },
        ],
        csvAll: () => fetchAllPages(async (page) => {
          const r = await get('/reports/warehouse-laptops/list', { ...d.base, page, limit: 100 });
          return { rows: r.data, totalPages: r.pagination?.totalPages };
        }, 100),
      },
    ],
  },
  {
    key: 'laptop-report',
    label: 'Technician (laptop) report',
    group: 'Stock & floor',
    sections: ['report_laptop'],
    blurb: 'Floor tickets by stage and technician, stage performance and configurations, with the tickets behind each number.',
    filters: [
      ...range,
      { key: 'all_time', label: 'All time', kind: 'check' },
      { key: 'search', label: 'Search', kind: 'search', placeholder: 'TTSPL, serial, ticket' },
      { key: 'stage', label: 'Stage', kind: 'select', placeholder: 'Any stage', options: (o, d) => opt(d?.filters?.stages, 'key', 'label') },
      { key: 'team', label: 'Team', kind: 'select', placeholder: 'Any team', options: (o, d) => opt(d?.filters?.teams) },
      { key: 'technician', label: 'Technician', kind: 'searchselect', placeholder: 'Anyone', options: (o, d) => opt(d?.filters?.technicians) },
      { key: 'status', label: 'Status', kind: 'select', placeholder: 'Any status', options: (o, d) => opt(d?.filters?.statuses) },
      { key: 'brand', label: 'Brand', kind: 'select', placeholder: 'Any brand', options: (o, d) => opt(d?.filters?.brands) },
      { key: 'processor', label: 'Processor', kind: 'select', placeholder: 'Any processor', options: (o, d) => opt(d?.filters?.processors) },
    ],
    defaults: () => ({ from: today(), to: today(), all_time: false }),
    load: (v) => get('/reports/laptop-report', laptopParams(v)),
    blocks: (d, v) => {
      const sm = d.summary || {};
      const matrixStages = Object.keys(d.technicianStageMatrix?.[0]?.stages || {});
      return [
        {
          kind: 'stats',
          title: `Tickets${d.period?.from ? ` · ${d.period.from} to ${d.period.to}` : ''}`,
          items: Object.keys(sm).map((k) => ({
            label: k,
            value: sm[k],
            drill: k === 'QC Failed'
              ? laptopDrill(v, 'QC failed', { popup_qc_history_failed: true })
              : laptopDrill(v, k === 'Total' ? 'All tickets' : k, k === 'Total' ? {} : { popup_status: k }),
          })),
        },
        { kind: 'table', title: 'By stage', csv: 'laptop_by_stage', rows: d.stages || [], columns: [{ key: 'label', label: 'Stage' }, { key: 'total', label: 'Total', kind: 'num' }, { key: 'done', label: 'Done', kind: 'num' }, { key: 'pending', label: 'Pending', kind: 'num' }] },
        {
          kind: 'table',
          title: 'By technician',
          note: 'Click a number to see the tickets.',
          csv: 'laptop_by_technician',
          rows: d.technicians || [],
          columns: [
            { key: 'name', label: 'Technician' },
            { key: 'total', label: 'Total', kind: 'num', drill: (r) => laptopDrill(v, `${r.name} — all`, { popup_technician: r.name }) },
            { key: 'inProgress', label: 'In progress', kind: 'num', drill: (r) => laptopDrill(v, `${r.name} — in progress`, { popup_technician: r.name, popup_tech_mode: 'inProgress' }) },
            { key: 'done', label: 'Done', kind: 'num', drill: (r) => laptopDrill(v, `${r.name} — done`, { popup_technician: r.name, popup_tech_mode: 'done' }) },
            { key: 'pending', label: 'Pending', kind: 'num', drill: (r) => laptopDrill(v, `${r.name} — pending`, { popup_technician: r.name, popup_tech_mode: 'pending' }) },
          ],
        },
        {
          kind: 'table',
          title: 'Stage performance',
          csv: 'laptop_stage_performance',
          rows: d.stagePerformance || [],
          columns: [{ key: 'label', label: 'Stage' }, ...['assigned', 'pending', 'failed', 'reworked', 'completed'].map((b) => ({
            key: b,
            label: b[0].toUpperCase() + b.slice(1),
            kind: 'num',
            drill: (r) => laptopDrill(v, `${r.label} — ${b}`, { stage_perf_stage: r.stage || r.label, stage_perf_bucket: b }),
          }))],
        },
        {
          kind: 'table',
          title: 'Technician × stage (assigned / completed)',
          csv: 'laptop_technician_stage',
          rows: (d.technicianStageMatrix || []).map((t) => ({ name: t.name, ...Object.fromEntries(matrixStages.map((s) => [s, `${t.stages?.[s]?.assigned ?? 0} / ${t.stages?.[s]?.completed ?? 0}`])) })),
          columns: [{ key: 'name', label: 'Technician' }, ...matrixStages.map((s) => ({ key: s, label: s }))],
        },
        {
          kind: 'table',
          title: 'Configurations',
          csv: 'laptop_configurations',
          rows: d.configurations || [],
          columns: [{ key: 'label', label: 'Processor' }, { key: 'count', label: 'Tickets', kind: 'num', drill: (r) => laptopDrill(v, `Configuration — ${r.label}`, { popup_processor: r.label }) }],
        },
      ];
    },
    downloads: (v) => [
      { label: 'All tickets (CSV)', csv: laptopDrill(v, 'All tickets', {}) },
      { label: 'Technician performance (Excel)', run: () => excel('technician_performance', v.all_time ? { all_time: '1' } : { from: v.from || today(), to: v.to || today() }, 'technician_performance') },
    ],
  },
  {
    key: 'production-qc-report',
    label: 'Production QC report',
    group: 'Stock & floor',
    sections: ['production_qc_report', 'qc_management'],
    blurb: 'Every QC attempt (QC1, QC2, dispatch QC): result, grade, checklist; PDF for the list or one attempt.',
    filters: [
      ...range,
      { key: 'search', label: 'Search', kind: 'search', placeholder: 'TTSPL or serial' },
      { key: 'technician_id', label: 'Technician', kind: 'searchselect', placeholder: 'Anyone', options: (o) => opt(o?.technicians, 'user_id', 'name') },
      { key: 'stage', label: 'QC stage', kind: 'select', placeholder: 'Any stage', options: (o) => opt(o?.stages) },
      { key: 'status', label: 'Result', kind: 'select', placeholder: 'Any result', options: (o) => opt(o?.qc_statuses) },
    ],
    defaults: last30,
    optionsLoader: () => get('/reports/production-qc/filters'),
    paged: true,
    load: (v, page) => get('/reports/production-qc', { ...pqcParams(v), page, limit: 100 }),
    blocks: (d) => [{
      kind: 'table',
      title: 'QC attempts',
      note: 'Click a row to open the attempt and its PDF.',
      csv: 'production_qc',
      rows: d.rows || [],
      pagination: d.pagination,
      columns: [
        { key: 'ttspl_id', label: 'TTSPL' }, { key: 'serial_number', label: 'Serial' }, { key: 'brand', label: 'Brand' }, { key: 'model', label: 'Model' },
        { key: 'qc_stage', label: 'QC stage' }, { key: 'attempt_no', label: 'Attempt', kind: 'num' }, { key: 'qc_status', label: 'Result' }, { key: 'final_grade', label: 'Grade' },
        { key: 'technician_name', label: 'Technician' }, { key: 'checked_by_name', label: 'Checked by' }, { key: 'customer_vendor', label: 'Customer / vendor' },
        { key: 'current_stage', label: 'Now at' }, { key: 'submitted_at', label: 'Submitted', kind: 'date' },
      ],
      onRow: (r) => ({
        title: `${r.ttspl_id || 'QC'} · ${r.qc_stage || ''} attempt ${r.attempt_no || 1}`,
        kind: 'record',
        load: async () => (await get(`/reports/production-qc/${encodeURIComponent(r.history_id)}`)).data,
        pdf: () => pdf(`/reports/production-qc/${encodeURIComponent(r.history_id)}/pdf`, {}, `production-qc_${r.ttspl_id || r.history_id}_attempt${r.attempt_no || 1}.pdf`),
      }),
    }],
    downloads: (v) => [{ label: 'PDF', run: () => pdf('/reports/production-qc/pdf', pqcParams(v), `production-qc-report_${today()}.pdf`) }],
  },
  {
    key: 'support-daily-summary',
    label: 'Daily support summary',
    group: 'Support & movement',
    sections: ['report_support_daily'],
    blurb: 'Pickups, complaints, replacements and returns for a day or range, by technician or team.',
    filters: [
      ...range,
      { key: 'all_time', label: 'All time', kind: 'check' },
      { key: 'assignee', label: 'Technician', kind: 'select', placeholder: 'Everyone', options: (o) => opt(o?.technicians, 'user_id', 'name') },
      { key: 'team', label: 'Team', kind: 'select', placeholder: 'Every team', options: (o) => opt(o?.teams, 'team_id', 'team_name') },
    ],
    defaults: () => ({ from: today(), to: today() }),
    optionsLoader: () => get('/reports/support-daily-summary/filters'),
    load: (v) => get('/reports/support-daily-summary', { ...allTimeParams(v), assignee: v.assignee || undefined, team: v.team || undefined }),
    blocks: (d) => {
      const s = d.summary || {};
      return [
        { kind: 'stats', title: 'Pickups', items: [{ label: 'Pending', value: s.pickup?.pending }, { label: 'Follow-up', value: s.pickup?.followup }] },
        { kind: 'stats', title: 'Complaints', items: [{ label: 'Pending', value: s.complaints?.pending }, { label: 'Resolved', value: s.complaints?.resolved }] },
        { kind: 'stats', title: 'Replacements', items: [{ label: 'Pickup done', value: s.replacements?.pickup_completed }, { label: 'Completed', value: s.replacements?.completed }] },
        { kind: 'stats', title: 'Returned to the warehouse', items: [{ label: 'Total', value: s.returned?.total }, { label: 'Pickup', value: s.returned?.pickup }, { label: 'Replacement', value: s.returned?.replacement }, { label: 'Complaint', value: s.returned?.complaint }] },
        {
          kind: 'table',
          title: 'Summary (for download)',
          csv: 'support_daily_summary',
          rows: [
            ['Pickups', 'Pending', s.pickup?.pending], ['Pickups', 'Follow-up', s.pickup?.followup], ['Complaints', 'Pending', s.complaints?.pending],
            ['Complaints', 'Resolved', s.complaints?.resolved], ['Replacements', 'Pickup done', s.replacements?.pickup_completed], ['Replacements', 'Completed', s.replacements?.completed],
            ['Returned', 'Total', s.returned?.total], ['Returned', 'Pickup', s.returned?.pickup], ['Returned', 'Replacement', s.returned?.replacement], ['Returned', 'Complaint', s.returned?.complaint],
          ].map(([group, item, count]) => ({ group, item, count: count ?? 0 })),
          columns: [{ key: 'group', label: 'Group' }, { key: 'item', label: 'Item' }, { key: 'count', label: 'Count', kind: 'num' }],
        },
      ];
    },
  },
  {
    key: 'inward-outward-summary',
    label: 'Inward & outward summary',
    group: 'Support & movement',
    sections: ['report_inward_outward'],
    blurb: 'Laptops in and out of the warehouse by kind — vendor, customer, replacement, direct — with the laptops behind each count.',
    filters: [
      ...range,
      { key: 'all_time', label: 'All time', kind: 'check' },
      { key: 'customer', label: 'Customer', kind: 'searchselect', placeholder: 'Any customer', options: (o) => opt(o?.customers, 'customer_id', 'customer_name') },
      { key: 'vendor', label: 'Vendor', kind: 'searchselect', placeholder: 'Any vendor', options: (o) => opt(o?.vendors, 'vendor_id', 'business_name') },
    ],
    defaults: () => ({ from: today(), to: today() }),
    optionsLoader: () => get('/reports/inward-outward-summary/filters', { from: daysAgo(365), to: today() }),
    load: (v) => get('/reports/inward-outward-summary', ioParams(v)),
    blocks: (d, v) => {
      const i = d.summary?.inward || {};
      const o = d.summary?.outward || {};
      const t = (type, label, value) => ({ label, value, drill: ioDrill(v, type, label) });
      return [
        {
          kind: 'stats',
          title: 'Inward',
          items: [
            t('inward_total', 'All inward', i.total), t('inward_vendor_purchase', 'Vendor purchase / GRN', i.vendor_purchase), t('inward_vendor_return', 'Vendor repair return', i.vendor_return),
            t('inward_vendor_replacement', 'Vendor replacement', i.vendor_replacement), t('inward_customer_return', 'Customer return', i.customer_return),
            t('inward_customer_replacement', 'Customer replacement', i.customer_replacement), t('inward_direct', 'Direct (courier / manual / ERP)', i.direct),
          ],
        },
        {
          kind: 'stats',
          title: 'Outward',
          items: [
            t('outward_total', 'All outward', o.total), t('outward_vendor_return', 'Vendor repair DC', o.vendor_return ?? o.vendor),
            t('outward_customer_service_return', 'Customer service return', o.customer_service_return), t('outward_customer_replacement', 'Customer replacement', o.customer_replacement),
            t('outward_customer_standard', 'Customer standard dispatch', o.customer_standard),
          ],
        },
      ];
    },
    downloads: (v) => [{ label: 'Excel (summary + laptops)', run: () => excel('inward_outward', ioParams(v), 'inward_outward') }],
  },
];

function pqcParams(v) {
  return {
    dateFrom: v.from || undefined,
    dateTo: v.to || undefined,
    search: v.search || undefined,
    technician_id: v.technician_id || undefined,
    stage: v.stage || undefined,
    status: v.status || undefined,
  };
}

/** Reports this user may open: any one of the report's sections (view). */
export const visibleReports = (hasPermission) => REPORTS.filter((r) => r.sections.some((s) => hasPermission(s, 'view')));

/** Every section that opens at least one report — the hub's route guard. */
export const ALL_REPORT_SECTIONS = [...new Set(REPORTS.flatMap((r) => r.sections))];
