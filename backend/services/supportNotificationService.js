'use strict';

const { createNotification } = require('./notificationService');
const { enqueueEmail } = require('./emailQueueService');
const { sendWhatsAppText } = require('./whatsappService');
const { logEvent } = require('./supportTicketStateService');

const ROLE_FOR_AUDIENCE = {
  LEAD: ['support_lead'],
  MANAGER: ['support_manager', 'manager'],
  OPS_HEAD: ['admin'],
  BUSINESS_HEAD: ['super_admin'],
  WAREHOUSE: ['warehouse'],
  ACCOUNTS: ['accounts'],
};

function templateOutcome(tpl) {
  if (!tpl || tpl.active === false) return 'SKIPPED';
  return 'QUEUED';
}

function renderTemplate(text, vars = {}) {
  return String(text == null ? '' : text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (
    vars[key] == null ? '' : String(vars[key])
  ));
}

async function usersForAudience(db, audience, assignedTo) {
  if (audience === 'ASSIGNEE') {
    if (!assignedTo) return [];
    const r = await db.query(
      'SELECT user_id, name, email, mobile_no AS phone FROM users WHERE user_id = $1',
      [assignedTo]
    );
    return r.rows;
  }
  const roles = ROLE_FOR_AUDIENCE[audience];
  if (!roles) return [];
  const r = await db.query(
    `SELECT user_id, name, email, mobile_no AS phone FROM users
      WHERE role = ANY($1::text[]) AND COALESCE(active, TRUE) = TRUE
      ORDER BY user_id`,
    [roles]
  );
  return r.rows;
}

async function loadTemplate(db, eventCode, channel, audience) {
  const r = await db.query(
    `SELECT * FROM support_notification_templates
      WHERE event_code = $1 AND channel = $2 AND audience = $3
      LIMIT 1`,
    [eventCode, channel, audience]
  );
  return r.rows[0] || null;
}

async function writeLog(db, row) {
  const r = await db.query(
    `INSERT INTO support_notification_log (
       ticket_id, wo_id, event_code, channel, audience, recipient, status
     ) VALUES ($1,$2,$3,$4,$5,$6,'QUEUED')
     RETURNING *`,
    [row.ticketId || null, row.woId || null, row.eventCode, row.channel, row.audience, row.recipient]
  );
  return r.rows[0];
}

async function finishLog(db, logId, status, error) {
  await db.query(
    `UPDATE support_notification_log
        SET status = $2, error = $3, sent_at = CASE WHEN $2 = 'SENT' THEN NOW() ELSE sent_at END
      WHERE log_id = $1`,
    [logId, status, error || null]
  );
}

async function deliver(channel, recipient, subject, body, userId) {
  if (channel === 'EMAIL') {
    if (!recipient) throw new Error('No email recipient');
    await enqueueEmail({
      toEmail: recipient,
      subject: subject || body.slice(0, 80),
      bodyText: body,
      dedupeKey: `sv2:${recipient}:${subject || ''}:${Date.now()}`,
    });
    return;
  }
  if (channel === 'WHATSAPP') {
    if (!recipient) throw new Error('No WhatsApp recipient');
    await sendWhatsAppText({ to: recipient, body });
    return;
  }
  if (channel === 'INAPP' || channel === 'PUSH') {
    if (!userId) throw new Error('No in-app recipient');
    await createNotification(userId, 'support_v2', { title: subject || 'Support', body });
    return;
  }
  throw new Error(`Unknown channel ${channel}`);
}

async function sendOne(db, {
  eventCode, channel, audience, recipient, userId, ticketId, woId, vars, visibleToCustomer,
}) {
  const log = await writeLog(db, {
    ticketId, woId, eventCode, channel, audience, recipient: recipient || String(userId || 'unknown'),
  });
  const tpl = await loadTemplate(db, eventCode, channel, audience);
  if (templateOutcome(tpl) === 'SKIPPED') {
    await finishLog(db, log.log_id, 'SKIPPED', tpl ? 'template inactive' : 'no template');
    return { status: 'SKIPPED', log_id: log.log_id };
  }
  const subject = renderTemplate(tpl.subject, vars);
  const body = renderTemplate(tpl.body, vars);
  try {
    await deliver(channel, recipient, subject, body, userId);
    await finishLog(db, log.log_id, 'SENT');
    if (ticketId && (visibleToCustomer || audience === 'CUSTOMER')) {
      await logEvent(db, {
        ticketId,
        woId,
        eventType: 'NOTIFICATION_SENT',
        actorKind: 'SYSTEM',
        summary: `${channel} → ${audience}`,
        detail: { event_code: eventCode, channel, audience, recipient },
        isCustomerVisible: audience === 'CUSTOMER',
      });
    }
    return { status: 'SENT', log_id: log.log_id };
  } catch (e) {
    await finishLog(db, log.log_id, 'FAILED', e.message);
    return { status: 'FAILED', log_id: log.log_id, error: e.message };
  }
}

async function notifyEvent(db, {
  eventCode, ticketId, woId, audiences = [], assignedTo, customer, vars = {},
}) {
  const results = [];
  for (const audience of audiences) {
    if (audience === 'CUSTOMER') {
      const email = customer && customer.email;
      const phone = customer && (customer.phone || customer.whatsapp);
      results.push(await sendOne(db, {
        eventCode, channel: 'EMAIL', audience, recipient: email, ticketId, woId, vars,
        visibleToCustomer: true,
      }));
      results.push(await sendOne(db, {
        eventCode, channel: 'WHATSAPP', audience, recipient: phone, ticketId, woId, vars,
        visibleToCustomer: true,
      }));
      continue;
    }
    const users = await usersForAudience(db, audience, assignedTo);
    const channels = audience === 'ASSIGNEE' && eventCode === 'SLA_ESCALATION_1'
      ? ['INAPP']
      : ['INAPP', 'EMAIL', 'PUSH'];
    for (const user of users) {
      for (const channel of channels) {
        const recipient = channel === 'EMAIL' ? user.email : (channel === 'WHATSAPP' ? user.phone : String(user.user_id));
        results.push(await sendOne(db, {
          eventCode, channel, audience, recipient, userId: user.user_id, ticketId, woId, vars,
        }));
      }
    }
  }
  return results;
}

async function notifyTechnicianVisit(db, woRow, eventCode) {
  if (!woRow || !woRow.ticket_id) return [];
  const ticket = (await db.query(
    `SELECT t.ticket_id, t.ticket_number, t.contact_name, t.contact_phone, t.contact_email,
            c.email AS customer_email, c.phone AS customer_phone,
            COALESCE(c.company_name, c.name) AS customer_name
       FROM support_tickets_v2 t
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE t.ticket_id = $1`,
    [woRow.ticket_id]
  )).rows[0];
  if (!ticket) return [];
  const tech = woRow.assigned_to
    ? (await db.query('SELECT name, mobile_no AS phone FROM users WHERE user_id = $1', [woRow.assigned_to])).rows[0]
    : null;
  const eta = woRow.slot_start && woRow.slot_end
    ? `${woRow.slot_start} – ${woRow.slot_end}`
    : (woRow.slot_start || 'to be confirmed');
  return notifyEvent(db, {
    eventCode,
    ticketId: ticket.ticket_id,
    woId: woRow.wo_id,
    audiences: ['CUSTOMER'],
    customer: {
      email: ticket.contact_email || ticket.customer_email,
      phone: ticket.contact_phone || ticket.customer_phone,
    },
    vars: {
      ticket_number: ticket.ticket_number,
      customer_name: ticket.contact_name || ticket.customer_name || '',
      tech_name: (tech && tech.name) || 'our technician',
      tech_phone: (tech && tech.phone) || '',
      eta,
    },
  });
}

module.exports = {
  templateOutcome,
  renderTemplate,
  usersForAudience,
  loadTemplate,
  writeLog,
  finishLog,
  sendOne,
  notifyEvent,
  notifyTechnicianVisit,
  ROLE_FOR_AUDIENCE,
};
