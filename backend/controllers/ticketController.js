const pool = require('../config/db');
const { pickNextAssigneeForTeamPool } = require('../services/qcRoundRobinService');
const {
  startWorkLog,
  syncWorkLogForTicketState,
  closeOpenWorkLogsForTickets
} = require('../services/ticketWorkLogService');
const { applyGrnVendorQcPassOnTicketComplete } = require('../services/grnTicketService');
const ttsplAuditService = require('../services/ttsplAuditService');

// Replace legacy "user/team/stage ID: N" tokens in activity notes with names.
// New activity logs already store names; this keeps historical entries readable.
async function resolveActivityNoteIds(rows = []) {
  const patterns = [
    { re: /user ID: (\d+)/gi, table: 'users', col: 'name', key: 'user_id' },
    { re: /team ID: (\d+)/gi, table: 'teams', col: 'team_name', key: 'team_id' },
    { re: /stage ID: (\d+)/gi, table: 'stages', col: 'stage_name', key: 'stage_id' }
  ];

  const idsByType = { users: new Set(), teams: new Set(), stages: new Set() };
  for (const row of rows) {
    if (!row?.notes) continue;
    for (const p of patterns) {
      for (const m of row.notes.matchAll(p.re)) idsByType[p.table].add(Number(m[1]));
    }
  }

  const nameMaps = { users: {}, teams: {}, stages: {} };
  await Promise.all(
    patterns.map(async (p) => {
      const ids = [...idsByType[p.table]];
      if (!ids.length) return;
      const result = await pool.query(
        `SELECT ${p.key} AS id, ${p.col} AS name FROM ${p.table} WHERE ${p.key} = ANY($1::int[])`,
        [ids]
      );
      result.rows.forEach((r) => { nameMaps[p.table][r.id] = r.name; });
    })
  );

  for (const row of rows) {
    if (!row?.notes) continue;
    let notes = row.notes;
    for (const p of patterns) {
      notes = notes.replace(p.re, (full, idStr) => {
        const name = nameMaps[p.table][Number(idStr)];
        if (!name) return full;
        return p.table === 'users' ? name : `${name}${p.table === 'teams' ? ' team' : ''}`;
      });
    }
    row.notes = notes;
  }
}

// Create Ticket
exports.createTicket = async (req, res) => {
  const {
    serial_number, ttspl_id, brand, model, initial_condition, priority, initial_cost,
    assigned_team_id, assigned_user_id, processor, ram, storage
  } = req.body;

  try {
    // Get first stage
    const stageResult = await pool.query(
      'SELECT stage_id, team_id, stage_name FROM stages ORDER BY stage_order ASC LIMIT 1'
    );

    if (stageResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No stages configured in system'
      });
    }

    const firstStage = stageResult.rows[0];

    // Determine assignments
    // Default to first stage defaults
    let finalTeamId = firstStage.team_id;
    let finalStageId = firstStage.stage_id;
    let finalUserId = req.user.user_id;

    // Override if Floor Manager/Admin and provided specific assignments
    if ((req.user.role === 'floor_manager' || req.user.role === 'admin') && assigned_team_id) {
      finalTeamId = assigned_team_id;
      // User ID is optional but can be assigned if provided
      finalUserId = assigned_user_id || null;

      // Find the stage corresponding to this team
      const stageForTeam = await pool.query(
        'SELECT stage_id FROM stages WHERE team_id = $1 ORDER BY stage_order ASC LIMIT 1',
        [assigned_team_id]
      );

      if (stageForTeam.rows.length > 0) {
        finalStageId = stageForTeam.rows[0].stage_id;
      }
    }


    // Fetch Machine Number and Specs if exists
    let machine_number = null;
    let inv_processor = processor;
    let inv_ram = ram;
    let inv_storage = storage;

    const invRes = await pool.query('SELECT machine_number, processor, ram, storage FROM inventory WHERE serial_number = $1', [serial_number]);
    if (invRes.rows.length > 0) {
      machine_number = invRes.rows[0].machine_number;
      inv_processor = inv_processor || invRes.rows[0].processor;
      inv_ram = inv_ram || invRes.rows[0].ram;
      inv_storage = inv_storage || invRes.rows[0].storage;
    }

    const openExisting = await pool.query(
      `SELECT ticket_id FROM tickets WHERE serial_number = $1 AND status IN ('in_progress', 'on_hold')`,
      [serial_number]
    );
    if (openExisting.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'An open ticket already exists for this serial. Complete or resolve it before creating another.'
      });
    }

    // Create ticket
    const result = await pool.query(
      `INSERT INTO tickets 
       (serial_number, ttspl_id, brand, model, initial_condition, priority, current_stage_id, assigned_team_id, assigned_user_id, initial_cost, machine_number, processor, ram, storage) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
       RETURNING *`,
      [serial_number, ttspl_id || null, brand, model, initial_condition, priority || 'normal',
        finalStageId, finalTeamId, finalUserId, initial_cost || 0, machine_number,
        inv_processor, inv_ram, inv_storage]
    );

    const ticket = result.rows[0];

    // Log activity
    let logMessage = `Ticket created with serial: ${serial_number}`;
    if (finalTeamId !== firstStage.team_id) {
      logMessage += ` (Custom Assignment: Team ${finalTeamId} / Stage ${finalStageId})`;
    }

    await pool.query(
      `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes) 
       VALUES ($1, $2, $3, $4, $5)`,
      [ticket.ticket_id, finalStageId, req.user.user_id, 'created', logMessage]
    );

    if (finalUserId) {
      await startWorkLog(pool, {
        ticketId: ticket.ticket_id,
        userId: finalUserId,
        stageId: finalStageId
      });
    }

    // Update Inventory Status to 'Floor' if item exists
    await pool.query(
      "UPDATE inventory SET status = 'Floor', stage = $2 WHERE serial_number = $1 OR machine_number = $1",
      [serial_number, firstStage.stage_name] // Use firstStage.stage_name as default. If custom assignment, we might need stageForTeam name.
    );

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      ticket
    });
  } catch (error) {
    if (error.code === '23505') { // Unique violation (serial on tickets or partial open-ticket index)
      return res.status(400).json({
        success: false,
        message: /uq_tickets_serial_open|open/i.test(error.message || '')
          ? 'An open ticket already exists for this serial.'
          : 'Serial number already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error creating ticket'
    });
  }
};

// Get Tickets (with filters)
exports.getTickets = async (req, res) => {
  const { status, stage_id, team_id, search, view, priority, ticket_type, stage_names } = req.query;

  try {
    let query = `
      SELECT t.*, 
             s.stage_name, s.stage_order,
             tm.team_name,
             tm.team_name AS assigned_team_name,
             u.name as assigned_user_name,
             COALESCE(
               NULLIF(TRIM(t.ttspl_id), ''),
               (regexp_match(t.machine_number, 'TTSPL[0-9]+', 'i'))[1],
               NULLIF(TRIM(t.machine_number), '')
             ) AS ttspl_display
      FROM tickets t
      LEFT JOIN stages s ON t.current_stage_id = s.stage_id
      LEFT JOIN teams tm ON t.assigned_team_id = tm.team_id
      LEFT JOIN users u ON t.assigned_user_id = u.user_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (status) {
      query += ` AND t.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (stage_id) {
      query += ` AND t.current_stage_id = $${paramCount}`;
      params.push(stage_id);
      paramCount++;
    }

    // Role-based visibility: Admin/Floor Manager/Manager see all.
    // QC users can also see unassigned tickets in their QC team bucket.
    const privilegedRoles = ['admin', 'floor_manager', 'manager'];
    const userTeamIds = (req.user.team_ids && req.user.team_ids.length > 0
      ? req.user.team_ids
      : (req.user.team_id != null ? [req.user.team_id] : []))
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0);

    if (req.user.role === 'qc' && !privilegedRoles.includes(req.user.role)) {
      query += ` AND s.stage_name IN ('QC1', 'QC2', 'Dispatch QC')`;
    }

    // Dispatch QC role: only ever sees the Dispatch QC stage.
    if (req.user.role === 'dispatch_qc' && !privilegedRoles.includes(req.user.role)) {
      query += ` AND s.stage_name = 'Dispatch QC'`;
    }

    if (!privilegedRoles.includes(req.user.role)) {
      if (view === 'completed') {
        query += ` AND (t.assigned_user_id = $${paramCount} OR EXISTS (
          SELECT 1 FROM activities a WHERE a.ticket_id = t.ticket_id AND a.user_id = $${paramCount}
          AND a.action IN ('stage_changed','stage_jumped')
        ))`;
        params.push(req.user.user_id);
        paramCount++;
      } else if (req.user.role === 'dispatch_qc') {
        // Dispatch QC sees ALL tickets currently in the Dispatch QC stage
        // (stage already restricted above) — no per-user assignment filter.
      } else {
        if (req.user.role === 'qc' && userTeamIds.length > 0) {
          // QC queue: include tickets assigned to me OR currently unassigned in my QC team bucket.
          query += ` AND (
            t.assigned_user_id = $${paramCount}
            OR (t.assigned_user_id IS NULL AND t.assigned_team_id = ANY($${paramCount + 1}::int[]))
          )`;
          params.push(req.user.user_id, userTeamIds);
          paramCount += 2;
        } else {
          // Other non-privileged users: only tickets assigned to them.
          query += ` AND t.assigned_user_id IS NOT NULL AND t.assigned_user_id = $${paramCount}`;
          params.push(req.user.user_id);
          paramCount++;
        }
      }
    } else {
      // Admins/Floor Managers: can filter by team_id if provided
      if (team_id) {
        query += ` AND t.assigned_team_id = $${paramCount}`;
        params.push(team_id);
        paramCount++;
      }
    }

    if (priority) {
      query += ` AND t.priority = $${paramCount}`;
      params.push(priority);
      paramCount++;
    }

    if (ticket_type) {
      query += ` AND t.ticket_type = $${paramCount}`;
      params.push(ticket_type);
      paramCount++;
    }

    if (stage_names) {
      const names = String(stage_names)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length) {
        query += ` AND s.stage_name = ANY($${paramCount}::text[])`;
        params.push(names);
        paramCount++;
      }
    }

    if (search) {
      query += ` AND (
        t.serial_number ILIKE $${paramCount}
        OR t.model ILIKE $${paramCount}
        OR COALESCE(t.ttspl_id, '') ILIKE $${paramCount}
        OR COALESCE(t.machine_number, '') ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // View filter: completed tab shows status=completed OR tickets user moved; in_progress shows status!=completed
    if (view === 'completed') {
      if (!privilegedRoles.includes(req.user.role)) {
        query += ` AND (t.status = 'completed' OR EXISTS (
          SELECT 1 FROM activities a WHERE a.ticket_id = t.ticket_id AND a.user_id = $${paramCount}
          AND a.action IN ('stage_changed','stage_jumped')
        ))`;
        params.push(req.user.user_id);
        paramCount++;
      } else {
        query += ` AND t.status = 'completed'`;
      }
    } else if (view === 'in_progress') {
      query += ` AND t.status NOT IN ('completed', 'cancelled')`;
    } else if (!status) {
      // Default list never shows cancelled tickets (e.g. serial removed from SO),
      // unless the caller explicitly filters by status.
      query += ` AND t.status <> 'cancelled'`;
    }

    query += ' ORDER BY t.created_at DESC';

    const page = Math.max(1, parseInt(req.query.page, 10) || 0);
    const limitRaw = parseInt(req.query.limit, 10) || 0;
    const limit = limitRaw > 0 ? Math.min(100, Math.max(1, limitRaw)) : 0;
    const paginate = page > 0 && limit > 0;

    let total;
    let totalPages = 1;

    if (paginate) {
      const whereStart = query.indexOf('FROM tickets t');
      const orderStart = query.indexOf(' ORDER BY');
      const fromWhere = query.slice(whereStart, orderStart);
      const countResult = await pool.query(`SELECT COUNT(*)::int AS total ${fromWhere}`, params);
      total = countResult.rows[0]?.total || 0;
      totalPages = Math.max(1, Math.ceil(total / limit));
      query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(limit, (page - 1) * limit);
    }

    const result = await pool.query(query, params);

    const payload = {
      success: true,
      tickets: result.rows,
      count: result.rows.length,
    };

    if (paginate) {
      payload.pagination = { page, limit, total, totalPages };
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error fetching tickets'
    });
  }
};

// Floor pipeline sidebar counts (active tickets per queue)
exports.getFloorNavCounts = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE t.status IN ('in_progress','on_hold'))::int AS all_tickets,
        COUNT(*) FILTER (WHERE t.status IN ('in_progress','on_hold') AND s.stage_name IN ('QC1','QC2'))::int AS qc_queue,
        COUNT(*) FILTER (WHERE t.status IN ('in_progress','on_hold') AND s.stage_name = 'Chip Level Repair')::int AS chip_level,
        COUNT(*) FILTER (WHERE t.status IN ('in_progress','on_hold') AND s.stage_name = 'Body & Paint')::int AS body_paint
      FROM tickets t
      LEFT JOIN stages s ON s.stage_id = t.current_stage_id
    `);
    const r = rows[0] || {};
    res.json({
      success: true,
      counts: {
        all_tickets: r.all_tickets || 0,
        qc_queue: r.qc_queue || 0,
        chip_level: r.chip_level || 0,
        body_paint: r.body_paint || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching floor counts' });
  }
};

// Get all stages
exports.getAllStages = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stages ORDER BY stage_order ASC');
    res.json({ success: true, stages: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching stages' });
  }
};

// Get My Tickets (Admin/Floor Manager: all; Team members: only tickets assigned to them)
exports.getMyTickets = async (req, res) => {
  try {
    const privilegedRoles = ['admin', 'floor_manager', 'manager'];
    let query = `
      SELECT t.*, 
             s.stage_name, s.stage_order,
             tm.team_name,
             u.name as assigned_user_name
      FROM tickets t
      LEFT JOIN stages s ON t.current_stage_id = s.stage_id
      LEFT JOIN teams tm ON t.assigned_team_id = tm.team_id
      LEFT JOIN users u ON t.assigned_user_id = u.user_id
    `;

    const params = [];
    if (!privilegedRoles.includes(req.user.role)) {
      query += ` WHERE t.assigned_user_id IS NOT NULL AND t.assigned_user_id = $1`;
      params.push(req.user.user_id);
    }

    query += ` ORDER BY t.created_at DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      tickets: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error fetching your tickets'
    });
  }
};

// Get Ticket by ID
exports.getTicketById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT t.*,
              s.stage_name, s.stage_order,
              tm.team_name,
              u.name as assigned_user_name,
              COALESCE(vsn.extra->>'gpu', '') AS gpu,
              COALESCE(vsn.extra->>'screen_size', '') AS screen_size,
              COALESCE(vsn.extra->>'generation', '') AS generation,
              COALESCE(vsn.extra->>'os', '') AS os,
              COALESCE(vsn.extra->>'model', t.model) AS model_name,
              COALESCE(vsn.extra->>'condition', '') AS condition,
              COALESCE(
                NULLIF(TRIM(t.ttspl_id), ''),
                vsn.inventory_asset_code,
                (regexp_match(t.machine_number, 'TTSPL[0-9]+', 'i'))[1],
                NULLIF(TRIM(t.machine_number), '')
              ) AS ttspl_display,
              vsn.extra AS vsn_extra
       FROM tickets t
       LEFT JOIN stages s ON t.current_stage_id = s.stage_id
       LEFT JOIN teams tm ON t.assigned_team_id = tm.team_id
       LEFT JOIN users u ON t.assigned_user_id = u.user_id
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id
       WHERE t.ticket_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    const ticket = result.rows[0];

    // Team members can only view tickets assigned to them.
    // QC users can additionally open unassigned tickets in their QC team bucket.
    const privilegedRoles = ['admin', 'floor_manager', 'manager'];
    if (!privilegedRoles.includes(req.user.role)) {
      const assignedToMe = Number(ticket.assigned_user_id) === Number(req.user.user_id);
      const userTeamIds = (req.user.team_ids && req.user.team_ids.length > 0
        ? req.user.team_ids
        : (req.user.team_id != null ? [req.user.team_id] : []))
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0);
      const qcStage = ['QC1', 'QC2', 'Dispatch QC'].includes(ticket.stage_name);
      const inMyQcBucket = req.user.role === 'qc'
        && qcStage
        && ticket.assigned_user_id == null
        && userTeamIds.includes(Number(ticket.assigned_team_id));
      // Dispatch QC role can open any ticket currently in the Dispatch QC stage.
      const dispatchQcAccess = req.user.role === 'dispatch_qc'
        && ticket.stage_name === 'Dispatch QC';

      if (!assignedToMe && !inMyQcBucket && !dispatchQcAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: you can only view tickets assigned to you'
        });
      }
    }

    // Get activities
    const activities = await pool.query(
      `SELECT a.*, u.name as user_name, s.stage_name
       FROM activities a
       LEFT JOIN users u ON a.user_id = u.user_id
       LEFT JOIN stages s ON a.stage_id = s.stage_id
       WHERE a.ticket_id = $1
       ORDER BY a.created_at DESC`,
      [id]
    );

    // Older activity notes stored raw IDs ("Assigned to user ID: 15. Moved to
    // stage ID: 3."). Resolve them to names so the work log reads naturally.
    await resolveActivityNoteIds(activities.rows);

    // Get photos
    const photos = await pool.query(
      `SELECT p.*, u.name as uploaded_by_name, s.stage_name
       FROM photos p
       LEFT JOIN users u ON p.uploaded_by = u.user_id
       LEFT JOIN stages s ON p.stage_id = s.stage_id
       WHERE p.ticket_id = $1
       ORDER BY p.uploaded_at DESC`,
      [id]
    );

    // Get parts
    const parts = await pool.query(
      `SELECT tp.*, p.part_name, p.part_type, p.category,
              COALESCE(tp.unit_cost, p.cost, 0) AS unit_cost,
              (tp.quantity_used * COALESCE(tp.unit_cost, p.cost, 0)) AS total_part_cost
       FROM ticket_parts tp
       LEFT JOIN parts p ON tp.part_id = p.part_id
       WHERE tp.ticket_id = $1
       ORDER BY tp.added_at DESC`,
      [id]
    );

    // Get service costs
    const services = await pool.query(
      `SELECT ts.*, u.name as added_by_name
       FROM ticket_services ts
       LEFT JOIN users u ON ts.added_by = u.user_id
       WHERE ts.ticket_id = $1`,
      [id]
    );

    // Get part requests (Phase 16: include catalog + reserved instance details)
    const partRequests = await pool.query(
      `SELECT pr.*, u.name as requested_by_name,
              pi.prt_id, pi.location_code, pi.status AS instance_status,
              p.category, p.quantity AS stock_qty, p.cost AS catalog_cost
       FROM part_requests pr
       LEFT JOIN users u ON pr.requested_by = u.user_id
       LEFT JOIN part_instances pi ON pi.instance_id = pr.instance_id
       LEFT JOIN parts p ON p.part_id = pr.part_id
       WHERE pr.ticket_id = $1
       ORDER BY pr.created_at DESC`,
      [id]
    );

    // Calculate Totals
    const initialCost = parseFloat(ticket.initial_cost) || 0;
    const partsTotal = parts.rows.reduce((sum, part) => sum + (parseFloat(part.total_part_cost) || 0), 0);
    const servicesTotal = services.rows.reduce((sum, svc) => sum + (parseFloat(svc.cost) || 0), 0);
    const grandTotal = initialCost + partsTotal + servicesTotal;

    res.json({
      success: true,
      ticket: {
        ...ticket,
        initial_cost: initialCost,
        parts_total: partsTotal,
        services_total: servicesTotal,
        grand_total: grandTotal
      },
      activities: activities.rows,
      photos: photos.rows,
      parts: parts.rows,
      services: services.rows,
      part_requests: partRequests.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error fetching ticket'
    });
  }
};

// Update Ticket
exports.updateTicket = async (req, res) => {
  const { id } = req.params;
  const { brand, model, status, priority, notes } = req.body;

  try {
    const result = await pool.query(
      `UPDATE tickets 
       SET brand = COALESCE($1, brand),
           model = COALESCE($2, model),
           status = COALESCE($3, status),
           priority = COALESCE($4, priority)
       WHERE ticket_id = $5
       RETURNING *`,
      [brand, model, status, priority, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Log activity
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) 
       VALUES ($1, $2, $3, $4)`,
      [id, req.user.user_id, 'updated', notes || 'Ticket details updated']
    );

    res.json({
      success: true,
      message: 'Ticket updated successfully',
      ticket: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error updating ticket'
    });
  }
};

// Move Ticket to Next Stage or Jump to Specific Stage
exports.moveToNextStage = async (req, res) => {
  const { id } = req.params;
  const { notes, checklist_data, target_stage_id } = req.body;

  try {
    // Get current ticket
    const ticketResult = await pool.query(
      'SELECT * FROM tickets WHERE ticket_id = $1',
      [id]
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    const ticket = ticketResult.rows[0];
    let nextStage;

    const currentStageMeta = await pool.query(
      'SELECT stage_name, stage_category FROM stages WHERE stage_id = $1',
      [ticket.current_stage_id]
    );
    const currentStageName = currentStageMeta.rows[0]?.stage_name;
    const currentStageCategory = currentStageMeta.rows[0]?.stage_category;

    // Check for Manual Override (Jump)
    const canJump = req.user.role === 'floor_manager' || req.user.role === 'admin';

    if (target_stage_id && canJump) {
      // Fetch target stage
      const targetStageRes = await pool.query('SELECT * FROM stages WHERE stage_id = $1', [target_stage_id]);
      if (targetStageRes.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Target stage not found' });
      }
      nextStage = targetStageRes.rows[0];
    } else {
      // Default: Get next sequential stage
      const nextStageResult = await pool.query(
        `SELECT * FROM stages 
           WHERE stage_order > (SELECT stage_order FROM stages WHERE stage_id = $1)
           ORDER BY stage_order ASC LIMIT 1`,
        [ticket.current_stage_id]
      );

      if (nextStageResult.rows.length > 0) {
        nextStage = nextStageResult.rows[0];
      }
    }

    // If no next stage found (and not jumping), assume completion
    if (!nextStage) {
      // ... existing completion logic for fallback ...
    }

    // Save checklist data... (keep existing)
    if (checklist_data) {
      await pool.query(
        `INSERT INTO ticket_checklist_progress (ticket_id, stage_id, checklist_data, completed_by)
         VALUES ($1, $2, $3, $4)`,
        [id, ticket.current_stage_id, JSON.stringify(checklist_data), req.user.user_id]
      );
    }

    // LOGIC for Inventory Stage (completion)
    let isCompleted = false;
    let successMessage = `Ticket moved to ${nextStage.stage_name}`;

    if (nextStage.stage_name === 'Inventory') {
      isCompleted = true;
      successMessage = 'Ticket moved to Inventory and marked as Ready Stock';

      // Update Inventory if serial matches
      await pool.query(
        `UPDATE inventory 
             SET status = 'In Stock', stock_type = 'Ready' 
             WHERE serial_number = $1`,
        [ticket.serial_number]
      );

      if (ticket.vendor_serial_id) {
        try {
          const qcPass = await applyGrnVendorQcPassOnTicketComplete(pool, ticket, req.user.user_id);
          if (qcPass.applied) {
            successMessage = 'Ticket completed — laptop marked QC Passed';
          }
        } catch (grnQcErr) {
          console.error('GRN vendor QC pass on ticket complete failed:', grnQcErr);
        }
      }
    }

    // Final Testing -> QC1: always round-robin among QC1 team members (not the Final Testing assignee).
    // QC1 -> QC2 is handled in qcController.submitQC with its own round-robin.
    let assignedUserIdValue = null;
    const enteringQC1FromFinalTesting =
      nextStage.stage_name === 'QC1' && currentStageName === 'Final Testing';

    if (enteringQC1FromFinalTesting && nextStage.team_id) {
      try {
        assignedUserIdValue = await pickNextAssigneeForTeamPool(pool, nextStage.team_id);
      } catch (rrErr) {
        console.error('QC1 round-robin assignment failed:', rrErr);
        assignedUserIdValue = null;
      }
    } else {
      let keepAssignee = false;
      if (ticket.assigned_user_id && nextStage.stage_category && currentStageCategory) {
        if (currentStageCategory === nextStage.stage_category) {
          keepAssignee = true;
        }
      }
      assignedUserIdValue = keepAssignee ? ticket.assigned_user_id : null;
    }

    // Update ticket to next stage
    // If completed, we also set status='completed' and completed_at
    let updateQuery = `UPDATE tickets 
       SET current_stage_id = $1, assigned_team_id = $2, assigned_user_id = $4`;

    const updateParams = [nextStage.stage_id, nextStage.team_id, id, assignedUserIdValue];

    if (isCompleted) {
      updateQuery += `, status = 'completed', completed_at = CURRENT_TIMESTAMP`;
    } else {
      // Ensure status is in_progress if we are jumping BACK or moving to active stage
      updateQuery += `, status = 'in_progress', completed_at = NULL`;

      // Also SYNC Inventory: If completed ticket is moved back, reset inventory status
      if (ticket.status === 'completed') {
        // We can't await here easily inside the query builder unless we do it separately.
        // But we have ticket.serial_number.
        await pool.query(
          `UPDATE inventory SET status = 'Floor', stock_type = 'Cooling Period' WHERE serial_number = $1`,
          [ticket.serial_number]
        );
      }
    }

    // SYNC Inventory Stage
    if (nextStage && nextStage.stage_name) {
      await pool.query(
        `UPDATE inventory SET stage = $1 WHERE serial_number = $2`,
        [nextStage.stage_name, ticket.serial_number]
      );
    }

    updateQuery += ` WHERE ticket_id = $3 RETURNING *`;

    const updateResult = await pool.query(updateQuery, updateParams);

    await syncWorkLogForTicketState(pool, updateResult.rows[0]);

    // Log activity
    const action = target_stage_id ? 'stage_jumped' : 'stage_changed';

    let activityNotes = notes || (isCompleted ? `Moved to Warehouse (Completed)` : `Moved to ${nextStage.stage_name}`);

    if (checklist_data) {
      try {
        const dataInfo = typeof checklist_data === 'string' ? JSON.parse(checklist_data) : checklist_data;
        const items = [];
        // Handle various checklist formats (Diagnosis object or Software booleans)
        for (const [key, value] of Object.entries(dataInfo)) {
          // Skip if value is false/null, or if it's 'notes' field inside data
          if (value === true) {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            items.push(label);
          } else if (typeof value === 'object' && value?.status === 'replaced') {
            // Handle diagnosis parts if structure is different? 
            // Usually diagnosis just saves to separate table, but if passed here...
            // For Software Checklist it is simple boolean.
          }
        }
        if (items.length > 0) {
          activityNotes += ` | Checklist: ${items.join(', ')}`;
        }
      } catch (e) {
        console.error('Error parsing checklist data for log', e);
      }
    }

    await pool.query(
      `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes) 
       VALUES ($1, $2, $3, $4, $5)`,
      [id, nextStage.stage_id, req.user.user_id, action, activityNotes]
    );

    res.json({
      success: true,
      message: successMessage,
      ticket: updateResult.rows[0],
      completed: isCompleted
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error moving ticket to next stage'
    });
  }
};

// Assign Ticket to User or Team
exports.assignTicket = async (req, res) => {
  const { id } = req.params;
  const { user_id, team_id, target_stage_id } = req.body;

  try {
    let updateQuery = 'UPDATE tickets SET ';
    const params = [];
    let paramCount = 1;
    let logMessage = '';

    if (user_id) {
      updateQuery += `assigned_user_id = $${paramCount}, `;
      params.push(user_id);
      paramCount++;
      const userRes = await pool.query('SELECT name FROM users WHERE user_id = $1', [user_id]);
      const userName = userRes.rows[0]?.name || `user #${user_id}`;
      logMessage += `Assigned to ${userName}. `;
    } else if (user_id === null) {
      updateQuery += `assigned_user_id = NULL, `;
      logMessage += `Unassigned user. `;
    }

    if (team_id) {
      updateQuery += `assigned_team_id = $${paramCount}, `;
      params.push(team_id);
      paramCount++;
      const teamRes = await pool.query('SELECT team_name FROM teams WHERE team_id = $1', [team_id]);
      const teamName = teamRes.rows[0]?.team_name || `team #${team_id}`;
      logMessage += `Assigned to ${teamName} team. `;
    }

    // Remove trailing comma and space
    updateQuery = updateQuery.slice(0, -2);

    // Stage logic: target_stage_id (priority assign) > user's first stage > team's first stage
    let targetStageId = null;
    let targetTeamId = null;

    if (target_stage_id) {
      // Floor manager priority assign: user + stage specified
      const stageRes = await pool.query('SELECT stage_id, team_id, stage_name FROM stages WHERE stage_id = $1', [target_stage_id]);
      if (stageRes.rows.length > 0) {
        targetStageId = stageRes.rows[0].stage_id;
        targetTeamId = stageRes.rows[0].team_id;
        logMessage += `Moved to ${stageRes.rows[0].stage_name || `stage #${targetStageId}`}. `;
      }
    } else if (user_id) {
      // Get all teams for this user (primary team_id + user_teams)
      const userTeamsRes = await pool.query(
        `SELECT team_id FROM users WHERE user_id = $1 AND team_id IS NOT NULL
         UNION
         SELECT team_id FROM user_teams WHERE user_id = $1`,
        [user_id]
      );
      const userTeamIds = userTeamsRes.rows.map((r) => r.team_id).filter(Boolean);

      if (userTeamIds.length > 0) {
        const stageRes = await pool.query(
          `SELECT s.stage_id, s.team_id, s.stage_name FROM stages s
           WHERE s.team_id = ANY($1::int[])
           ORDER BY s.stage_order ASC LIMIT 1`,
          [userTeamIds]
        );
        if (stageRes.rows.length > 0) {
          targetStageId = stageRes.rows[0].stage_id;
          targetTeamId = stageRes.rows[0].team_id;
          logMessage += `Moved to ${stageRes.rows[0].stage_name || `stage #${targetStageId}`}. `;
        }
      }
    } else if (team_id) {
      // When assigning to team only, move to that team's first stage
      const stageRes = await pool.query(
        'SELECT stage_id, team_id, stage_name FROM stages WHERE team_id = $1 ORDER BY stage_order ASC LIMIT 1',
        [team_id]
      );
      if (stageRes.rows.length > 0) {
        targetStageId = stageRes.rows[0].stage_id;
        targetTeamId = stageRes.rows[0].team_id;
        logMessage += `Moved to ${stageRes.rows[0].stage_name || `stage #${targetStageId}`}. `;
      }
    }

    if (targetStageId != null) {
      updateQuery += `, current_stage_id = ${targetStageId}`;
      if (targetTeamId != null) updateQuery += `, assigned_team_id = ${targetTeamId}`;
    }
    updateQuery += `, status = 'in_progress', completed_at = NULL WHERE ticket_id = $${paramCount} RETURNING *`;
    params.push(id);

    const result = await pool.query(updateQuery, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Log activity
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) 
       VALUES ($1, $2, $3, $4)`,
      [id, req.user.user_id, 'assigned', logMessage.trim()]
    );

    const updatedTicket = result.rows[0];

    await syncWorkLogForTicketState(pool, updatedTicket);

    // Inventory Sync Logic: If ticket was completed (or we are resetting to in_progress), ensure Inventory is "Floor"
    if (updatedTicket.status === 'in_progress') {
      await pool.query(
        `UPDATE inventory SET status = 'Floor', stock_type = 'Cooling Period' WHERE serial_number = $1`,
        [updatedTicket.serial_number]
      );
    }

    // Sync Inventory Stage Name
    if (updatedTicket.current_stage_id) {
      // We need stage name. 
      const stageNameRes = await pool.query('SELECT stage_name FROM stages WHERE stage_id = $1', [updatedTicket.current_stage_id]);
      if (stageNameRes.rows.length > 0) {
        await pool.query(
          `UPDATE inventory SET stage = $1 WHERE serial_number = $2`,
          [stageNameRes.rows[0].stage_name, updatedTicket.serial_number]
        );
      }
    }

    res.json({
      success: true,
      message: 'Ticket assigned successfully',
      ticket: updatedTicket
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error assigning ticket'
    });
  }
};

// Claim Ticket (Self-Assign for Team Members)
exports.claimTicket = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.user_id;
  const userTeamIds = req.user.team_ids && req.user.team_ids.length > 0
    ? req.user.team_ids
    : (req.user.team_id != null ? [req.user.team_id] : []);

  try {
    const ticketCheck = await pool.query(
      `SELECT * FROM tickets WHERE ticket_id = $1`,
      [id]
    );

    if (ticketCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const ticket = ticketCheck.rows[0];

    const ticketTeamId = parseInt(ticket.assigned_team_id, 10);
    const canClaim = req.user.role === 'admin' || req.user.role === 'floor_manager'
      || (userTeamIds.length > 0 && userTeamIds.includes(ticketTeamId));

    if (!canClaim) {
      return res.status(403).json({ success: false, message: 'Ticket is not assigned to your team' });
    }

    if (ticket.assigned_user_id) {
      return res.status(400).json({ success: false, message: 'Ticket is already assigned to a user' });
    }

    // Proceed to claim
    const result = await pool.query(
      `UPDATE tickets 
       SET assigned_user_id = $1
       WHERE ticket_id = $2
       RETURNING *`,
      [userId, id]
    );

    // Get updated details including team name for frontend consistency
    const updatedTicket = await pool.query(
      `SELECT t.*, s.stage_name, tm.team_name, u.name as assigned_user_name
         FROM tickets t
         LEFT JOIN stages s ON t.current_stage_id = s.stage_id
         LEFT JOIN teams tm ON t.assigned_team_id = tm.team_id
         LEFT JOIN users u ON t.assigned_user_id = u.user_id
         WHERE t.ticket_id = $1`,
      [id]
    );

    // Log activity
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) 
       VALUES ($1, $2, $3, $4)`,
      [id, userId, 'claimed', 'Ticket claimed by user']
    );

    await syncWorkLogForTicketState(pool, updatedTicket.rows[0]);

    res.json({
      success: true,
      message: 'Ticket claimed successfully',
      ticket: updatedTicket.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error claiming ticket'
    });
  }
};

// Update Ticket Grade (for Grading Team)
exports.updateGrade = async (req, res) => {
  const { id } = req.params;
  const { grade } = req.body;

  if (!['A', 'A+', 'A-', 'B+', 'B-', 'C', 'D'].includes(grade)) {
    return res.status(400).json({ success: false, message: 'Invalid grade value' });
  }

  try {
    const ticketResult = await pool.query('SELECT * FROM tickets WHERE ticket_id = $1', [id]);
    if (ticketResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Ticket not found' });

    const ticket = ticketResult.rows[0];

    const userTeamIds = req.user.team_ids || (req.user.team_id != null ? [req.user.team_id] : []);
    const isGradingTeam = userTeamIds.includes(9);
    if (!isGradingTeam && req.user.role !== 'admin' && req.user.role !== 'floor_manager') {
      return res.status(403).json({ success: false, message: 'Only Grading Team can update grades' });
    }

    // Update Ticket Grade
    await pool.query('UPDATE tickets SET final_grade = $1 WHERE ticket_id = $2', [grade, id]);

    // Update Inventory Grade
    await pool.query('UPDATE inventory SET grade = $1 WHERE serial_number = $2', [grade, ticket.serial_number]);

    // Log Activity
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) 
             VALUES ($1, $2, $3, $4)`,
      [id, req.user.user_id, 'graded', `Grade updated to ${grade}`]
    );

    res.json({ success: true, message: `Grade updated to ${grade}`, grade });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error updating grade' });
  }
};

// Add Note/Comment
exports.addNote = async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  try {
    const ticketResult = await pool.query(
      'SELECT current_stage_id FROM tickets WHERE ticket_id = $1',
      [id]
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    await pool.query(
      `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes) 
       VALUES ($1, $2, $3, $4, $5)`,
      [id, ticketResult.rows[0].current_stage_id, req.user.user_id, 'note_added', notes]
    );

    res.json({
      success: true,
      message: 'Note added successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error adding note'
    });
  }
};

// Add Part to Ticket
exports.addPartToTicket = async (req, res) => {
  const { id } = req.params;
  const { part_id, quantity_used, notes } = req.body;

  try {
    const ticketRes = await pool.query('SELECT * FROM tickets WHERE ticket_id = $1', [id]);
    if (!ticketRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const ticket = ticketRes.rows[0];

    const partRes = await pool.query(
      `SELECT part_id, part_name, part_type, cost FROM parts WHERE part_id = $1`,
      [part_id]
    );
    if (!partRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Part not found' });
    }
    const part = partRes.rows[0];
    const qty = Number(quantity_used) || 1;
    const unitCost = parseFloat(part.cost) || 0;
    const totalCost = unitCost * qty;

    await pool.query(
      `INSERT INTO ticket_parts (ticket_id, part_id, quantity_used, notes)
       VALUES ($1, $2, $3, $4)`,
      [id, part_id, qty, notes]
    );

    await pool.query(
      `UPDATE parts SET quantity = quantity - $1 WHERE part_id = $2`,
      [qty, part_id]
    );

    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) 
       VALUES ($1, $2, $3, $4)`,
      [id, req.user.user_id, 'part_added', `Added ${qty} × ${part.part_name}`]
    );

    if (ticket.ttspl_id) {
      await ttsplAuditService.logTtsplEvent({
        ttsplId: ticket.ttspl_id,
        vendorSerialId: ticket.vendor_serial_id,
        eventType: 'parts_used',
        description: `Part used: ${part.part_name} × ${qty} (₹${totalCost.toFixed(2)})`,
        metadata: {
          part_id,
          part_name: part.part_name,
          quantity: qty,
          unit_cost: unitCost,
          total_cost: totalCost
        },
        actorUserId: req.user.user_id
      });

      const upgradeTypes = ['RAM', 'Storage', 'Memory', 'SSD', 'HDD'];
      const partType = String(part.part_type || '').trim();
      if (upgradeTypes.some((t) => partType.toLowerCase().includes(t.toLowerCase()))) {
        const fieldMap = { RAM: 'ram', Memory: 'ram', Storage: 'storage', SSD: 'storage', HDD: 'storage' };
        const fieldName =
          Object.entries(fieldMap).find(([k]) => partType.toLowerCase().includes(k.toLowerCase()))?.[1] ||
          'storage';
        await ttsplAuditService.logConfigChange({
          ttsplId: ticket.ttspl_id,
          vendorSerialId: ticket.vendor_serial_id,
          ticketId: ticket.ticket_id,
          changedBy: req.user.user_id,
          changeType: 'upgrade',
          fieldName,
          oldValue: ticket[fieldName] || '',
          newValue: part.part_name,
          notes: notes || `Part upgrade via ticket #${id}`,
          partUsedId: part_id,
          partCost: totalCost
        });
      }
    }

    res.json({
      success: true,
      message: 'Part added to ticket successfully'
    });
  } catch (error) {
    console.error('Add part error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error adding part to ticket'
    });
  }
};

// Request Part (Diagnosis Team)
exports.requestPart = async (req, res) => {
  const { id } = req.params;
  const { part_name, description } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO part_requests (ticket_id, requested_by, part_name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, req.user.user_id, part_name, description]
    );

    // Log activity
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes)
       VALUES ($1, $2, 'part_requested', $3)`,
      [id, req.user.user_id, `Requested part: ${part_name}`]
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Request part error:', error);
    res.status(500).json({ success: false, message: 'Server error requesting part' });
  }
};

// Fulfill Part Request (Procurement Team)
exports.fulfillPartRequest = async (req, res) => {
  const { id } = req.params;
  const { request_id, part_id, quantity, notes } = req.body;

  try {
    const ticketStageRes = await pool.query(
      `SELECT s.stage_name
       FROM tickets t
       LEFT JOIN stages s ON t.current_stage_id = s.stage_id
       WHERE t.ticket_id = $1`,
      [id]
    );
    const stageName = ticketStageRes.rows[0]?.stage_name || '';

    // 1. Update request status
    if (request_id) {
      await pool.query(
        "UPDATE part_requests SET status = 'procured' WHERE request_id = $1",
        [request_id]
      );
    }

    // 2. Link part to ticket (skip for Chip Level Repair; L3 team will attach)
    if (stageName !== 'Chip Level Repair') {
      await pool.query(
        `INSERT INTO ticket_parts (ticket_id, part_id, quantity_used, notes)
         VALUES ($1, $2, $3, $4)`,
        [id, part_id, quantity || 1, notes]
      );

      const partRes = await pool.query("SELECT part_name FROM parts WHERE part_id = $1", [part_id]);
      const partName = partRes.rows[0]?.part_name || 'Unknown Part';

      await pool.query(
        `INSERT INTO activities (ticket_id, user_id, action, notes)
         VALUES ($1, $2, 'part_added', $3)`,
        [id, req.user.user_id, `Added part: ${partName}`]
      );
    } else {
      await pool.query(
        `INSERT INTO activities (ticket_id, user_id, action, notes)
         VALUES ($1, $2, 'part_procured', $3)`,
        [id, req.user.user_id, 'Procurement marked part as procured for chip-level repair']
      );
    }

    res.json({
      success: true,
      data: null
    });
  } catch (error) {
    console.error('Fulfill part error:', error);
    res.status(500).json({ success: false, message: 'Server error fulfilling part' });
  }
};

// Add Service Cost (Vendor/Service Teams)
exports.addServiceCost = async (req, res) => {
  const { id } = req.params;
  const { service_type, cost } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO ticket_services (ticket_id, service_type, cost, added_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, service_type, cost, req.user.user_id]
    );

    // Log activity
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes)
       VALUES ($1, $2, 'service_cost_added', $3)`,
      [id, req.user.user_id, `Added service cost: ${service_type} ($${cost})`]
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Add service cost error:', error);
    res.status(500).json({ success: false, message: 'Server error adding service cost' });
  }
};

// Update Grade (Grading Team)
exports.updateGrade = async (req, res) => {
  const { id } = req.params;
  const { grade } = req.body;

  try {
    // Update Ticket
    const result = await pool.query(
      `UPDATE tickets SET final_grade = $1 WHERE ticket_id = $2 RETURNING *`,
      [grade, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ message: 'Ticket not found' });

    const ticket = result.rows[0];

    // Update Inventory
    // Assuming we match by serial_number
    await pool.query(
      `UPDATE inventory SET grade = $1 WHERE serial_number = $2`,
      [grade, ticket.serial_number]
    );

    // Log Activity
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes)
       VALUES ($1, $2, 'grade_updated', $3)`,
      [id, req.user.user_id, `Updated grade to: ${grade}`]
    );

    res.json({
      success: true,
      message: 'Grade updated',
      ticket: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error updating grade' });
  }
};

// Start Work Timer
exports.startWork = async (req, res) => {
  const { id } = req.params;
  const { verify } = req.body; // TTSPL id or serial number the tech scans/types to confirm the machine
  const userId = req.user.user_id;

  try {
    const ticketRes = await pool.query(
      'SELECT current_stage_id, ttspl_id, serial_number FROM tickets WHERE ticket_id = $1',
      [id]
    );
    if (ticketRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const ticket = ticketRes.rows[0];
    const stageId = ticket.current_stage_id;

    // Machine-identity gate: the tech must confirm the right laptop before the timer starts.
    const entered = String(verify || '').trim().toLowerCase();
    if (!entered) {
      return res.status(400).json({ success: false, message: 'Enter the TTSPL ID or Serial number to start work' });
    }
    const valid = [ticket.ttspl_id, ticket.serial_number]
      .filter(Boolean)
      .map((x) => String(x).trim().toLowerCase());
    if (!valid.includes(entered)) {
      return res.status(400).json({ success: false, message: 'TTSPL ID / Serial number does not match this ticket' });
    }

    // Restart the stage timer from this moment: close any open segment, open a fresh one.
    await pool.query(
      `UPDATE work_logs SET end_time = CURRENT_TIMESTAMP WHERE ticket_id = $1 AND end_time IS NULL`,
      [id]
    );
    await pool.query(
      `INSERT INTO work_logs (ticket_id, user_id, stage_id) VALUES ($1, $2, $3)`,
      [id, userId, stageId]
    );
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'work_started', 'Verified machine & started work timer')`,
      [id, userId]
    );

    res.json({ success: true, message: 'Work started — timer running' });
  } catch (error) {
    console.error('Start work error:', error);
    res.status(500).json({ success: false, message: 'Server error starting work' });
  }
};

// ── Stage task checklist (Assembly & Software, Final Testing, etc.) ──────────
exports.saveStageTask = async (req, res) => {
  const { id } = req.params;
  const { stage_id, checklist_data, notes, completed } = req.body;
  const userId = req.user.user_id;
  if (!stage_id) return res.status(400).json({ success: false, message: 'stage_id is required' });
  try {
    const existing = await pool.query(
      'SELECT id FROM ticket_checklist_progress WHERE ticket_id = $1 AND stage_id = $2 ORDER BY id DESC LIMIT 1',
      [id, stage_id]
    );
    const payload = JSON.stringify(checklist_data || {});
    if (existing.rows.length) {
      await pool.query(
        `UPDATE ticket_checklist_progress
         SET checklist_data = $1::jsonb, completed_by = $2,
             completed_at = CASE WHEN $3 THEN NOW() ELSE completed_at END
         WHERE id = $4`,
        [payload, userId, !!completed, existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO ticket_checklist_progress (ticket_id, stage_id, checklist_data, completed_by, completed_at)
         VALUES ($1, $2, $3::jsonb, $4, CASE WHEN $5 THEN NOW() ELSE NULL END)`,
        [id, stage_id, payload, userId, !!completed]
      );
    }
    if (notes && String(notes).trim()) {
      await pool.query(
        `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes) VALUES ($1, $2, $3, 'stage_work', $4)`,
        [id, stage_id, userId, String(notes).trim()]
      );
    }
    res.json({ success: true, message: completed ? 'Task completed' : 'Task progress saved' });
  } catch (error) {
    console.error('saveStageTask error:', error);
    res.status(500).json({ success: false, message: 'Server error saving task' });
  }
};

exports.getStageTask = async (req, res) => {
  const { id } = req.params;
  const { stage_id } = req.query;
  if (!stage_id) return res.status(400).json({ success: false, message: 'stage_id is required' });
  try {
    const r = await pool.query(
      'SELECT * FROM ticket_checklist_progress WHERE ticket_id = $1 AND stage_id = $2 ORDER BY id DESC LIMIT 1',
      [id, stage_id]
    );
    res.json({ success: true, progress: r.rows[0] || null });
  } catch (error) {
    console.error('getStageTask error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching task' });
  }
};

// End Work Timer
exports.endWork = async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  const userId = req.user.user_id;

  if (!notes) return res.status(400).json({ success: false, message: 'Notes are mandatory to end work' });

  try {
    // Find active log
    const activeRes = await pool.query(
      'SELECT log_id FROM work_logs WHERE ticket_id = $1 AND user_id = $2 AND end_time IS NULL',
      [id, userId]
    );

    if (activeRes.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No active work timer found' });
    }

    const logId = activeRes.rows[0].log_id;

    // Update Log
    await pool.query(
      `UPDATE work_logs SET end_time = CURRENT_TIMESTAMP, notes = $1 WHERE log_id = $2`,
      [notes, logId]
    );

    // Log Activity
    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'work_ended', $3)`,
      [id, userId, `Ended work: ${notes}`]
    );

    // Auto-Move to Next Stage logic is handled by Frontend calling next-stage?
    // User said: "He has to scan the laptop again and then Timer will stop and Ticket moved to next Step."
    // Ideally, we move it here or return success so frontend calls move.
    // Let's return success and let frontend chain the call to be safe (or we can call moveToNextStage logic internally).
    // Calling internal logic is complex due to req/res structure.

    // We will return a flag 'ready_for_next_stage: true'

    res.json({ success: true, message: 'Work timer stopped', ready_for_next_stage: true });
  } catch (error) {
    console.error('End work error:', error);
    res.status(500).json({ success: false, message: 'Server error ending work' });
  }
};

// Get Active Work Log
// Hardware & Software stages. The work timer should run as ONE continuous,
// ongoing timer across all of these for the same technician — it must not reset
// when the unit moves between Diagnosis → Assembly & Software → Final Testing →
// Chip Level Repair → Body & Paint.
const HW_SW_STAGE_NAMES = [
  'Diagnosis',
  'Assembly & Software',
  'Final Testing',
  'Chip Level Repair',
  'Body & Paint'
];

exports.getActiveWorkLog = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.user_id;

  try {
    const result = await pool.query(
      `SELECT w.*, (EXTRACT(EPOCH FROM w.start_time) * 1000) AS start_time_epoch, s.stage_name
       FROM work_logs w
       LEFT JOIN stages s ON s.stage_id = w.stage_id
       WHERE w.ticket_id = $1 AND w.user_id = $2 AND w.end_time IS NULL`,
      [id, userId]
    );

    if (result.rows.length > 0) {
      const log = result.rows[0];
      log.session_start_epoch = Number(log.start_time_epoch);
      log.session_elapsed_ms = null;

      // When the open segment is a Hardware & Software stage, accumulate the
      // technician's total time across every HW/SW segment on this ticket (closed
      // + the currently-open one) so the on-screen timer keeps counting across
      // stage moves instead of restarting each stage. QC / other stages keep
      // their own per-stage timer.
      if (HW_SW_STAGE_NAMES.includes(log.stage_name)) {
        const totalRes = await pool.query(
          `SELECT COALESCE(
             SUM(EXTRACT(EPOCH FROM (COALESCE(w.end_time, CURRENT_TIMESTAMP) - w.start_time)) * 1000),
             0
           ) AS session_elapsed_ms
           FROM work_logs w
           JOIN stages s ON s.stage_id = w.stage_id
           WHERE w.ticket_id = $1 AND w.user_id = $2 AND s.stage_name = ANY($3::text[])`,
          [id, userId, HW_SW_STAGE_NAMES]
        );
        const sessionElapsedMs = Number(totalRes.rows[0]?.session_elapsed_ms) || 0;
        log.session_elapsed_ms = sessionElapsedMs;
        // Reference start the client subtracts from its own clock to keep ticking.
        log.session_start_epoch = Date.now() - sessionElapsedMs;
      }

      res.json({ success: true, active: true, log });
    } else {
      res.json({ success: true, active: false });
    }
  } catch (error) {
    console.error('Get active log error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching active log' });
  }
};

// Bulk Move Tickets
exports.bulkMoveTickets = async (req, res) => {
  const { current_stage_id, target_stage_id } = req.body;
  const userId = req.user.user_id;

  if (!current_stage_id || !target_stage_id) {
    return res.status(400).json({ success: false, message: 'Current and Target Stage IDs are required' });
  }

  try {
    // 1. Get Target Stage Details (to get team_id)
    const targetStageRes = await pool.query('SELECT * FROM stages WHERE stage_id = $1', [target_stage_id]);
    if (targetStageRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Target stage not found' });
    }
    const targetStage = targetStageRes.rows[0];

    // 2. Get Tickets in Current Stage
    // Optional: Filter by specific team if needed, but "bulk move stage" usually implies all in that stage.
    // We should probably respect RBAC (only admin/manager/floor manager).
    // Assuming route protection handles RBAC.

    const ticketsRes = await pool.query('SELECT ticket_id, serial_number FROM tickets WHERE current_stage_id = $1', [current_stage_id]);
    const tickets = ticketsRes.rows;

    if (tickets.length === 0) {
      return res.status(400).json({ success: false, message: 'No tickets found in the selected stage' });
    }

    // 3. Perform Bulk Update
    // We update: stage, team (to target stage's team), unassign user, reset status to in_progress
    const updateRes = await pool.query(
      `UPDATE tickets 
       SET current_stage_id = $1, 
           assigned_team_id = $2, 
           assigned_user_id = NULL,
           status = 'in_progress',
           updated_at = CURRENT_TIMESTAMP
       WHERE current_stage_id = $3
       RETURNING ticket_id`,
      [targetStage.stage_id, targetStage.team_id, current_stage_id]
    );

    // 4. Log Activities & Sync Inventory (Iterate helps with granular logging, or we can do bulk insert if performance is key. 
    // For < 1000 items, iteration is fine and safer for logic).

    // We'll calculate success count based on updateRes
    const movedCount = updateRes.rowCount;
    const movedIds = updateRes.rows.map((r) => r.ticket_id);
    await closeOpenWorkLogsForTickets(pool, movedIds);

    // Async logging (fire and forget to speed up response?) 
    // OR just log a single "Bulk Move" activity if possible? 
    // The requirement says "He want to assign all ticket...". 
    // Detailed logs per ticket are better for audit.

    const activityQuery = `
      INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
      VALUES ($1, $2, $3, 'bulk_move', $4)
    `;

    const inventoryQuery = `
      UPDATE inventory SET stage = $1 WHERE serial_number = $2
    `;

    // Process logs and inventory sync in parallel promises
    const promises = tickets.map(t => {
      return Promise.all([
        pool.query(activityQuery, [t.ticket_id, targetStage.stage_id, userId, `Bulk moved to ${targetStage.stage_name}`]),
        pool.query(inventoryQuery, [targetStage.stage_name, t.serial_number])
      ]);
    });

    await Promise.all(promises);

    res.json({
      success: true,
      message: `Successfully moved ${movedCount} tickets to ${targetStage.stage_name}`,
      count: movedCount
    });

  } catch (error) {
    console.error('Bulk move error:', error);
    res.status(500).json({ success: false, message: 'Server error performing bulk move' });
  }
};

/** GET /api/tickets/floor-manager-queue */
exports.getFloorManagerQueue = async (req, res) => {
  if (!['admin', 'manager', 'floor_manager'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Floor manager access required' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT t.*, s.stage_name,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id', t.ttspl_id) AS ttspl_id,
              vsn.extra->>'brand' AS brand,
              vsn.extra->>'processor' AS processor,
              vsn.extra->>'ram' AS ram,
              vsn.extra->>'storage' AS storage,
              u.name AS assigned_user_name
       FROM tickets t
       JOIN stages s ON s.stage_id = t.current_stage_id
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id
       LEFT JOIN users u ON u.user_id = t.assigned_user_id
       WHERE s.stage_name = 'Floor Manager'
         AND t.status NOT IN ('completed', 'qc_failed_return_vendor', 'cancelled')
       ORDER BY
         CASE t.priority WHEN 'sales_order' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
         t.created_at ASC`
    );
    res.json({ success: true, tickets: rows });
  } catch (error) {
    console.error('getFloorManagerQueue:', error);
    res.status(500).json({ success: false, message: 'Failed to load floor manager queue' });
  }
};

/** GET /api/tickets/team-members?team_name=Hardware+%26+Software */
exports.getTeamMembers = async (req, res) => {
  const teamName = String(req.query.team_name || 'Hardware & Software').trim();
  const isQc = /qc/i.test(teamName);
  const roles = isQc ? ['qc'] : ['technician', 'floor_manager', 'team_member', 'team_lead'];
  try {
    const teamRes = await pool.query(
      `SELECT team_id FROM teams WHERE team_name = $1 LIMIT 1`,
      [teamName]
    );
    const teamId = teamRes.rows[0]?.team_id;

    let rows;
    if (teamId) {
      const r = await pool.query(
        `SELECT u.user_id, u.name, u.role,
                COUNT(t.ticket_id) FILTER (WHERE t.status = 'in_progress')::int AS active_tickets
         FROM users u
         LEFT JOIN tickets t ON t.assigned_user_id = u.user_id AND t.status = 'in_progress'
         WHERE COALESCE(u.active, true) = true
           AND u.role = ANY($1::text[])
           AND (
             u.team_id = $2
             OR EXISTS (SELECT 1 FROM user_teams ut WHERE ut.user_id = u.user_id AND ut.team_id = $2)
           )
         GROUP BY u.user_id, u.name, u.role
         ORDER BY active_tickets ASC, u.name ASC`,
        [roles, teamId]
      );
      rows = r.rows;
    }

    if (!rows?.length) {
      const fallback = await pool.query(
        `SELECT u.user_id, u.name, u.role,
                COUNT(t.ticket_id) FILTER (WHERE t.status = 'in_progress')::int AS active_tickets
         FROM users u
         LEFT JOIN tickets t ON t.assigned_user_id = u.user_id AND t.status = 'in_progress'
         WHERE COALESCE(u.active, true) = true AND u.role = ANY($1::text[])
         GROUP BY u.user_id, u.name, u.role
         ORDER BY active_tickets ASC, u.name ASC`,
        [roles]
      );
      rows = fallback.rows;
    }

    res.json({ success: true, team_name: teamName, members: rows });
  } catch (error) {
    console.error('getTeamMembers:', error);
    res.status(500).json({ success: false, message: 'Failed to load team members' });
  }
};

/** GET /api/tickets/:id/next-assignee?to_stage_name=QC2 */
exports.getNextAssignee = async (req, res) => {
  const { to_stage_name } = req.query;
  if (!to_stage_name) {
    return res.status(400).json({ success: false, message: 'to_stage_name required' });
  }

  const ROUND_ROBIN_TARGETS = new Set([
    'Final Testing→QC1',
    'QC1→QC2',
    'QC2→QC1',
  ]);

  try {
    const ticket = await pool.query(
      `SELECT t.*, s.stage_name AS current_stage_name
       FROM tickets t
       JOIN stages s ON s.stage_id = t.current_stage_id
       WHERE t.ticket_id = $1`,
      [req.params.id]
    );
    if (!ticket.rows.length) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const t = ticket.rows[0];
    const key = `${t.current_stage_name}→${to_stage_name}`;

    if (!ROUND_ROBIN_TARGETS.has(key)) {
      if (!t.assigned_user_id) {
        return res.json({ success: true, assignee: null, keep_same: true });
      }
      const u = await pool.query(
        'SELECT user_id, name, role FROM users WHERE user_id = $1',
        [t.assigned_user_id]
      );
      return res.json({ success: true, assignee: u.rows[0] || null, keep_same: true });
    }

    const stageRes = await pool.query('SELECT * FROM stages WHERE stage_name = $1', [to_stage_name]);
    if (!stageRes.rows.length) {
      return res.json({ success: true, assignee: null });
    }
    const teamId = stageRes.rows[0].team_id;
    if (!teamId) {
      return res.json({ success: true, assignee: null });
    }

    const members = await pool.query(
      `SELECT DISTINCT u.user_id, u.name, u.role,
         COUNT(tkt.ticket_id) FILTER (WHERE tkt.status = 'in_progress')::int AS active_tickets
       FROM users u
       LEFT JOIN user_teams ut ON ut.user_id = u.user_id AND ut.team_id = $1
       LEFT JOIN tickets tkt ON tkt.assigned_user_id = u.user_id AND tkt.status = 'in_progress'
       WHERE (u.team_id = $1 OR ut.team_id = $1) AND COALESCE(u.active, true) = true
       GROUP BY u.user_id, u.name, u.role
       ORDER BY active_tickets ASC, u.user_id ASC`,
      [teamId]
    );

    const rrState = await pool.query(
      'SELECT last_assigned_user_id FROM qc_round_robin_state WHERE team_id = $1',
      [teamId]
    );
    const ids = members.rows.map((r) => r.user_id);
    if (!ids.length) {
      return res.json({ success: true, assignee: null, team_has_no_members: true });
    }

    let nextIdx = 0;
    if (rrState.rows.length && rrState.rows[0].last_assigned_user_id) {
      const lastIdx = ids.indexOf(rrState.rows[0].last_assigned_user_id);
      nextIdx = (lastIdx + 1) % ids.length;
    }
    const next = members.rows.find((r) => r.user_id === ids[nextIdx]);
    return res.json({
      success: true,
      assignee: next || null,
      team_members: members.rows,
    });
  } catch (error) {
    console.error('getNextAssignee:', error);
    res.status(500).json({ success: false, message: 'Failed to preview assignee' });
  }
};

const CONFIG_FIELD_MAP = {
  RAM: 'ram',
  Storage: 'storage',
  Processor: 'processor',
  GPU: 'gpu',
  Screen: 'screen_size',
  OS: 'os',
  Other: 'other'
};

/** POST /api/tickets/:id/parts-with-config */
exports.addPartToTicketWithConfig = async (req, res) => {
  const { id } = req.params;
  const {
    part_id,
    quantity,
    notes,
    is_upgrade: isUpgradeRaw,
    config_field: configFieldRaw,
    old_value: oldValueRaw,
    new_value: newValueRaw
  } = req.body;

  const qty = Math.max(1, Number(quantity) || 1);
  const isUpgrade = Boolean(isUpgradeRaw);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticketRes = await client.query('SELECT * FROM tickets WHERE ticket_id = $1 FOR UPDATE', [id]);
    if (!ticketRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const ticket = ticketRes.rows[0];

    const partRes = await client.query(
      `SELECT part_id, part_name, part_type, category, quantity, cost FROM parts WHERE part_id = $1 FOR UPDATE`,
      [part_id]
    );
    if (!partRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Part not found' });
    }
    const part = partRes.rows[0];
    if (part.quantity < qty) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Insufficient stock (${part.quantity} available)` });
    }

    const unitCost = parseFloat(part.cost) || 0;
    const totalCost = unitCost * qty;

    const tpRes = await client.query(
      `INSERT INTO ticket_parts (ticket_id, part_id, quantity_used, notes, unit_cost, is_upgrade)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [id, part_id, qty, notes || null, unitCost, isUpgrade]
    );

    const newQtyRes = await client.query(
      `UPDATE parts SET quantity = quantity - $1 WHERE part_id = $2 RETURNING quantity`,
      [qty, part_id]
    );
    const newPartsQuantity = newQtyRes.rows[0]?.quantity ?? 0;

    await client.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'part_added', $3)`,
      [id, req.user.user_id, `Added ${qty} × ${part.part_name}${isUpgrade ? ' (upgrade)' : ''}`]
    );

    let configUpdated = false;
    if (ticket.ttspl_id) {
      await ttsplAuditService.logTtsplEvent({
        ttsplId: ticket.ttspl_id,
        vendorSerialId: ticket.vendor_serial_id,
        eventType: 'parts_used',
        description: `Part used: ${part.part_name} × ${qty} (₹${totalCost.toFixed(2)})`,
        metadata: { part_id, part_name: part.part_name, quantity: qty, unit_cost: unitCost, is_upgrade: isUpgrade },
        actorUserId: req.user.user_id,
        actorName: req.user.name,
        db: client
      });

      if (isUpgrade && configFieldRaw && newValueRaw) {
        const fieldName = CONFIG_FIELD_MAP[configFieldRaw] || String(configFieldRaw).toLowerCase();
        const oldValue = oldValueRaw || ticket[fieldName] || '';
        const newValue = String(newValueRaw).trim();

        await ttsplAuditService.logConfigChange({
          ttsplId: ticket.ttspl_id,
          vendorSerialId: ticket.vendor_serial_id,
          ticketId: ticket.ticket_id,
          changedBy: req.user.user_id,
          changeType: 'upgrade',
          fieldName,
          oldValue,
          newValue,
          notes: notes || `Upgrade via part: ${part.part_name}`,
          partUsedId: part_id,
          partCost: totalCost,
          db: client
        });

        if (ticket.vendor_serial_id) {
          const vs = await client.query(
            `SELECT extra FROM vendor_serial_numbers WHERE serial_id = $1`,
            [ticket.vendor_serial_id]
          );
          let extra = vs.rows[0]?.extra || {};
          if (typeof extra === 'string') {
            try { extra = JSON.parse(extra); } catch { extra = {}; }
          }
          if (fieldName !== 'other') extra[fieldName] = newValue;
          await client.query(
            `UPDATE vendor_serial_numbers SET extra = $1::jsonb, updated_at = NOW() WHERE serial_id = $2`,
            [JSON.stringify(extra), ticket.vendor_serial_id]
          );
          if (['processor', 'ram', 'storage'].includes(fieldName)) {
            await client.query(
              `UPDATE tickets SET ${fieldName} = $1 WHERE ticket_id = $2`,
              [newValue, id]
            );
          }
        }
        configUpdated = true;
      }
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      ticket_part_id: tpRes.rows[0].id,
      new_parts_quantity: newPartsQuantity,
      config_updated: configUpdated,
      message: `Part attached. ${part.part_name} — ${newPartsQuantity} remaining in stock`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('addPartToTicketWithConfig:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to attach part' });
  } finally {
    client.release();
  }
};

/** POST /api/tickets/:id/log-note */
exports.logNote = async (req, res) => {
  const { id } = req.params;
  const { note_text, time_spent_minutes } = req.body;
  if (!note_text?.trim() || note_text.trim().length < 3) {
    return res.status(400).json({ success: false, message: 'Note text required (min 3 characters)' });
  }
  try {
    const ticketRes = await pool.query('SELECT * FROM tickets WHERE ticket_id = $1', [id]);
    if (!ticketRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    const t = ticketRes.rows[0];
    const text = note_text.trim();

    await pool.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'note_added', $3)`,
      [id, req.user.user_id, text]
    );

    if (t.ttspl_id) {
      await ttsplAuditService.logTtsplEvent({
        ttsplId: t.ttspl_id,
        vendorSerialId: t.vendor_serial_id,
        eventType: 'note_added',
        description: text,
        metadata: { time_spent_minutes: time_spent_minutes || null },
        actorUserId: req.user.user_id,
        actorName: req.user.name
      });
    }

    res.json({ success: true, message: 'Work note logged' });
  } catch (error) {
    console.error('logNote:', error);
    res.status(500).json({ success: false, message: 'Failed to log note' });
  }
};