const pool = require('../config/db');
const { resolveQcAssignee, recordAssigneeForTeam, fetchOrderedMemberIds } = require('../services/qcRoundRobinService');
const { syncWorkLogForTicketState, closeOpenWorkLogs, startWorkLog } = require('../services/ticketWorkLogService');
const { applyGrnVendorQcPassOnTicketComplete } = require('../services/grnTicketService');
const ttsplAuditService = require('../services/ttsplAuditService');
const { sendHighlightedTicketAlert } = require('../services/highlightedTicketAlertService');
const vendorBilling = require('./vendorBillingController');

const PRIVILEGED_ROLES = ['admin', 'floor_manager', 'manager'];
const STAGE_ROUTING_ROLES = ['admin', 'floor_manager', 'manager', 'warehouse'];
const TECHNICIAN_ROLES = ['technician', 'team_member', 'team_lead'];
const DIAGNOSIS_REPAIR_STAGES = ['Chip Level Repair', 'Body & Paint'];
const QC_STAGES = ['QC1', 'QC2', 'Dispatch QC'];

const MANAGER_ROUTING_FROM = {
  Diagnosis: ['Assembly & Software', 'Chip Level Repair', 'Body & Paint'],
};

function isStageRouter(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return STAGE_ROUTING_ROLES.includes(user.role);
}

function isAssignedTechnician(user, ticket) {
  const userId = Number(user?.user_id);
  const assigneeId = Number(ticket?.assigned_user_id);
  return userId > 0 && assigneeId > 0 && userId === assigneeId
    && TECHNICIAN_ROLES.includes(user?.role);
}

async function canMarkDiagnosisRepair(req, ticket, targetStageName) {
  if (isStageRouter(req.user)) return true;
  if (!DIAGNOSIS_REPAIR_STAGES.includes(targetStageName)) return false;
  if (!isAssignedTechnician(req.user, ticket)) return false;
  const currentStage = await getStageById(pool, ticket.current_stage_id);
  return currentStage?.stage_name === 'Diagnosis';
}

async function getStageByName(db, stageName) {
  const r = await db.query(
    `SELECT * FROM stages
     WHERE stage_name = $1
     ORDER BY (team_id IS NULL), stage_id ASC
     LIMIT 1`,
    [stageName]
  );
  return r.rows[0] || null;
}

async function getStageById(db, stageId) {
  const r = await db.query(`SELECT * FROM stages WHERE stage_id = $1`, [stageId]);
  return r.rows[0] || null;
}

async function validateTransition(fromStageName, toStageName, conditionHint) {
  const r = await pool.query(
    `SELECT * FROM stage_transition_rules
     WHERE from_stage_name = $1 AND to_stage_name = $2
     LIMIT 1`,
    [fromStageName, toStageName]
  );
  if (!r.rows.length) {
    return { ok: false, message: `Transition from "${fromStageName}" to "${toStageName}" is not allowed` };
  }
  const rule = r.rows[0];
  if (conditionHint && rule.condition && rule.condition !== conditionHint) {
    return { ok: false, message: `Transition requires condition "${rule.condition}"` };
  }
  return { ok: true, rule };
}

async function notifyHighlightedTechnician(ticket, reason) {
  if (!ticket.assigned_user_id) return;
  try {
    const u = await pool.query(
      `SELECT name, email FROM users WHERE user_id = $1`,
      [ticket.assigned_user_id]
    );
    if (!u.rows.length) return;
    await sendHighlightedTicketAlert({
      technicianEmail: u.rows[0].email,
      technicianName: u.rows[0].name,
      ttsplId: ticket.ttspl_id,
      ticketId: ticket.ticket_id,
      reason
    });
  } catch (e) {
    console.warn('[highlightedTicket] alert failed:', e.message);
  }
}

async function applyInventoryCompletion(db, ticket, userId) {
  await db.query(
    `UPDATE inventory SET status = 'In Stock', stock_type = 'Ready', stage = 'Inventory'
     WHERE serial_number = $1`,
    [ticket.serial_number]
  );

  if (ticket.vendor_serial_id) {
    await db.query(
      `UPDATE vendor_serial_numbers
       SET qc_status = 'passed', inventory_status = 'in_stock', updated_at = NOW()
       WHERE serial_id = $1`,
      [ticket.vendor_serial_id]
    );
    try {
      await applyGrnVendorQcPassOnTicketComplete(db, ticket, userId);
    } catch (e) {
      console.error('GRN vendor QC pass on inventory move failed:', e);
    }
  }

  if (ticket.ttspl_id) {
    await ttsplAuditService.logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'qc2_passed',
      description: 'QC2 passed — ready for inventory',
      actorUserId: userId,
      db
    });
    await ttsplAuditService.logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'inventory_ready',
      description: 'Ticket completed — moved to Inventory',
      actorUserId: userId,
      db
    });
  }
}

exports.getTicketsByTtsplId = async (req, res) => {
  try {
    const { ttsplId } = req.params;
    const r = await pool.query(
      `SELECT t.*, s.stage_name, u.name AS assigned_user_name
       FROM tickets t
       LEFT JOIN stages s ON s.stage_id = t.current_stage_id
       LEFT JOIN users u ON u.user_id = t.assigned_user_id
       WHERE t.ttspl_id = $1
       ORDER BY t.created_at DESC`,
      [ttsplId]
    );
    res.json({ success: true, tickets: r.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Failed to fetch tickets' });
  }
};

exports.getTtsplHistory = async (req, res) => {
  try {
    const data = await ttsplAuditService.getTtsplHistory(req.params.ttsplId);
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Failed to load history' });
  }
};

exports.getFloorDashboard = async (req, res) => {
  try {
    const [byStage, priority, techLoad, avgDur, partsAlerts, recent, qcFail] = await Promise.all([
      pool.query(`
        SELECT s.stage_name,
               COUNT(t.ticket_id)::int AS count,
               COUNT(t.ticket_id) FILTER (WHERE t.highlighted = TRUE)::int AS highlighted_count
        FROM stages s
        LEFT JOIN tickets t ON t.current_stage_id = s.stage_id AND t.status NOT IN ('completed', 'qc_failed_return_vendor', 'cancelled')
        GROUP BY s.stage_name, s.stage_order
        ORDER BY s.stage_order
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE priority = 'normal')::int AS normal,
          COUNT(*) FILTER (WHERE priority = 'high')::int AS high,
          COUNT(*) FILTER (WHERE priority = 'sales_order')::int AS sales_order
        FROM tickets WHERE status NOT IN ('completed', 'qc_failed_return_vendor', 'cancelled')
      `),
      pool.query(`
        SELECT u.user_id, u.name,
               COUNT(t.ticket_id)::int AS active_tickets
        FROM users u
        LEFT JOIN tickets t ON t.assigned_user_id = u.user_id
          AND t.status NOT IN ('completed', 'qc_failed_return_vendor', 'cancelled')
        WHERE u.active = TRUE AND u.role IN ('technician', 'floor_manager', 'qc')
        GROUP BY u.user_id, u.name
        HAVING COUNT(t.ticket_id) > 0
        ORDER BY active_tickets DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT s.stage_name,
               ROUND(AVG(EXTRACT(EPOCH FROM (wl.end_time - wl.start_time)) / 3600.0)::numeric, 2) AS avg_hours
        FROM work_logs wl
        JOIN stages s ON s.stage_id = wl.stage_id
        WHERE wl.end_time IS NOT NULL
        GROUP BY s.stage_name, s.stage_order
        ORDER BY s.stage_order
      `),
      pool.query(`
        SELECT pr.request_id, pr.part_name, pr.status, pr.ticket_id, t.ttspl_id
        FROM part_requests pr
        JOIN tickets t ON t.ticket_id = pr.ticket_id
        WHERE COALESCE(pr.status, 'pending') NOT IN ('fulfilled', 'completed')
        ORDER BY pr.created_at DESC
        LIMIT 15
      `),
      pool.query(`
        SELECT t.ticket_id, t.ttspl_id, t.serial_number, t.completed_at, s.stage_name
        FROM tickets t
        JOIN stages s ON s.stage_id = t.current_stage_id
        WHERE t.status = 'completed'
          AND t.completed_at >= CURRENT_DATE
        ORDER BY t.completed_at DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE qc_fail_count = 0 AND status = 'completed')::int AS passed,
          COUNT(*) FILTER (WHERE qc_fail_count > 0)::int AS failed
        FROM tickets
        WHERE created_at >= NOW() - INTERVAL '30 days'
      `)
    ]);

    res.json({
      success: true,
      byStage: byStage.rows,
      priorityCounts: priority.rows[0] || { normal: 0, high: 0, sales_order: 0 },
      technicianLoad: techLoad.rows,
      avgStageDuration: avgDur.rows,
      partsAlerts: partsAlerts.rows,
      recentCompletions: recent.rows,
      qcFailRate: qcFail.rows[0] || { passed: 0, failed: 0 }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Dashboard failed' });
  }
};

exports.moveToStage = async (req, res) => {
  const { id } = req.params;
  const { to_stage_name, reason, notes } = req.body;
  // Optional manual assignee (e.g. Final Testing -> QC1 picker). Overrides round-robin.
  const overrideAssignee = req.body.assigned_user_id ? Number(req.body.assigned_user_id) : null;

  if (!to_stage_name) {
    return res.status(400).json({ success: false, message: 'to_stage_name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticketRes = await client.query('SELECT * FROM tickets WHERE ticket_id = $1', [id]);
    if (!ticketRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const ticket = ticketRes.rows[0];
    const currentStage = await getStageById(client, ticket.current_stage_id);
    const currentStageName = currentStage?.stage_name;
    const nextStage = await getStageByName(client, to_stage_name);

    if (!nextStage) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Target stage not found' });
    }

    let conditionHint = null;
    if (currentStageName === 'QC1' && to_stage_name === 'Assembly & Software') conditionHint = 'qc1_failed';
    if (currentStageName === 'QC1' && to_stage_name === 'QC2') conditionHint = 'qc1_passed';
    if (currentStageName === 'QC1' && to_stage_name === 'Dispatch QC') conditionHint = 'qc1_passed_so';
    if (currentStageName === 'QC2' && to_stage_name === 'QC1') conditionHint = 'qc2_failed';
    if (currentStageName === 'QC2' && to_stage_name === 'Inventory') conditionHint = 'qc2_passed';
    if (currentStageName === 'Dispatch QC' && to_stage_name === 'Inventory') conditionHint = 'dispatch_qc_passed';
    if (currentStageName === 'Dispatch QC' && to_stage_name === 'Assembly & Software') conditionHint = 'dispatch_qc_failed';

    const privileged = PRIVILEGED_ROLES.includes(req.user.role);
    if (!privileged && req.user.role === 'qc' && !QC_STAGES.includes(currentStageName)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'QC team can only act on QC stages' });
    }

    const managerRoutes = MANAGER_ROUTING_FROM[currentStageName];
    if (managerRoutes?.includes(to_stage_name) && !isStageRouter(req.user)) {
      const techRepairOk = await canMarkDiagnosisRepair(req, ticket, to_stage_name);
      if (!techRepairOk) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Only floor manager, warehouse, or admin can route tickets from this stage',
        });
      }
    }

    if (
      currentStageName === 'Diagnosis'
      && to_stage_name === 'Assembly & Software'
      && req.user.role !== 'super_admin'
      && !PRIVILEGED_ROLES.includes(req.user.role)
    ) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'Only admin or floor manager can move tickets from Diagnosis to Assembly & Software',
      });
    }

    const transition = await validateTransition(currentStageName, to_stage_name, conditionHint);
    if (!transition.ok && !privileged) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: transition.message });
    }

    const updates = [];
    const params = [];
    let pi = 1;
    let highlighted = ticket.highlighted;
    let highlightedReason = ticket.highlighted_reason;
    let qcFailCount = ticket.qc_fail_count || 0;

    if (currentStageName === 'QC1' && to_stage_name === 'Assembly & Software') {
      if (!reason?.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'QC1 fail reason is required' });
      }
      qcFailCount += 1;
      updates.push(`qc_fail_count = $${pi++}`); params.push(qcFailCount);
      updates.push(`qc1_failed_at = NOW()`);
      updates.push(`qc1_fail_reason = $${pi++}`); params.push(reason.trim());
      highlighted = true;
      highlightedReason = `QC1 failed: ${reason.trim()}`;
      await ttsplAuditService.logTtsplEvent({
        ttsplId: ticket.ttspl_id,
        vendorSerialId: ticket.vendor_serial_id,
        eventType: 'qc1_failed',
        description: highlightedReason,
        metadata: { reason: reason.trim(), ticket_id: ticket.ticket_id },
        actorUserId: req.user.user_id,
        actorName: req.user.name,
        db: client
      });
    }

    if (currentStageName === 'QC1' && to_stage_name === 'QC2') {
      updates.push(`qc1_passed_at = NOW()`);
      updates.push(`highlighted = FALSE`);
      updates.push(`highlighted_reason = NULL`);
      highlighted = false;
      highlightedReason = null;
    }

    if (currentStageName === 'QC1' && to_stage_name === 'Dispatch QC') {
      updates.push(`qc1_passed_at = NOW()`);
      updates.push(`highlighted = FALSE`);
      updates.push(`highlighted_reason = NULL`);
      highlighted = false;
      highlightedReason = null;
    }

    if (currentStageName === 'Dispatch QC' && to_stage_name === 'Assembly & Software') {
      if (!reason?.trim() || reason.trim().length < 5) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Dispatch QC fail reason is required (min 5 characters)' });
      }
      qcFailCount += 1;
      updates.push(`qc_fail_count = $${pi++}`); params.push(qcFailCount);
      highlighted = true;
      highlightedReason = `Dispatch QC failed: ${reason.trim()}`;
      updates.push(`highlighted = TRUE`);
      updates.push(`highlighted_reason = $${pi++}`); params.push(highlightedReason);
      await ttsplAuditService.logTtsplEvent({
        ttsplId: ticket.ttspl_id,
        vendorSerialId: ticket.vendor_serial_id,
        eventType: 'qc1_failed',
        description: highlightedReason,
        metadata: { reason: reason.trim(), ticket_id: ticket.ticket_id, dispatch_qc: true },
        actorUserId: req.user.user_id,
        actorName: req.user.name,
        db: client
      });
    }

    if (currentStageName === 'Dispatch QC' && to_stage_name === 'Inventory') {
      updates.push(`highlighted = FALSE`);
      updates.push(`highlighted_reason = NULL`);
      highlighted = false;
      highlightedReason = null;
    }

    if (currentStageName === 'QC2' && to_stage_name === 'QC1') {
      if (!reason?.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'QC2 fail reason is required' });
      }
      if (!overrideAssignee) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'QC1 technician is required when failing from QC2 to QC1',
        });
      }
      const qc1MemberIds = nextStage.team_id
        ? await fetchOrderedMemberIds(client, nextStage.team_id)
        : [];
      if (!qc1MemberIds.includes(overrideAssignee)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Selected user is not an active QC1 team member',
        });
      }
      updates.push(`qc2_failed_at = NOW()`);
      updates.push(`qc2_fail_reason = $${pi++}`); params.push(reason.trim());
      highlighted = true;
      highlightedReason = `QC2 failed: ${reason.trim()}`;
      updates.push(`highlighted = TRUE`);
      updates.push(`highlighted_reason = $${pi++}`); params.push(highlightedReason);
      await ttsplAuditService.logTtsplEvent({
        ttsplId: ticket.ttspl_id,
        vendorSerialId: ticket.vendor_serial_id,
        eventType: 'qc2_failed',
        description: highlightedReason,
        metadata: { reason: reason.trim() },
        actorUserId: req.user.user_id,
        db: client
      });
    }

    if (to_stage_name === 'QC1' && ticket.qc1_failed_at && currentStageName !== 'QC2') {
      highlighted = true;
      highlightedReason = `QC1 previously failed: ${ticket.qc1_fail_reason || 'see history'}`;
      updates.push(`highlighted = TRUE`);
      updates.push(`highlighted_reason = $${pi++}`); params.push(highlightedReason);
    }

    if (to_stage_name === 'Assembly & Software' && ['technician', 'team_member', 'team_lead'].includes(req.user.role)) {
      updates.push(`highlighted = FALSE`);
      updates.push(`highlighted_reason = NULL`);
      highlighted = false;
    }

    let isCompleted = false;
    if (to_stage_name === 'Inventory') {
      isCompleted = true;
      updates.push(`status = 'completed'`);
      updates.push(`completed_at = NOW()`);
      updates.push(`qc2_passed_at = NOW()`);
      await applyInventoryCompletion(client, ticket, req.user.user_id);

      if (ticket.ticket_type === 'sales_order_qc') {
        await client.query(
          `UPDATE dc_qc_tickets SET status = 'qc_passed', updated_at = NOW()
           WHERE ticket_id = $1`,
          [ticket.ticket_id]
        );
        await client.query(
          `UPDATE delivery_challan_lines
           SET pre_dispatch_qc_passed = TRUE, updated_at = NOW()
           WHERE pre_dispatch_qc_ticket_id = $1`,
          [ticket.ticket_id]
        );
        // SO-level allocation: mark this laptop QC-passed and keep it reserved
        // (a passed pre-dispatch unit stays allocated to its order, not back to stock).
        await client.query(
          `UPDATE sales_order_serials SET qc_status = 'passed', updated_at = NOW()
           WHERE qc_ticket_id = $1 AND status = 'attached'`,
          [ticket.ticket_id]
        );
        if (ticket.vendor_serial_id) {
          await client.query(
            `UPDATE vendor_serial_numbers SET inventory_status = 'reserved', updated_at = NOW()
             WHERE serial_id = $1
               AND COALESCE(inventory_status,'in_stock') NOT IN ('rented','sold','on_demo','in_transit','returned')`,
            [ticket.vendor_serial_id]
          );
        }
      }
    } else {
      updates.push(`status = 'in_progress'`);
      updates.push(`completed_at = NULL`);
    }

    let assignedUserId = ticket.assigned_user_id;

    const KEEP_SAME_TECH_TRANSITIONS = new Set([
      'Diagnosis→Assembly & Software',
      'Assembly & Software→Final Testing',
      'Chip Level Repair→Assembly & Software',
      'Body & Paint→Assembly & Software',
      'QC1→Assembly & Software',
      'Dispatch QC→Assembly & Software',
    ]);

    const ROUND_ROBIN_TRANSITIONS = new Set([
      'Final Testing→QC1',
      'QC1→QC2',
      'QC1→Dispatch QC',
    ]);

    // All Hardware & Software stages — moving between any two of these keeps the
    // same technician so their work timer stays ongoing across the whole HW/SW flow.
    const HW_SW_STAGES = new Set([
      'Diagnosis',
      'Assembly & Software',
      'Final Testing',
      'Chip Level Repair',
      'Body & Paint',
    ]);

    const transitionKey = `${currentStageName}→${to_stage_name}`;
    const bothHwSw = HW_SW_STAGES.has(currentStageName) && HW_SW_STAGES.has(to_stage_name);

    if (ROUND_ROBIN_TRANSITIONS.has(transitionKey) && nextStage.team_id) {
      assignedUserId = await resolveQcAssignee(client, {
        teamId: nextStage.team_id,
        ticketId: ticket.ticket_id,
        targetStageName: to_stage_name,
        transitionKey
      });
    } else if (KEEP_SAME_TECH_TRANSITIONS.has(transitionKey) || bothHwSw) {
      assignedUserId = ticket.assigned_user_id;
    }

    // Manual picker (e.g. Final Testing -> QC1, QC2 fail -> QC1) wins over round-robin/keep-same.
    if (overrideAssignee) {
      assignedUserId = overrideAssignee;
      if (currentStageName === 'QC2' && to_stage_name === 'QC1' && nextStage.team_id) {
        await recordAssigneeForTeam(client, nextStage.team_id, overrideAssignee);
      }
    }

    updates.push(`current_stage_id = $${pi++}`); params.push(nextStage.stage_id);
    updates.push(`assigned_team_id = $${pi++}`); params.push(nextStage.team_id);
    updates.push(`assigned_user_id = $${pi++}`); params.push(assignedUserId);

    params.push(id);
    const updateSql = `UPDATE tickets SET ${updates.join(', ')} WHERE ticket_id = $${pi} RETURNING *`;
    const updated = await client.query(updateSql, params);
    const newTicket = updated.rows[0];

    if (ticket.serial_number) {
      await client.query(
        `UPDATE inventory SET stage = $1 WHERE serial_number = $2`,
        [to_stage_name, ticket.serial_number]
      );
    }

    // Stop the previous segment. Keep the timer running automatically only when
    // the SAME technician carries the unit to the next stage (Diagnosis →
    // Assembly & Software → Final Testing). A handoff to a new person (e.g. QC)
    // leaves it stopped so they scan-to-start their own timer.
    await closeOpenWorkLogs(client, newTicket.ticket_id);
    const sameTech = assignedUserId && ticket.assigned_user_id
      && Number(assignedUserId) === Number(ticket.assigned_user_id);
    if (newTicket.status !== 'completed' && sameTech) {
      await startWorkLog(client, {
        ticketId: newTicket.ticket_id,
        userId: assignedUserId,
        stageId: nextStage.stage_id
      });
    }

    const activityNotes = notes || reason || `Moved to ${to_stage_name}`;
    await client.query(
      `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
       VALUES ($1, $2, $3, 'stage_changed', $4)`,
      [id, nextStage.stage_id, req.user.user_id, activityNotes]
    );

    await ttsplAuditService.logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'stage_changed',
      description: `${currentStageName} → ${to_stage_name}`,
      metadata: { from: currentStageName, to: to_stage_name, reason: reason || null },
      actorUserId: req.user.user_id,
      actorName: req.user.name,
      db: client
    });

    await client.query('COMMIT');

    let assignedUserName = null;
    if (newTicket.assigned_user_id) {
      const uRes = await pool.query(
        'SELECT name FROM users WHERE user_id = $1',
        [newTicket.assigned_user_id]
      );
      assignedUserName = uRes.rows[0]?.name || null;
    }

    if (highlighted && highlightedReason) {
      notifyHighlightedTechnician({ ...newTicket, highlighted_reason: highlightedReason }, highlightedReason);
    }

    const assignNote = assignedUserName ? ` — assigned to ${assignedUserName}` : '';
    res.json({
      success: true,
      message: isCompleted
        ? 'Ticket completed — moved to Inventory'
        : `Moved to ${to_stage_name}${assignNote}`,
      ticket: newTicket,
      assigned_user_name: assignedUserName,
      completed: isCompleted
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('moveToStage error:', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to move stage' });
  } finally {
    client.release();
  }
};

async function moveToNamedStage(req, res, stageName, flags = {}) {
  const ticketRes = await pool.query('SELECT * FROM tickets WHERE ticket_id = $1', [req.params.id]);
  if (!ticketRes.rows.length) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }
  const ticket = ticketRes.rows[0];

  const allowed = await canMarkDiagnosisRepair(req, ticket, stageName);
  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: 'Only the assigned technician (Diagnosis) or floor manager can route to repair stages',
    });
  }

  if (flags.chip_repair_required) {
    await pool.query(`UPDATE tickets SET chip_repair_required = TRUE WHERE ticket_id = $1`, [req.params.id]);
    if (ticket.ttspl_id) {
      await ttsplAuditService.logTtsplEvent({
        ttsplId: ticket.ttspl_id,
        vendorSerialId: ticket.vendor_serial_id,
        eventType: 'chip_repair_started',
        description: 'Chip Level Repair required',
        actorUserId: req.user.user_id
      });
    }
  }
  if (flags.body_paint_required) {
    await pool.query(`UPDATE tickets SET body_paint_required = TRUE WHERE ticket_id = $1`, [req.params.id]);
    if (ticket.ttspl_id) {
      await ttsplAuditService.logTtsplEvent({
        ttsplId: ticket.ttspl_id,
        vendorSerialId: ticket.vendor_serial_id,
        eventType: 'body_paint_started',
        description: 'Body & Paint required',
        actorUserId: req.user.user_id
      });
    }
  }
  req.body.to_stage_name = stageName;
  return exports.moveToStage(req, res);
}

exports.markChipRepairRequired = (req, res) =>
  moveToNamedStage(req, res, 'Chip Level Repair', { chip_repair_required: true });

exports.markBodyPaintRequired = (req, res) =>
  moveToNamedStage(req, res, 'Body & Paint', { body_paint_required: true });

exports.markQcFailed = async (req, res) => {
  const { id } = req.params;
  const { reason, return_dc_number } = req.body;
  if (!reason?.trim()) {
    return res.status(400).json({ success: false, message: 'Reason is required' });
  }
  try {
    const ticketRes = await pool.query('SELECT * FROM tickets WHERE ticket_id = $1', [id]);
    if (!ticketRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const ticket = ticketRes.rows[0];

    await pool.query(
      `UPDATE tickets SET
         floor_manager_qc_failed = TRUE,
         floor_manager_qc_failed_at = NOW(),
         floor_manager_qc_fail_reason = $2,
         return_to_vendor_dc_number = $3,
         status = 'qc_failed_return_vendor',
         highlighted = TRUE,
         highlighted_reason = $2
       WHERE ticket_id = $1`,
      [id, reason.trim(), return_dc_number || null]
    );

    if (ticket.vendor_serial_id) {
      await pool.query(
        `UPDATE vendor_serial_numbers SET qc_status = 'qc_failed_return_vendor', updated_at = NOW()
         WHERE serial_id = $1`,
        [ticket.vendor_serial_id]
      );
    }

    // SO-level allocation: this laptop failed pre-dispatch QC — mark it failed so
    // the warehouse detaches/replaces it before the DC can be generated.
    if (ticket.ticket_type === 'sales_order_qc') {
      await pool.query(
        `UPDATE sales_order_serials SET qc_status = 'failed', updated_at = NOW()
         WHERE qc_ticket_id = $1 AND status = 'attached'`,
        [ticket.ticket_id]
      );
    }

    await ttsplAuditService.logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'qc_failed_return_vendor',
      description: `Floor manager QC fail: ${reason.trim()}`,
      metadata: { return_dc_number: return_dc_number || null },
      actorUserId: req.user.user_id,
      actorName: req.user.name
    });

    // Auto-raise a DRAFT vendor debit note linked to this return ticket (accounts
    // fills the amount & approves; it then adjusts the next vendor bill).
    let debitNote = null;
    try {
      debitNote = await vendorBilling.createReturnDebitNote(pool, {
        ticket, reason: reason.trim(), actorUserId: req.user.user_id,
      });
    } catch (dnErr) {
      console.error('[vendor-return] debit note auto-create failed for ticket', id, dnErr.message);
    }

    res.json({
      success: true,
      message: 'Ticket marked for vendor return. Initiate vendor return DC from vendor management.',
      instructions: 'Create a vendor return DC and link the serial to complete the return process.',
      debit_note: debitNote ? { debit_note_number: debitNote.debit_note_number, debit_note_id: debitNote.debit_note_id } : null,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Failed' });
  }
};

exports.updateTtsplConfig = async (req, res) => {
  const { id } = req.params;
  const { processor, ram, storage, gpu, screen_size, os, change_type, notes } = req.body;
  const fields = { processor, ram, storage, gpu, screen_size, os };
  if (!notes?.trim()) {
    return res.status(400).json({ success: false, message: 'Notes are required for config changes' });
  }
  const changeType = change_type || 'correction';

  try {
    const ticketRes = await pool.query('SELECT * FROM tickets WHERE ticket_id = $1', [id]);
    if (!ticketRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const ticket = ticketRes.rows[0];
    const ttsplId = ticket.ttspl_id;
    if (!ttsplId) {
      return res.status(400).json({ success: false, message: 'Ticket has no TTSPL ID' });
    }

    let extra = {};
    if (ticket.vendor_serial_id) {
      const vs = await pool.query(
        `SELECT extra FROM vendor_serial_numbers WHERE serial_id = $1`,
        [ticket.vendor_serial_id]
      );
      extra = vs.rows[0]?.extra || {};
      if (typeof extra === 'string') {
        try { extra = JSON.parse(extra); } catch { extra = {}; }
      }
    }

    const current = {
      processor: ticket.processor || extra.processor || '',
      ram: ticket.ram || extra.ram || '',
      storage: ticket.storage || extra.storage || '',
      gpu: extra.gpu || '',
      screen_size: extra.screen_size || '',
      os: extra.os || ''
    };

    const changes = [];
    for (const [field, newVal] of Object.entries(fields)) {
      if (newVal === undefined || newVal === null) continue;
      const oldVal = current[field] || '';
      if (String(newVal).trim() === String(oldVal).trim()) continue;
      await ttsplAuditService.logConfigChange({
        ttsplId,
        vendorSerialId: ticket.vendor_serial_id,
        ticketId: ticket.ticket_id,
        changedBy: req.user.user_id,
        changeType,
        fieldName: field,
        oldValue: oldVal,
        newValue: newVal,
        notes: notes.trim()
      });
      changes.push({ field, oldValue: oldVal, newValue: newVal });
      extra[field] = newVal;
      if (['processor', 'ram', 'storage'].includes(field)) {
        await pool.query(
          `UPDATE tickets SET ${field} = $1 WHERE ticket_id = $2`,
          [newVal, id]
        );
      }
    }

    if (ticket.vendor_serial_id && changes.length) {
      await pool.query(
        `UPDATE vendor_serial_numbers SET extra = $1::jsonb, updated_at = NOW() WHERE serial_id = $2`,
        [JSON.stringify(extra), ticket.vendor_serial_id]
      );
    }

    if (changes.length) {
      await ttsplAuditService.logTtsplEvent({
        ttsplId,
        vendorSerialId: ticket.vendor_serial_id,
        eventType: 'config_updated',
        description: `Config updated: ${changes.map((c) => `${c.field} ${c.oldValue} → ${c.newValue}`).join(', ')}`,
        metadata: { changes },
        actorUserId: req.user.user_id,
        actorName: req.user.name
      });
    }

    res.json({ success: true, message: 'Configuration updated', changes });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Config update failed' });
  }
};
