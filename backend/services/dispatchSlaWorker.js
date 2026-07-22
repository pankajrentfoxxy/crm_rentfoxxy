const pool = require('../config/db');
const { loadConfig, fetchDispatchMemberIds, STATUS } = require('./dispatchWorkflowService');
const { createNotification } = require('./notificationService');
const { safeLogSalesOrderActivity, ACTIVITY_TYPES } = require('./salesOrderActivityService');

let cronJob = null;

async function processAcceptanceReminders() {
  const cfg = await loadConfig();
  const intervalMs = cfg.reminder_interval_minutes * 60 * 1000;
  const now = new Date();

  const overdue = await pool.query(
    `SELECT dw.*, u.name AS assigned_user_name
       FROM dispatch_workflow dw
       LEFT JOIN users u ON u.user_id = dw.assigned_user_id
      WHERE dw.status = $1
        AND dw.acceptance_due_at IS NOT NULL
        AND dw.acceptance_due_at < NOW()
        AND dw.assigned_user_id IS NOT NULL
        AND (
          dw.last_reminder_at IS NULL
          OR dw.last_reminder_at < NOW() - ($2::int * interval '1 minute')
        )`,
    [STATUS.WAITING, cfg.reminder_interval_minutes]
  );

  for (const row of overdue.rows) {
    const isFirstBreach = !row.last_reminder_at;

    await createNotification(row.assigned_user_id, 'dispatch_reminder', {
      title: 'Dispatch acceptance overdue',
      body: `SO ${row.sales_order_number} — please accept or reassign.`,
      salesOrderNumber: row.sales_order_number,
    });

    await pool.query(
      `UPDATE dispatch_workflow SET last_reminder_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [row.id]
    );

    await safeLogSalesOrderActivity({
      salesOrderNumber: row.sales_order_number,
      activityType: ACTIVITY_TYPES.DISPATCH,
      action: 'dispatch_reminder_sent',
      description: `Acceptance SLA reminder sent to ${row.assigned_user_name || 'assignee'}.`,
      metadata: { assigned_user_id: row.assigned_user_id, acceptance_due_at: row.acceptance_due_at },
    });

    if (isFirstBreach) {
      try {
        const { emitSlaBreach } = require('./dispatchSocketService');
        await emitSlaBreach(row);
      } catch (err) {
        console.error('dispatch socket sla-breach emit failed:', err.message);
      }
    }
  }
}

async function processQcReminders() {
  const cfg = await loadConfig();
  const overdue = await pool.query(
    `SELECT dw.*, tk.ticket_id, tk.ticket_assignee_user_id,
            tu.name AS ticket_assignee_name
       FROM dispatch_workflow dw
       INNER JOIN LATERAL (
         SELECT t.ticket_id, t.assigned_user_id AS ticket_assignee_user_id
           FROM tickets t
           JOIN stages s ON s.stage_id = t.current_stage_id
          WHERE t.sales_order_number = dw.sales_order_number
            AND t.ticket_type = 'sales_order_qc'
            AND t.status IN ('in_progress', 'on_hold')
            AND s.stage_name = 'Dispatch QC'
            AND t.assigned_user_id IS NOT NULL
          ORDER BY t.ticket_id DESC
          LIMIT 1
       ) tk ON TRUE
       LEFT JOIN users tu ON tu.user_id = tk.ticket_assignee_user_id
      WHERE dw.status = $1
        AND dw.qc_due_at IS NOT NULL
        AND dw.qc_due_at < NOW()
        AND NOT (dw.qc_alert_snoozed_until IS NOT NULL AND dw.qc_alert_snoozed_until > NOW())
        AND (
          dw.qc_last_reminder_at IS NULL
          OR dw.qc_last_reminder_at < NOW() - ($2::int * interval '1 minute')
        )`,
    [STATUS.DISPATCH_QC, cfg.reminder_interval_minutes]
  );

  for (const row of overdue.rows) {
    const isFirstBreach = !row.qc_last_reminder_at;
    const notifyUserId = row.ticket_assignee_user_id;

    await createNotification(notifyUserId, 'dispatch_qc_reminder', {
      title: 'Dispatch QC overdue',
      body: `SO ${row.sales_order_number} — complete Dispatch QC or snooze with a remark.`,
      salesOrderNumber: row.sales_order_number,
    });

    await pool.query(
      `UPDATE dispatch_workflow SET qc_last_reminder_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [row.id]
    );

    await safeLogSalesOrderActivity({
      salesOrderNumber: row.sales_order_number,
      activityType: ACTIVITY_TYPES.DISPATCH,
      action: 'dispatch_qc_reminder_sent',
      description: `Dispatch QC SLA reminder sent to ${row.ticket_assignee_name || 'ticket assignee'}.`,
      metadata: {
        ticket_id: row.ticket_id,
        ticket_assignee_user_id: notifyUserId,
        qc_due_at: row.qc_due_at,
      },
    });

    if (isFirstBreach) {
      try {
        const { emitQcSlaBreach } = require('./dispatchSocketService');
        await emitQcSlaBreach(row);
      } catch (err) {
        console.error('dispatch socket qc-sla-breach emit failed:', err.message);
      }
    }
  }
}

async function processQcOverdue() {
  const cfg = await loadConfig();
  const r = await pool.query(
    `UPDATE dispatch_workflow
        SET qc_overdue = TRUE, updated_at = NOW()
      WHERE status = $1
        AND qc_due_at IS NOT NULL
        AND NOW() > qc_due_at + ($2::int * interval '1 minute')
        AND qc_overdue IS NOT TRUE
      RETURNING sales_order_number, qc_due_at`,
    [STATUS.DISPATCH_QC, cfg.qc_buffer_minutes]
  );

  for (const row of r.rows) {
    await safeLogSalesOrderActivity({
      salesOrderNumber: row.sales_order_number,
      activityType: ACTIVITY_TYPES.DISPATCH,
      action: 'dispatch_qc_overdue',
      description: 'Dispatch QC ETA exceeded (buffer applied).',
      metadata: { qc_due_at: row.qc_due_at },
    });
  }
}

async function runSlaSweep() {
  try {
    await processAcceptanceReminders();
    await processQcReminders();
    await processQcOverdue();
  } catch (err) {
    console.error('dispatchSlaWorker sweep failed:', err.message);
  }
}

function startDispatchSlaWorker() {
  if (cronJob) return;
  const cron = require('node-cron');
  cronJob = cron.schedule('* * * * *', runSlaSweep, { timezone: 'Asia/Kolkata' });
  console.log('Dispatch SLA worker started (every minute)');
}

function stopDispatchSlaWorker() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

module.exports = { startDispatchSlaWorker, stopDispatchSlaWorker, runSlaSweep };
