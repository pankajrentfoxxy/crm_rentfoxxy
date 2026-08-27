'use strict';

const { notifyEvent } = require('./supportNotificationService');
const { maskPhone } = require('./supportWoSerialize');
const { logEvent } = require('./supportTicketStateService');

function sixDigit() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function audit(client, woId, action, actorId, extra = {}) {
  await client.query(
    `INSERT INTO support_otp_audit (wo_id, action, actor_id, channel, recipient, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [woId, action, actorId || null, extra.channel || null, extra.recipient || null, extra.reason || null]
  );
}

async function sendOtp(client, woId, actorId, { phone, reason, resend } = {}) {
  const wo = (await client.query(
    `SELECT w.*, t.contact_phone, t.contact_name, t.customer_id, t.ticket_id
       FROM support_work_orders w
       JOIN support_tickets_v2 t ON t.ticket_id = w.ticket_id
      WHERE w.wo_id = $1 FOR UPDATE OF w`,
    [woId]
  )).rows[0];
  if (!wo) throw Object.assign(new Error('Work order not found'), { status: 404 });
  if (String(wo.method || '').toUpperCase() === 'COURIER') {
    throw Object.assign(new Error('Courier work orders do not use OTP'), { status: 400 });
  }
  if (resend) {
    if (wo.otp_send_count >= 3) {
      throw Object.assign(new Error('Maximum of 3 OTP sends used'), { status: 409 });
    }
    if (wo.otp_sent_at && (Date.now() - new Date(wo.otp_sent_at).getTime()) < 60000) {
      throw Object.assign(new Error('Wait 60 seconds before resending'), { status: 409 });
    }
  }
  const dest = String(phone || wo.contact_phone || '').replace(/\D/g, '').slice(-10);
  if (!dest) throw Object.assign(new Error('No contact phone to send OTP'), { status: 400 });
  const otp = sixDigit();
  await client.query(
    `UPDATE support_work_orders SET
       customer_otp = $2,
       otp_sent_at = NOW(),
       otp_sent_to = $3,
       otp_send_count = otp_send_count + 1,
       otp_expires_at = NOW() + INTERVAL '15 minutes',
       updated_at = NOW()
     WHERE wo_id = $1`,
    [woId, otp, dest]
  );
  await audit(client, woId, resend ? 'RESENT' : 'SENT', actorId, { channel: 'WHATSAPP', recipient: maskPhone(dest), reason });
  const assignee = (await client.query('SELECT name FROM users WHERE user_id = $1', [wo.assigned_to])).rows[0];
  await client.query('SAVEPOINT otp_notify');
  try {
    await notifyEvent(client, {
      eventCode: 'OTP_SENT_CUSTOMER',
      ticketId: wo.ticket_id,
      woId,
      audiences: ['CUSTOMER'],
      customer: { phone: dest },
      vars: { otp, assignee_name: (assignee && assignee.name) || 'our engineer' },
    });
    await client.query('RELEASE SAVEPOINT otp_notify');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT otp_notify');
    console.error('otp notify:', e);
  }
  return { otp_sent_to: maskPhone(dest), otp_expires_at: new Date(Date.now() + 15 * 60 * 1000) };
}

async function revealOtp(client, woId, actorId, reason) {
  if (!reason || String(reason).trim().length < 5) {
    throw Object.assign(new Error('A reason is required to reveal the OTP'), { status: 400 });
  }
  const wo = (await client.query('SELECT * FROM support_work_orders WHERE wo_id = $1', [woId])).rows[0];
  if (!wo || !wo.customer_otp) throw Object.assign(new Error('No OTP has been sent'), { status: 404 });
  await audit(client, woId, 'REVEALED', actorId, { reason });
  await logEvent(client, {
    ticketId: wo.ticket_id, woId, actorId,
    eventType: 'OTP_REVEALED',
    summary: 'Handover code revealed to support lead',
    isCustomerVisible: true,
    detail: { reason },
  });
  return { otp: wo.customer_otp, expires_in_sec: 30 };
}

async function requestBypass(client, woId, actorId, reason) {
  const wo = (await client.query('SELECT * FROM support_work_orders WHERE wo_id = $1', [woId])).rows[0];
  if (!wo) throw Object.assign(new Error('Work order not found'), { status: 404 });
  const ap = await client.query(
    `INSERT INTO support_approvals (ticket_id, wo_id, approval_type, status, label, requested_by)
     VALUES ($1,$2,'OTP_BYPASS','PENDING',$3,$4) RETURNING approval_id`,
    [wo.ticket_id, woId, `OTP bypass ${wo.wo_number}`, actorId]
  );
  await client.query(
    'UPDATE support_work_orders SET otp_bypass_approval_id = $2 WHERE wo_id = $1',
    [woId, ap.rows[0].approval_id]
  );
  await audit(client, woId, 'BYPASS_REQUESTED', actorId, { reason });
  await notifyEvent(client, {
    eventCode: 'OTP_BYPASS_REQUESTED',
    ticketId: wo.ticket_id, woId, audiences: ['LEAD'],
    vars: { wo_number: wo.wo_number, assignee_name: String(actorId), reason, customer_name: '' },
  }).catch(() => {});
  return { approval_id: ap.rows[0].approval_id };
}

module.exports = { sendOtp, revealOtp, requestBypass, audit };
