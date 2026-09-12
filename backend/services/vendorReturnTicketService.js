/**
 * Vendor rental-return tickets (VRT). Wraps VRTDC; rent stops on successful vendor notify.
 */
const pool = require('../config/db');
const { nextFinancialYearNumber } = require('./salesManagementService');
const { logTtsplEvent } = require('./ttsplAuditService');
const { logVendorAudit } = require('./vendorAuditLogService');
const { sendDispatchMail, isDispatchMailConfigured } = require('./dispatchEmailService');
const { formatCompanyBlock } = require('../utils/companyDefaults');
const { createReturnDc } = require('./vendorReturnToVendorService');

const RENTAL_PO_TYPES = ['rental_purchase', 'rent_to_own'];
const ELIGIBLE_STATUSES = ['in_stock'];
const LIVE_ITEM_STATUSES = ['requested', 'rental_stopped', 'dc_created', 'handed_over', 'vendor_received'];
const RETURN_NOTIFY_CC = process.env.VENDOR_RETURN_NOTIFY_CC || process.env.ACCOUNTS_EMAIL_CC || '';

const OPEN_TICKET_ITEM_SQL = `
  EXISTS (
    SELECT 1 FROM vendor_return_ticket_items i
     WHERE i.serial_id = vsn.serial_id
       AND i.item_status NOT IN ('cancelled','vendor_received')
  )
`;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
    `SELECT t.*, v.email AS vendor_email_live, v.phone AS vendor_phone
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
  const ticket = {
    ...head.rows[0],
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
    data: list.rows,
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
  if (String(row.inventory_status || '') !== 'in_stock') {
    throw new Error(
      `${row.inventory_asset_code || row.serial_number}: only in-stock laptops can be returned (status: ${row.inventory_status})`
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
  remarks,
  actorUserId,
  actorName,
}) {
  if (!vendorId) throw new Error('Vendor is required');
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
       status, request_date, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,'requested',CURRENT_DATE,$7)`,
    [
      ticketNumber,
      vendor.vendor_id,
      vendorName,
      vendor.email || null,
      returnReason || null,
      remarks || null,
      actorUserId || null,
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
    payload: { serial_ids: ids, return_reason: returnReason || null },
  });

  return getTicket(ticketNumber, client);
}

function buildNotifyBodies(ticket, items) {
  const warehouse = formatCompanyBlock();
  const rows = items.filter((i) => i.item_status !== 'cancelled');
  const stopDate = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const requestDate = ticket.request_date
    ? new Date(ticket.request_date).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
    : stopDate;

  const tableRows = rows.map((r) => (
    `<tr>
      <td style="padding:6px 8px;border:1px solid #e5e7eb">${escapeHtml(r.ttspl_id)}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb">${escapeHtml(r.serial_number)}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb">${escapeHtml([r.brand, r.model].filter(Boolean).join(' '))}</td>
      <td style="padding:6px 8px;border:1px solid #e5e7eb">${escapeHtml(r.configuration)}</td>
    </tr>`
  )).join('');

  const html = `
    <p>Dear ${escapeHtml(ticket.vendor_name || 'Vendor')},</p>
    <p>Please collect the following rental units from our warehouse. Vendor rental on these units <strong>stops from ${escapeHtml(stopDate)}</strong>.</p>
    <p>
      Ticket: <strong>${escapeHtml(ticket.ticket_number)}</strong><br/>
      Request date: ${escapeHtml(requestDate)}<br/>
      Rent stop date: ${escapeHtml(stopDate)}
    </p>
    <table style="border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#0e7490;color:#fff">
          <th style="padding:6px 8px;text-align:left">Asset ID</th>
          <th style="padding:6px 8px;text-align:left">Serial</th>
          <th style="padding:6px 8px;text-align:left">Brand / Model</th>
          <th style="padding:6px 8px;text-align:left">Configuration</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p>The laptops are ready for collection at:</p>
    <pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(warehouse)}</pre>
    ${ticket.return_reason ? `<p>Reason: ${escapeHtml(ticket.return_reason)}</p>` : ''}
    <p>Regards,<br/>Rentfoxxy Warehouse</p>
  `;

  const text = [
    `Dear ${ticket.vendor_name || 'Vendor'},`,
    '',
    `Please collect the following rental units. Vendor rental stops from ${stopDate}.`,
    `Ticket: ${ticket.ticket_number}`,
    `Request date: ${requestDate}`,
    `Rent stop date: ${stopDate}`,
    '',
    ...rows.map((r) => `- ${r.ttspl_id || ''}  ${r.serial_number || ''}  ${[r.brand, r.model].filter(Boolean).join(' ')}`),
    '',
    'Ready for collection at:',
    warehouse,
    ticket.return_reason ? `Reason: ${ticket.return_reason}` : '',
    '',
    'Regards, Rentfoxxy Warehouse',
  ].filter(Boolean).join('\n');

  return { html, text, subject: `Vendor return ${ticket.ticket_number} — units ready for collection` };
}

async function writeNotifyError(ticketNumber, message) {
  await pool.query(
    `UPDATE vendor_return_tickets SET notify_error = $2, updated_at = NOW() WHERE ticket_number = $1`,
    [ticketNumber, String(message || '').slice(0, 1000)]
  );
}

async function notifyVendor(client, { ticketNumber, actorUserId, actorName }) {
  const headRes = await client.query(
    `SELECT * FROM vendor_return_tickets WHERE ticket_number = $1 FOR UPDATE`,
    [ticketNumber]
  );
  const head = headRes.rows[0];
  if (!head) throw new Error('Return ticket not found');
  if (head.status === 'cancelled') throw new Error('Ticket is cancelled');
  if (head.vendor_notified_at) {
    return { already_notified: true, ticket: await getTicket(ticketNumber, client) };
  }

  const email = String(head.vendor_email || '').trim();
  if (!email) throw new Error('Vendor has no email address on file.');
  if (!isDispatchMailConfigured()) {
    throw new Error('Dispatch email is not configured (DISPATCH_SMTP_*).');
  }

  const itemsRes = await client.query(
    `SELECT * FROM vendor_return_ticket_items WHERE ticket_number = $1 ORDER BY id`,
    [ticketNumber]
  );
  const live = itemsRes.rows.filter((i) => i.item_status !== 'cancelled');
  if (!live.length) throw new Error('No live laptops on this ticket');

  const { html, text, subject } = buildNotifyBodies(head, live);
  let ok = false;
  try {
    ok = await sendDispatchMail({
      to: email,
      cc: RETURN_NOTIFY_CC || undefined,
      subject,
      text,
      html,
    });
  } catch (err) {
    await writeNotifyError(ticketNumber, err.message || String(err));
    const fail = new Error('Vendor notification email could not be sent.');
    fail.status = 503;
    throw fail;
  }
  if (!ok) {
    await writeNotifyError(ticketNumber, 'sendDispatchMail returned false');
    const fail = new Error('Vendor notification email could not be sent.');
    fail.status = 503;
    throw fail;
  }

  try {
    await client.query(
      `UPDATE vendor_return_tickets
          SET vendor_notified_at = NOW(), vendor_notified_by = $2,
              status = 'notified', notify_error = NULL, updated_at = NOW()
        WHERE ticket_number = $1`,
      [ticketNumber, actorUserId || null]
    );
    await client.query(
      `UPDATE vendor_return_ticket_items
          SET item_status = 'rental_stopped', rental_stopped_at = NOW()
        WHERE ticket_number = $1 AND item_status = 'requested'`,
      [ticketNumber]
    );
    await client.query(
      `UPDATE vendor_serial_numbers vsn
          SET vendor_rent_end_date = COALESCE(vsn.vendor_rent_end_date, CURRENT_DATE),
              updated_at = NOW()
         FROM vendor_return_ticket_items i
        WHERE i.serial_id = vsn.serial_id AND i.ticket_number = $1
          AND i.item_status <> 'cancelled'`,
      [ticketNumber]
    );
    await persistDerivedStatus(client, ticketNumber);

    for (const item of live) {
      await logTtsplEvent({
        db: client,
        vendorSerialId: item.serial_id,
        ttsplId: item.ttspl_id,
        eventType: 'vendor_return_rental_stopped',
        description: `Vendor notified — rental stopped on ${ticketNumber}`,
        metadata: { ticket_number: ticketNumber },
        actorUserId,
        actorName,
      });
    }

    await logVendorAudit({
      actorUserId,
      vendorId: head.vendor_id,
      entityType: 'vendor_return_ticket',
      entityId: ticketNumber,
      action: 'vendor_notified',
      payload: {
        serial_ids: live.map((i) => i.serial_id),
        stopped_on: new Date().toISOString().slice(0, 10),
        email,
      },
    });
  } catch (err) {
    await writeNotifyError(ticketNumber, `email sent, rent stop failed: ${err.message}`);
    throw err;
  }

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

  const items = await client.query(
    `SELECT * FROM vendor_return_ticket_items
      WHERE ticket_number = $1 AND serial_id = ANY($2::int[])
      FOR UPDATE`,
    [ticketNumber, ids]
  );
  for (const item of items.rows) {
    if (!['requested', 'rental_stopped'].includes(item.item_status)) {
      throw new Error(
        `${item.ttspl_id || item.serial_number}: cannot cancel after a return DC is created`
      );
    }
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
  // Do not clear vendor_rent_end_date — cancelled ticket does not restart rent.
  await persistDerivedStatus(client, ticketNumber);

  await logVendorAudit({
    actorUserId,
    vendorId: null,
    entityType: 'vendor_return_ticket',
    entityId: ticketNumber,
    action: 'items_cancelled',
    payload: { serial_ids: ids, reason: reason || null },
  });

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
        SET status = 'cancelled', remarks = COALESCE($2::text, remarks), updated_at = NOW()
      WHERE ticket_number = $1`,
    [ticketNumber, reason || null]
  );
  return getTicket(ticketNumber, client);
}

module.exports = {
  RENTAL_PO_TYPES,
  LIVE_ITEM_STATUSES,
  deriveTicketStatus,
  listEligibleLaptops,
  listEligibleVendors,
  listTickets,
  getTicket,
  createTicket,
  notifyVendor,
  createDcFromTicket,
  syncFromDc,
  cancelTicketItems,
  cancelTicket,
};
