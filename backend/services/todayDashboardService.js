/**
 * The Today dashboard (claude/pending.md item 11): one read-only page that
 * replaces the old Overview (/dashboard), the Billing dashboard
 * (/finance/dashboard) and the new UI's Operations page (/carret).
 *
 * Two rules shape every number here:
 *
 * 1. A tile counts exactly what the list it links to shows. Wherever a list's
 *    own service can be called, it is (floor board, delivery / return challans,
 *    stock, SLA board, ageing, orders to accept) — with the same scoping the
 *    list's controller applies. Where a count is a plain SQL predicate, it is
 *    the list's predicate, copied with a pointer to where it lives.
 * 2. A block is computed only for a user who may view that area
 *    (permissionService, the same matrix the list routes enforce). A block the
 *    user may not see comes back as null and the page does not draw it.
 *
 * Snapshot: every "on the day" figure is rebuilt from timestamps for any past
 * IST day. A "right now" figure (open tickets, ready stock, outstanding …)
 * cannot be — nothing records what those lists held on an earlier day — so
 * for a past day the tile says so instead of showing today's number.
 */
const pool = require('../config/db');
const { hasPermission } = require('./permissionService');
const {
  isRestrictedToAssigned, scopeUserId, salesOrderScopeSection, resolveSalesOrderListOrderType,
} = require('./dataScopeService');
const { getAllowedCustomerTypes } = require('./customerAccessScope');
const {
  buildSalesOrderListWhere, listDeliveryChallansGrouped, listReturnDeliveryChallans,
} = require('./salesManagementService');
const { canViewEwayLockedDc } = require('./saleDcComplianceService');
const { listPendingOrders } = require('./dispatchWorkflowService');
const { listBoard } = require('./floorBoardService');
const stock = require('./stockService');
const { slaBoard } = require('./supportSlaService');
const { ageingBuckets } = require('./invoiceLifecycleService');

const SO_SECTIONS = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement'];
const FLOOR_PAGE_SECTIONS = ['floor_pipeline', 'floor_tickets'];

/** Why a "right now" tile is blank on a past day. */
const NOT_KEPT = 'Not kept for past days — this list only knows what it holds now.';

const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
  && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Today's IST calendar date as YYYY-MM-DD. */
function istToday(now = Date.now()) {
  return new Date(now + 330 * 60000).toISOString().slice(0, 10);
}

/** First day of D's month. */
const monthStart = (d) => `${d.slice(0, 7)}-01`;

const num = (v) => Number(v) || 0;
const money = (v) => Math.round(num(v) * 100) / 100;

/**
 * One tile. A failure in one list's query must not blank the whole page, so it
 * becomes a tile that says it could not load.
 */
async function tile(name, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`today dashboard ${name}:`, e.message);
    return { unavailable: 'Could not load this figure.' };
  }
}

/* ------------------------------------------------------------------ leads */

// The day bounds of an IST calendar day, as timestamptz, in SQL.
const DAY_START = (p) => `(${p}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`;
const DAY_END = (p) => `((${p}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;

async function leadsBlock(req, { date, isToday }) {
  const assignedOnly = await isRestrictedToAssigned(req, 'leads');
  const uid = scopeUserId(req.user);
  // Scope = leadController buildPrismaWhereForLeads (assigned-only branch) and
  // getFollowUpBoard: my leads, or ones I assigned that have no owner yet.
  const scope = (a, u) => `(${a}::boolean = FALSE OR ${u}::int IS NULL OR l.assigned_user_id = ${u}
                  OR (l.assigned_user_id IS NULL AND l.assigned_by = ${u}))`;

  // GET /api/leads?date_from=&date_to= (IST days since 29 Sep) with no status
  // filter — the leads page sends all statuses and its "All" tab shows them.
  const created = await tile('leads.created', async () => {
    const r = (await pool.query(
      `SELECT COUNT(*) FILTER (WHERE l.created_at >= ${DAY_START('$1')})::int AS day,
              COUNT(*)::int AS month
         FROM leads l
        WHERE l.is_duplicate = FALSE
          AND l.created_at >= ${DAY_START('$2')} AND l.created_at < ${DAY_END('$1')}
          AND ${scope('$3', '$4')}`,
      [date, monthStart(date), assignedOnly, uid]
    )).rows[0];
    return r;
  });

  // GET /api/leads/follow-ups/board — the leads page's follow-up tiles read
  // this, and ?follow_up=today|overdue opens the same leads on its Open tab.
  // Follow-up dates move when a follow-up is logged, so a past day's "due"
  // list cannot be rebuilt.
  let followUps = { unavailable: NOT_KEPT };
  if (isToday) {
    followUps = await tile('leads.follow_ups', async () => (await pool.query(
      `SELECT COUNT(*) FILTER (WHERE d = today)::int AS today,
              COUNT(*) FILTER (WHERE d < today)::int AS overdue
         FROM (SELECT (l.follow_up_date AT TIME ZONE 'Asia/Kolkata')::date AS d,
                      (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today
                 FROM leads l
                WHERE l.follow_up_date IS NOT NULL AND l.is_duplicate = FALSE
                  AND l.status NOT IN ('Rejected', 'Gone')
                  AND ${scope('$1', '$2')}) x`,
      [assignedOnly, uid]
    )).rows[0]);
  }

  return {
    new_day: created.unavailable ? created : { count: created.day },
    new_month: created.unavailable ? created : { count: created.month },
    follow_ups_today: followUps.unavailable ? followUps : { count: followUps.today },
    follow_ups_overdue: followUps.unavailable ? followUps : { count: followUps.overdue },
  };
}

/* ------------------------------------------------------------- quotations */

/**
 * GET /api/sales-management/quotations?date_from=&date_to= (listQuotationsGrouped):
 * no data scope, one row per line, a quotation counted once if any of its
 * lines was created in the range. Value = every line of those quotations.
 */
async function quotationCount(from, to) {
  const r = (await pool.query(
    `WITH q AS (
       SELECT DISTINCT quotation_number FROM sales_quotations
        WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date
          AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date
     )
     SELECT (SELECT COUNT(*)::int FROM q) AS count,
            (SELECT COALESCE(SUM(COALESCE(s.rate, 0) * COALESCE(s.quantity, 0)), 0)
               FROM sales_quotations s WHERE s.quotation_number IN (SELECT quotation_number FROM q)) AS amount`,
    [from, to]
  )).rows[0];
  return { count: r.count, amount: money(r.amount) };
}

async function quotationsBlock(req, { date }) {
  return {
    day: await tile('quotations.day', () => quotationCount(date, date)),
    month: await tile('quotations.month', () => quotationCount(monthStart(date), date)),
  };
}

/* ----------------------------------------------------------- sales orders */

/**
 * GET /api/sales-management/sales-orders?entity_scope=&date_from=&date_to=,
 * built with the list's own WHERE (buildSalesOrderListWhere) and the scoping
 * listSalesOrders applies: the entity's data scope, replacement-only users,
 * the dispatch-workflow filter. "All" status, as the list's All tab.
 */
async function salesOrderCount(req, { entityScope = '', from, to }) {
  if (!req.permissionCache) req.permissionCache = {};
  const assignedOnly = await isRestrictedToAssigned(req, salesOrderScopeSection(entityScope));
  const orderType = await resolveSalesOrderListOrderType(req.user, '', req.permissionCache);
  const { where, params } = buildSalesOrderListWhere({
    assignedUserId: assignedOnly ? scopeUserId(req.user) : null,
    dateFrom: from,
    dateTo: to,
    entityScope,
    orderType,
    viewerRole: req.user?.role || null,
    viewerUserId: req.user?.user_id || null,
    restrictDispatchWorkflow: req.user?.role === 'dispatch' && assignedOnly,
  });
  const r = (await pool.query(
    `SELECT (SELECT COUNT(DISTINCT sales_order_number)::int FROM sales_order_lines ${where}) AS count,
            (SELECT COALESCE(SUM(COALESCE(s.rate, 0) * COALESCE(s.quantity, 0)), 0)
               FROM sales_order_lines s
              WHERE s.sales_order_number IN (SELECT DISTINCT sales_order_number FROM sales_order_lines ${where})) AS amount`,
    params
  )).rows[0];
  return { count: r.count, amount: money(r.amount) };
}

async function salesOrdersBlock(req, { date }) {
  return {
    day: await tile('so.day', () => salesOrderCount(req, { from: date, to: date })),
    month: await tile('so.month', () => salesOrderCount(req, { from: monthStart(date), to: date })),
  };
}

/** Sales = the gorefurbo / sale book of the same list (entity_scope=sale). */
async function salesBlock(req, { date }) {
  return {
    day: await tile('sold.day', () => salesOrderCount(req, { entityScope: 'sale', from: date, to: date })),
    month: await tile('sold.month', () => salesOrderCount(req, { entityScope: 'sale', from: monthStart(date), to: date })),
  };
}

/* --------------------------------------------------------------- dispatch */

/** listDeliveryChallans' scoping: the DC grant's data scope and the e-way lock. */
async function challanTotal(req, filters) {
  const assignedOnly = await isRestrictedToAssigned(req, 'delivery_challans');
  const canSeeLockedEway = await canViewEwayLockedDc(req.user, req.permissionCache || {});
  const data = await listDeliveryChallansGrouped({
    page: 1,
    limit: 1,
    assignedUserId: assignedOnly ? scopeUserId(req.user) : null,
    hidePendingEway: !canSeeLockedEway,
    ...filters,
  });
  return { count: num(data.pagination?.total) };
}

async function dispatchBlock(req, { date, isToday, can, board }) {
  const out = {};
  if (await can('dispatch_pending_orders')) {
    out.to_accept = isToday
      ? await tile('dispatch.to_accept', async () => ({
        count: (await listPendingOrders({ userId: req.user.user_id, role: req.user.role })).length,
      }))
      : { unavailable: NOT_KEPT };
  }
  if (board) {
    out.dispatch_qc = isToday ? board.stageTile('Dispatch QC') : { unavailable: NOT_KEPT };
  }
  if (await can('delivery_challans')) {
    out.at_gate = isToday
      ? await tile('dispatch.at_gate', () => challanTotal(req, { status: 'dispatch_ready' }))
      : { unavailable: NOT_KEPT };
    out.delivered = await tile('dispatch.delivered', () => challanTotal(req, {
      status: 'delivered', deliveredFrom: date, deliveredTo: date,
    }));
  }
  return Object.keys(out).length ? out : null;
}

/* ---------------------------------------------------------------- rentals */

async function rentalsBlock(req, { date, isToday, can, counts }) {
  const out = {};
  if (await can('inventory_management')) {
    if (isToday && counts) {
      out.with_customer = counts.unavailable ? counts : { count: counts.with_customer };
      out.on_rent = counts.unavailable ? counts : { count: num(counts.by_status?.rented) };
    } else {
      out.with_customer = { unavailable: NOT_KEPT };
      out.on_rent = { unavailable: NOT_KEPT };
    }
    // GET /api/stock/assets?moved_to=&moved_on= — from the status audit
    // (inventory_status_transitions), so it holds for any past day.
    out.went_on_rent = await tile('rentals.started', async () => ({
      count: (await stock.listAssets({ movedTo: 'rented', movedOn: date, limit: 1 })).total,
    }));
    out.came_back = await tile('rentals.ended', async () => ({
      count: (await stock.listAssets({ movedTo: 'returned', movedOn: date, limit: 1 })).total,
    }));
  }
  if (await can('return_dc')) {
    // GET /api/sales-management/return-dc?status=pending,in_transit — the
    // Return Challans page's first tab.
    out.returns_due = isToday
      ? await tile('rentals.returns_due', async () => {
        const assignedOnly = await isRestrictedToAssigned(req, 'return_dc');
        const data = await listReturnDeliveryChallans({
          page: 1, limit: 1, status: 'pending,in_transit', assignedUserId: assignedOnly ? scopeUserId(req.user) : null,
        });
        return { count: num(data.pagination?.total) };
      })
      : { unavailable: NOT_KEPT };
  }
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------------ stock */

async function stockBlock(req, { isToday, can, counts, board }) {
  const out = {};
  const past = !isToday;
  if ((await can('inventory_management')) || (await can('ready_to_rent_location'))) {
    // GET /api/stock/ready — its summary is what the Ready Stock page shows.
    out.ready = past ? { unavailable: NOT_KEPT } : await tile('stock.ready', async () => {
      const { summary } = await stock.readyStock();
      return {
        count: summary.total, rent: summary.rental, sell: summary.sale, both: summary.both, untagged: summary.untagged,
      };
    });
  }
  if (await can('inventory_management')) {
    const by = (k) => (past ? { unavailable: NOT_KEPT } : (counts.unavailable ? counts : { count: num(counts.by_status?.[k]) }));
    out.in_repair = by('in_repair');
    out.returned = by('returned');
    out.qc_failed = by('qc_failed');
    out.reserved = by('reserved');
  }
  if (board) {
    out.floor = past ? { unavailable: NOT_KEPT } : board.stages();
  }
  return Object.keys(out).length ? out : null;
}

/* ---------------------------------------------------------------- support */

/** GET /api/support/sla/board — open tickets in the user's customer access, and their SLA. */
async function supportBlock(req, { isToday }) {
  if (!isToday) return { open: { unavailable: NOT_KEPT }, breached: { unavailable: NOT_KEPT }, at_risk: { unavailable: NOT_KEPT } };
  const r = await tile('support', async () => {
    const allowedCustomerTypes = await getAllowedCustomerTypes(req.user);
    const board = await slaBoard({ allowedCustomerTypes });
    return { open: board.tickets.length, breached: board.counts.breached, at_risk: board.counts.at_risk };
  });
  if (r.unavailable) return { open: r, breached: r, at_risk: r };
  return { open: { count: r.open }, breached: { count: r.breached }, at_risk: { count: r.at_risk } };
}

/* ------------------------------------------------------------------ money */

async function moneyBlock(req, { date, isToday, can }) {
  const out = {};
  if (await can('customer_billing')) {
    // GET /api/customer-billing/invoices?month=&year= — its summary block:
    // every status but cancelled, by billing month.
    out.invoiced_month = await tile('money.invoiced', async () => {
      const r = (await pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(ci.grand_total), 0) AS amount
           FROM customer_invoices ci
          WHERE ci.invoice_month = $1 AND ci.invoice_year = $2 AND ci.status <> 'cancelled'`,
        [Number(date.slice(5, 7)), Number(date.slice(0, 4))]
      )).rows[0];
      return { count: r.count, amount: money(r.amount) };
    });
    // Customer payments in the ledger by payment date (includes the balance
    // "mark paid" books as an adjustment).
    const collected = await tile('money.collected', async () => (await pool.query(
      `SELECT COUNT(*) FILTER (WHERE payment_date = $1::date)::int AS day_count,
              COALESCE(SUM(amount) FILTER (WHERE payment_date = $1::date), 0) AS day_amount,
              COUNT(*)::int AS month_count, COALESCE(SUM(amount), 0) AS month_amount
         FROM payment_records
        WHERE party_type = 'customer' AND payment_date >= $2::date AND payment_date <= $1::date`,
      [date, monthStart(date)]
    )).rows[0]);
    out.collected_day = collected.unavailable ? collected : { count: collected.day_count, amount: money(collected.day_amount) };
    out.collected_month = collected.unavailable ? collected : { count: collected.month_count, amount: money(collected.month_amount) };
    if (isToday) {
      // GET /api/customer-billing/ageing — the Ageing page's totals.
      out.outstanding = await tile('money.ageing', async () => {
        const rows = await ageingBuckets(pool, {});
        const t = {};
        ['outstanding', 'not_due', 'days_1_30', 'days_31_60', 'days_61_90', 'days_90_plus']
          .forEach((k) => { t[k] = money(rows.reduce((s, r) => s + num(r[k]), 0)); });
        return { amount: t.outstanding, count: rows.reduce((s, r) => s + num(r.invoice_count), 0), buckets: t };
      });
      out.drafts = await tile('money.drafts', async () => {
        const r = (await pool.query(
          `SELECT COUNT(*)::int AS count, COALESCE(SUM(grand_total), 0) AS amount FROM customer_invoices WHERE status = 'draft'`
        )).rows[0];
        return { count: r.count, amount: money(r.amount) };
      });
    } else {
      out.outstanding = { unavailable: NOT_KEPT };
      out.drafts = { unavailable: NOT_KEPT };
    }
  }
  if (await can('vendor_billing_mgmt')) {
    // GET /api/vendor-billing/bills?status=generated|approved — the list's summary.
    const bills = isToday ? await tile('money.vendor_bills', async () => (await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'generated')::int AS to_approve,
              COALESCE(SUM(total_payable) FILTER (WHERE status = 'generated'), 0) AS to_approve_amount,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS to_pay,
              COALESCE(SUM(total_payable) FILTER (WHERE status = 'approved'), 0) AS to_pay_amount
         FROM vendor_monthly_bills`
    )).rows[0]) : { unavailable: NOT_KEPT };
    out.vendor_bills_to_approve = bills.unavailable ? bills : { count: bills.to_approve, amount: money(bills.to_approve_amount) };
    out.vendor_bills_to_pay = bills.unavailable ? bills : { count: bills.to_pay, amount: money(bills.to_pay_amount) };
  }
  const pendingNotes = async (section, table, key) => {
    if (!(await can(section))) return;
    out[key] = isToday ? await tile(`money.${key}`, async () => {
      const r = (await pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS amount FROM ${table} WHERE status = 'pending'`
      )).rows[0];
      return { count: r.count, amount: money(r.amount) };
    }) : { unavailable: NOT_KEPT };
  };
  // Approval queues the Billing dashboard carried. Table names are constants.
  await pendingNotes('credit_notes', 'customer_credit_notes', 'credit_notes_pending');
  await pendingNotes('debit_notes', 'vendor_debit_notes', 'debit_notes_pending');
  if (await can('einvoice_ewb')) {
    // financeOverviewController getCounts: delivered sale DCs with no IRN.
    out.einvoice_queue = isToday ? await tile('money.einvoice', async () => ({
      count: (await pool.query(
        `SELECT COUNT(DISTINCT dcl.dc_number)::int AS c
           FROM delivery_challan_lines dcl
           LEFT JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
           LEFT JOIN sales_quotations sq ON sq.quotation_number = dcl.quotation_number
          WHERE dcl.status = 'delivered' AND dcl.irn IS NULL
            AND COALESCE(sol.quotation_type, sq.quotation_type) = 'sale'`
      )).rows[0].c,
    })) : { unavailable: NOT_KEPT };
  }
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------------ entry */

/**
 * @param req   express request (user, permissionCache)
 * @param date  YYYY-MM-DD (IST day) or empty for today
 */
async function todayDashboard(req, { date: requested } = {}) {
  const today = istToday();
  const date = requested || today;
  if (!isIsoDate(date)) throw Object.assign(new Error('date must be YYYY-MM-DD'), { status: 400 });
  if (date > today) throw Object.assign(new Error('Pick today or an earlier day'), { status: 400 });
  const isToday = date === today;

  if (!req.permissionCache) req.permissionCache = {};
  const user = req.user || {};
  const can = (section) => hasPermission(user.user_id, user.role, section, 'view', req.permissionCache);
  const canAny = async (sections) => {
    for (const s of sections) if (await can(s)) return true;
    return false;
  };

  // Shared loads, done once: the floor board's stage counts (scoped to the
  // user like the board) and the stock counts.
  let board = null;
  if (isToday && await canAny(FLOOR_PAGE_SECTIONS)) {
    const b = await tile('floor', () => listBoard(req, { stage: 'Dispatch QC', view: 'queue' }));
    board = {
      stageTile: (name) => (b.unavailable ? b : { count: num((b.stages || []).find((s) => s.name === name)?.count) }),
      stages: () => (b.unavailable ? b : {
        count: (b.stages || []).reduce((s, x) => s + num(x.count), 0),
        stages: (b.stages || []).filter((s) => num(s.count) > 0).map((s) => ({ name: s.name, count: num(s.count) })),
      }),
    };
  } else if (!isToday && await canAny(FLOOR_PAGE_SECTIONS)) {
    board = { stageTile: () => ({ unavailable: NOT_KEPT }), stages: () => ({ unavailable: NOT_KEPT }) };
  }
  const counts = isToday && await can('inventory_management')
    ? await tile('stock.counts', () => stock.assetCounts())
    : null;

  const ctx = { date, isToday, can, board, counts };
  const blocks = {
    leads: (await can('leads')) ? await leadsBlock(req, ctx) : null,
    quotations: (await can('sales_quotations')) ? await quotationsBlock(req, ctx) : null,
    sales_orders: (await canAny(SO_SECTIONS)) ? await salesOrdersBlock(req, ctx) : null,
    dispatch: await dispatchBlock(req, ctx),
    rentals: await rentalsBlock(req, ctx),
    sales: (await canAny(SO_SECTIONS)) ? await salesBlock(req, ctx) : null,
    stock: await stockBlock(req, ctx),
    support: (await can('support_tickets')) ? await supportBlock(req, ctx) : null,
    money: await moneyBlock(req, ctx),
  };

  return {
    date,
    today,
    is_today: isToday,
    month_from: monthStart(date),
    generated_at: new Date().toISOString(),
    blocks,
  };
}

module.exports = { todayDashboard, istToday, NOT_KEPT };
