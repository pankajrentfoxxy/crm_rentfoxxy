'use strict';

const pool = require('../config/db');
const { hasPermission } = require('../services/permissionService');
const { pauseSla, resumeSla, recalcTicketSla } = require('../services/supportSlaService');
const {
  computeTicketStatus,
  logEvent,
  forceTicketStatus,
} = require('../services/supportTicketStateService');
const {
  createTicket,
  resolveLine,
  catalogChain,
  findRepeat,
  validatePause,
  normalizePauseContactMethod,
  nextPauseStreak,
  shouldFlagPauseAbuse,
  reopenWindowError,
  ticketResolveBlockers,
} = require('../services/supportTicketFlowService');
const { notifyEvent } = require('../services/supportNotificationService');
const { issueCsatToken } = require('../services/supportCsatService');
const {
  LATEST_DC_SQL,
  decorateSerialRow,
  siteKey,
  digitsPin,
} = require('../services/supportDeliverySite');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 tickets:', e);
  const body = { success: false, message: e.message };
  if (e.errors) body.errors = e.errors;
  if (e.missing) body.missing = e.missing;
  if (e.blockers) body.blockers = e.blockers;
  return res.status(status).json(body);
}

async function canSection(req, section, action = 'can_edit') {
  if (req.user && req.user.role === 'super_admin') return true;
  if (!req.permissionCache) req.permissionCache = {};
  return hasPermission(
    req.user.user_id,
    req.user.role,
    section,
    action,
    req.permissionCache
  );
}

async function loadTicket(db, id) {
  const r = await db.query('SELECT * FROM support_tickets_v2 WHERE ticket_id = $1', [id]);
  if (!r.rows[0]) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  return r.rows[0];
}

exports.searchCustomers = async (req, res) => {
  try {
    const q = String(req.query.q || req.query.search || '').trim();
    const params = [];
    let where = 'WHERE COALESCE(c.status, 1) = 1';
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (
        COALESCE(c.company_name, '') ILIKE $1 OR c.name ILIKE $1
        OR CAST(c.customer_id AS TEXT) LIKE $1
        OR COALESCE(c.phone, '') ILIKE $1
      )`;
    }
    params.push(Math.min(parseInt(req.query.limit, 10) || 20, 50));
    const r = await pool.query(
      `SELECT c.customer_id, c.name, c.company_name, c.email, c.phone, c.support_tier,
              COALESCE(c.company_name, c.name) AS display_name
         FROM customers c ${where}
        ORDER BY COALESCE(c.company_name, c.name) NULLS LAST
        LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

async function groupForPincode(db, pincode) {
  if (!pincode) return null;
  const pin = String(pincode).replace(/\D/g, '').slice(0, 6);
  if (pin.length < 6) return null;
  const r = await db.query(
    `SELECT g.group_id, g.name
       FROM support_zone_pincodes zp
       JOIN support_assignment_groups g
         ON g.zone_id = zp.zone_id AND g.group_type = 'FIELD' AND g.is_active = TRUE
      WHERE $1 BETWEEN zp.pincode_from AND zp.pincode_to
      LIMIT 1`,
    [pin]
  );
  return r.rows[0] || null;
}

exports.customerContext = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cust = (await pool.query(
      `SELECT customer_id, name, company_name, email, phone, support_tier
         FROM customers WHERE customer_id = $1`,
      [id]
    )).rows[0];
    if (!cust) return res.status(404).json({ success: false, message: 'Customer not found' });

    const [fleet, contract, openTickets, overdue, buffer, sites, sla] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS n FROM vendor_serial_numbers
          WHERE current_customer_id = $1 AND deleted_at IS NULL
            AND inventory_status IN ('rented','on_demo')`,
        [id]
      ),
      pool.query(
        `SELECT MAX(rent_end_date) AS contract_end
           FROM vendor_serial_numbers
          WHERE current_customer_id = $1 AND deleted_at IS NULL`,
        [id]
      ),
      pool.query(
        `SELECT ticket_id, ticket_number, subject, status, priority, created_at
           FROM support_tickets_v2
          WHERE customer_id = $1
            AND status IN ('NEW','TRIAGED','ASSIGNED','IN_PROGRESS','PENDING')
          ORDER BY created_at DESC
          LIMIT 8`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM customer_invoices
          WHERE customer_id = $1
            AND LOWER(COALESCE(status,'')) NOT IN ('paid','cancelled','waived','draft')
            AND COALESCE(due_date, invoice_date + INTERVAL '15 days') < CURRENT_DATE`,
        [id]
      ).catch(() => ({ rows: [{ n: 0 }] })),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM customer_buffer_stock
          WHERE customer_id = $1 AND status = 'AVAILABLE'`,
        [id]
      ).catch(() => ({ rows: [{ n: 0 }] })),
      pool.query(
        `SELECT customer_address_id, address, pincode, city, concern_person, mobile_no
           FROM customer_addresses WHERE customer_id = $1
           ORDER BY customer_address_id`,
        [id]
      ).catch(() => pool.query(
        `SELECT customer_address_id, address, pincode, concern_person, mobile_no
           FROM customer_addresses WHERE customer_id = $1
           ORDER BY customer_address_id`,
        [id]
      )),
      pool.query(
        `SELECT name FROM support_sla_policies
          WHERE active = TRUE
            AND (support_tier = $1 OR support_tier IS NULL)
          ORDER BY specificity DESC NULLS LAST
          LIMIT 1`,
        [cust.support_tier || null]
      ).catch(() => ({ rows: [] })),
    ]);

    const delivered = await pool.query(
      `SELECT s.serial_id, s.extra->>'pincode' AS extra_pincode,
              dc.dc_number, dc.customer_shipping_address
         FROM vendor_serial_numbers s
         ${LATEST_DC_SQL}
        WHERE s.current_customer_id = $1
          AND s.deleted_at IS NULL
          AND s.inventory_status IN ('rented','on_demo')`,
      [id]
    );
    const deliveryByKey = new Map();
    for (const row of delivered.rows) {
      const dec = decorateSerialRow(row);
      if (!dec.site_key) continue;
      if (!deliveryByKey.has(dec.site_key)) {
        deliveryByKey.set(dec.site_key, {
          site_key: dec.site_key,
          source: 'delivery',
          address: dec.delivery_address,
          pincode: dec.delivery_pincode,
          city: dec.delivery_city,
          dc_number: dec.dc_number,
          machine_count: 0,
          customer_address_id: null,
        });
      }
      deliveryByKey.get(dec.site_key).machine_count += 1;
    }

    const siteRows = [];
    for (const site of deliveryByKey.values()) {
      const crm = sites.rows.find((s) => digitsPin(s.pincode) && digitsPin(s.pincode) === digitsPin(site.pincode));
      if (crm) site.customer_address_id = crm.customer_address_id;
      const g = await groupForPincode(pool, site.pincode);
      siteRows.push({
        ...site,
        suggested_group_id: g ? g.group_id : null,
        suggested_group_name: g ? g.name : null,
      });
    }
    for (const s of sites.rows) {
      const pin = digitsPin(s.pincode);
      const already = siteRows.some((row) => digitsPin(row.pincode) === pin && pin);
      if (already) continue;
      const g = await groupForPincode(pool, s.pincode);
      siteRows.push({
        site_key: siteKey(pin, s.address),
        source: 'crm',
        customer_address_id: s.customer_address_id,
        address: s.address,
        pincode: pin || s.pincode,
        city: s.city || '',
        concern_person: s.concern_person,
        mobile_no: s.mobile_no,
        machine_count: 0,
        suggested_group_id: g ? g.group_id : null,
        suggested_group_name: g ? g.name : null,
      });
    }

    res.json({
      success: true,
      customer: cust,
      context: {
        support_tier: cust.support_tier,
        fleet_size: fleet.rows[0].n,
        contract_end: contract.rows[0].contract_end,
        sla_policy_name: sla.rows[0] ? sla.rows[0].name : null,
        buffer_units: buffer.rows[0].n,
        overdue_invoices: overdue.rows[0].n,
        open_tickets: openTickets.rows,
        sites: siteRows,
        contacts: [
          { name: cust.name, phone: cust.phone, email: cust.email, source: 'customer' },
          ...siteRows
            .filter((s) => s.concern_person)
            .map((s) => ({ name: s.concern_person, phone: s.mobile_no, source: 'site' })),
        ],
      },
    });
  } catch (e) { bad(res, e); }
};

exports.customerContacts = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query(
      `SELECT * FROM (
          SELECT 'c-' || c.customer_id::text AS contact_id,
                 COALESCE(c.name, c.company_name) AS name,
                 c.phone, c.email, 'CUSTOMER'::text AS source,
                 NULL::text AS site_label, TRUE AS is_primary
            FROM customers c WHERE c.customer_id = $1
          UNION ALL
          SELECT 'a-' || a.customer_address_id::text,
                 NULLIF(a.concern_person, ''),
                 a.mobile_no, NULL,
                 'SITE_CONTACT'::text,
                 CONCAT_WS(', ', NULLIF(a.address, ''), NULLIF(a.city, ''), NULLIF(a.pincode, '')),
                 FALSE
            FROM customer_addresses a
           WHERE a.customer_id = $1
             AND (NULLIF(a.concern_person, '') IS NOT NULL OR NULLIF(a.mobile_no, '') IS NOT NULL)
        ) x
       WHERE name IS NOT NULL OR phone IS NOT NULL`
      ,
      [id]
    );
    const seen = new Set();
    const rows = [];
    for (const row of r.rows) {
      const key = String(row.phone || '').replace(/\D/g, '').slice(-10) + '|' + String(row.name || '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    res.json({ success: true, rows });
  } catch (e) { bad(res, e); }
};

exports.customerAssets = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = String(req.query.q || '').trim();
    const r = await pool.query(
      `SELECT s.serial_id,
              s.inventory_asset_code AS ttspl_id,
              s.serial_number,
              COALESCE(s.extra->>'brand','') AS brand,
              COALESCE(s.extra->>'model', s.extra->>'model_name','') AS model,
              COALESCE(s.extra->>'ram','') AS ram,
              COALESCE(s.extra->>'storage','') AS storage,
              COALESCE(s.extra->>'assigned_employee', s.extra->>'assigned_to','') AS assigned_employee,
              COALESCE(s.extra->>'warranty_status','unknown') AS warranty_status,
              COALESCE(s.extra->>'pincode','') AS extra_pincode,
              s.delivered_at, s.rent_start_date, s.rent_end_date, s.rent_monthly_rate, s.inventory_status,
              COALESCE((s.extra->>'locking_period')::int, NULL) AS locking_period,
              dc.dc_number, dc.customer_shipping_address,
              (
                SELECT COUNT(*)::int FROM support_ticket_assets a
                 JOIN support_tickets_v2 t ON t.ticket_id = a.ticket_id
                WHERE a.serial_id = s.serial_id
                  AND t.created_at >= NOW() - INTERVAL '90 days'
              ) AS complaint_count_90d,
              (
                SELECT COUNT(*)::int FROM support_ticket_assets a
                 JOIN support_tickets_v2 t ON t.ticket_id = a.ticket_id
                WHERE a.serial_id = s.serial_id
                  AND t.status IN ('NEW','TRIAGED','ASSIGNED','IN_PROGRESS','PENDING')
              ) AS open_ticket_count
         FROM vendor_serial_numbers s
         ${LATEST_DC_SQL}
        WHERE s.current_customer_id = $1
          AND s.deleted_at IS NULL
          AND s.inventory_status IN ('rented','on_demo')
          AND (
            $2 = ''
            OR s.inventory_asset_code ILIKE '%' || $2 || '%'
            OR s.serial_number ILIKE '%' || $2 || '%'
            OR COALESCE(s.extra->>'assigned_employee','') ILIKE '%' || $2 || '%'
            OR COALESCE(s.extra->>'assigned_to','') ILIKE '%' || $2 || '%'
          )
        ORDER BY s.inventory_asset_code NULLS LAST, s.serial_id`,
      [id, q]
    );
    const rows = r.rows.map((row) => {
      const dec = decorateSerialRow(row);
      return {
        ...dec,
        pincode: dec.delivery_pincode || dec.extra_pincode || '',
        customer_shipping_address: undefined,
      };
    });
    res.json({ success: true, rows });
  } catch (e) { bad(res, e); }
};

exports.searchTickets = async (req, res) => {
  try {
    const raw = String(req.query.q || '').trim();
    if (!raw) return res.json({ success: true, rows: [] });
    const q = raw.replace(/^#/, '');
    const r = await pool.query(
      `SELECT ticket_id, ticket_number, legacy_ticket_number, subject, status, priority
         FROM support_tickets_v2
        WHERE ticket_number ILIKE $1
           OR legacy_ticket_number ILIKE $1
           OR CAST(ticket_id AS TEXT) = $2
           OR CAST(legacy_ticket_id AS TEXT) = $2
        ORDER BY ticket_id DESC
        LIMIT 8`,
      [`%${q}%`, q]
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.repeatCheck = async (req, res) => {
  try {
    const lineId = Number(req.params.lineId);
    const serialId = req.query.serial_id ? Number(req.query.serial_id) : null;
    const subtypeId = req.query.subtype_id ? Number(req.query.subtype_id) : null;
    const exclude = req.query.ticket_id ? Number(req.query.ticket_id) : null;
    if (lineId && !serialId) {
      const line = (await pool.query(
        'SELECT serial_id, reported_subtype_id, ticket_id FROM support_ticket_assets WHERE line_id = $1',
        [lineId]
      )).rows[0];
      if (!line) return res.status(404).json({ success: false, message: 'Line not found' });
      const hit = await findRepeat(pool, line.serial_id, line.reported_subtype_id, line.ticket_id);
      return res.json({ success: true, repeat: hit });
    }
    const hit = await findRepeat(pool, serialId, subtypeId, exclude);
    res.json({ success: true, repeat: hit });
  } catch (e) { bad(res, e); }
};

exports.create = async (req, res) => {
  try {
    const result = await createTicket(pool, req.body || {}, req.user && req.user.user_id);
    res.status(201).json({ success: true, ...result });
  } catch (e) { bad(res, e); }
};

exports.patchTicket = async (req, res) => {
  try {
    const id = Number(req.params.id);
    await loadTicket(pool, id);
    const b = req.body || {};
    await pool.query(
      `UPDATE support_tickets_v2 SET
         subject = COALESCE($2, subject),
         contact_name = COALESCE($3, contact_name),
         contact_phone = COALESCE($4, contact_phone),
         contact_email = COALESCE($5, contact_email),
         site_id = COALESCE($6, site_id),
         site_label = COALESCE($7, site_label),
         updated_at = NOW()
       WHERE ticket_id = $1`,
      [id, b.subject || null, b.contact_name || null, b.contact_phone || null,
        b.contact_email || null, b.site_id || null, b.site_label || null]
    );
    await logEvent(pool, {
      ticketId: id,
      eventType: 'TICKET_UPDATED',
      actorId: req.user.user_id,
      summary: 'Ticket details updated',
    });
    res.json({ success: true });
  } catch (e) { bad(res, e); }
};

exports.classify = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const lines = Array.isArray(req.body.asset_lines) ? req.body.asset_lines : [];
    if (!lines.length) return res.status(400).json({ success: false, message: 'asset_lines required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const line of lines) {
        if (!line.line_id || !line.reported_issue_id) {
          throw Object.assign(new Error('Every machine must be classified'), { status: 400 });
        }
        const chain = await catalogChain(client, line.reported_issue_id);
        if (!chain) throw Object.assign(new Error('Invalid reported_issue_id'), { status: 400 });
        await client.query(
          `UPDATE support_ticket_assets SET
             reported_type_id = $2, reported_subtype_id = $3, reported_issue_id = $4,
             reported_description = COALESCE($5, reported_description),
             impact = COALESCE($6, impact), urgency = COALESCE($7, urgency),
             is_safety = $8, updated_at = NOW()
           WHERE line_id = $1 AND ticket_id = $9`,
          [
            line.line_id, chain.type.catalog_id, chain.subtype.catalog_id, chain.issue.catalog_id,
            line.reported_description || null, line.impact || null, line.urgency || null,
            Boolean(chain.issue.is_safety), id,
          ]
        );
      }
      await logEvent(client, {
        ticketId: id,
        eventType: 'CLASSIFIED',
        actorId: req.user.user_id,
        summary: 'Lines reclassified',
      });
      await computeTicketStatus(client, id);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true });
  } catch (e) { bad(res, e); }
};

exports.priorityOverride = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const priority = Number(req.body.priority);
    const reason = String(req.body.reason || '').trim();
    if (![1, 2, 3, 4].includes(priority) || reason.length < 3) {
      return res.status(400).json({ success: false, message: 'priority and reason required' });
    }
    await loadTicket(pool, id);
    await pool.query(
      `UPDATE support_tickets_v2
          SET priority = $2, priority_overridden = TRUE, priority_override_reason = $3, updated_at = NOW()
        WHERE ticket_id = $1`,
      [id, priority, reason]
    );
    await logEvent(pool, {
      ticketId: id,
      eventType: 'PRIORITY_OVERRIDE',
      actorId: req.user.user_id,
      summary: `Priority overridden to P${priority}`,
      detail: { priority, reason },
    });
    res.json({ success: true, priority });
  } catch (e) { bad(res, e); }
};

exports.assign = async (req, res) => {
  try {
    const id = Number(req.params.id);
    await loadTicket(pool, id);
    if (req.body.user_id) {
      const { assertAssignable } = require('../services/supportAssignmentEngine');
      await assertAssignable(pool, req.body.user_id, req.body.slot_start || req.body.date);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE support_tickets_v2
            SET assignment_group_id = COALESCE($2, assignment_group_id),
                assigned_to = COALESCE($3, assigned_to),
                updated_at = NOW()
          WHERE ticket_id = $1`,
        [id, req.body.group_id || null, req.body.user_id || null]
      );
      await logEvent(client, {
        ticketId: id,
        eventType: 'TICKET_ASSIGNED',
        actorId: req.user.user_id,
        summary: 'Ticket assigned',
        detail: { group_id: req.body.group_id || null, user_id: req.body.user_id || null },
      });
      const state = await computeTicketStatus(client, id);
      await client.query('COMMIT');
      res.json({ success: true, ...state });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.setStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ticket = await loadTicket(pool, id);
    const next = String(req.body.status || '').toUpperCase();
    const note = req.body.note || null;
    if (['CLOSED', 'CANCELLED', 'RESOLVED'].includes(next)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const state = await forceTicketStatus(client, id, next, {
          actorId: req.user.user_id,
          summary: note || `Status → ${next}`,
          detail: { note, pending_reason: req.body.pending_reason || null },
        });
        await client.query('COMMIT');
        return res.json({ success: true, ...state });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }
    if (req.body.pending_reason) {
      await pool.query(
        `UPDATE support_tickets_v2 SET pending_reason = $2, updated_at = NOW() WHERE ticket_id = $1`,
        [id, req.body.pending_reason]
      );
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await computeTicketStatus(client, id);
      if (note) {
        await logEvent(client, {
          ticketId: id,
          eventType: 'STATUS_NOTE',
          actorId: req.user.user_id,
          summary: note,
          detail: { from: ticket.status, requested: next },
        });
      }
      await client.query('COMMIT');
      res.json({ success: true, ...state });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.pause = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.body.reason || '').toUpperCase();
    const note = req.body.note || null;
    const customerSide = Boolean(req.body.customer_side) || reason === 'PENDING_CUSTOMER';
    const contactMethod = normalizePauseContactMethod(req.body.contact_method || null);
    const contactReference = String(req.body.contact_reference || req.body.reference || '').trim();
    const pauseErr = validatePause({
      reason,
      contact_method: contactMethod,
      contact_reference: contactReference,
    });
    if (pauseErr) {
      return res.status(400).json({ success: false, message: pauseErr });
    }
    const ticket = await loadTicket(pool, id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const slaPause = await pauseSla(client, id, reason, req.user.user_id, note, new Date(), customerSide);
      const streak = nextPauseStreak(ticket.pause_streak);
      await client.query(
        `UPDATE support_tickets_v2
            SET pending_reason = $2, sla_paused = $3, pause_streak = $4, updated_at = NOW()
          WHERE ticket_id = $1`,
        [id, reason, Boolean(slaPause.paused), streak]
      );
      await logEvent(client, {
        ticketId: id,
        eventType: 'SLA_PAUSED',
        actorId: req.user.user_id,
        summary: `Paused · ${reason}${contactMethod ? ` · ${contactMethod}` : ''}`,
        detail: { reason, note, contact_method: contactMethod || null, contact_reference: contactReference || null },
        contactMethod: contactMethod || null,
        isCustomerVisible: reason === 'PENDING_CUSTOMER',
      });
      const flagged = shouldFlagPauseAbuse(streak);
      if (flagged) {
        await logEvent(client, {
          ticketId: id,
          eventType: 'PAUSE_ABUSE',
          actorKind: 'SYSTEM',
          summary: 'Third consecutive pause — flagged for the lead',
          detail: { pause_streak: streak },
        });
      }
      const state = await computeTicketStatus(client, id);
      await client.query('COMMIT');
      if (flagged) {
        notifyEvent(pool, {
          eventCode: 'PAUSE_ABUSE',
          ticketId: id,
          audiences: ['LEAD'],
          assignedTo: ticket.assigned_to,
          vars: { ticket_number: ticket.ticket_number },
        }).catch((e) => console.error('pauseAbuse notify:', e));
      }
      res.json({ success: true, pause_streak: streak, flagged, ...state });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.resume = async (req, res) => {
  try {
    const id = Number(req.params.id);
    await loadTicket(pool, id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sla = await resumeSla(client, id, req.user.user_id);
      await client.query(
        `UPDATE support_tickets_v2
            SET pending_reason = NULL,
                sla_paused = FALSE,
                pause_streak = 0,
                sla_paused_minutes = COALESCE(sla_paused_minutes,0) + $2,
                sla_resolution_due_at = COALESCE($3, sla_resolution_due_at),
                updated_at = NOW()
          WHERE ticket_id = $1`,
        [id, sla.addedMinutes || 0, sla.sla_resolution_due_at || null]
      );
      await logEvent(client, {
        ticketId: id,
        eventType: 'SLA_RESUMED',
        actorId: req.user.user_id,
        summary: `Resumed · +${sla.addedMinutes || 0}m`,
      });
      const state = await computeTicketStatus(client, id);
      await client.query('COMMIT');
      res.json({ success: true, addedMinutes: sla.addedMinutes, ...state });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.resolveTicket = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ticket = await loadTicket(pool, id);
    if (ticket.sla_resolution_breached && !req.body.breach_reason) {
      return res.status(400).json({ success: false, message: 'breach_reason required for a breached ticket' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lines = (await client.query(
        `SELECT line_code, line_status, resolution_code_id, root_cause_id, liability
           FROM support_ticket_assets WHERE ticket_id = $1`,
        [id]
      )).rows;
      const wos = (await client.query(
        'SELECT wo_number, status FROM support_work_orders WHERE ticket_id = $1',
        [id]
      )).rows;
      const blockers = ticketResolveBlockers(lines, wos);
      if (blockers.length) {
        throw Object.assign(new Error('Cannot resolve yet'), { status: 400, blockers });
      }
      if (req.body.breach_reason) {
        await client.query(
          `UPDATE support_tickets_v2 SET breach_reason = $2, updated_at = NOW() WHERE ticket_id = $1`,
          [id, req.body.breach_reason]
        );
      }
      const state = await computeTicketStatus(client, id);
      if (state.blockers && state.blockers.length) {
        throw Object.assign(new Error('Cannot resolve yet'), { status: 400, blockers: state.blockers });
      }
      if (state.status !== 'RESOLVED') {
        await forceTicketStatus(client, id, 'RESOLVED', {
          actorId: req.user.user_id,
          summary: 'Ticket resolved',
        });
      }
      const csat = await issueCsatToken(client, id);
      await client.query('COMMIT');
      const cust = (await pool.query(
        `SELECT email, phone FROM customers WHERE customer_id = $1`,
        [ticket.customer_id]
      )).rows[0] || {};
      notifyEvent(pool, {
        eventCode: 'TICKET_RESOLVED',
        ticketId: id,
        audiences: ['CUSTOMER'],
        customer: cust,
        vars: {
          ticket_number: ticket.ticket_number,
          customer_name: ticket.contact_name || '',
          resolution_summary: req.body.note || 'Your request has been resolved.',
          csat_link: csat.url,
        },
      }).catch((e) => console.error('resolve notify:', e));
      res.json({ success: true, status: 'RESOLVED', csat_url: csat.url });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.closeTicket = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ticket = await loadTicket(pool, id);
    if (ticket.sla_resolution_breached && !req.body.breach_reason && !ticket.breach_reason) {
      return res.status(400).json({ success: false, message: 'breach_reason required for a breached ticket' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (req.body.breach_reason) {
        await client.query(
          `UPDATE support_tickets_v2 SET breach_reason = $2, updated_at = NOW() WHERE ticket_id = $1`,
          [id, req.body.breach_reason]
        );
      }
      const state = await forceTicketStatus(client, id, 'CLOSED', {
        actorId: req.user.user_id,
        summary: req.body.note || 'Ticket closed',
      });
      await client.query('COMMIT');
      res.json({ success: true, ...state });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.reopenTicket = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'reason required' });
    const ticket = await loadTicket(pool, id);
    if (ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED') {
      return res.status(400).json({ success: false, message: 'Only resolved or closed tickets can be reopened' });
    }
    const closedAt = ticket.closed_at || ticket.resolved_at;
    const { getNumber } = require('../services/supportSettingsService');
    const windowDays = await getNumber(pool, 'reopen_window_days', 7);
    const windowErr = reopenWindowError(closedAt, new Date(), windowDays);
    if (windowErr) {
      return res.status(400).json({ success: false, message: windowErr });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const nextPri = Math.max(1, Number(ticket.priority) - 1);
      const reopenCount = Number(ticket.reopen_count || 0) + 1;
      const quality = reopenCount >= 2;
      await client.query(
        `UPDATE support_tickets_v2
            SET reopen_count = $2,
                reopen_reason = $3,
                priority = $4,
                quality_flag = quality_flag OR $5,
                escalation_level = 0,
                escalation_fired = '{}'::jsonb,
                dashboard_pinned = FALSE,
                updated_at = NOW()
          WHERE ticket_id = $1`,
        [id, reopenCount, reason, nextPri, quality]
      );
      await forceTicketStatus(client, id, 'IN_PROGRESS', {
        actorId: req.user.user_id,
        summary: `Reopened: ${reason}`,
        detail: { reason },
      });
      await recalcTicketSla(client, id, {
        customerId: ticket.customer_id,
        ticketClass: ticket.ticket_class,
        priority: nextPri,
      });
      await logEvent(client, {
        ticketId: id,
        eventType: 'TICKET_REOPENED',
        actorId: req.user.user_id,
        summary: `Reopened · P${nextPri}`,
        detail: { reason, priority: nextPri, reopen_count: reopenCount },
        isCustomerVisible: true,
      });
      const state = await computeTicketStatus(client, id);
      await client.query('COMMIT');
      if (quality) {
        notifyEvent(pool, {
          eventCode: 'QUALITY_REOPEN',
          ticketId: id,
          audiences: ['LEAD'],
          assignedTo: ticket.assigned_to,
          vars: { ticket_number: ticket.ticket_number },
        }).catch((e) => console.error('quality reopen notify:', e));
      }
      res.json({ success: true, ...state, priority: nextPri, reopen_count: reopenCount, quality_flag: quality });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.cancelTicket = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'reason required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await forceTicketStatus(client, id, 'CANCELLED', {
        actorId: req.user.user_id,
        summary: `Cancelled: ${reason}`,
        detail: { reason },
      });
      await client.query('COMMIT');
      res.json({ success: true, ...state });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.linkTicket = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const target = Number(req.body.target_ticket_id);
    const linkType = String(req.body.link_type || 'RELATED').toUpperCase();
    if (!target || !['REPEAT_OF', 'RELATED', 'MERGED', 'DUPLICATE'].includes(linkType)) {
      return res.status(400).json({ success: false, message: 'target_ticket_id and link_type required' });
    }
    await pool.query(
      `INSERT INTO support_ticket_links (from_ticket_id, to_ticket_id, link_type, created_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [id, target, linkType, req.user.user_id]
    );
    await logEvent(pool, {
      ticketId: id,
      eventType: 'TICKET_LINKED',
      actorId: req.user.user_id,
      summary: `Linked ${linkType} → ${target}`,
    });
    res.json({ success: true });
  } catch (e) { bad(res, e); }
};

exports.comment = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, message: 'body required' });
    await loadTicket(pool, id);
    await logEvent(pool, {
      ticketId: id,
      eventType: 'COMMENT',
      actorId: req.user.user_id,
      summary: body,
      isCustomerVisible: Boolean(req.body.is_customer_visible),
    });
    res.status(201).json({ success: true });
  } catch (e) { bad(res, e); }
};

exports.addAttachment = async (req, res) => {
  try {
    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
    if (!files.length) return res.status(400).json({ success: false, message: 'file required' });
    const ticketId = req.params.id ? Number(req.params.id) : null;
    const lineId = req.body.line_id ? Number(req.body.line_id) : null;
    const kind = req.body.kind || 'PHOTO_CUSTOMER';
    const rows = [];
    for (const f of files) {
      const r = await pool.query(
        `INSERT INTO support_attachments (
           ticket_id, line_id, kind, file_path, original_name, mime_type, uploaded_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [ticketId, lineId, kind, f.path || f.filename, f.originalname, f.mimetype, req.user.user_id]
      );
      rows.push(r.rows[0]);
    }
    if (ticketId) {
      await logEvent(pool, {
        ticketId,
        lineId,
        eventType: 'ATTACHMENT_ADDED',
        actorId: req.user.user_id,
        summary: `${rows.length} file(s) attached`,
      });
    }
    res.status(201).json({ success: true, rows });
  } catch (e) { bad(res, e); }
};

exports.setFound = async (req, res) => {
  try {
    const lineId = Number(req.params.lineId);
    const chain = await catalogChain(pool, req.body.found_issue_id);
    if (!chain) return res.status(400).json({ success: false, message: 'Invalid found_issue_id' });
    const line = (await pool.query(
      'SELECT * FROM support_ticket_assets WHERE line_id = $1',
      [lineId]
    )).rows[0];
    if (!line) return res.status(404).json({ success: false, message: 'Line not found' });
    await pool.query(
      `UPDATE support_ticket_assets SET
         found_type_id = $2, found_subtype_id = $3, found_issue_id = $4, updated_at = NOW()
       WHERE line_id = $1`,
      [lineId, chain.type.catalog_id, chain.subtype.catalog_id, chain.issue.catalog_id]
    );
    if (Number(chain.issue.catalog_id) !== Number(line.reported_issue_id)) {
      await logEvent(pool, {
        ticketId: line.ticket_id,
        lineId,
        eventType: 'RECLASSIFIED',
        actorId: req.user.user_id,
        summary: `Found ${chain.issue.name}`,
        detail: { reported_issue_id: line.reported_issue_id, found_issue_id: chain.issue.catalog_id },
      });
    }
    res.json({ success: true });
  } catch (e) { bad(res, e); }
};

exports.resolveLine = async (req, res) => {
  try {
    const canCharge = await canSection(req, 'support_charges', 'can_edit')
      || await canSection(req, 'support_charges', 'can_create');
    const state = await resolveLine(
      pool,
      Number(req.params.lineId),
      req.body || {},
      req.user.user_id,
      canCharge
    );
    res.json({ success: true, ...state });
  } catch (e) { bad(res, e); }
};
