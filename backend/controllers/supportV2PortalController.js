'use strict';

const pool = require('../config/db');
const { createTicket, reopenWindowError } = require('../services/supportTicketFlowService');
const { forceTicketStatus, recalcTicketSla, logEvent } = require('../services/supportTicketFlowService');
const { decideApproval } = require('../services/supportReturnPickupService');
const { notifyEvent } = require('../services/supportNotificationService');
const { portalTicketView } = require('../services/supportPortalView');

function bad(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('supportV2 portal:', e);
  const body = { success: false, message: e.message };
  if (e.errors) body.errors = e.errors;
  return res.status(status).json(body);
}

async function loadOwned(customerId, ticketId) {
  const r = await pool.query(
    `SELECT t.*, COALESCE(c.company_name, c.name) AS customer_name
       FROM support_tickets_v2 t
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE t.ticket_id = $1 AND t.customer_id = $2`,
    [ticketId, customerId]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  return r.rows[0];
}

exports.listAssets = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT vsn.serial_id,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
              vsn.serial_number,
              vsn.extra->>'brand' AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name') AS model
         FROM vendor_serial_numbers vsn
        WHERE vsn.current_customer_id = $1
          AND vsn.deleted_at IS NULL
        ORDER BY vsn.delivered_at DESC NULLS LAST`,
      [req.customer.customer_id]
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.catalog = async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.catalog_id, i.code, i.name,
              s.catalog_id AS subtype_id, s.name AS subtype_name,
              t.catalog_id AS type_id, t.name AS type_name
         FROM support_issue_catalog i
         JOIN support_issue_catalog s ON s.catalog_id = i.parent_id
         JOIN support_issue_catalog t ON t.catalog_id = s.parent_id
        WHERE i.active = TRUE AND s.active = TRUE AND t.active = TRUE
        ORDER BY t.name, s.name, i.name`
    );
    res.json({ success: true, rows: r.rows });
  } catch (e) { bad(res, e); }
};

exports.listTickets = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT t.ticket_id, t.ticket_number, t.status, t.priority, t.subject,
              t.channel, t.sla_resolution_due_at, t.sla_paused, t.created_at,
              t.resolved_at, t.closed_at, t.csat_score
         FROM support_tickets_v2 t
        WHERE t.customer_id = $1
        ORDER BY t.created_at DESC
        LIMIT 100`,
      [req.customer.customer_id]
    );
    res.json({ success: true, tickets: r.rows.map(portalTicketView) });
  } catch (e) { bad(res, e); }
};

exports.getTicket = async (req, res) => {
  try {
    const ticket = portalTicketView(await loadOwned(req.customer.customer_id, Number(req.params.id)));
    const lines = (await pool.query(
      `SELECT line_id, line_code, ttspl_id, serial_number, line_status, reported_description
         FROM support_ticket_assets WHERE ticket_id = $1 ORDER BY line_id`,
      [ticket.ticket_id]
    )).rows;
    const events = (await pool.query(
      `SELECT event_id, event_type, summary, created_at, is_customer_visible
         FROM support_ticket_events
        WHERE ticket_id = $1 AND is_customer_visible = TRUE
        ORDER BY created_at ASC`,
      [ticket.ticket_id]
    )).rows;
    const charges = (await pool.query(
      `SELECT e.extra_line_id, e.amount, e.description, e.status, e.evidence_urls,
              a.approval_id, a.approval_type, a.status AS approval_status
         FROM customer_invoice_extra_lines e
         LEFT JOIN support_approvals a ON a.approval_id = e.approval_id
        WHERE e.ticket_id = $1 AND e.customer_id = $2`,
      [ticket.ticket_id, req.customer.customer_id]
    )).rows;
    res.json({ success: true, ticket, lines, events, charges });
  } catch (e) { bad(res, e); }
};

exports.createTicket = async (req, res) => {
  try {
    const me = (await pool.query(
      'SELECT customer_id, name, company_name, email, phone FROM customers WHERE customer_id = $1',
      [req.customer.customer_id]
    )).rows[0];
    const body = {
      ...(req.body || {}),
      customer_id: req.customer.customer_id,
      channel: 'PORTAL',
      contact_name: req.body.contact_name || me.company_name || me.name,
      contact_phone: req.body.contact_phone || me.phone,
      contact_email: req.body.contact_email || me.email,
    };
    const row = await createTicket(pool, body, null);
    res.status(201).json({ success: true, ...row, channel: 'PORTAL' });
  } catch (e) { bad(res, e); }
};

exports.approveCharge = async (req, res) => {
  try {
    const ticket = await loadOwned(req.customer.customer_id, Number(req.params.id));
    const pending = (await pool.query(
      `SELECT approval_id FROM support_approvals
        WHERE ticket_id = $1 AND status = 'PENDING' AND customer_side = TRUE
        ORDER BY approval_id DESC LIMIT 1`,
      [ticket.ticket_id]
    )).rows[0];
    if (!pending) return res.status(404).json({ success: false, message: 'No charge awaiting approval' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await decideApproval(client, pending.approval_id, { decision: 'APPROVED' }, null);
      await client.query('COMMIT');
      res.json({ success: true, ...row });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.disputeCharge = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'reason required' });
    const ticket = await loadOwned(req.customer.customer_id, Number(req.params.id));
    const extra = (await pool.query(
      `SELECT extra_line_id, amount, approval_id FROM customer_invoice_extra_lines
        WHERE ticket_id = $1 AND customer_id = $2 AND status = 'PENDING'
        ORDER BY extra_line_id DESC LIMIT 1`,
      [ticket.ticket_id, req.customer.customer_id]
    )).rows[0];
    if (!extra) return res.status(404).json({ success: false, message: 'No pending charge' });
    await pool.query(
      `UPDATE customer_invoice_extra_lines
          SET status = 'DISPUTED', waived_reason = $2, updated_at = NOW()
        WHERE extra_line_id = $1`,
      [extra.extra_line_id, reason]
    );
    await logEvent(pool, {
      ticketId: ticket.ticket_id,
      eventType: 'CHARGE_DISPUTED',
      actorKind: 'CUSTOMER',
      summary: 'Customer disputed a charge',
      detail: { reason, amount: extra.amount },
      isCustomerVisible: true,
    });
    notifyEvent(pool, {
      eventCode: 'CHARGE_DISPUTED',
      ticketId: ticket.ticket_id,
      audiences: ['ACCOUNTS'],
      vars: { ticket_number: ticket.ticket_number, amount: extra.amount, reason },
    }).catch((e) => console.error('dispute notify:', e));
    res.json({ success: true, status: 'DISPUTED' });
  } catch (e) { bad(res, e); }
};

exports.reopen = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ success: false, message: 'reason required' });
    const ticket = await loadOwned(req.customer.customer_id, Number(req.params.id));
    if (ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED') {
      return res.status(400).json({ success: false, message: 'Only resolved or closed tickets can be reopened' });
    }
    const { getNumber } = require('../services/supportSettingsService');
    const windowDays = await getNumber(pool, 'reopen_window_days', 7);
    const windowErr = reopenWindowError(ticket.closed_at || ticket.resolved_at, new Date(), windowDays);
    if (windowErr) return res.status(400).json({ success: false, message: windowErr });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const nextPri = Math.max(1, Number(ticket.priority) - 1);
      const reopenCount = Number(ticket.reopen_count || 0) + 1;
      await client.query(
        `UPDATE support_tickets_v2
            SET reopen_count = $2, reopen_reason = $3, priority = $4,
                quality_flag = quality_flag OR $5, updated_at = NOW()
          WHERE ticket_id = $1`,
        [ticket.ticket_id, reopenCount, reason, nextPri, reopenCount >= 2]
      );
      await forceTicketStatus(client, ticket.ticket_id, 'IN_PROGRESS', {
        summary: `Reopened by customer: ${reason}`,
        detail: { reason },
      });
      await recalcTicketSla(client, ticket.ticket_id, {
        customerId: ticket.customer_id,
        ticketClass: ticket.ticket_class,
        priority: nextPri,
      });
      await logEvent(client, {
        ticketId: ticket.ticket_id,
        eventType: 'TICKET_REOPENED',
        actorKind: 'CUSTOMER',
        summary: `Reopened · P${nextPri}`,
        detail: { reason, priority: nextPri },
        isCustomerVisible: true,
      });
      await client.query('COMMIT');
      res.json({ success: true, status: 'IN_PROGRESS', priority: nextPri });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { bad(res, e); }
};

exports.documents = async (req, res) => {
  try {
    const ticket = await loadOwned(req.customer.customer_id, Number(req.params.id));
    const rows = (await pool.query(
      `SELECT wo_id, wo_number, wo_type, document_number, status
         FROM support_work_orders
        WHERE ticket_id = $1 AND document_number IS NOT NULL
        ORDER BY wo_id`,
      [ticket.ticket_id]
    )).rows;
    res.json({
      success: true,
      documents: rows.map((w) => ({
        wo_id: w.wo_id,
        wo_number: w.wo_number,
        document_number: w.document_number,
        kind: /RDC/i.test(w.document_number) ? 'RDC' : /SDC/i.test(w.document_number) ? 'SDC' : 'DC',
      })),
    });
  } catch (e) { bad(res, e); }
};
