const pool = require('../config/db');
const ttsplAuditService = require('../services/ttsplAuditService');
const { generatePrqNumber } = require('../services/partIdService');

// config_field -> vendor_serial_numbers.extra JSON key (only specs that map to
// a real config field get written back; battery/keyboard/other are tracked in
// history only).
const CONFIG_KEY_MAP = {
  ram: 'ram',
  storage: 'storage',
  display: 'screen_size',
  processor: 'processor',
  gpu: 'gpu',
  os: 'os',
};

const OPEN_STATUSES = ['pending', 'approved', 'escalated', 'ordered', 'received'];

async function logTicketActivity(db, ticketId, userId, action, notes) {
  try {
    await db.query(
      `INSERT INTO activities (ticket_id, user_id, action, notes, created_at)
       VALUES ($1,$2,$3,$4,NOW())`,
      [ticketId, userId || null, action, notes || null]
    );
  } catch (_) {
    // activities is best-effort; never block the main flow on logging.
  }
}

// Mark a ticket's block (if any) resolved and decrement the open counter.
async function releaseBlock(db, ticketId, requestId) {
  const r = await db.query(
    `UPDATE ticket_part_blocks
        SET is_active = false, unblocked_at = NOW()
      WHERE ticket_id = $1 AND request_id = $2 AND is_active = true
      RETURNING block_id`,
    [ticketId, requestId]
  );
  if (r.rows.length) {
    await db.query(
      `UPDATE tickets
          SET open_part_requests = GREATEST(0, COALESCE(open_part_requests,0) - 1)
        WHERE ticket_id = $1`,
      [ticketId]
    );
  }
}

/**
 * POST /api/part-requests
 * Raise a part request from a floor stage.
 */
exports.createPartRequest = async (req, res) => {
  const {
    ticket_id, request_type = 'replacement', part_id, quantity = 1,
    description, config_field, old_value, new_value,
  } = req.body;
  const blocksStage = req.body.blocks_stage !== false;

  if (!ticket_id || !part_id) {
    return res.status(400).json({ success: false, message: 'ticket_id and part_id are required' });
  }
  if (!['replacement', 'upgrade', 'consumable'].includes(request_type)) {
    return res.status(400).json({ success: false, message: 'Invalid request_type' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tRes = await client.query(
      `SELECT t.ticket_id, t.ttspl_id, t.vendor_serial_id, t.current_stage_id, s.stage_name
         FROM tickets t
         LEFT JOIN stages s ON s.stage_id = t.current_stage_id
        WHERE t.ticket_id = $1`,
      [ticket_id]
    );
    if (!tRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const ticket = tRes.rows[0];

    const pRes = await client.query(
      `SELECT part_id, part_name, quantity, cost FROM parts WHERE part_id = $1`,
      [part_id]
    );
    if (!pRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Part not found in catalog' });
    }
    const part = pRes.rows[0];
    const qty = Math.max(1, Number(quantity) || 1);
    const inStock = Number(part.quantity || 0) >= qty;
    const status = inStock ? 'pending' : 'escalated';

    const requestNumber = await generatePrqNumber(client);

    const insert = await client.query(
      `INSERT INTO part_requests
         (ticket_id, requested_by, part_name, description, status, request_number,
          request_type, part_id, quantity, stage_name, ticket_stage_id,
          config_field, old_value, new_value, blocks_stage,
          escalated_by, escalated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17)
       RETURNING *`,
      [
        ticket_id, req.user.user_id, part.part_name, description || null, status, requestNumber,
        request_type, part_id, qty, ticket.stage_name || null, ticket.current_stage_id || null,
        request_type === 'upgrade' ? (config_field || null) : null,
        request_type === 'upgrade' ? (old_value || null) : null,
        request_type === 'upgrade' ? (new_value || null) : null,
        blocksStage,
        status === 'escalated' ? req.user.user_id : null,
        status === 'escalated' ? new Date() : null,
      ]
    );
    const request = insert.rows[0];

    if (blocksStage) {
      await client.query(
        `INSERT INTO ticket_part_blocks (ticket_id, request_id)
         VALUES ($1,$2) ON CONFLICT (ticket_id, request_id) DO NOTHING`,
        [ticket_id, request.request_id]
      );
      await client.query(
        `UPDATE tickets SET open_part_requests = COALESCE(open_part_requests,0) + 1
          WHERE ticket_id = $1`,
        [ticket_id]
      );
    }

    await logTicketActivity(
      client, ticket_id, req.user.user_id, 'part_requested',
      `${requestNumber} (${request_type}) — ${part.part_name}${inStock ? '' : ' → escalated to procurement (out of stock)'}`
    );
    await ttsplAuditService.logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'part_requested',
      description: `${requestNumber}: ${request_type} — ${part.part_name}`,
      metadata: { request_id: request.request_id, request_type, part_id, in_stock: inStock },
      actorUserId: req.user.user_id,
      actorName: req.user.name || null,
      db: client,
    });

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      request_id: request.request_id,
      request_number: requestNumber,
      status,
      in_stock: inStock,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

const REQUEST_SELECT = `
  SELECT pr.*,
         p.part_name AS catalog_part_name, p.category, p.quantity AS stock_qty, p.cost AS catalog_cost,
         pi.prt_id, pi.location_code AS instance_location, pi.status AS instance_status,
         t.ttspl_id, t.ticket_type, t.brand, t.model,
         u.name AS requested_by_name,
         appr.name AS approved_by_name
    FROM part_requests pr
    LEFT JOIN parts p ON p.part_id = pr.part_id
    LEFT JOIN part_instances pi ON pi.instance_id = pr.instance_id
    LEFT JOIN tickets t ON t.ticket_id = pr.ticket_id
    LEFT JOIN users u ON u.user_id = pr.requested_by
    LEFT JOIN users appr ON appr.user_id = pr.approved_by
`;

/** GET /api/part-requests */
exports.listPartRequests = async (req, res) => {
  try {
    const { ticket_id, status } = req.query;
    const where = [];
    const params = [];
    let i = 1;
    if (ticket_id) { where.push(`pr.ticket_id = $${i++}`); params.push(ticket_id); }
    if (status) { where.push(`pr.status = $${i++}`); params.push(status); }

    const role = req.user.role;
    if (['team_member', 'team_lead', 'technician'].includes(role)) {
      where.push(`pr.requested_by = $${i++}`); params.push(req.user.user_id);
    }
    const sql = `${REQUEST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY pr.created_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, requests: r.rows });
  } catch (err) {
    console.error('listPartRequests:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/part-requests/:requestId */
exports.getPartRequest = async (req, res) => {
  try {
    const r = await pool.query(`${REQUEST_SELECT} WHERE pr.request_id = $1`, [req.params.requestId]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, request: r.rows[0] });
  } catch (err) {
    console.error('getPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/tickets-style: GET /api/part-requests?ticket_id is preferred, but
 *  keep an explicit endpoint for the ticket detail page. */
exports.getTicketPartRequests = async (req, res) => {
  try {
    const r = await pool.query(
      `${REQUEST_SELECT} WHERE pr.ticket_id = $1 ORDER BY pr.created_at DESC`,
      [req.params.ticketId]
    );
    res.json({ success: true, requests: r.rows });
  } catch (err) {
    console.error('getTicketPartRequests:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** PATCH /api/part-requests/:requestId/approve */
exports.approvePartRequest = async (req, res) => {
  const { requestId } = req.params;
  const { instance_id, auto_select } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query(
      `SELECT pr.*, t.ttspl_id, t.vendor_serial_id FROM part_requests pr
         LEFT JOIN tickets t ON t.ticket_id = pr.ticket_id
        WHERE pr.request_id = $1 FOR UPDATE`,
      [requestId]
    );
    if (!rRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const request = rRes.rows[0];
    if (!['pending', 'escalated', 'ordered', 'received'].includes(request.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Cannot approve a request in '${request.status}' state` });
    }

    let instance;
    if (instance_id) {
      const iRes = await client.query(
        `SELECT * FROM part_instances WHERE instance_id = $1 AND part_id = $2 FOR UPDATE`,
        [instance_id, request.part_id]
      );
      if (!iRes.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Instance not found for this part' }); }
      instance = iRes.rows[0];
      if (instance.status !== 'in_stock') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: `Instance is '${instance.status}', not in_stock` }); }
    } else if (auto_select) {
      const iRes = await client.query(
        `SELECT * FROM part_instances
          WHERE part_id = $1 AND status = 'in_stock'
          ORDER BY received_at ASC, instance_id ASC LIMIT 1 FOR UPDATE`,
        [request.part_id]
      );
      if (!iRes.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'No in-stock instance available — escalate to procurement' }); }
      instance = iRes.rows[0];
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Provide instance_id or auto_select=true' });
    }

    await client.query(
      `UPDATE part_instances SET status='reserved', updated_at=NOW() WHERE instance_id=$1`,
      [instance.instance_id]
    );
    await client.query(
      `UPDATE part_requests
          SET status='approved', instance_id=$1, approved_by=$2, approved_at=NOW(), updated_at=NOW()
        WHERE request_id=$3`,
      [instance.instance_id, req.user.user_id, requestId]
    );
    await logTicketActivity(client, request.ticket_id, req.user.user_id, 'part_approved',
      `${request.request_number} approved — ${instance.prt_id} reserved`);
    await ttsplAuditService.logTtsplEvent({
      ttsplId: request.ttspl_id, vendorSerialId: request.vendor_serial_id,
      eventType: 'part_approved',
      description: `${request.request_number} approved — ${instance.prt_id} reserved`,
      metadata: { request_id: Number(requestId), instance_id: instance.instance_id, prt_id: instance.prt_id },
      actorUserId: req.user.user_id, actorName: req.user.name || null, db: client,
    });

    await client.query('COMMIT');
    res.json({ success: true, instance_id: instance.instance_id, prt_id: instance.prt_id, location_code: instance.location_code });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('approvePartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

/** PATCH /api/part-requests/:requestId/reject */
exports.rejectPartRequest = async (req, res) => {
  const { requestId } = req.params;
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ success: false, message: 'Rejection reason is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query(`SELECT * FROM part_requests WHERE request_id=$1 FOR UPDATE`, [requestId]);
    if (!rRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const request = rRes.rows[0];
    // free any reserved instance
    if (request.instance_id) {
      await client.query(`UPDATE part_instances SET status='in_stock', updated_at=NOW() WHERE instance_id=$1 AND status='reserved'`, [request.instance_id]);
    }
    await client.query(
      `UPDATE part_requests SET status='rejected', rejection_reason=$1, updated_at=NOW() WHERE request_id=$2`,
      [reason.trim(), requestId]
    );
    await releaseBlock(client, request.ticket_id, request.request_id);
    await logTicketActivity(client, request.ticket_id, req.user.user_id, 'part_rejected',
      `${request.request_number} rejected: ${reason.trim()}`);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('rejectPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

/** PATCH /api/part-requests/:requestId/escalate */
exports.escalateToProcurement = async (req, res) => {
  const { requestId } = req.params;
  const { notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query(`SELECT * FROM part_requests WHERE request_id=$1 FOR UPDATE`, [requestId]);
    if (!rRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const request = rRes.rows[0];
    await client.query(
      `UPDATE part_requests SET status='escalated', escalated_by=$1, escalated_at=NOW(),
              description=COALESCE($2, description), updated_at=NOW()
        WHERE request_id=$3`,
      [req.user.user_id, notes || null, requestId]
    );
    await logTicketActivity(client, request.ticket_id, req.user.user_id, 'part_escalated',
      `${request.request_number} escalated to procurement`);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('escalateToProcurement:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

/** PATCH /api/part-requests/:requestId/link-spo */
exports.linkRequestToSpo = async (req, res) => {
  const { requestId } = req.params;
  const { spo_id } = req.body;
  if (!spo_id) return res.status(400).json({ success: false, message: 'spo_id is required' });
  try {
    const rRes = await pool.query(`SELECT * FROM part_requests WHERE request_id=$1`, [requestId]);
    if (!rRes.rows.length) return res.status(404).json({ success: false, message: 'Request not found' });
    const request = rRes.rows[0];
    await pool.query(
      `UPDATE part_requests SET status='ordered', spo_id=$1, updated_at=NOW() WHERE request_id=$2`,
      [spo_id, requestId]
    );
    await logTicketActivity(pool, request.ticket_id, req.user.user_id, 'part_ordered',
      `${request.request_number} linked to SPO #${spo_id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('linkRequestToSpo:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** PATCH /api/part-requests/:requestId/received
 *  Warehouse links a freshly received PRT instance to a procurement request. */
exports.markPartReceived = async (req, res) => {
  const { requestId } = req.params;
  const { instance_id } = req.body;
  if (!instance_id) return res.status(400).json({ success: false, message: 'instance_id is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query(
      `SELECT pr.*, t.ttspl_id, t.vendor_serial_id FROM part_requests pr
         LEFT JOIN tickets t ON t.ticket_id = pr.ticket_id
        WHERE pr.request_id=$1 FOR UPDATE`, [requestId]);
    if (!rRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const request = rRes.rows[0];
    const iRes = await client.query(`SELECT * FROM part_instances WHERE instance_id=$1 FOR UPDATE`, [instance_id]);
    if (!iRes.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Instance not found' }); }
    const instance = iRes.rows[0];

    await client.query(`UPDATE part_instances SET status='reserved', updated_at=NOW() WHERE instance_id=$1`, [instance_id]);
    await client.query(
      `UPDATE part_requests SET status='approved', instance_id=$1, approved_by=$2, approved_at=NOW(), updated_at=NOW()
        WHERE request_id=$3`,
      [instance_id, req.user.user_id, requestId]
    );
    await logTicketActivity(client, request.ticket_id, req.user.user_id, 'part_received',
      `${request.request_number} part received — ${instance.prt_id} reserved`);
    await ttsplAuditService.logTtsplEvent({
      ttsplId: request.ttspl_id, vendorSerialId: request.vendor_serial_id,
      eventType: 'part_received',
      description: `${request.request_number} received — ${instance.prt_id}`,
      metadata: { request_id: Number(requestId), instance_id, prt_id: instance.prt_id },
      actorUserId: req.user.user_id, actorName: req.user.name || null, db: client,
    });
    await client.query('COMMIT');
    res.json({ success: true, prt_id: instance.prt_id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('markPartReceived:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

/** POST /api/part-requests/:requestId/attach
 *  Technician installs the approved part and returns the old/defective one. */
exports.attachPartAndReturnOld = async (req, res) => {
  const { requestId } = req.params;
  const { old_part_returned, old_part_condition, old_part_notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqRes = await client.query(
      `SELECT pr.*, p.part_name, p.cost AS part_cost,
              pi.prt_id, pi.unit_cost AS instance_cost,
              t.ttspl_id, t.vendor_serial_id
         FROM part_requests pr
         JOIN parts p ON p.part_id = pr.part_id
         LEFT JOIN part_instances pi ON pi.instance_id = pr.instance_id
         JOIN tickets t ON t.ticket_id = pr.ticket_id
        WHERE pr.request_id = $1 FOR UPDATE`,
      [requestId]
    );
    if (!reqRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const r = reqRes.rows[0];
    if (r.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Cannot attach: request is '${r.status}'. Must be approved.` });
    }

    const unitCost = parseFloat(r.instance_cost != null ? r.instance_cost : (r.part_cost || 0)) || 0;
    const isUpgrade = r.request_type === 'upgrade';
    const qty = r.quantity || 1;

    if (r.instance_id) {
      await client.query(
        `UPDATE part_instances
            SET status='installed', installed_ttspl_id=$1, installed_ticket_id=$2,
                installed_at=NOW(), updated_at=NOW()
          WHERE instance_id=$3`,
        [r.ttspl_id, r.ticket_id, r.instance_id]
      );
    }

    await client.query(
      `UPDATE parts SET quantity = GREATEST(0, quantity - $1), updated_at = NOW() WHERE part_id = $2`,
      [qty, r.part_id]
    );

    await client.query(
      `INSERT INTO ticket_parts (ticket_id, part_id, quantity_used, notes, unit_cost, is_upgrade)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.ticket_id, r.part_id, qty, r.description || null, unitCost, isUpgrade]
    );

    let configUpdated = false;
    if (isUpgrade && r.config_field && r.new_value) {
      await ttsplAuditService.logConfigChange({
        ttsplId: r.ttspl_id, vendorSerialId: r.vendor_serial_id, ticketId: r.ticket_id,
        changedBy: req.user.user_id, changeType: 'upgrade', fieldName: r.config_field,
        oldValue: r.old_value, newValue: r.new_value,
        notes: `${r.part_name} upgrade (${r.old_value || '—'} → ${r.new_value})`,
        partUsedId: r.part_id, partCost: unitCost, db: client,
      });
      const jsonbKey = CONFIG_KEY_MAP[r.config_field];
      if (jsonbKey && r.vendor_serial_id) {
        await client.query(
          `UPDATE vendor_serial_numbers
              SET extra = jsonb_set(COALESCE(extra,'{}'::jsonb), $1, $2::jsonb, true),
                  updated_at = NOW()
            WHERE serial_id = $3`,
          [`{${jsonbKey}}`, JSON.stringify(r.new_value), r.vendor_serial_id]
        );
        // processor/ram/storage are also mirrored onto the tickets row.
        if (['processor', 'ram', 'storage'].includes(jsonbKey)) {
          await client.query(
            `UPDATE tickets SET ${jsonbKey} = $1 WHERE ticket_id = $2`,
            [r.new_value, r.ticket_id]
          );
        }
      }
      configUpdated = true;
    }

    await client.query(
      `UPDATE part_requests
          SET status='attached', attached_by=$1, attached_at=NOW(),
              old_part_returned=$2,
              old_part_returned_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
              old_part_condition=$3, old_part_notes=$4, updated_at=NOW()
        WHERE request_id=$5`,
      [req.user.user_id, Boolean(old_part_returned), old_part_condition || null, old_part_notes || null, requestId]
    );

    // Old part returned in reusable condition → add a unit back to catalog stock.
    if (old_part_returned && old_part_condition === 'good') {
      await client.query(
        `UPDATE parts SET quantity = quantity + 1, updated_at = NOW() WHERE part_id = $1`,
        [r.part_id]
      );
    }

    await releaseBlock(client, r.ticket_id, Number(requestId));

    await logTicketActivity(client, r.ticket_id, req.user.user_id, 'part_attached',
      `${r.request_number} attached — ${r.part_name}${r.prt_id ? ` (${r.prt_id})` : ''}${isUpgrade ? ` · ${r.old_value || '—'} → ${r.new_value}` : ''}`);
    await ttsplAuditService.logTtsplEvent({
      ttsplId: r.ttspl_id, vendorSerialId: r.vendor_serial_id,
      eventType: 'part_attached',
      description: `Part attached: ${r.part_name}${r.prt_id ? ` (${r.prt_id})` : ''}${isUpgrade ? ` — Upgrade: ${r.old_value || '—'} → ${r.new_value}` : ''}`,
      metadata: {
        request_id: Number(requestId), part_id: r.part_id, prt_id: r.prt_id,
        part_name: r.part_name, unit_cost: unitCost, is_upgrade: isUpgrade,
        config_field: r.config_field, old_value: r.old_value, new_value: r.new_value,
        old_part_returned: Boolean(old_part_returned), old_part_condition: old_part_condition || null,
      },
      actorUserId: req.user.user_id, actorName: req.user.name || null, db: client,
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Part attached successfully', config_updated: configUpdated, ticket_unblocked: Boolean(r.blocks_stage) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('attachPartAndReturnOld:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

/** PATCH /api/part-requests/:requestId/cancel */
exports.cancelPartRequest = async (req, res) => {
  const { requestId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query(`SELECT * FROM part_requests WHERE request_id=$1 FOR UPDATE`, [requestId]);
    if (!rRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const request = rRes.rows[0];
    if (['attached', 'cancelled'].includes(request.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Cannot cancel a '${request.status}' request` });
    }
    // technicians may only cancel their own requests
    if (['team_member', 'team_lead', 'technician'].includes(req.user.role)
        && Number(request.requested_by) !== Number(req.user.user_id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You can only cancel your own request' });
    }
    if (request.instance_id) {
      await client.query(`UPDATE part_instances SET status='in_stock', updated_at=NOW() WHERE instance_id=$1 AND status='reserved'`, [request.instance_id]);
    }
    await client.query(`UPDATE part_requests SET status='cancelled', updated_at=NOW() WHERE request_id=$1`, [requestId]);
    await releaseBlock(client, request.ticket_id, request.request_id);
    await logTicketActivity(client, request.ticket_id, req.user.user_id, 'part_cancelled', `${request.request_number} cancelled`);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('cancelPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

/** GET /api/part-requests/warehouse-queue */
exports.getWarehouseQueue = async (req, res) => {
  try {
    const r = await pool.query(
      `${REQUEST_SELECT}
        WHERE pr.status IN ('pending','approved','escalated','ordered','received')
        ORDER BY
          CASE pr.status WHEN 'pending' THEN 0 WHEN 'received' THEN 1
                         WHEN 'ordered' THEN 2 WHEN 'escalated' THEN 3 ELSE 4 END,
          pr.created_at ASC`
    );
    res.json({ success: true, requests: r.rows });
  } catch (err) {
    console.error('getWarehouseQueue:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/part-requests/procurement-queue */
exports.getProcurementQueue = async (req, res) => {
  try {
    const r = await pool.query(
      `${REQUEST_SELECT}
        WHERE pr.status IN ('escalated','ordered')
        ORDER BY CASE pr.status WHEN 'escalated' THEN 0 ELSE 1 END, pr.created_at ASC`
    );
    res.json({ success: true, requests: r.rows });
  } catch (err) {
    console.error('getProcurementQueue:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/part-requests/cost-summary/:ttsplId */
exports.getPartCostSummary = async (req, res) => {
  const { ttsplId } = req.params;
  try {
    const costRes = await pool.query(
      `SELECT COALESCE(SUM(tp.quantity_used * COALESCE(tp.unit_cost, p.cost, 0)),0)::numeric AS parts_cost,
              COALESCE((
                SELECT MAX(vpd.rate)
                  FROM tickets t2
                  JOIN vendor_serial_numbers vsn2 ON vsn2.serial_id = t2.vendor_serial_id
                  LEFT JOIN vendor_product_details vpd ON vpd.po_id = vsn2.po_id
                 WHERE t2.ttspl_id = $1
              ),0)::numeric AS base_cost
         FROM tickets t
         LEFT JOIN ticket_parts tp ON tp.ticket_id = t.ticket_id
         LEFT JOIN parts p ON p.part_id = tp.part_id
        WHERE t.ttspl_id = $1`,
      [ttsplId]
    );
    const breakdown = await pool.query(
      `SELECT pi.prt_id, pi.unit_cost, pi.installed_at, p.part_name, p.category,
              pr.request_type AS type, pr.request_number
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
         LEFT JOIN part_requests pr ON pr.instance_id = pi.instance_id
        WHERE pi.installed_ttspl_id = $1 AND pi.status = 'installed'
        ORDER BY pi.installed_at ASC`,
      [ttsplId]
    );
    const row = costRes.rows[0] || { parts_cost: 0, base_cost: 0 };
    const partsCost = parseFloat(row.parts_cost) || 0;
    const baseCost = parseFloat(row.base_cost) || 0;
    res.json({
      success: true,
      ttspl_id: ttsplId,
      base_cost: baseCost,
      parts_cost: partsCost,
      total_expense: baseCost + partsCost,
      parts_breakdown: breakdown.rows,
    });
  } catch (err) {
    console.error('getPartCostSummary:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
