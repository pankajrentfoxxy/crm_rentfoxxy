/**
 * Dispatch workflow orchestration — SO creation through customer asset.
 * State machine is idempotent (guards on current status).
 */
const pool = require('../config/db');
const { serialMatchesSoLine } = require('../utils/soInventorySpecMatch');
const { entityForQuotationType } = require('./salesManagementService');
const {
  logSalesOrderActivity,
  safeLogSalesOrderActivity,
  ACTIVITY_TYPES,
} = require('./salesOrderActivityService');
const {
  createNotification,
  createNotificationsForUsers,
} = require('./notificationService');

const STATUS = Object.freeze({
  WAITING: 'waiting_acceptance',
  ACCEPTED: 'accepted',
  ATTACHING: 'attaching',
  DISPATCH_QC: 'dispatch_qc',
  READY: 'ready_for_dispatch',
  DC: 'dc_generated',
  DISPATCHED: 'dispatched',
  CUSTOMER_ASSET: 'customer_asset',
  AWAITING_PR: 'awaiting_purchase',
});

const WF_ACTIVITY = ACTIVITY_TYPES.DISPATCH;

async function loadConfig(client) {
  const db = client || pool;
  const r = await db.query(`SELECT * FROM dispatch_workflow_config WHERE id = 1`);
  return r.rows[0] || {
    acceptance_sla_minutes: 30,
    reminder_interval_minutes: 10,
    qc_eta_minutes: 120,
    qc_buffer_minutes: 60,
  };
}

async function fetchDispatchMemberIds(client) {
  const db = client || pool;
  const r = await db.query(
    `SELECT DISTINCT u.user_id
       FROM users u
       LEFT JOIN user_teams ut ON ut.user_id = u.user_id
       LEFT JOIN teams t ON t.team_id = COALESCE(ut.team_id, u.team_id)
      WHERE COALESCE(u.active, true) = true
        AND (
          u.role = 'dispatch'
          OR LOWER(COALESCE(t.team_name, '')) IN ('dispatch team', 'dispatch')
        )
      ORDER BY u.user_id ASC`
  );
  return r.rows.map((row) => row.user_id);
}

async function assignRoundRobin(client) {
  const cfg = await loadConfig(client);

  if (cfg.fixed_assignee_user_id) {
    const fixed = await client.query(
      `SELECT user_id FROM users
        WHERE user_id = $1 AND COALESCE(active, true) = true`,
      [cfg.fixed_assignee_user_id]
    );
    if (fixed.rows.length) {
      const userId = fixed.rows[0].user_id;
      await client.query(
        `INSERT INTO dispatch_round_robin_state (id, last_assigned_user_id, updated_at)
         VALUES (1, $1, NOW())
         ON CONFLICT (id) DO UPDATE
         SET last_assigned_user_id = EXCLUDED.last_assigned_user_id, updated_at = NOW()`,
        [userId]
      );
      const seqR = await client.query(
        `SELECT COALESCE(MAX(assignment_sequence), 0) + 1 AS next_seq FROM dispatch_workflow`
      );
      return { userId, sequence: seqR.rows[0]?.next_seq || 1 };
    }
  }

  const ids = await fetchDispatchMemberIds(client);
  if (!ids.length) return { userId: null, sequence: null };

  const stRes = await client.query(
    `SELECT last_assigned_user_id FROM dispatch_round_robin_state WHERE id = 1 FOR UPDATE`
  );
  let nextIdx = 0;
  if (stRes.rows.length && stRes.rows[0].last_assigned_user_id != null) {
    const lastIdx = ids.indexOf(stRes.rows[0].last_assigned_user_id);
    nextIdx = lastIdx >= 0 ? (lastIdx + 1) % ids.length : 0;
  }
  const picked = ids[nextIdx];

  await client.query(
    `INSERT INTO dispatch_round_robin_state (id, last_assigned_user_id, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE
     SET last_assigned_user_id = EXCLUDED.last_assigned_user_id, updated_at = NOW()`,
    [picked]
  );

  const seqR = await client.query(
    `SELECT COALESCE(MAX(assignment_sequence), 0) + 1 AS next_seq FROM dispatch_workflow`
  );
  return { userId: picked, sequence: seqR.rows[0]?.next_seq || 1 };
}

async function getWorkflow(client, salesOrderNumber, { forUpdate = false } = {}) {
  const db = client || pool;
  const lock = forUpdate && client ? ' FOR UPDATE OF dw' : '';
  const r = await db.query(
    `SELECT dw.*,
            u.name AS assigned_user_name,
            pr.status AS purchase_request_status
       FROM dispatch_workflow dw
       LEFT JOIN users u ON u.user_id = dw.assigned_user_id
       LEFT JOIN sales_order_procurement_requests pr ON pr.id = dw.purchase_request_id
      WHERE dw.sales_order_number = $1${lock}`,
    [salesOrderNumber]
  );
  return r.rows[0] || null;
}

async function logWorkflowActivity(client, salesOrderNumber, action, description, metadata = {}, user = null, remarks = null) {
  return logSalesOrderActivity({
    client,
    salesOrderNumber,
    activityType: WF_ACTIVITY,
    action,
    description,
    remarks,
    metadata,
    user,
  });
}

async function findActiveDispatchQcTicket(client, salesOrderNumber) {
  const db = client || pool;
  const r = await db.query(
    `SELECT t.ticket_id, t.current_stage_id, t.assigned_user_id
       FROM tickets t
       JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.sales_order_number = $1
        AND t.ticket_type = 'sales_order_qc'
        AND t.status IN ('in_progress', 'on_hold')
        AND s.stage_name = 'Dispatch QC'
      ORDER BY t.ticket_id DESC
      LIMIT 1`,
    [salesOrderNumber]
  );
  return r.rows[0] || null;
}

async function logDispatchQcTicketActivity(client, { salesOrderNumber, userId, action, notes }) {
  const ticket = await findActiveDispatchQcTicket(client, salesOrderNumber);
  if (!ticket) return null;
  await client.query(
    `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [ticket.ticket_id, ticket.current_stage_id, userId, action, notes]
  );
  return ticket.ticket_id;
}

async function notifyDispatchUser(userId, type, { title, body, salesOrderNumber }) {
  if (!userId) return null;
  return createNotification(userId, type, { title, body, salesOrderNumber });
}

async function notifyDispatchTeam(type, payload, { excludeUserId } = {}) {
  const ids = await fetchDispatchMemberIds(pool);
  const filtered = excludeUserId ? ids.filter((id) => id !== excludeUserId) : ids;
  return createNotificationsForUsers(filtered, type, payload);
}

/** SO assignee from dispatch_workflow (assigned_dispatch_user_id in product terms). */
function resolveAssignedDispatchUserId(wf) {
  if (!wf) return null;
  return wf.assigned_user_id || wf.accepted_by || null;
}

/**
 * Start workflow inside SO creation transaction.
 */
async function startWorkflow(client, { salesOrderNumber, quotationType, user }) {
  const existing = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (existing) return existing;

  const cfg = await loadConfig(client);
  const { userId, sequence } = await assignRoundRobin(client);
  const now = new Date();
  const due = new Date(now.getTime() + cfg.acceptance_sla_minutes * 60 * 1000);

  const ins = await client.query(
    `INSERT INTO dispatch_workflow (
       sales_order_number, quotation_type, assigned_user_id, assigned_at,
       assignment_sequence, status, acceptance_due_at
     ) VALUES ($1, $2, $3, NOW(), $4, $5, $6)
     RETURNING *`,
    [salesOrderNumber, quotationType || 'rental', userId, sequence, STATUS.WAITING, due]
  );
  const wf = ins.rows[0];

  let assigneeName = 'Unassigned';
  if (userId) {
    const u = await client.query(`SELECT name FROM users WHERE user_id = $1`, [userId]);
    assigneeName = u.rows[0]?.name || `User #${userId}`;
  }

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dispatch_assigned',
    `Assigned to ${assigneeName} (accept by ${due.toLocaleString('en-IN')}).`,
    { assigned_user_id: userId, assignment_sequence: sequence, acceptance_due_at: due.toISOString() },
    user
  );

  if (userId) {
    await logWorkflowActivity(
      client,
      salesOrderNumber,
      'dispatch_notification_sent',
      `Dispatch notification sent to ${assigneeName}.`,
      { user_id: userId },
      user
    );
  }

  return { workflow: wf, assigneeName, notifyUserId: userId };
}

async function postStartWorkflowNotifications({ salesOrderNumber, notifyUserId, assigneeName }) {
  if (!notifyUserId) return;
  await notifyDispatchUser(notifyUserId, 'dispatch_assigned', {
    title: 'New sales order assigned',
    body: `SO ${salesOrderNumber} assigned to you. Accept within SLA.`,
    salesOrderNumber,
  });
  try {
    const { emitNewOrder } = require('./dispatchSocketService');
    await emitNewOrder(salesOrderNumber);
  } catch (err) {
    console.error('dispatch socket new-order emit failed:', err.message);
  }
}

async function acceptOrder(client, { salesOrderNumber, userId, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf) return { ok: false, status: 404, message: 'Workflow not found' };
  if (wf.status !== STATUS.WAITING) {
    if (wf.status === STATUS.ACCEPTED || wf.accepted_by === userId) {
      return { ok: true, workflow: wf, noop: true };
    }
    return { ok: false, status: 400, message: `Cannot accept from status ${wf.status}` };
  }
  if (wf.assigned_user_id && wf.assigned_user_id !== userId) {
    const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';
    if (!isAdmin) {
      return { ok: false, status: 403, message: 'This order is assigned to another dispatch user' };
    }
  }

  const upd = await client.query(
    `UPDATE dispatch_workflow
        SET status = $1, accepted_by = $2, accepted_at = NOW(),
            alert_snoozed_until = NULL, last_decline_remark = NULL, updated_at = NOW()
      WHERE sales_order_number = $3
      RETURNING *`,
    [STATUS.ACCEPTED, userId, salesOrderNumber]
  );
  const updated = upd.rows[0];

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dispatch_accepted',
    `${user?.name || 'Dispatch user'} accepted the order.`,
    { accepted_by: userId, accepted_at: updated.accepted_at },
    user
  );

  await checkAvailability(client, updated, user);
  const refreshed = await getWorkflow(client, salesOrderNumber);
  try {
    const { emitAccepted } = require('./dispatchSocketService');
    await emitAccepted(salesOrderNumber);
  } catch (err) {
    console.error('dispatch socket accepted emit failed:', err.message);
  }
  return { ok: true, workflow: refreshed };
}

async function findAvailableSerialForSo(client, salesOrderNumber) {
  const linesR = await client.query(
    `SELECT id AS line_id, brand, model_name, processor, generation, ram, storage, gpu, screen_size,
            COALESCE(main_qty, quantity, 0) AS ordered_qty, entity_code, quotation_type
       FROM sales_order_lines WHERE sales_order_number = $1 ORDER BY id`,
    [salesOrderNumber]
  );
  const attachedR = await client.query(
    `SELECT line_id, COUNT(*)::int AS n FROM sales_order_serials
      WHERE sales_order_number = $1 AND status IN ('attached', 'dispatched')
      GROUP BY line_id`,
    [salesOrderNumber]
  );
  const attachedByLine = Object.fromEntries(attachedR.rows.map((r) => [r.line_id, r.n]));

  for (const line of linesR.rows) {
    const need = Number(line.ordered_qty) - (attachedByLine[line.line_id] || 0);
    if (need <= 0) continue;

    const entity = line.entity_code || entityForQuotationType(line.quotation_type);
    const serialsR = await client.query(
      `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code,
              COALESCE(vsn.extra->>'brand', inv.brand) AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', inv.model) AS model,
              COALESCE(vsn.extra->>'processor', inv.processor) AS processor,
              vsn.extra->>'generation' AS generation,
              COALESCE(vsn.extra->>'ram', inv.ram) AS ram,
              COALESCE(vsn.extra->>'storage', inv.storage) AS storage,
              vsn.inventory_status, vsn.qc_status
         FROM vendor_serial_numbers vsn
         LEFT JOIN inventory inv ON inv.machine_number = vsn.inventory_asset_code OR inv.serial_number = vsn.serial_number
        WHERE vsn.deleted_at IS NULL
          AND LOWER(COALESCE(vsn.qc_status, '')) = 'passed'
          AND LOWER(COALESCE(vsn.inventory_status, 'in_stock')) IN ('in_stock', 'passed')
          AND (vsn.current_entity IS NULL OR vsn.current_entity = $1)
        ORDER BY vsn.serial_id ASC
        LIMIT 200`,
      [entity]
    );

    for (const serial of serialsR.rows) {
      if (serialMatchesSoLine(line, serial)) {
        return { available: true, line, serial };
      }
    }
  }
  return { available: false };
}

async function createPurchaseRequest(client, wf, user) {
  const soNumber = wf.sales_order_number;
  const linesR = await client.query(
    `SELECT id AS line_id, customer_id, brand, model_name, processor, generation, ram, storage, gpu, screen_size,
            COALESCE(main_qty, quantity, 1) AS quantity
       FROM sales_order_lines WHERE sales_order_number = $1 ORDER BY id LIMIT 1`,
    [soNumber]
  );
  const line = linesR.rows[0];
  if (!line) return null;

  const spec = {
    brand: line.brand,
    model_name: line.model_name,
    processor: line.processor,
    generation: line.generation,
    ram: line.ram,
    storage: line.storage,
    gpu: line.gpu,
    screen_size: line.screen_size,
  };

  const pr = await client.query(
    `INSERT INTO sales_order_procurement_requests (
       sales_order_number, line_id, customer_id, status, priority, spec, quantity, notes, created_by
     ) VALUES ($1, $2, $3, 'New', 'high', $4::jsonb, $5, $6, $7)
     RETURNING *`,
    [
      soNumber,
      line.line_id,
      line.customer_id,
      JSON.stringify(spec),
      line.quantity,
      `Auto-created: no matching laptop for SO ${soNumber}`,
      user?.user_id || null,
    ]
  );
  const prRow = pr.rows[0];

  await client.query(
    `UPDATE dispatch_workflow
        SET status = $1, purchase_request_id = $2, updated_at = NOW()
      WHERE sales_order_number = $3`,
    [STATUS.AWAITING_PR, prRow.id, soNumber]
  );

  await logWorkflowActivity(
    client,
    soNumber,
    'purchase_request_created',
    `Purchase request #${prRow.id} created — no matching laptop in stock.`,
    { purchase_request_id: prRow.id, spec },
    user
  );

  return prRow;
}

async function checkAvailability(client, wf, user) {
  const soNumber = wf.sales_order_number;
  if (![STATUS.ACCEPTED, STATUS.ATTACHING, STATUS.AWAITING_PR].includes(wf.status)) {
    return wf;
  }

  const match = await findAvailableSerialForSo(client, soNumber);
  if (match.available) {
    if (wf.status !== STATUS.ATTACHING) {
      await client.query(
        `UPDATE dispatch_workflow SET status = $1, updated_at = NOW() WHERE sales_order_number = $2`,
        [STATUS.ATTACHING, soNumber]
      );
      await logWorkflowActivity(
        client,
        soNumber,
        'laptop_available',
        'Matching laptop available — attach via Sales Order serial panel.',
        { serial_id: match.serial.serial_id, ttspl: match.serial.inventory_asset_code },
        user
      );
    }
    return getWorkflow(client, soNumber);
  }

  if (wf.status === STATUS.AWAITING_PR && wf.purchase_request_id) return wf;
  await createPurchaseRequest(client, wf, user);
  return getWorkflow(client, soNumber);
}

async function onAttached(client, { salesOrderNumber, serialId, user }) {
  const db = client || pool;
  const wf = await getWorkflow(db, salesOrderNumber, { forUpdate: !!client });
  if (!wf) return null;
  if ([STATUS.DISPATCH_QC, STATUS.READY, STATUS.DC, STATUS.DISPATCHED, STATUS.CUSTOMER_ASSET].includes(wf.status)) {
    return wf;
  }

  const cfg = await loadConfig(db);
  const qcDue = new Date(Date.now() + cfg.qc_eta_minutes * 60 * 1000);

  const upd = await db.query(
    `UPDATE dispatch_workflow
        SET status = $1, qc_started_at = NOW(), qc_due_at = $2, qc_overdue = FALSE, updated_at = NOW()
      WHERE sales_order_number = $3
      RETURNING *`,
    [STATUS.DISPATCH_QC, qcDue, salesOrderNumber]
  );

  await logWorkflowActivity(
    db,
    salesOrderNumber,
    'laptop_attached',
    `Laptop attached (serial #${serialId}). Dispatch QC started — ETA ${qcDue.toLocaleString('en-IN')}.`,
    { serial_id: serialId, qc_due_at: qcDue.toISOString() },
    user
  );

  await logWorkflowActivity(
    db,
    salesOrderNumber,
    'dispatch_qc_started',
    'Dispatch QC in progress.',
    { qc_due_at: qcDue.toISOString() },
    user
  );

  try {
    const { emitQcStarted } = require('./dispatchSocketService');
    await emitQcStarted(salesOrderNumber);
  } catch (err) {
    console.error('dispatch socket qc-started emit failed:', err.message);
  }

  return upd.rows[0];
}

async function onQcPassed(client, { salesOrderNumber, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf) return null;
  if ([STATUS.READY, STATUS.DC, STATUS.DISPATCHED, STATUS.CUSTOMER_ASSET].includes(wf.status)) return wf;
  if (wf.status !== STATUS.DISPATCH_QC) return wf;

  const upd = await client.query(
    `UPDATE dispatch_workflow
        SET status = $1, qc_passed_at = NOW(), qc_overdue = FALSE, updated_at = NOW()
      WHERE sales_order_number = $2
      RETURNING *`,
    [STATUS.READY, salesOrderNumber]
  );

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dispatch_qc_passed',
    'Dispatch QC passed — ready for delivery challan.',
    { qc_passed_at: new Date().toISOString() },
    user
  );

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'ready_for_dispatch',
    'Order ready for dispatch / DC generation.',
    {},
    user
  );

  const assigneeId = resolveAssignedDispatchUserId(wf);
  if (assigneeId) {
    await notifyDispatchUser(assigneeId, 'ready_for_dispatch', {
      title: 'Ready for dispatch',
      body: `SO ${salesOrderNumber} passed Dispatch QC.`,
      salesOrderNumber,
    });
  }

  try {
    const { emitQcComplete } = require('./dispatchSocketService');
    await emitQcComplete(salesOrderNumber, assigneeId);
  } catch (err) {
    console.error('dispatch socket qc-complete emit failed:', err.message);
  }

  return upd.rows[0];
}

async function onQcFailed(client, { salesOrderNumber, reason, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf) return null;

  const assigneeId = resolveAssignedDispatchUserId(wf);
  const trimmedReason = String(reason || '').trim() || 'Dispatch QC failed — attach another laptop.';

  if (wf.status === STATUS.DISPATCH_QC) {
    await client.query(
      `UPDATE dispatch_workflow
          SET status = $1, qc_started_at = NULL, qc_due_at = NULL,
              qc_passed_at = NULL, qc_overdue = FALSE, updated_at = NOW()
        WHERE sales_order_number = $2`,
      [STATUS.ATTACHING, salesOrderNumber]
    );
  }

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dispatch_qc_failed',
    trimmedReason,
    { assigned_user_id: assigneeId },
    user
  );

  if (assigneeId) {
    await notifyDispatchUser(assigneeId, 'dispatch_qc_failed', {
      title: 'Dispatch QC failed',
      body: `SO ${salesOrderNumber}: ${trimmedReason}`,
      salesOrderNumber,
    });
  }

  return wf;
}

async function onDcGenerated(client, { salesOrderNumber, dcNumber, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf) return null;
  if ([STATUS.DISPATCHED, STATUS.CUSTOMER_ASSET].includes(wf.status)) return wf;
  if (wf.status === STATUS.DC && wf.updated_at) return wf;

  await client.query(
    `UPDATE dispatch_workflow SET status = $1, updated_at = NOW() WHERE sales_order_number = $2`,
    [STATUS.DC, salesOrderNumber]
  );

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dc_created',
    `Delivery challan ${dcNumber || ''} generated.`,
    { dc_number: dcNumber },
    user
  );

  return getWorkflow(client, salesOrderNumber);
}

async function onDispatched(client, { salesOrderNumber, dcNumber, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf) return null;
  if (wf.status === STATUS.CUSTOMER_ASSET) return wf;

  await client.query(
    `UPDATE dispatch_workflow SET status = $1, updated_at = NOW() WHERE sales_order_number = $2`,
    [STATUS.DISPATCHED, salesOrderNumber]
  );

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dispatch_started',
    `Dispatched via DC ${dcNumber || ''}.`,
    { dc_number: dcNumber },
    user
  );

  return getWorkflow(client, salesOrderNumber);
}

async function onCustomerAsset(client, { salesOrderNumber, dcNumber, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf) return null;
  if (wf.status === STATUS.CUSTOMER_ASSET) return wf;

  await client.query(
    `UPDATE dispatch_workflow SET status = $1, updated_at = NOW() WHERE sales_order_number = $2`,
    [STATUS.CUSTOMER_ASSET, salesOrderNumber]
  );

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dispatch_completed',
    `Delivered — customer asset created${dcNumber ? ` (DC ${dcNumber})` : ''}.`,
    { dc_number: dcNumber },
    user
  );

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'customer_asset_created',
    'Customer asset record active.',
    { dc_number: dcNumber },
    user
  );

  return getWorkflow(client, salesOrderNumber);
}

async function onPurchaseRequestReceived(client, { salesOrderNumber, purchaseRequestId, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf || wf.status !== STATUS.AWAITING_PR) return wf;

  await client.query(
    `UPDATE sales_order_procurement_requests SET status = 'Received', updated_at = NOW() WHERE id = $1`,
    [purchaseRequestId]
  );

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'purchase_request_received',
    `Purchase request #${purchaseRequestId} received — check laptop availability.`,
    { purchase_request_id: purchaseRequestId },
    user
  );

  await client.query(
    `UPDATE dispatch_workflow SET status = $1, updated_at = NOW() WHERE sales_order_number = $2`,
    [STATUS.ACCEPTED, salesOrderNumber]
  );

  const refreshed = await getWorkflow(client, salesOrderNumber);
  return checkAvailability(client, refreshed, user);
}

async function fetchSoLinesByNumbers(soNumbers) {
  if (!soNumbers?.length) return {};
  const r = await pool.query(
    `SELECT id AS line_id, sales_order_number, brand, model_name, processor, generation,
            ram, storage, gpu, screen_size, quotation_type,
            COALESCE(main_qty, quantity, 1) AS quantity
       FROM sales_order_lines
      WHERE sales_order_number = ANY($1::text[])
      ORDER BY sales_order_number, id ASC`,
    [soNumbers]
  );
  const bySo = {};
  for (const line of r.rows) {
    if (!bySo[line.sales_order_number]) bySo[line.sales_order_number] = [];
    bySo[line.sales_order_number].push(line);
  }
  return bySo;
}

function enrichRowsWithSoLines(rows, linesBySo) {
  return rows.map((row) => {
    const lines = linesBySo[row.sales_order_number] || [];
    const first = lines[0] || {};
    return {
      ...row,
      lines,
      brand: first.brand ?? row.brand,
      model_name: first.model_name ?? row.model_name,
      processor: first.processor ?? row.processor,
      generation: first.generation ?? row.generation,
      ram: first.ram ?? row.ram,
      storage: first.storage ?? row.storage,
      quantity: first.quantity ?? row.quantity,
    };
  });
}

async function attachSoLinesToRows(rows) {
  const soNumbers = [...new Set(rows.map((r) => r.sales_order_number).filter(Boolean))];
  const linesBySo = await fetchSoLinesByNumbers(soNumbers);
  return enrichRowsWithSoLines(rows, linesBySo);
}

async function listPendingOrders({ userId, role }) {
  // Acceptance queue is for dispatch login only — not sales/admin/manager.
  if (role !== 'dispatch' && role !== 'super_admin') {
    return [];
  }

  const params = [STATUS.WAITING];
  let assigneeFilter = '';
  if (role === 'dispatch') {
    params.push(userId);
    assigneeFilter = ` AND dw.assigned_user_id = $${params.length}`;
  }

  const r = await pool.query(
    `SELECT dw.id, dw.sales_order_number, dw.quotation_type, dw.assigned_user_id,
            dw.assigned_at, dw.assignment_sequence, dw.acceptance_due_at, dw.status,
            dw.alert_snoozed_until, dw.last_decline_remark,
            u.name AS assigned_user_name,
            sol.customer_name,
            COALESCE(sol.entity_code, sol.branch) AS entity_code,
            sol.quotation_type AS order_type,
            CASE
              WHEN dw.acceptance_due_at IS NOT NULL AND dw.acceptance_due_at < NOW() THEN 'critical'
              WHEN dw.acceptance_due_at IS NOT NULL AND dw.acceptance_due_at < NOW() + interval '5 minutes' THEN 'high'
              ELSE 'normal'
            END AS priority
       FROM dispatch_workflow dw
       LEFT JOIN users u ON u.user_id = dw.assigned_user_id
       LEFT JOIN LATERAL (
         SELECT customer_name, entity_code, quotation_type, branch
           FROM sales_order_lines
          WHERE sales_order_number = dw.sales_order_number
          ORDER BY id ASC
          LIMIT 1
       ) sol ON TRUE
      WHERE dw.status = $1${assigneeFilter}
      ORDER BY dw.acceptance_due_at ASC NULLS LAST, dw.assigned_at ASC`,
    params
  );
  return attachSoLinesToRows(r.rows);
}

async function listPendingAssignmentAlerts({ userId, role }) {
  if (role !== 'dispatch') {
    return [];
  }

  const r = await pool.query(
    `SELECT dw.id, dw.sales_order_number, dw.quotation_type, dw.assigned_user_id,
            dw.assigned_at, dw.acceptance_due_at, dw.status, dw.last_decline_remark,
            dw.alert_snoozed_until,
            sol.customer_name,
            COALESCE(sol.entity_code, sol.branch) AS entity_code,
            sol.quotation_type AS order_type,
            sol.brand, sol.model_name, sol.processor, sol.generation, sol.ram, sol.storage,
            COALESCE(sol.main_qty, sol.quantity, 1) AS quantity,
            CASE
              WHEN dw.acceptance_due_at IS NOT NULL AND dw.acceptance_due_at < NOW() THEN 'critical'
              WHEN dw.acceptance_due_at IS NOT NULL AND dw.acceptance_due_at < NOW() + interval '5 minutes' THEN 'high'
              ELSE 'normal'
            END AS priority
       FROM dispatch_workflow dw
       LEFT JOIN LATERAL (
         SELECT customer_name, entity_code, quotation_type, branch,
                brand, model_name, processor, generation, ram, storage, main_qty, quantity
           FROM sales_order_lines
          WHERE sales_order_number = dw.sales_order_number
          ORDER BY id ASC
          LIMIT 1
       ) sol ON TRUE
      WHERE dw.status = $1
        AND dw.assigned_user_id = $2
        AND (dw.acceptance_due_at IS NULL OR dw.acceptance_due_at <= NOW())
        AND NOT (dw.alert_snoozed_until IS NOT NULL AND dw.alert_snoozed_until > NOW())
      ORDER BY dw.acceptance_due_at ASC NULLS LAST, dw.assigned_at ASC`,
    [STATUS.WAITING, userId]
  );
  return attachSoLinesToRows(r.rows);
}

async function listPendingQcAlerts({ userId }) {
  if (!userId) return [];

  const r = await pool.query(
    `SELECT dw.id, dw.sales_order_number, dw.quotation_type,
            dw.qc_started_at, dw.qc_due_at, dw.qc_overdue, dw.status,
            dw.qc_alert_snoozed_until, dw.qc_alert_snooze_remark,
            sol.customer_name,
            COALESCE(sol.entity_code, sol.branch) AS entity_code,
            sol.quotation_type AS order_type,
            sol.brand, sol.model_name, sol.processor, sol.generation, sol.ram, sol.storage,
            COALESCE(sol.main_qty, sol.quantity, 1) AS quantity,
            tk.ticket_id,
            tk.ticket_assignee_user_id,
            CASE
              WHEN dw.qc_due_at IS NOT NULL AND dw.qc_due_at < NOW() THEN 'critical'
              WHEN dw.qc_due_at IS NOT NULL AND dw.qc_due_at < NOW() + interval '5 minutes' THEN 'high'
              ELSE 'normal'
            END AS priority
       FROM dispatch_workflow dw
       LEFT JOIN LATERAL (
         SELECT customer_name, entity_code, quotation_type, branch,
                brand, model_name, processor, generation, ram, storage, main_qty, quantity
           FROM sales_order_lines
          WHERE sales_order_number = dw.sales_order_number
          ORDER BY id ASC
          LIMIT 1
       ) sol ON TRUE
       INNER JOIN LATERAL (
         SELECT t.ticket_id, t.assigned_user_id AS ticket_assignee_user_id
           FROM tickets t
           JOIN stages s ON s.stage_id = t.current_stage_id
          WHERE t.sales_order_number = dw.sales_order_number
            AND t.ticket_type = 'sales_order_qc'
            AND t.status IN ('in_progress', 'on_hold')
            AND s.stage_name = 'Dispatch QC'
            AND t.assigned_user_id = $2
          ORDER BY t.ticket_id DESC
          LIMIT 1
       ) tk ON TRUE
      WHERE dw.status = $1
        AND dw.qc_due_at IS NOT NULL
        AND dw.qc_alert_dismissed IS NOT TRUE
        AND NOT (dw.qc_alert_snoozed_until IS NOT NULL AND dw.qc_alert_snoozed_until > NOW())
      ORDER BY dw.qc_due_at ASC NULLS LAST, dw.qc_started_at ASC`,
    [STATUS.DISPATCH_QC, userId]
  );
  return attachSoLinesToRows(r.rows.map((row) => ({
    ...row,
    qc_sla_breached: row.qc_due_at ? new Date(row.qc_due_at) <= new Date() : false,
  })));
}

async function assertDispatchQcTicketAssignee(client, { salesOrderNumber, userId }) {
  const db = client || pool;
  const r = await db.query(
    `SELECT t.assigned_user_id
       FROM tickets t
       JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE t.sales_order_number = $1
        AND t.ticket_type = 'sales_order_qc'
        AND t.status IN ('in_progress', 'on_hold')
        AND s.stage_name = 'Dispatch QC'
      ORDER BY t.ticket_id DESC
      LIMIT 1`,
    [salesOrderNumber]
  );
  const assigneeId = r.rows[0]?.assigned_user_id;
  if (!assigneeId) {
    return { ok: false, status: 400, message: 'Dispatch QC ticket has no assignee yet' };
  }
  if (Number(assigneeId) !== Number(userId)) {
    return { ok: false, status: 403, message: 'Only the assigned Dispatch QC technician can snooze this alert' };
  }
  return { ok: true };
}

async function snoozeAssignmentAlert(client, { salesOrderNumber, userId, remark, snoozeMinutes, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf) return { ok: false, status: 404, message: 'Workflow not found' };
  if (wf.status !== STATUS.WAITING) {
    return { ok: false, status: 400, message: 'Order is no longer waiting for acceptance' };
  }
  if (wf.assigned_user_id && wf.assigned_user_id !== userId) {
    return { ok: false, status: 403, message: 'This order is assigned to another dispatch user' };
  }

  const trimmedRemark = String(remark || '').trim();
  if (!trimmedRemark) {
    return { ok: false, status: 400, message: 'Remark is required to snooze this alert' };
  }

  const cfg = await loadConfig(client);
  const allowed = [5, 10, 15, 30, 60];
  const defaultMinutes = cfg.alert_snooze_minutes || 5;
  let minutes = parseInt(snoozeMinutes, 10);
  if (!allowed.includes(minutes)) {
    minutes = allowed.includes(defaultMinutes) ? defaultMinutes : 5;
  }

  const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);

  await client.query(
    `UPDATE dispatch_workflow
        SET alert_snoozed_until = $1, last_decline_remark = $2, updated_at = NOW()
      WHERE sales_order_number = $3`,
    [snoozeUntil, trimmedRemark, salesOrderNumber]
  );

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dispatch_alert_snoozed',
    `Dispatch alert snoozed for ${minutes} minutes: ${trimmedRemark}`,
    { snoozed_until: snoozeUntil.toISOString(), snooze_minutes: minutes, remark: trimmedRemark },
    user
  );

  return { ok: true, snoozed_until: snoozeUntil, snooze_minutes: minutes, remark: trimmedRemark };
}

async function snoozeQcAlert(client, { salesOrderNumber, userId, remark, snoozeMinutes, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf) return { ok: false, status: 404, message: 'Workflow not found' };
  if (wf.status !== STATUS.DISPATCH_QC) {
    return { ok: false, status: 400, message: 'Order is no longer in Dispatch QC' };
  }
  const assigneeCheck = await assertDispatchQcTicketAssignee(client, {
    salesOrderNumber,
    userId,
  });
  if (!assigneeCheck.ok) return assigneeCheck;

  const trimmedRemark = String(remark || '').trim();
  if (!trimmedRemark) {
    return { ok: false, status: 400, message: 'Remark is required to snooze this alert' };
  }

  const cfg = await loadConfig(client);
  const allowed = [5, 10, 15, 30, 60];
  const defaultMinutes = cfg.alert_snooze_minutes || 5;
  let minutes = parseInt(snoozeMinutes, 10);
  if (!allowed.includes(minutes)) {
    minutes = allowed.includes(defaultMinutes) ? defaultMinutes : 5;
  }

  const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);

  await client.query(
    `UPDATE dispatch_workflow
        SET qc_alert_snoozed_until = $1, qc_alert_snooze_remark = $2, updated_at = NOW()
      WHERE sales_order_number = $3`,
    [snoozeUntil, trimmedRemark, salesOrderNumber]
  );

  const snoozeNote = `QC reminder snoozed for ${minutes} minute${minutes === 1 ? '' : 's'}. Remark: ${trimmedRemark}`;

  await logDispatchQcTicketActivity(client, {
    salesOrderNumber,
    userId,
    action: 'dispatch_qc_snoozed',
    notes: snoozeNote,
  });

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dispatch_qc_alert_snoozed',
    `Dispatch QC reminder snoozed for ${minutes} minutes.`,
    {
      snoozed_until: snoozeUntil.toISOString(),
      snooze_minutes: minutes,
      remark: trimmedRemark,
      ticket_assignee_user_id: userId,
    },
    user,
    trimmedRemark
  );

  return { ok: true, snoozed_until: snoozeUntil, snooze_minutes: minutes, remark: trimmedRemark };
}

async function dismissQcAlert(client, { salesOrderNumber, userId, remark, user }) {
  const wf = await getWorkflow(client, salesOrderNumber, { forUpdate: true });
  if (!wf) return { ok: false, status: 404, message: 'Workflow not found' };
  if (wf.status !== STATUS.DISPATCH_QC) {
    return { ok: false, status: 400, message: 'Order is no longer in Dispatch QC' };
  }
  const assigneeCheck = await assertDispatchQcTicketAssignee(client, {
    salesOrderNumber,
    userId,
  });
  if (!assigneeCheck.ok) return assigneeCheck;

  const trimmedRemark = String(remark || '').trim();
  if (!trimmedRemark) {
    return { ok: false, status: 400, message: 'Remark is required to reject this reminder' };
  }

  await client.query(
    `UPDATE dispatch_workflow
        SET qc_alert_dismissed = TRUE,
            qc_alert_dismiss_remark = $1,
            qc_alert_dismissed_at = NOW(),
            qc_alert_dismissed_by = $2,
            qc_alert_snoozed_until = NULL,
            updated_at = NOW()
      WHERE sales_order_number = $3`,
    [trimmedRemark, userId, salesOrderNumber]
  );

  const dismissNote = `QC reminder rejected/skipped. Remark: ${trimmedRemark}`;

  await logDispatchQcTicketActivity(client, {
    salesOrderNumber,
    userId,
    action: 'dispatch_qc_reminder_rejected',
    notes: dismissNote,
  });

  await logWorkflowActivity(
    client,
    salesOrderNumber,
    'dispatch_qc_alert_dismissed',
    'Dispatch QC reminder rejected/skipped (will not remind again).',
    {
      remark: trimmedRemark,
      ticket_assignee_user_id: userId,
    },
    user,
    trimmedRemark
  );

  return { ok: true, remark: trimmedRemark };
}

async function listDispatchDashboard({ userId, role }) {
  const isDispatch = role === 'dispatch' || role === 'super_admin' || role === 'admin';
  const params = [];
  let where = `dw.status NOT IN ('customer_asset')`;
  if (isDispatch && role === 'dispatch') {
    params.push(userId);
    where += ` AND (dw.assigned_user_id = $${params.length} OR dw.accepted_by = $${params.length})`;
  }
  const r = await pool.query(
    `SELECT dw.*, u.name AS assigned_user_name,
            pr.status AS purchase_request_status
       FROM dispatch_workflow dw
       LEFT JOIN users u ON u.user_id = dw.assigned_user_id
       LEFT JOIN sales_order_procurement_requests pr ON pr.id = dw.purchase_request_id
      WHERE ${where}
      ORDER BY dw.acceptance_due_at ASC NULLS LAST, dw.updated_at DESC
      LIMIT 50`,
    params
  );
  return r.rows;
}

module.exports = {
  STATUS,
  loadConfig,
  fetchDispatchMemberIds,
  assignRoundRobin,
  getWorkflow,
  startWorkflow,
  postStartWorkflowNotifications,
  acceptOrder,
  checkAvailability,
  createPurchaseRequest,
  onAttached,
  onQcPassed,
  onQcFailed,
  resolveAssignedDispatchUserId,
  onDcGenerated,
  onDispatched,
  onCustomerAsset,
  onPurchaseRequestReceived,
  fetchSoLinesByNumbers,
  attachSoLinesToRows,
  listPendingOrders,
  listPendingAssignmentAlerts,
  listPendingQcAlerts,
  assertDispatchQcTicketAssignee,
  snoozeAssignmentAlert,
  snoozeQcAlert,
  dismissQcAlert,
  listDispatchDashboard,
  safeLogWorkflowActivity: (params) => safeLogSalesOrderActivity({ ...params, activityType: WF_ACTIVITY }),
};
