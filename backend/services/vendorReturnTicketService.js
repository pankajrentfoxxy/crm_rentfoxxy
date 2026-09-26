/**
 * Vendor rental-return tickets (VRT) — the return request (D10,
 * claude/carret-vendor-return-request.md). The user picks the rent stop date
 * (today or later) and a pickup slot; sending mails the vendor with a PDF and
 * stops the rent from that date. Wraps VRTDC for the laptops leaving.
 */
const pool = require('../config/db');
const { nextFinancialYearNumber } = require('./salesManagementService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { logVendorAudit } = require('./vendorAuditLogService');
const { sendDispatchMail, isDispatchMailConfigured } = require('./dispatchEmailService');
const { formatCompanyBlock } = require('../utils/companyDefaults');
const { createReturnDc } = require('./vendorReturnToVendorService');
const reqMail = require('./vendorReturnRequestMail');

const RENTAL_PO_TYPES = ['rental_purchase', 'rent_to_own'];
// The warehouse statuses a rented unit can sit in while the vendor bill is still
// charging us for it — the same set vendorReturnToVendorService accepts on the DC
// this ticket eventually raises. 'returned' (came back from a customer, now on our
// shelf) is the usual reason to hand a machine back and stop the rent, and the
// vendor bill keeps charging for it until vendor_rent_end_date is set, so leaving
// it out made the rent unstoppable from here. 'rented', 'in_repair' and the
// outward states stay out: the unit is not ours to hand over yet.
const ELIGIBLE_STATUSES = ['in_stock', 'returned', 'qc_failed'];
const LIVE_ITEM_STATUSES = ['requested', 'rental_stopped', 'dc_created', 'handed_over', 'vendor_received'];
// VENDOR_RETURN_NOTIFY_CC is the older name; VENDOR_RETURN_REQUEST_CC wins.
function returnMailCc() {
  if (String(process.env.VENDOR_RETURN_REQUEST_CC || '').trim()) return reqMail.requestCc();
  return String(process.env.VENDOR_RETURN_NOTIFY_CC || '').trim() || reqMail.requestCc();
}

const OPEN_TICKET_ITEM_SQL = `
  EXISTS (
    SELECT 1 FROM vendor_return_ticket_items i
     WHERE i.serial_id = vsn.serial_id
       AND i.item_status NOT IN ('cancelled','vendor_received')
  )
`;

function deriveTicketStatus(items) {
  const live = (items || []).filter((i) => i.item_status !== 'cancelled');
  if (!live.length) return 'cancelled';
  const statuses = live.map((i) => i.item_status);
  const done = (s) => s === 'handed_over' || s === 'vendor_received';
  if (statuses.every((s) => s === 'vendor_received')) return 'completed';
  if (statuses.every((s) => done(s))) return 'picked';
  if (statuses.some((s) => done(s)) && statuses.some((s) => !done(s))) return 'partially_picked';
  if (statuses.every((s) => s === 'requested')) return 'requested';
  return 'notified';
}

async function persistDerivedStatus(client, ticketNumber) {
  const items = await client.query(
    `SELECT item_status FROM vendor_return_ticket_items WHERE ticket_number = $1`,
    [ticketNumber]
  );
  const status = deriveTicketStatus(items.rows);
  await client.query(
    `UPDATE vendor_return_tickets
        SET status = $2::varchar,
            completed_at = CASE WHEN $2::text = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            updated_at = NOW()
      WHERE ticket_number = $1`,
    [ticketNumber, status]
  );
  return status;
}

async function listEligibleLaptops({ vendorId, search, page = 1, limit = 50 }) {
  const params = [RENTAL_PO_TYPES, ELIGIBLE_STATUSES];
  const where = [
    'vsn.deleted_at IS NULL',
    'vpo.deleted_at IS NULL',
    'vsn.po_id IS NOT NULL',
    'vpo.purchase_order_type = ANY($1::text[])',
    'vsn.inventory_status = ANY($2::text[])',
    'vsn.vendor_rent_end_date IS NULL',
    `NOT ${OPEN_TICKET_ITEM_SQL}`,
  ];
  if (vendorId) {
    params.push(Number(vendorId));
    where.push(`vpo.vendor_id = $${params.length}`);
  }
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    const n = params.length;
    where.push(`(
      vsn.serial_number ILIKE $${n}
      OR vsn.inventory_asset_code ILIKE $${n}
      OR COALESCE(vsn.extra->>'ttspl_id', '') ILIKE $${n}
      OR v.business_name ILIKE $${n}
    )`);
  }
  const offset = (Math.max(1, page) - 1) * limit;
  params.push(limit, offset);

  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT vsn.serial_id,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
              vsn.serial_number,
              vsn.inventory_status,
              vsn.qc_status,
              vsn.po_id,
              vsn.warehouse_carret,
              vsn.warehouse_carret_slot,
              vpo.purchase_order_number AS po_number,
              vpo.vendor_id,
              v.business_name AS vendor_name,
              COALESCE(vsn.extra->>'brand', '') AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model,
              COALESCE(vsn.extra->>'processor', '') AS processor,
              COALESCE(vsn.extra->>'ram', '') AS ram,
              COALESCE(vsn.extra->>'storage', '') AS storage,
              COALESCE(
                NULLIF(vsn.rent_monthly_rate, 0),
                NULLIF((vpo.line_items->0->>'rate')::numeric, 0),
                NULLIF((vpo.line_items->0->>'monthly_rental_amount')::numeric, 0),
                NULLIF((vpo.line_items->0->>'monthly_rate')::numeric, 0)
              ) AS monthly_rent_rate
         FROM vendor_serial_numbers vsn
         JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
         JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
        WHERE ${where.join(' AND ')}
        ORDER BY v.business_name, vpo.purchase_order_number, vsn.inventory_asset_code
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n
         FROM vendor_serial_numbers vsn
         JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
         JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
        WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    ),
  ]);

  return {
    data: rows.rows,
    pagination: {
      page: Math.max(1, page),
      limit,
      total: count.rows[0]?.n || 0,
      totalPages: Math.max(1, Math.ceil((count.rows[0]?.n || 0) / limit)),
    },
  };
}

async function listEligibleVendors() {
  const { rows } = await pool.query(
    `SELECT v.vendor_id,
            v.business_name,
            v.first_name,
            v.email,
            COUNT(*)::int AS inward_count
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
       JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
      WHERE vsn.deleted_at IS NULL
        AND vpo.deleted_at IS NULL
        AND vsn.po_id IS NOT NULL
        AND vpo.purchase_order_type = ANY($1::text[])
        AND vsn.inventory_status = ANY($2::text[])
        AND vsn.vendor_rent_end_date IS NULL
        AND NOT ${OPEN_TICKET_ITEM_SQL}
      GROUP BY v.vendor_id, v.business_name, v.first_name, v.email
      ORDER BY v.business_name NULLS LAST, v.first_name NULLS LAST`,
    [RENTAL_PO_TYPES, ELIGIBLE_STATUSES]
  );
  return rows;
}

async function getTicket(ticketNumber, db = pool) {
  const head = await db.query(
    `SELECT t.*, v.email AS vendor_email_live, v.phone AS vendor_phone,
            v.contact_person_name AS vendor_contact_name
       FROM vendor_return_tickets t
       LEFT JOIN vendors v ON v.vendor_id = t.vendor_id AND v.deleted_at IS NULL
      WHERE t.ticket_number = $1`,
    [ticketNumber]
  );
  if (!head.rows[0]) return null;
  const items = await db.query(
    `SELECT i.*, vpo.purchase_order_number AS po_number
       FROM vendor_return_ticket_items i
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = i.po_id
      WHERE i.ticket_number = $1
      ORDER BY i.id`,
    [ticketNumber]
  );
  const dcs = await db.query(
    `SELECT d.dc_number, d.status, d.dispatched_at, d.created_at, d.vendor_received_at,
            (SELECT COUNT(*)::int FROM vendor_return_dc_items i WHERE i.dc_number = d.dc_number) AS item_count
       FROM vendor_return_delivery_challans d
      WHERE d.return_ticket_number = $1
      ORDER BY d.created_at`,
    [ticketNumber]
  );
  const h = head.rows[0];
  const ticket = {
    ...h,
    rent_stop_date: reqMail.ymd(h.rent_stop_date),
    pickup_date: reqMail.ymd(h.pickup_date),
    reason_label: reqMail.reasonLabel(h.reason_code, h.return_reason),
    items: items.rows,
    dcs: dcs.rows,
    derived_status: deriveTicketStatus(items.rows),
  };
  return ticket;
}

async function listTickets({ status, vendorId, page = 1, limit = 25 }) {
  const params = [];
  const where = ['1=1'];
  if (status) {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }
  if (vendorId) {
    params.push(Number(vendorId));
    where.push(`t.vendor_id = $${params.length}`);
  }
  const offset = (Math.max(1, page) - 1) * limit;
  params.push(limit, offset);

  const [list, count] = await Promise.all([
    pool.query(
      `SELECT t.*,
              (SELECT COUNT(*)::int FROM vendor_return_ticket_items i
                WHERE i.ticket_number = t.ticket_number AND i.item_status <> 'cancelled') AS item_count
         FROM vendor_return_tickets t
        WHERE ${where.join(' AND ')}
        ORDER BY t.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM vendor_return_tickets t WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    ),
  ]);

  return {
    data: list.rows.map((r) => ({
      ...r,
      rent_stop_date: reqMail.ymd(r.rent_stop_date),
      pickup_date: reqMail.ymd(r.pickup_date),
    })),
    pagination: {
      page: Math.max(1, page),
      limit,
      total: count.rows[0]?.n || 0,
      totalPages: Math.max(1, Math.ceil((count.rows[0]?.n || 0) / limit)),
    },
  };
}

async function assertSerialEligible(client, serialId, vendorId) {
  const r = await client.query(
    `SELECT vsn.*,
            vpo.po_id, vpo.purchase_order_number AS po_number, vpo.vendor_id,
            vpo.purchase_order_type, vpo.line_items,
            v.business_name AS vendor_name
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
       JOIN vendors v ON v.vendor_id = vpo.vendor_id AND v.deleted_at IS NULL
      WHERE vsn.serial_id = $1
        AND vsn.deleted_at IS NULL
      FOR UPDATE OF vsn`,
    [serialId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`Laptop serial #${serialId} not found`);
  if (!RENTAL_PO_TYPES.includes(String(row.purchase_order_type || ''))) {
    throw new Error(`${row.inventory_asset_code || row.serial_number}: not on a rental purchase PO`);
  }
  if (!ELIGIBLE_STATUSES.includes(String(row.inventory_status || ''))) {
    throw new Error(
      `${row.inventory_asset_code || row.serial_number}: not in the warehouse (status: ${row.inventory_status})`
    );
  }
  if (Number(row.vendor_id) !== Number(vendorId)) {
    throw new Error(`${row.inventory_asset_code || row.serial_number}: belongs to a different vendor`);
  }
  if (row.vendor_rent_end_date) {
    throw new Error(`${row.inventory_asset_code || row.serial_number}: vendor rental already stopped`);
  }
  const open = await client.query(
    `SELECT ticket_number FROM vendor_return_ticket_items
      WHERE serial_id = $1 AND item_status NOT IN ('cancelled','vendor_received')
      LIMIT 1`,
    [serialId]
  );
  if (open.rows.length) {
    throw new Error(
      `${row.inventory_asset_code || row.serial_number}: already on return ticket ${open.rows[0].ticket_number}`
    );
  }
  return row;
}

function snapshotRate(vsn) {
  const fromSerial = Number(vsn.rent_monthly_rate || 0);
  if (fromSerial) return fromSerial;
  const line = Array.isArray(vsn.line_items) ? vsn.line_items[0] : null;
  return Number(line?.rate || line?.monthly_rental_amount || line?.monthly_rate || 0) || null;
}

function buildConfig(vsn) {
  const ex = vsn.extra && typeof vsn.extra === 'object' ? vsn.extra : {};
  return [ex.brand || '', ex.model || ex.model_name || '', ex.processor || '', ex.ram || '', ex.storage || '']
    .filter(Boolean)
    .join(' / ');
}

async function createTicket(client, {
  vendorId,
  serialIds,
  returnReason,
  reasonCode,
  rentStopDate,
  pickupDate,
  pickupTime,
  remarks,
  actorUserId,
  actorName,
}) {
  if (!vendorId) throw new Error('Vendor is required');
  const code = reasonCode ? String(reasonCode).trim() : null;
  if (code && !reqMail.REASONS[code]) throw Object.assign(new Error('Unknown return reason'), { status: 400 });
  if (code === 'other' && String(returnReason || '').trim().length < 3) {
    throw Object.assign(new Error('Say why the laptops are going back'), { status: 400 });
  }
  const dates = reqMail.validateRequestDates({ rentStopDate, pickupDate, pickupTime });
  const reasonStored = code && code !== 'other' ? reqMail.REASONS[code].label : (returnReason || null);
  if (!Array.isArray(serialIds) || !serialIds.length) throw new Error('Select at least one laptop');
  const ids = [...new Set(serialIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)))];
  if (!ids.length) throw new Error('Invalid serial selection');

  const vRes = await client.query(
    `SELECT vendor_id, business_name, first_name, email
       FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [Number(vendorId)]
  );
  const vendor = vRes.rows[0];
  if (!vendor) throw new Error('Vendor not found');

  const serialRows = [];
  for (const sid of ids) {
    serialRows.push(await assertSerialEligible(client, sid, vendor.vendor_id));
  }

  const ticketNumber = await nextFinancialYearNumber('vendor_return_ticket', client);
  const vendorName = vendor.business_name || vendor.first_name || `Vendor ${vendor.vendor_id}`;

  await client.query(
    `INSERT INTO vendor_return_tickets (
       ticket_number, vendor_id, vendor_name, vendor_email, return_reason, remarks,
       status, request_date, created_by, reason_code, rent_stop_date, pickup_date, pickup_time
     ) VALUES ($1,$2,$3,$4,$5,$6,'requested',CURRENT_DATE,$7,$8,$9::date,$10::date,$11)`,
    [
      ticketNumber,
      vendor.vendor_id,
      vendorName,
      vendor.email || null,
      reasonStored,
      remarks || null,
      actorUserId || null,
      code,
      dates.rentStopDate,
      dates.pickupDate,
      dates.pickupTime,
    ]
  );

  for (const vsn of serialRows) {
    const ttspl = vsn.inventory_asset_code || vsn.extra?.ttspl_id || null;
    await client.query(
      `INSERT INTO vendor_return_ticket_items (
         ticket_number, serial_id, po_id, ttspl_id, serial_number, brand, model,
         configuration, monthly_rent_rate, item_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'requested')`,
      [
        ticketNumber,
        vsn.serial_id,
        vsn.po_id,
        ttspl,
        vsn.serial_number,
        vsn.extra?.brand || null,
        vsn.extra?.model || vsn.extra?.model_name || null,
        buildConfig(vsn),
        snapshotRate(vsn),
      ]
    );
    await client.query(
      `UPDATE vendor_serial_numbers
          SET vendor_return_ticket_number = $2, updated_at = NOW()
        WHERE serial_id = $1`,
      [vsn.serial_id, ticketNumber]
    );
    await logTtsplEvent({
      db: client,
      vendorSerialId: vsn.serial_id,
      ttsplId: ttspl,
      eventType: 'vendor_return_ticket_created',
      description: `Added to vendor return ticket ${ticketNumber}`,
      metadata: { ticket_number: ticketNumber },
      actorUserId,
      actorName,
    });
  }

  await logVendorAudit({
    actorUserId,
    vendorId: vendor.vendor_id,
    entityType: 'vendor_return_ticket',
    entityId: ticketNumber,
    action: 'ticket_created',
    payload: {
      serial_ids: ids, return_reason: reasonStored, rent_stop_date: dates.rentStopDate,
      pickup_date: dates.pickupDate, pickup_time: dates.pickupTime,
    },
  });

  return getTicket(ticketNumber, client);
}

/** Change the reason, dates or note before the vendor is told. */
async function updateTicket(client, {
  ticketNumber, reasonCode, returnReason, rentStopDate, pickupDate, pickupTime, remarks, actorUserId,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_return_tickets WHERE ticket_number = $1 FOR UPDATE`,
    [ticketNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw Object.assign(new Error('Return request not found'), { status: 404 });
  if (head.status !== 'requested' || head.vendor_notified_at) {
    throw Object.assign(new Error('The vendor has already been told — this request can no longer be changed'), { status: 409 });
  }
  const code = reasonCode !== undefined ? (reasonCode ? String(reasonCode).trim() : null) : head.reason_code;
  if (code && !reqMail.REASONS[code]) throw Object.assign(new Error('Unknown return reason'), { status: 400 });
  const free = returnReason !== undefined ? returnReason : head.return_reason;
  if (code === 'other' && String(free || '').trim().length < 3) {
    throw Object.assign(new Error('Say why the laptops are going back'), { status: 400 });
  }
  const dates = reqMail.validateRequestDates({
    rentStopDate: rentStopDate !== undefined ? rentStopDate : reqMail.ymd(head.rent_stop_date),
    pickupDate: pickupDate !== undefined ? pickupDate : reqMail.ymd(head.pickup_date),
    pickupTime: pickupTime !== undefined ? pickupTime : head.pickup_time,
  });
  await client.query(
    `UPDATE vendor_return_tickets
        SET reason_code = $2, return_reason = $3, rent_stop_date = $4::date,
            pickup_date = $5::date, pickup_time = $6, remarks = $7, updated_at = NOW()
      WHERE ticket_number = $1`,
    [
      ticketNumber, code,
      code && code !== 'other' ? reqMail.REASONS[code].label : (free || null),
      dates.rentStopDate, dates.pickupDate, dates.pickupTime,
      remarks !== undefined ? (remarks || null) : head.remarks,
    ]
  );
  await logVendorAudit({
    actorUserId,
    vendorId: head.vendor_id,
    entityType: 'vendor_return_ticket',
    entityId: ticketNumber,
    action: 'ticket_updated',
    payload: { reason_code: code, rent_stop_date: dates.rentStopDate, pickup_date: dates.pickupDate, pickup_time: dates.pickupTime },
  });
  return getTicket(ticketNumber, client);
}

async function writeNotifyError(ticketNumber, message) {
  await pool.query(
    `UPDATE vendor_return_tickets SET notify_error = $2, updated_at = NOW() WHERE ticket_number = $1`,
    [ticketNumber, String(message || '').slice(0, 1000)]
  );
}

/**
 * Everything the mail and the PDF need, read on the caller's connection (the
 * send runs inside its transaction). Items: live (not cancelled), with PO number
 * and the laptop's own spec fields.
 */
async function loadRequestContext(db, ticketNumber, { lock = false } = {}) {
  const headRes = await db.query(
    `SELECT * FROM vendor_return_tickets WHERE ticket_number = $1${lock ? ' FOR UPDATE' : ''}`,
    [ticketNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw Object.assign(new Error('Return request not found'), { status: 404 });
  const vendor = (await db.query(
    `SELECT * FROM vendors WHERE vendor_id = $1`,
    [head.vendor_id]
  )).rows[0] || null;
  const itemsRes = await db.query(
    `SELECT i.*, vpo.purchase_order_number AS po_number, vsn.extra AS serial_extra
       FROM vendor_return_ticket_items i
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = i.po_id
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = i.serial_id
      WHERE i.ticket_number = $1
      ORDER BY i.id`,
    [ticketNumber]
  );
  const { resolveVrdcItemSpecs } = require('./vendorRepairDcShared');
  const items = itemsRes.rows.map((r) => {
    const spec = resolveVrdcItemSpecs({ ...r, extra: r.serial_extra || {} });
    return {
      ...r,
      brand: spec.brand || r.brand,
      model: spec.model || r.model,
      processor: spec.processor,
      generation: spec.generation,
      ram: spec.ram,
      storage: spec.storage,
    };
  });
  return { head, vendor, items };
}

/** The stop date a send would apply: the chosen one, or today if none was set. */
function effectiveStopDate(head) {
  return reqMail.ymd(head.rent_stop_date) || reqMail.todayIst();
}

function mailParts({ head, vendor, items, stopDate }) {
  const live = items.filter((i) => i.item_status !== 'cancelled');
  const to = String(vendor?.email || head.vendor_email || '').trim();
  const cc = returnMailCc();
  const mail = reqMail.buildRequestMail({
    ticket: { ...head, vendor_name: head.vendor_name || vendor?.business_name },
    items: live,
    stopDate,
    contactName: vendor?.contact_person_name || null,
    pickupAddress: formatCompanyBlock(),
  });
  return { live, to, cc, ...mail };
}

/** What "Send to vendor" would send — for the screen, before anything changes. */
async function previewRequest(ticketNumber) {
  const ctx = await loadRequestContext(pool, ticketNumber);
  const stopDate = effectiveStopDate(ctx.head);
  const parts = mailParts({ ...ctx, stopDate });
  return {
    to: parts.to || null,
    cc: parts.cc,
    subject: parts.subject,
    html: parts.html,
    rent_stop_date: stopDate,
    last_billed_date: reqMail.lastBilledDay(stopDate),
    stop_date_passed: stopDate < reqMail.todayIst(),
    laptops: parts.live.length,
  };
}

async function buildRequestPdf(db, ctx, stopDate) {
  const { generateReturnRequestPdf } = require('./vendorReturnRequestPdfService');
  const live = ctx.items.filter((i) => i.item_status !== 'cancelled');
  return generateReturnRequestPdf({
    ticket: { ...ctx.head, reason_label: reqMail.reasonLabel(ctx.head.reason_code, ctx.head.return_reason) },
    items: live,
    vendor: ctx.vendor,
    stopDate,
  });
}

/** The request PDF for download (as it stands now). */
async function requestPdf(ticketNumber) {
  const ctx = await loadRequestContext(pool, ticketNumber);
  return buildRequestPdf(pool, ctx, effectiveStopDate(ctx.head));
}

async function notifyVendor(client, { ticketNumber, actorUserId, actorName }) {
  const ctx = await loadRequestContext(client, ticketNumber, { lock: true });
  const { head } = ctx;
  if (head.status === 'cancelled') throw new Error('Ticket is cancelled');
  if (head.vendor_notified_at) {
    return { already_notified: true, ticket: await getTicket(ticketNumber, client) };
  }

  // D10: the chosen date, never in the past. A request drafted for today and
  // sent tomorrow must be re-dated, or the vendor is told rent stopped on a
  // day that has gone.
  const stopDate = effectiveStopDate(head);
  if (stopDate < reqMail.todayIst()) {
    throw Object.assign(
      new Error(`The rent stop date ${reqMail.prettyDate(stopDate)} has passed — change it to today or later before sending`),
      { status: 409 }
    );
  }
  const lastBilled = reqMail.lastBilledDay(stopDate);

  const parts = mailParts({ ...ctx, stopDate });
  if (!parts.to) throw new Error('Vendor has no email address on file.');
  if (!isDispatchMailConfigured()) {
    throw new Error('Dispatch email is not configured (DISPATCH_SMTP_*).');
  }
  if (!parts.live.length) throw new Error('No live laptops on this ticket');

  // Database first, email last, all in the caller's transaction: if the email
  // fails, everything rolls back and the vendor was told nothing; the vendor
  // is only told rent stopped once our records say so. (It used to send the
  // email first, and record failures through the pool on the row this
  // transaction had locked — which hung the request until timeout.)
  const pdfRel = await buildRequestPdf(client, ctx, stopDate);
  await client.query(
    `UPDATE vendor_return_tickets
        SET vendor_notified_at = NOW(), vendor_notified_by = $2,
            status = 'notified', notify_error = NULL,
            rent_stop_date = $3::date, notify_to = $4, notify_cc = $5, request_pdf_path = $6,
            updated_at = NOW()
      WHERE ticket_number = $1`,
    [ticketNumber, actorUserId || null, stopDate, parts.to, parts.cc, pdfRel]
  );
  await client.query(
    `UPDATE vendor_return_ticket_items
        SET item_status = 'rental_stopped', rental_stopped_at = NOW()
      WHERE ticket_number = $1 AND item_status = 'requested'`,
    [ticketNumber]
  );
  // vendor_rent_end_date is the last billed day (inclusive), so "stops from
  // the 1st" stores the 30th.
  await client.query(
    `UPDATE vendor_serial_numbers vsn
        SET vendor_rent_end_date = COALESCE(vsn.vendor_rent_end_date, $2::date),
            updated_at = NOW()
       FROM vendor_return_ticket_items i
      WHERE i.serial_id = vsn.serial_id AND i.ticket_number = $1
        AND i.item_status <> 'cancelled'`,
    [ticketNumber, lastBilled]
  );
  await persistDerivedStatus(client, ticketNumber);

  for (const item of parts.live) {
    await logTtsplEvent({
      db: client,
      vendorSerialId: item.serial_id,
      ttsplId: item.ttspl_id,
      eventType: 'vendor_return_rental_stopped',
      description: `Return request ${ticketNumber} sent to the vendor — rent stops from ${stopDate}`,
      metadata: { ticket_number: ticketNumber, rent_stop_date: stopDate, last_billed_date: lastBilled },
      actorUserId,
      actorName,
    });
  }

  let ok = false;
  let mailError = null;
  try {
    ok = await sendDispatchMail({
      to: parts.to,
      cc: parts.cc || undefined,
      subject: parts.subject,
      text: parts.text,
      html: parts.html,
      pdfRelativePath: `uploads/${pdfRel}`,
      userTriggered: true,
    });
  } catch (err) {
    mailError = err.message || String(err);
  }
  if (!ok) {
    const fail = new Error('Vendor notification email could not be sent. Nothing was changed.');
    fail.status = 503;
    // Written by the caller AFTER its rollback, when the row is unlocked.
    fail.notifyError = mailError || 'sendDispatchMail returned false';
    fail.ticketNumber = ticketNumber;
    throw fail;
  }

  await logVendorAudit({
    actorUserId,
    vendorId: head.vendor_id,
    entityType: 'vendor_return_ticket',
    entityId: ticketNumber,
    action: 'vendor_notified',
    payload: {
      serial_ids: parts.live.map((i) => i.serial_id),
      rent_stop_date: stopDate,
      last_billed_date: lastBilled,
      email: parts.to,
      cc: parts.cc,
    },
  });

  return { already_notified: false, ticket: await getTicket(ticketNumber, client) };
}

async function createDcFromTicket(client, {
  ticketNumber,
  serialIds,
  returnReason,
  remarks,
  actorUserId,
  actorName,
}) {
  const headRes = await client.query(
    `SELECT * FROM vendor_return_tickets WHERE ticket_number = $1 FOR UPDATE`,
    [ticketNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Return ticket not found');
  if (head.status === 'cancelled') throw new Error('Ticket is cancelled');
  if (!head.vendor_notified_at) throw new Error('Notify the vendor before creating a return DC');

  if (!Array.isArray(serialIds) || !serialIds.length) throw new Error('Select at least one laptop');
  const ids = [...new Set(serialIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)))];

  const items = await client.query(
    `SELECT * FROM vendor_return_ticket_items
      WHERE ticket_number = $1 AND serial_id = ANY($2::int[])
      FOR UPDATE`,
    [ticketNumber, ids]
  );
  if (items.rows.length !== ids.length) {
    throw new Error('One or more laptops are not on this ticket');
  }
  for (const item of items.rows) {
    if (item.item_status !== 'rental_stopped') {
      throw new Error(
        `${item.ttspl_id || item.serial_number}: cannot add to DC (status: ${item.item_status})`
      );
    }
  }

  const created = await createReturnDc(client, {
    viaReturnRequest: true,
    serialIds: ids,
    vendorId: head.vendor_id,
    returnReason: returnReason || head.return_reason,
    remarks: remarks || head.remarks,
    actorUserId,
    actorName,
  });

  await client.query(
    `UPDATE vendor_return_delivery_challans
        SET return_ticket_number = $2, updated_at = NOW()
      WHERE dc_number = $1`,
    [created.dc_number, ticketNumber]
  );
  await client.query(
    `UPDATE vendor_return_ticket_items
        SET item_status = 'dc_created', dc_number = $2
      WHERE ticket_number = $1 AND serial_id = ANY($3::int[])`,
    [ticketNumber, created.dc_number, ids]
  );
  await persistDerivedStatus(client, ticketNumber);

  await logVendorAudit({
    actorUserId,
    vendorId: head.vendor_id,
    entityType: 'vendor_return_ticket',
    entityId: ticketNumber,
    action: 'vrtdc_created',
    payload: { dc_number: created.dc_number, serial_ids: ids },
  });

  return {
    dc_number: created.dc_number,
    ticket: await getTicket(ticketNumber, client),
  };
}

async function syncFromDc(client, { dcNumber, phase }) {
  const dcRes = await client.query(
    `SELECT return_ticket_number FROM vendor_return_delivery_challans WHERE dc_number = $1`,
    [dcNumber]
  );
  const ticketNumber = dcRes.rows[0]?.return_ticket_number;
  if (!ticketNumber) return null;

  if (phase === 'dispatched') {
    await client.query(
      `UPDATE vendor_return_ticket_items
          SET item_status = 'handed_over', handed_over_at = NOW()
        WHERE dc_number = $1 AND item_status IN ('dc_created','rental_stopped')`,
      [dcNumber]
    );
  } else if (phase === 'completed') {
    await client.query(
      `UPDATE vendor_return_ticket_items
          SET item_status = 'vendor_received', vendor_received_at = NOW()
        WHERE dc_number = $1 AND item_status <> 'cancelled'`,
      [dcNumber]
    );
  } else if (phase === 'cancelled') {
    await client.query(
      `UPDATE vendor_return_ticket_items
          SET item_status = 'rental_stopped', dc_number = NULL
        WHERE dc_number = $1 AND item_status = 'dc_created'`,
      [dcNumber]
    );
  }

  await persistDerivedStatus(client, ticketNumber);
  return ticketNumber;
}

async function cancelTicketItems(client, { ticketNumber, serialIds, reason, actorUserId, actorName }) {
  if (!Array.isArray(serialIds) || !serialIds.length) throw new Error('Select at least one laptop');
  const ids = [...new Set(serialIds.map((id) => Number(id)).filter((n) => Number.isFinite(n)))];

  const head = (await client.query(
    `SELECT * FROM vendor_return_tickets WHERE ticket_number = $1 FOR UPDATE`,
    [ticketNumber]
  )).rows[0];
  if (!head) throw Object.assign(new Error('Return request not found'), { status: 404 });

  const items = await client.query(
    `SELECT * FROM vendor_return_ticket_items
      WHERE ticket_number = $1 AND serial_id = ANY($2::int[])
      FOR UPDATE`,
    [ticketNumber, ids]
  );
  if (items.rows.length !== ids.length) throw new Error('One or more laptops are not on this request');
  for (const item of items.rows) {
    if (!['requested', 'rental_stopped'].includes(item.item_status)) {
      throw new Error(
        `${item.ttspl_id || item.serial_number}: cannot cancel after a return DC is created`
      );
    }
  }
  // Laptops the vendor has already been told about: the vendor gets told the
  // return is off, so there has to be a reason to give.
  const told = items.rows.filter((i) => i.item_status === 'rental_stopped');
  if (told.length && String(reason || '').trim().length < 3) {
    throw Object.assign(new Error('Give a reason — the vendor is told these laptops are no longer coming back'), { status: 400 });
  }

  await client.query(
    `UPDATE vendor_return_ticket_items
        SET item_status = 'cancelled', remarks = COALESCE($3::text, remarks)
      WHERE ticket_number = $1 AND serial_id = ANY($2::int[])`,
    [ticketNumber, ids, reason || null]
  );
  await client.query(
    `UPDATE vendor_serial_numbers
        SET vendor_return_ticket_number = NULL, updated_at = NOW()
      WHERE serial_id = ANY($1::int[])
        AND vendor_return_ticket_number = $2`,
    [ids, ticketNumber]
  );

  // D10: the laptop stays with us, so its rent resumes — but only where the end
  // date is still the one this request set (older requests stopped rent on the
  // day of the mail) and the laptop is still in our warehouse.
  let resumed = [];
  if (told.length) {
    const r = await client.query(
      `UPDATE vendor_serial_numbers vsn
          SET vendor_rent_end_date = NULL, updated_at = NOW()
         FROM vendor_return_ticket_items i
        WHERE i.ticket_number = $1
          AND i.serial_id = vsn.serial_id
          AND i.serial_id = ANY($2::int[])
          AND vsn.vendor_rent_end_date = COALESCE($3::date - 1, i.rental_stopped_at::date)
          AND vsn.inventory_status = ANY($4::text[])
        RETURNING vsn.serial_id`,
      [ticketNumber, told.map((i) => i.serial_id), head.rent_stop_date, ELIGIBLE_STATUSES]
    );
    resumed = r.rows.map((x) => x.serial_id);
  }
  await persistDerivedStatus(client, ticketNumber);

  for (const item of told) {
    await logTtsplEvent({
      db: client,
      vendorSerialId: item.serial_id,
      ttsplId: item.ttspl_id,
      eventType: 'vendor_return_cancelled',
      description: resumed.includes(item.serial_id)
        ? `Taken off return request ${ticketNumber} — vendor rent resumes`
        : `Taken off return request ${ticketNumber}`,
      metadata: { ticket_number: ticketNumber, reason: reason || null, rent_resumed: resumed.includes(item.serial_id) },
      actorUserId,
      actorName,
    });
  }

  await logVendorAudit({
    actorUserId,
    vendorId: head.vendor_id,
    entityType: 'vendor_return_ticket',
    entityId: ticketNumber,
    action: 'items_cancelled',
    payload: { serial_ids: ids, reason: reason || null, rent_resumed: resumed },
  });

  // Mail last, like the send: if it can't go, nothing above is kept.
  if (told.length) {
    const vendor = (await client.query('SELECT * FROM vendors WHERE vendor_id = $1', [head.vendor_id])).rows[0];
    const to = String(vendor?.email || head.notify_to || head.vendor_email || '').trim();
    if (!to) throw new Error('Vendor has no email address on file — cannot tell them the return is off.');
    const remaining = (await client.query(
      `SELECT COUNT(*)::int AS n FROM vendor_return_ticket_items
        WHERE ticket_number = $1 AND item_status <> 'cancelled'`,
      [ticketNumber]
    )).rows[0].n;
    const mail = reqMail.buildCancelMail({
      ticket: head, items: told, contactName: vendor?.contact_person_name || null, remainingCount: remaining, reason,
    });
    let ok = false;
    try {
      ok = await sendDispatchMail({
        to, cc: head.notify_cc || returnMailCc(), subject: mail.subject, text: mail.text, html: mail.html, userTriggered: true,
      });
    } catch (_) { ok = false; }
    if (!ok) {
      throw Object.assign(new Error('The cancellation mail to the vendor could not be sent. Nothing was changed.'), { status: 503 });
    }
    await client.query(
      `UPDATE vendor_return_tickets SET cancel_mail_sent_at = NOW(), updated_at = NOW() WHERE ticket_number = $1`,
      [ticketNumber]
    );
  }

  return getTicket(ticketNumber, client);
}

async function cancelTicket(client, { ticketNumber, reason, actorUserId, actorName }) {
  const items = await client.query(
    `SELECT * FROM vendor_return_ticket_items WHERE ticket_number = $1 FOR UPDATE`,
    [ticketNumber]
  );
  const blocking = items.rows.filter((i) => !['requested', 'rental_stopped', 'cancelled'].includes(i.item_status));
  if (blocking.length) {
    throw new Error('Cancel or complete linked return DCs before cancelling this ticket');
  }
  const liveIds = items.rows
    .filter((i) => i.item_status !== 'cancelled')
    .map((i) => i.serial_id);
  if (liveIds.length) {
    await cancelTicketItems(client, {
      ticketNumber,
      serialIds: liveIds,
      reason,
      actorUserId,
      actorName,
    });
  }
  await client.query(
    `UPDATE vendor_return_tickets
        SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2::text, updated_at = NOW()
      WHERE ticket_number = $1`,
    [ticketNumber, reason || null]
  );
  return getTicket(ticketNumber, client);
}

module.exports = {
  writeNotifyError,
  RENTAL_PO_TYPES,
  LIVE_ITEM_STATUSES,
  deriveTicketStatus,
  listEligibleLaptops,
  listEligibleVendors,
  listTickets,
  getTicket,
  createTicket,
  updateTicket,
  previewRequest,
  requestPdf,
  notifyVendor,
  createDcFromTicket,
  syncFromDc,
  cancelTicketItems,
  cancelTicket,
};
