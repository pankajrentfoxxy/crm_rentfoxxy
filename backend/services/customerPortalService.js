/**
 * Customer-portal read models.
 *
 * Every query here is scoped to a single `customer_id` (the logged-in portal
 * customer) and returns only customer-safe fields. Warehouse locations, internal
 * inventory states, technician identities, QC/diagnosis stages, production
 * workflow, employee activity and vendor data are never selected — support
 * progress is collapsed onto the small customer-facing stage set below.
 *
 * Where the admin side already derives something non-trivially (sales order
 * fulfilment status, deployed-asset rows) we call that code rather than
 * re-implementing the SQL, so the portal can never drift from the CRM.
 */
const pool = require('../config/db');
const { deriveItemCurrentStep } = require('./supportTicketFlow');
const { listSalesOrdersGrouped } = require('./salesManagementService');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('./customerDeployedAssets');

const TERMINAL_ITEM_STATUSES = new Set(['resolved', 'closed', 'inventory_updated', 'cancelled']);

/** The only ticket stages a customer is ever shown, in progress order. */
const CUSTOMER_STAGES = [
  'received',
  'in_progress',
  'picked_up',
  'at_service_centre',
  'replacement_in_progress',
  'out_for_delivery',
  'resolved',
];

const CUSTOMER_STAGE_LABELS = {
  received: 'Received',
  in_progress: 'In Progress',
  picked_up: 'Device Picked Up',
  at_service_centre: 'At Service Centre',
  replacement_in_progress: 'Replacement In Progress',
  out_for_delivery: 'Out for Delivery',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/**
 * Collapse an internal workflow step onto a customer-facing stage. The internal
 * steps name technician actions (assignment, TTSPL verification, POD, OTP,
 * warehouse hand-offs); customers only get to see how far along their device is.
 */
const INTERNAL_STEP_TO_CUSTOMER_STAGE = {
  unassigned: 'received',
  assigned: 'in_progress',
  visited: 'in_progress',
  verify_ttspl: 'in_progress',
  working: 'in_progress',
  fixed_pending_pod: 'in_progress',
  warehouse_otp: 'in_progress',
  pickup_open: 'in_progress',
  pickup_action: 'in_progress',
  wait_72h: 'in_progress',
  pending_dispatch: 'in_progress',
  reached: 'picked_up',
  pod_uploaded: 'picked_up',
  customer_otp: 'picked_up',
  picked_up_for_repair: 'picked_up',
  pickup_done: 'picked_up',
  in_transit: 'picked_up',
  reached_warehouse: 'at_service_centre',
  awaiting_service_return: 'at_service_centre',
  service_dc_pending: 'at_service_centre',
  warehouse_confirmed: 'at_service_centre',
  replacement_required: 'replacement_in_progress',
  approved: 'replacement_in_progress',
  dispatched: 'out_for_delivery',
  out_for_delivery: 'out_for_delivery',
  delivered_pending_otp: 'out_for_delivery',
  otp_verified: 'resolved',
};

function customerStageForItem(item, replacementOrder) {
  if (String(item.status || '').toLowerCase() === 'cancelled') return 'cancelled';
  let internalStep;
  try {
    internalStep = deriveItemCurrentStep(item, replacementOrder);
  } catch {
    internalStep = null;
  }
  return INTERNAL_STEP_TO_CUSTOMER_STAGE[internalStep] || 'in_progress';
}

/**
 * A ticket's stage is the least-advanced stage across its open items, so the
 * customer sees the work that is still outstanding rather than the most
 * optimistic line. Closed/cancelled tickets report themselves directly.
 */
function customerStageForTicket(ticketStatus, itemStages) {
  const status = String(ticketStatus || '').toLowerCase();
  if (status === 'cancelled') return 'cancelled';
  if (status === 'closed') return 'closed';
  const ranked = (itemStages || [])
    .filter((s) => CUSTOMER_STAGES.includes(s))
    .sort((a, b) => CUSTOMER_STAGES.indexOf(a) - CUSTOMER_STAGES.indexOf(b));
  return ranked[0] || 'received';
}

function paginate({ page, limit }, maxLimit = 100) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), maxLimit);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

function configLabel(row = {}) {
  return [row.processor, row.generation, row.ram, row.storage, row.gpu, row.screen_size]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .join(' · ');
}

/* ------------------------------------------------------------------ orders */

/** Delivery progress for an order, from its own fulfilment counters. */
function deliveryStatusForOrder(row) {
  const qty = Math.max(0, Number(row.laptop_qty || 0));
  const delivered = Math.max(0, Number(row.delivered_count || 0));
  const dispatched = Math.max(0, Number(row.dispatched_count || 0));
  if (String(row.status || '').toLowerCase() === 'cancelled') return 'cancelled';
  if (qty > 0 && delivered >= qty) return 'delivered';
  if (delivered > 0) return 'partially_delivered';
  if (dispatched > 0) return 'in_transit';
  return 'not_dispatched';
}

function orderTypeLabel(row) {
  if (row.is_replacement_order) return 'Replacement';
  const t = String(row.quotation_type || '').toLowerCase();
  if (t === 'demo') return 'Demo';
  if (t === 'sale' || t === 'sales') return 'Sale';
  if (t === 'rental') return 'Rental';
  return row.quotation_type || 'Rental';
}

/**
 * Rental and demo orders are not settled against the sales order at all — they
 * are billed monthly through customer_invoices — so they report as monthly
 * invoicing rather than being mislabelled unpaid. Only sale-type orders are
 * measured against their recorded payments. Keyed off the underlying
 * quotation_type, since a replacement of a rental is still billed monthly.
 */
function paymentStatus(quotationType, totalValue, paidAmount) {
  const type = String(quotationType || 'rental').toLowerCase();
  const total = Number(totalValue || 0);
  const paid = Number(paidAmount || 0);
  if (paid > 0) return paid + 0.5 >= total ? 'paid' : 'partially_paid';
  if (type === 'rental' || type === 'demo') return 'monthly_invoicing';
  if (total <= 0) return 'not_applicable';
  return 'unpaid';
}

/**
 * Per-order extras the admin list query does not carry: the challans raised for
 * the order, a one-line configuration summary and how much has been paid.
 */
async function enrichOrders(soNumbers) {
  if (!soNumbers.length) return new Map();
  const [dcRes, specRes, payRes] = await Promise.all([
    pool.query(
      `SELECT sales_order_number, dc_number, status
         FROM delivery_challan_lines
        WHERE sales_order_number = ANY($1::text[])
          AND COALESCE(movement_type, 'outbound') = 'outbound'
        ORDER BY created_at ASC`,
      [soNumbers]
    ),
    pool.query(
      `SELECT sales_order_number, brand, model_name, processor, generation,
              ram, storage, gpu, screen_size,
              COALESCE(main_qty, quantity, 0) AS qty
         FROM sales_order_lines
        WHERE sales_order_number = ANY($1::text[])
        ORDER BY id ASC`,
      [soNumbers]
    ),
    pool.query(
      `SELECT sales_order_number, COALESCE(SUM(amount), 0) AS paid
         FROM sales_order_payments
        WHERE sales_order_number = ANY($1::text[])
        GROUP BY sales_order_number`,
      [soNumbers]
    ),
  ]);

  const map = new Map(soNumbers.map((so) => [so, { dcs: [], specs: [], paid: 0 }]));

  dcRes.rows.forEach((r) => {
    const e = map.get(r.sales_order_number);
    if (e) e.dcs.push({ dc_number: r.dc_number, status: r.status });
  });
  specRes.rows.forEach((r) => {
    const e = map.get(r.sales_order_number);
    if (!e) return;
    const label = [r.brand, r.model_name].filter(Boolean).join(' ').trim();
    e.specs.push({ label: label || 'Laptop', config: configLabel(r), qty: Number(r.qty || 0) });
  });
  payRes.rows.forEach((r) => {
    const e = map.get(r.sales_order_number);
    if (e) e.paid = Number(r.paid || 0);
  });
  return map;
}

/**
 * Delivery progress maps onto the fulfilment statuses the shared order query
 * already filters in SQL, which keeps pagination totals honest. `dispatched`
 * covers both in-transit and partially delivered orders.
 */
const DELIVERY_STATUS_TO_SQL_STATUS = {
  not_dispatched: 'pending',
  in_transit: 'dispatched',
  partially_delivered: 'dispatched',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

async function listCustomerOrders(customerId, filters = {}) {
  const { page, limit } = paginate(filters);
  const deliveryFilter = String(filters.delivery_status || '').trim().toLowerCase();
  const status = filters.order_status
    || DELIVERY_STATUS_TO_SQL_STATUS[deliveryFilter]
    || '';

  const result = await listSalesOrdersGrouped({
    page,
    limit,
    customerId,
    search: filters.search || '',
    dateFrom: filters.date_from || undefined,
    dateTo: filters.date_to || undefined,
    status,
    entityScope: filters.entity_scope || '',
    orderType: filters.order_type || '',
  });

  const rows = result.sales_orders || [];
  const extras = await enrichOrders(rows.map((r) => r.sales_order_number));

  const orders = rows.map((row) => {
    const extra = extras.get(row.sales_order_number) || { dcs: [], specs: [], paid: 0 };
    const uniqueDcs = [...new Set(extra.dcs.map((d) => d.dc_number).filter(Boolean))];
    const typeLabel = orderTypeLabel(row);
    return {
      sales_order_number: row.sales_order_number,
      order_type: typeLabel,
      quotation_type: row.quotation_type,
      is_replacement_order: Boolean(row.is_replacement_order),
      order_date: row.created_at,
      items: extra.specs,
      quantity: Number(row.laptop_qty || 0),
      dc_numbers: uniqueDcs,
      delivery_status: deliveryStatusForOrder(row),
      delivered_count: Number(row.delivered_count || 0),
      dispatched_count: Number(row.dispatched_count || 0),
      order_status: row.status,
      total_value: Number(row.total_value || 0),
      amount_paid: extra.paid,
      payment_status: paymentStatus(row.quotation_type, row.total_value, extra.paid),
      dispatch_date: row.dispatch_date,
    };
  });

  return { orders, pagination: result.pagination, stats: result.stats };
}

async function getCustomerOrder(customerId, salesOrderNumber) {
  const linesRes = await pool.query(
    `SELECT id, sales_order_number, quotation_number, quotation_type, entity_code,
            brand, model_name, processor, generation, ram, storage, gpu, screen_size,
            quantity, main_qty, rate, status, remark, locking_period,
            battery_charger_warranty, technical_warranty, created_at,
            customer_shipping_address, delivery_address, is_wfh
       FROM sales_order_lines
      WHERE sales_order_number = $1 AND customer_id = $2
      ORDER BY id ASC`,
    [salesOrderNumber, customerId]
  );
  if (!linesRes.rows.length) return null;

  const [dcRes, payRes, serialRes] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (dc_number)
              dc_number, status, dispatch_mode, courier_name, awb_number,
              dispatched_at, delivered_at, created_at
         FROM delivery_challan_lines
        WHERE sales_order_number = $1 AND customer_id = $2
          AND COALESCE(movement_type, 'outbound') = 'outbound'
        ORDER BY dc_number, created_at DESC`,
      [salesOrderNumber, customerId]
    ),
    pool.query(
      `SELECT payment_type, amount, payment_date, payment_mode, reference_number
         FROM sales_order_payments
        WHERE sales_order_number = $1
        ORDER BY payment_date DESC`,
      [salesOrderNumber]
    ),
    pool.query(
      `SELECT sos.ttspl_id, sos.dc_number, vsn.serial_number,
              vsn.extra->>'brand' AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name') AS model_name,
              vsn.extra->>'processor' AS processor, vsn.extra->>'generation' AS generation,
              vsn.extra->>'ram' AS ram, vsn.extra->>'storage' AS storage,
              vsn.extra->>'gpu' AS gpu, vsn.extra->>'screen_size' AS screen_size
         FROM sales_order_serials sos
         LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
        WHERE sos.sales_order_number = $1 AND sos.status = 'attached'
        ORDER BY sos.allocation_id ASC`,
      [salesOrderNumber]
    ),
  ]);

  const head = linesRes.rows[0];
  const totalValue = linesRes.rows.reduce(
    (s, l) => s + (Number(l.rate) || 0) * (Number(l.quantity) || 0),
    0
  );
  const paid = payRes.rows.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const quantity = linesRes.rows.reduce(
    (s, l) => s + (Number(l.main_qty ?? l.quantity) || 0),
    0
  );
  const allCancelled = linesRes.rows.every((l) => String(l.status).toLowerCase() === 'cancelled');
  const typeLabel = orderTypeLabel(head);

  return {
    sales_order_number: salesOrderNumber,
    order_date: head.created_at,
    quotation_number: head.quotation_number,
    order_type: typeLabel,
    order_status: allCancelled ? 'cancelled' : 'active',
    quantity,
    total_value: totalValue,
    amount_paid: paid,
    payment_status: paymentStatus(head.quotation_type, totalValue, paid),
    shipping_address: head.customer_shipping_address || head.delivery_address || null,
    is_wfh: Boolean(head.is_wfh),
    lines: linesRes.rows.map((l) => ({
      id: l.id,
      brand: l.brand,
      model_name: l.model_name,
      config: configLabel(l),
      quantity: Number(l.main_qty ?? l.quantity) || 0,
      rate: Number(l.rate) || 0,
      status: l.status,
      remark: l.remark,
      locking_period: l.locking_period,
      battery_charger_warranty: l.battery_charger_warranty,
      technical_warranty: l.technical_warranty,
    })),
    serials: serialRes.rows.map((s) => ({
      ttspl_id: s.ttspl_id,
      serial_number: s.serial_number,
      brand: s.brand,
      model_name: s.model_name,
      config: configLabel(s),
      dc_number: s.dc_number,
    })),
    delivery_challans: dcRes.rows,
    payments: payRes.rows.map((p) => ({
      payment_type: p.payment_type,
      amount: Number(p.amount) || 0,
      payment_date: p.payment_date,
      payment_mode: p.payment_mode,
      reference_number: p.reference_number,
    })),
  };
}

/* ----------------------------------------------------------------- tickets */

/** Tickets raised through the portal and tickets the CRM logged for this customer. */
const ticketScopeSql = (idx) => `(st.portal_customer_id = $${idx} OR st.customer_id = $${idx})`;

function buildTicketWhere(customerId, filters, params) {
  params.push(customerId);
  let where = `WHERE ${ticketScopeSql(params.length)}`;

  if (filters.search) {
    params.push(`%${filters.search}%`);
    const i = params.length;
    where += ` AND (
      CAST(st.id AS TEXT) ILIKE $${i}
      OR COALESCE(st.top_level_remarks, '') ILIKE $${i}
      OR COALESCE(st.ttspl_id, '') ILIKE $${i}
    )`;
  }
  if (filters.ttspl) {
    params.push(`%${filters.ttspl}%`);
    const i = params.length;
    where += ` AND (
      COALESCE(st.ttspl_id, '') ILIKE $${i}
      OR EXISTS (
        SELECT 1 FROM support_ticket_items sti
         WHERE sti.ticket_id = st.id
           AND (COALESCE(sti.ttspl_id, '') ILIKE $${i}
                OR COALESCE(sti.unique_serial_number, '') ILIKE $${i})
      )
    )`;
  }
  if (filters.serial) {
    params.push(`%${filters.serial}%`);
    const i = params.length;
    where += ` AND EXISTS (
      SELECT 1 FROM support_ticket_items sti
       WHERE sti.ticket_id = st.id
         AND (COALESCE(sti.serial_number, '') ILIKE $${i}
              OR COALESCE(sti.unique_serial_number, '') ILIKE $${i})
    )`;
  }
  if (filters.ticket_type) {
    params.push(String(filters.ticket_type).toLowerCase());
    where += ` AND LOWER(COALESCE(st.ticket_category, 'complaint')) = $${params.length}`;
  }
  if (filters.status) {
    params.push(String(filters.status).toLowerCase());
    where += ` AND LOWER(st.status) = $${params.length}`;
  }
  if (filters.date_from) {
    params.push(filters.date_from);
    where += ` AND st.created_at >= $${params.length}::date`;
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    where += ` AND st.created_at < ($${params.length}::date + INTERVAL '1 day')`;
  }
  return where;
}

/** Item columns needed to derive a stage. Nothing here is returned to the client. */
const ITEM_STEP_COLUMNS = `
  sti.id, sti.ticket_id, sti.item_type, sti.status, sti.assigned_to, sti.visited_at,
  sti.ttspl_verified, sti.outcome, sti.work_done_at, sti.pod_image_path,
  sti.otp_verified_at, sti.customer_otp_verified_at, sti.warehouse_otp_verified_at,
  sti.warehouse_otp_code, sti.otp_code, sti.picked_up_at, sti.loan_delivered_at,
  sti.pickup_method, sti.pickup_type, sti.source_item_id, sti.reached_warehouse_at,
  sti.warehouse_received_at, sti.service_dc_number,
  sti.return_dc_number, sti.pickup_assigned_to,
  sti.proof_of_completion_path, sti.current_step,
  sti.serial_number, sti.unique_serial_number, sti.ttspl_id,
  sti.brand, sti.model, sti.processor, sti.ram, sti.storage, sti.generation,
  sti.remarks, sti.created_at
`;

async function loadTicketItems(ticketIds) {
  if (!ticketIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT ${ITEM_STEP_COLUMNS},
            sdc.status AS service_dc_status,
            sdc.delivered_at AS service_dc_delivered_at,
            ro.status AS replacement_order_status,
            ro.delivery_otp_verified_at AS replacement_delivery_otp_verified_at
       FROM support_ticket_items sti
       -- Same lateral the CRM ticket detail uses, so the derived stage matches.
       LEFT JOIN LATERAL (
         SELECT status, delivered_at
           FROM delivery_challan_lines
          WHERE dc_number = sti.service_dc_number
            AND movement_type = 'outbound'
            AND dc_purpose = 'service_return'
          LIMIT 1
       ) sdc ON sti.service_dc_number IS NOT NULL
       LEFT JOIN LATERAL (
         SELECT status, delivery_otp_verified_at
           FROM support_replacement_orders
          WHERE item_id = sti.id
          ORDER BY id DESC
          LIMIT 1
       ) ro ON TRUE
      WHERE sti.ticket_id = ANY($1::int[])
      ORDER BY sti.id ASC`,
    [ticketIds]
  );
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.ticket_id)) map.set(r.ticket_id, []);
    map.get(r.ticket_id).push(r);
  });
  return map;
}

/** Strip an item down to what a customer may see, plus its derived stage. */
function publicItem(item) {
  const replacementOrder = item.replacement_order_status
    ? {
      status: item.replacement_order_status,
      delivery_otp_verified_at: item.replacement_delivery_otp_verified_at,
    }
    : null;
  const stage = customerStageForItem(item, replacementOrder);
  return {
    item_id: item.id,
    item_type: item.item_type,
    ttspl_id: item.ttspl_id || item.unique_serial_number || null,
    serial_number: item.serial_number || null,
    brand: item.brand || null,
    model: item.model || null,
    config: configLabel(item),
    stage,
    stage_label: CUSTOMER_STAGE_LABELS[stage] || 'In Progress',
    is_open: !TERMINAL_ITEM_STATUSES.has(String(item.status || '').toLowerCase()),
    created_at: item.created_at,
  };
}

function firstLine(text) {
  return String(text || '').split('\n')[0].trim();
}

async function listCustomerTickets(customerId, filters = {}) {
  const { page, limit, offset } = paginate(filters);
  const stageFilter = String(filters.stage || '').trim().toLowerCase();

  const params = [];
  const where = buildTicketWhere(customerId, filters, params);

  // A stage filter cannot be pushed into SQL because the stage is derived from
  // item state, so in that case we page in memory over the customer's own rows.
  const sqlLimit = stageFilter ? 500 : limit;
  const sqlOffset = stageFilter ? 0 : offset;

  const listParams = [...params, sqlLimit, sqlOffset];
  const [countRes, listRes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM support_tickets st ${where}`, params),
    pool.query(
      `SELECT st.id, st.status, st.priority, st.ticket_category, st.top_level_remarks,
              st.ttspl_id, st.created_at, st.updated_at, st.last_activity_at, st.closed_at
         FROM support_tickets st
         ${where}
        ORDER BY st.created_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    ),
  ]);

  const itemsByTicket = await loadTicketItems(listRes.rows.map((r) => r.id));

  let tickets = listRes.rows.map((t) => {
    const items = (itemsByTicket.get(t.id) || []).map(publicItem);
    const openStages = items.filter((i) => i.is_open).map((i) => i.stage);
    const stage = customerStageForTicket(t.status, openStages.length ? openStages : items.map((i) => i.stage));
    const primary = items[0] || {};
    return {
      ticket_id: t.id,
      ticket_number: `T-${t.id}`,
      ticket_type: t.ticket_category || 'complaint',
      ttspl_id: t.ttspl_id || primary.ttspl_id || null,
      serial_number: primary.serial_number || null,
      subject: firstLine(t.top_level_remarks) || 'Support request',
      created_at: t.created_at,
      stage,
      stage_label: CUSTOMER_STAGE_LABELS[stage] || 'In Progress',
      status: t.status,
      last_updated: t.last_activity_at || t.updated_at,
      closed_at: t.closed_at,
      item_count: items.length,
      open_item_count: items.filter((i) => i.is_open).length,
    };
  });

  let total = countRes.rows[0]?.total || 0;
  if (stageFilter) {
    tickets = tickets.filter((t) => t.stage === stageFilter);
    total = tickets.length;
    tickets = tickets.slice(offset, offset + limit);
  }

  return {
    tickets,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/**
 * Submissions still waiting on the Support team. These are not tickets yet, so
 * without this the customer who raised one would see nothing at all until it
 * gets converted.
 */
async function listCustomerPendingRequests(customerId) {
  const { rows } = await pool.query(
    `SELECT id, request_type, device_serial, issue_description, status, created_at, extra
       FROM support_requests
      WHERE matched_customer_id = $1
        AND status IN ('pending', 'reviewed')
      ORDER BY created_at DESC
      LIMIT 50`,
    [customerId]
  );

  return rows.map((r) => ({
    request_id: r.id,
    reference: `SR-${r.id}`,
    request_type: r.request_type || 'complaint',
    ttspl_ids: Array.isArray(r.extra?.devices) && r.extra.devices.length
      ? r.extra.devices
      : [r.device_serial].filter(Boolean),
    subject: firstLine(r.issue_description) || 'Support request',
    stage_label: r.status === 'reviewed' ? 'Under review' : 'Submitted',
    created_at: r.created_at,
  }));
}

async function getCustomerTicket(customerId, ticketId) {
  const { rows } = await pool.query(
    `SELECT st.id, st.status, st.priority, st.ticket_category, st.top_level_remarks,
            st.ttspl_id, st.dc_number, st.created_at, st.updated_at,
            st.last_activity_at, st.closed_at, st.pickup_address
       FROM support_tickets st
      WHERE st.id = $1 AND ${ticketScopeSql(2)}
      LIMIT 1`,
    [ticketId, customerId]
  );
  const t = rows[0];
  if (!t) return null;

  const items = (await loadTicketItems([t.id])).get(t.id) || [];
  const publicItems = items.map(publicItem);
  const openStages = publicItems.filter((i) => i.is_open).map((i) => i.stage);
  const stage = customerStageForTicket(
    t.status,
    openStages.length ? openStages : publicItems.map((i) => i.stage)
  );

  return {
    ticket_id: t.id,
    ticket_number: `T-${t.id}`,
    ticket_type: t.ticket_category || 'complaint',
    subject: firstLine(t.top_level_remarks) || 'Support request',
    description: t.top_level_remarks || '',
    ttspl_id: t.ttspl_id || publicItems[0]?.ttspl_id || null,
    status: t.status,
    stage,
    stage_label: CUSTOMER_STAGE_LABELS[stage] || 'In Progress',
    priority: t.priority,
    created_at: t.created_at,
    last_updated: t.last_activity_at || t.updated_at,
    closed_at: t.closed_at,
    pickup_address: t.pickup_address || null,
    items: publicItems,
  };
}

/**
 * Confirm a TTSPL/serial is actually deployed with this customer before a portal
 * ticket is allowed to reference it.
 */
async function findCustomerAsset(customerId, assetRef) {
  const ref = String(assetRef || '').trim();
  if (!ref) return null;
  const { rows } = await pool.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.current_dc_number AS dc_number,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
            vsn.extra->>'brand' AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name') AS model_name,
            vsn.extra->>'processor' AS processor, vsn.extra->>'generation' AS generation,
            vsn.extra->>'ram' AS ram, vsn.extra->>'storage' AS storage,
            vsn.extra
       FROM vendor_serial_numbers vsn
      WHERE vsn.current_customer_id = $1
        AND vsn.deleted_at IS NULL
        AND (vsn.inventory_asset_code = $2
             OR vsn.serial_number = $2
             OR vsn.extra->>'ttspl_id' = $2)
      LIMIT 1`,
    [customerId, ref]
  );
  return rows[0] || null;
}

/* -------------------------------------------------------------- deliveries */

const CUSTOMER_DELIVERY_IN_TRANSIT = ['in_transit', 'reached', 'shipped'];

async function listCustomerDeliveries(customerId, filters = {}) {
  const { page, limit, offset } = paginate(filters);
  const params = [customerId];
  let where = `WHERE dcl.customer_id = $1 AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'`;

  if (filters.search) {
    params.push(`%${filters.search}%`);
    const i = params.length;
    where += ` AND (dcl.dc_number ILIKE $${i}
                    OR COALESCE(dcl.sales_order_number, '') ILIKE $${i}
                    OR COALESCE(dcl.awb_number, '') ILIKE $${i})`;
  }
  const status = String(filters.status || '').trim().toLowerCase();
  if (status === 'in_transit') {
    params.push(CUSTOMER_DELIVERY_IN_TRANSIT);
    where += ` AND dcl.status = ANY($${params.length}::text[])`;
  } else if (status) {
    params.push(status);
    where += ` AND LOWER(dcl.status) = $${params.length}`;
  }
  if (filters.date_from) {
    params.push(filters.date_from);
    where += ` AND dcl.created_at >= $${params.length}::date`;
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    where += ` AND dcl.created_at < ($${params.length}::date + INTERVAL '1 day')`;
  }

  const listParams = [...params, limit, offset];
  const [countRes, listRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT dcl.dc_number)::int AS total
         FROM delivery_challan_lines dcl ${where}`,
      params
    ),
    pool.query(
      `SELECT DISTINCT ON (dcl.dc_number)
              dcl.dc_number, dcl.sales_order_number, dcl.status,
              dcl.dispatch_mode, dcl.ship_by, dcl.courier_name, dcl.awb_number,
              dcl.courier_tracking_url, dcl.porter_tracking_id,
              dcl.created_at, dcl.dispatched_at, dcl.delivered_at,
              dcl.estimated_delivery, dcl.rejection_reason
         FROM delivery_challan_lines dcl
         ${where}
        ORDER BY dcl.dc_number, dcl.created_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    ),
  ]);

  const total = countRes.rows[0]?.total || 0;
  return {
    deliveries: listRes.rows,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/**
 * Challan tracking for the customer: document + delivery milestones + the units
 * on it. Technician identity, OTP codes and warehouse-return handling stay out.
 */
async function getCustomerDelivery(customerId, dcNumber) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (dc_number)
            dc_number, sales_order_number, status, dispatch_mode, ship_by,
            courier_name, awb_number, courier_tracking_url, porter_tracking_id,
            created_at, dispatched_at, reached_at, delivered_at, estimated_delivery,
            pod_type, pod_photo_url, esign_url, pod_submitted_at,
            delivery_notes, rejection_reason, rejected_at, pdf_path, serial_number
       FROM delivery_challan_lines
      WHERE dc_number = $1 AND customer_id = $2
        AND COALESCE(movement_type, 'outbound') = 'outbound'
      ORDER BY dc_number, created_at DESC`,
    [dcNumber, customerId]
  );
  const dc = rows[0];
  if (!dc) return null;

  const unitsRes = await pool.query(
    `SELECT sos.ttspl_id, vsn.serial_number,
            vsn.extra->>'brand' AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name') AS model_name,
            vsn.extra->>'processor' AS processor, vsn.extra->>'generation' AS generation,
            vsn.extra->>'ram' AS ram, vsn.extra->>'storage' AS storage,
            vsn.extra->>'gpu' AS gpu, vsn.extra->>'screen_size' AS screen_size
       FROM sales_order_serials sos
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
      WHERE sos.dc_number = $1
      ORDER BY sos.allocation_id ASC`,
    [dcNumber]
  );

  const { serial_number: _rawSerials, ...head } = dc;
  return {
    ...head,
    units: unitsRes.rows.map((u) => ({
      ttspl_id: u.ttspl_id,
      serial_number: u.serial_number,
      brand: u.brand,
      model_name: u.model_name,
      config: configLabel(u),
    })),
    timeline: [
      { key: 'created', label: 'Challan created', at: dc.created_at },
      { key: 'dispatched', label: 'Dispatched', at: dc.dispatched_at },
      { key: 'reached', label: 'Reached location', at: dc.reached_at },
      dc.rejected_at
        ? { key: 'rejected', label: 'Refused', at: dc.rejected_at }
        : { key: 'delivered', label: 'Delivered', at: dc.delivered_at },
    ].filter((s) => s.at || ['created', 'dispatched', 'delivered'].includes(s.key)),
  };
}

/* --------------------------------------------------------------- dashboard */

/**
 * The eight dashboard KPIs. Order counts come from the same admin query the
 * Orders list uses, so a card can never disagree with the table it opens.
 */
async function getCustomerDashboard(customerId) {
  const [activeOrders, pendingOrders, counts] = await Promise.all([
    listSalesOrdersGrouped({ customerId, status: 'active', page: 1, limit: 1 }),
    listSalesOrdersGrouped({ customerId, status: 'pending', page: 1, limit: 1 }),
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM support_tickets st
           WHERE (st.portal_customer_id = $1 OR st.customer_id = $1)
             AND LOWER(st.status) IN ('open', 'in_progress')) AS open_tickets,
         (SELECT COUNT(*)::int FROM support_ticket_items sti
            JOIN support_tickets st2 ON st2.id = sti.ticket_id
           WHERE (st2.portal_customer_id = $1 OR st2.customer_id = $1)
             AND sti.item_type = 'pickup'
             AND LOWER(COALESCE(sti.status, '')) NOT IN ('resolved','closed','inventory_updated','cancelled')) AS pending_pickup,
         (SELECT COUNT(*)::int FROM support_ticket_items sti
            JOIN support_tickets st3 ON st3.id = sti.ticket_id
           WHERE (st3.portal_customer_id = $1 OR st3.customer_id = $1)
             AND sti.item_type = 'replacement'
             AND LOWER(COALESCE(sti.status, '')) NOT IN ('resolved','closed','inventory_updated','cancelled')) AS pending_replacement,
         (SELECT COUNT(DISTINCT dc_number)::int FROM delivery_challan_lines
           WHERE customer_id = $1
             AND COALESCE(movement_type, 'outbound') = 'outbound'
             AND status = ANY($2::text[])) AS in_transit_deliveries,
         (SELECT COALESCE(SUM(
                    CASE WHEN jsonb_typeof(serial_number) = 'array'
                         THEN jsonb_array_length(serial_number) ELSE 0 END), 0)::int
            FROM delivery_challan_lines
           WHERE customer_id = $1
             AND COALESCE(movement_type, 'outbound') = 'outbound'
             AND status = 'delivered') AS delivered_laptops,
         (SELECT COUNT(*)::int FROM vendor_serial_numbers vsn
           WHERE vsn.current_customer_id = $1
             AND vsn.deleted_at IS NULL
             AND vsn.inventory_status = ANY($3::text[])) AS active_laptops`,
      [customerId, CUSTOMER_DELIVERY_IN_TRANSIT, DEPLOYED_WITH_CUSTOMER_STATUSES]
    ),
  ]);

  const row = counts.rows[0] || {};

  return {
    active_orders: Number(activeOrders.pagination?.total || 0),
    pending_orders: Number(pendingOrders.pagination?.total || 0),
    open_support_tickets: Number(row.open_tickets || 0),
    pending_pickup: Number(row.pending_pickup || 0),
    pending_replacement: Number(row.pending_replacement || 0),
    in_transit_deliveries: Number(row.in_transit_deliveries || 0),
    delivered_laptops: Number(row.delivered_laptops || 0),
    active_laptops: Number(row.active_laptops || 0),
  };
}

/* ----------------------------------------------------------------- laptops */

/**
 * Reuses the admin deployed-asset query so the portal shows the same rows as the
 * CRM customer screen. Required lazily to keep the controller/service graph acyclic.
 */
async function listCustomerLaptops(customerId, filters = {}) {
  const {
    queryCustomerActiveAssets,
    queryCustomerReturnedAssets,
  } = require('../controllers/customerManagementController');

  const lifecycle = String(filters.lifecycle || 'active').toLowerCase() === 'returned'
    ? 'returned'
    : 'active';
  const usePaging = filters.page != null || filters.limit != null;
  const { page, limit, offset } = paginate(filters);
  const opts = {
    search: filters.search || '',
    from: filters.date_from || '',
    to: filters.date_to || '',
    ...(usePaging ? { limit, offset } : {}),
  };

  const { rows, total } = lifecycle === 'returned'
    ? await queryCustomerReturnedAssets(customerId, opts)
    : await queryCustomerActiveAssets(customerId, opts);

  return {
    laptops: rows.map((r) => ({ ...r, config: configLabel(r) })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil((total || 0) / limit)),
    },
  };
}

module.exports = {
  CUSTOMER_STAGES,
  CUSTOMER_STAGE_LABELS,
  listCustomerOrders,
  getCustomerOrder,
  listCustomerTickets,
  listCustomerPendingRequests,
  getCustomerTicket,
  findCustomerAsset,
  listCustomerDeliveries,
  getCustomerDelivery,
  getCustomerDashboard,
  listCustomerLaptops,
};
