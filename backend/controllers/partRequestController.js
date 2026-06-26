/**
 * Part Request Controller (Phase 16)
 *
 * Flow: floor raises request -> warehouse approves (reserves a PRT instance)
 *       OR escalates to procurement -> SPO -> received -> approved
 *       -> technician attaches part (config update for upgrades) + returns old
 *       -> ticket unblocked -> expense tracked per laptop.
 */
const pool = require('../config/db');
const { generatePrqNumber, generatePrtId } = require('../services/partIdService');
const { logTtsplEvent, logConfigChange, resolveTtsplAsset } = require('../services/ttsplAuditService');

const FULL_SELECT = `
  SELECT pr.*,
         COALESCE(pr.part_name, p.part_name) AS part_name,
         p.category, p.part_type, p.cost AS catalog_cost, p.quantity AS stock_qty,
         pi.prt_id, pi.location_code, pi.status AS instance_status, pi.unit_cost AS instance_cost,
         t.ttspl_id, t.brand, t.model, t.processor, t.ram, t.storage,
         t.vendor_serial_id, t.current_stage_id,
         st.stage_name,
         u.name AS requester_name,
         au.name AS approver_name,
         spo.purchase_order_number AS spo_number
    FROM part_requests pr
    LEFT JOIN parts p              ON p.part_id = pr.part_id
    LEFT JOIN part_instances pi    ON pi.instance_id = pr.instance_id
    LEFT JOIN tickets t            ON t.ticket_id = pr.ticket_id
    LEFT JOIN stages st            ON st.stage_id = COALESCE(pr.ticket_stage_id, t.current_stage_id)
    LEFT JOIN users u              ON u.user_id = pr.requested_by
    LEFT JOIN users au             ON au.user_id = pr.approved_by
    LEFT JOIN vendor_spare_parts_purchase_orders spo ON spo.spo_id = pr.spo_id
`;

const PRIVILEGED = ['admin', 'manager', 'super_admin'];

// POST /api/part-requests
exports.createPartRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      ticket_id, request_type = 'replacement', part_id, quantity = 1,
      description, config_field, old_value, new_value, blocks_stage = true,
    } = req.body || {};

    if (!ticket_id) return res.status(400).json({ success: false, message: 'ticket_id required' });
    if (!part_id) return res.status(400).json({ success: false, message: 'part_id required' });
    if (!['replacement', 'upgrade', 'consumable'].includes(request_type)) {
      return res.status(400).json({ success: false, message: 'Invalid request_type' });
    }
    if (request_type === 'upgrade' && (!config_field || !new_value)) {
      return res.status(400).json({ success: false, message: 'Upgrade requires config_field and new_value' });
    }

    const partRes = await client.query(
      `SELECT part_id, part_name, quantity, cost FROM parts WHERE part_id = $1`, [part_id]
    );
    if (!partRes.rows.length) return res.status(404).json({ success: false, message: 'Part not found' });
    const part = partRes.rows[0];

    const tRes = await client.query(
      `SELECT ticket_id, ttspl_id, vendor_serial_id, current_stage_id FROM tickets WHERE ticket_id = $1`,
      [ticket_id]
    );
    if (!tRes.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const ticket = tRes.rows[0];

    let stageName = null;
    if (ticket.current_stage_id) {
      const sRes = await client.query(`SELECT stage_name FROM stages WHERE stage_id = $1`, [ticket.current_stage_id]);
      stageName = sRes.rows[0]?.stage_name || null;
    }

    const inStock = Number(part.quantity) > 0;
    const status = inStock ? 'pending' : 'escalated';
    const blocks = blocks_stage !== false;

    await client.query('BEGIN');

    const reqNumber = await generatePrqNumber(client);
    const ins = await client.query(
      `INSERT INTO part_requests
         (ticket_id, requested_by, part_name, description, status, request_number,
          request_type, part_id, quantity, stage_name, ticket_stage_id,
          config_field, old_value, new_value, blocks_stage,
          escalated_by, escalated_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,NOW())
       RETURNING request_id`,
      [
        ticket_id, req.user.user_id, part.part_name, description || null, status, reqNumber,
        request_type, part_id, Number(quantity) || 1, stageName, ticket.current_stage_id || null,
        config_field || null, old_value || null, new_value || null, blocks,
        inStock ? null : req.user.user_id, inStock ? null : new Date(),
      ]
    );
    const requestId = ins.rows[0].request_id;

    if (blocks) {
      await client.query(
        `INSERT INTO ticket_part_blocks (ticket_id, request_id)
         VALUES ($1,$2) ON CONFLICT (ticket_id, request_id) DO NOTHING`,
        [ticket_id, requestId]
      );
      await client.query(
        `UPDATE tickets SET open_part_requests = COALESCE(open_part_requests,0) + 1, updated_at = NOW()
          WHERE ticket_id = $1`,
        [ticket_id]
      );
    }

    await logTtsplEvent({
      ttsplId: ticket.ttspl_id,
      vendorSerialId: ticket.vendor_serial_id,
      eventType: 'part_requested',
      description: `Part requested: ${part.part_name} (${request_type})${inStock ? '' : ' — out of stock, escalated to procurement'}`,
      metadata: { request_id: requestId, request_number: reqNumber, part_id, request_type, config_field, old_value, new_value },
      actorUserId: req.user.user_id,
      actorName: req.user.name,
      db: client,
    });

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      request_id: requestId,
      request_number: reqNumber,
      status,
      in_stock: inStock,
      message: inStock ? 'Part request submitted for warehouse approval' : 'Part out of stock — escalated to procurement',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('createPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// GET /api/part-requests
exports.listPartRequests = async (req, res) => {
  try {
    const { ticket_id, status } = req.query;
    const where = [];
    const params = [];

    if (ticket_id) { params.push(Number(ticket_id)); where.push(`pr.ticket_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`pr.status = $${params.length}`); }

    // Non-privileged users without a ticket filter only see their own requests.
    if (!ticket_id && !PRIVILEGED.includes(req.user.role) && req.user.role !== 'warehouse' && req.user.role !== 'procurement') {
      params.push(req.user.user_id);
      where.push(`pr.requested_by = $${params.length}`);
    }

    const sql = `${FULL_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pr.created_at DESC LIMIT 500`;
    const result = await pool.query(sql, params);
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    console.error('listPartRequests:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/:requestId
exports.getPartRequest = async (req, res) => {
  try {
    const result = await pool.query(`${FULL_SELECT} WHERE pr.request_id = $1`, [req.params.requestId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/tickets/:ticketId/part-requests  (also reachable via list with ?ticket_id=)
exports.getTicketPartRequests = async (req, res) => {
  try {
    const result = await pool.query(
      `${FULL_SELECT} WHERE pr.ticket_id = $1 ORDER BY pr.created_at DESC`,
      [req.params.ticketId]
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/part-requests/:requestId/approve   body: { instance_id } | { auto_select: true }
exports.approvePartRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    const { instance_id, auto_select } = req.body || {};

    await client.query('BEGIN');

    const prRes = await client.query(
      `SELECT * FROM part_requests WHERE request_id = $1 FOR UPDATE`, [requestId]
    );
    if (!prRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const pr = prRes.rows[0];
    if (!['pending', 'escalated', 'ordered', 'received'].includes(pr.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Cannot approve a request with status '${pr.status}'` });
    }

    let instanceId = instance_id ? Number(instance_id) : null;
    if (!instanceId) {
      if (!auto_select && pr.instance_id) instanceId = pr.instance_id;
    }
    if (!instanceId) {
      // auto-select oldest in_stock instance for this part
      const pick = await client.query(
        `SELECT instance_id FROM part_instances
          WHERE part_id = $1 AND status = 'in_stock'
          ORDER BY received_at ASC, instance_id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [pr.part_id]
      );
      if (pick.rows.length) {
        instanceId = pick.rows[0].instance_id;
      } else {
        // No PRT instance exists yet. Legacy stock may live only in parts.quantity
        // (added before Phase 16). If there is stock, mint a PRT instance on-the-fly.
        const partRow = await client.query(
          `SELECT part_id, part_name, quantity, cost FROM parts WHERE part_id = $1 FOR UPDATE`,
          [pr.part_id]
        );
        const part = partRow.rows[0];
        if (!part || Number(part.quantity) <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Part "${part?.part_name || pr.part_id}" is out of stock (0 available). Escalate to procurement.`
          });
        }
        const prtId = await generatePrtId(new Date(), client);
        const created = await client.query(
          `INSERT INTO part_instances
             (prt_id, part_id, unit_cost, status, notes, received_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'in_stock', 'Auto-created from legacy stock on approval', NOW(), NOW(), NOW())
           RETURNING instance_id`,
          [prtId, pr.part_id, Number(part.cost || 0)]
        );
        instanceId = created.rows[0].instance_id;
      }
    }

    const instRes = await client.query(
      `SELECT * FROM part_instances WHERE instance_id = $1 FOR UPDATE`, [instanceId]
    );
    if (!instRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Part instance not found' }); }
    const inst = instRes.rows[0];
    if (Number(inst.part_id) !== Number(pr.part_id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Selected part unit does not match the requested part' });
    }
    if (inst.status !== 'in_stock' && inst.status !== 'reserved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Part unit is '${inst.status}', not available` });
    }

    await client.query(
      `UPDATE part_instances SET status = 'reserved', updated_at = NOW() WHERE instance_id = $1`, [instanceId]
    );
    await client.query(
      `UPDATE part_requests SET status = 'approved', instance_id = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW()
        WHERE request_id = $3`,
      [instanceId, req.user.user_id, requestId]
    );

    const tRes = await client.query(`SELECT ttspl_id, vendor_serial_id FROM tickets WHERE ticket_id = $1`, [pr.ticket_id]);
    await logTtsplEvent({
      ttsplId: tRes.rows[0]?.ttspl_id,
      vendorSerialId: tRes.rows[0]?.vendor_serial_id,
      eventType: 'part_approved',
      description: `Part request ${pr.request_number} approved — ${inst.prt_id} reserved`,
      metadata: { request_id: Number(requestId), instance_id: instanceId, prt_id: inst.prt_id },
      actorUserId: req.user.user_id, actorName: req.user.name, db: client,
    });

    await client.query('COMMIT');
    res.json({ success: true, instance_id: instanceId, prt_id: inst.prt_id, location_code: inst.location_code, message: 'Part approved and reserved' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('approvePartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// PATCH /api/part-requests/:requestId/reject   body: { reason }
exports.rejectPartRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) return res.status(400).json({ success: false, message: 'Rejection reason required' });

    await client.query('BEGIN');
    const prRes = await client.query(`SELECT * FROM part_requests WHERE request_id = $1 FOR UPDATE`, [requestId]);
    if (!prRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const pr = prRes.rows[0];

    // Free a reserved instance, if any.
    if (pr.instance_id) {
      await client.query(`UPDATE part_instances SET status = 'in_stock', updated_at = NOW() WHERE instance_id = $1 AND status = 'reserved'`, [pr.instance_id]);
    }
    await client.query(
      `UPDATE part_requests SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE request_id = $2`,
      [reason, requestId]
    );
    await unblockTicket(client, pr);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Part request rejected' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('rejectPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// PATCH /api/part-requests/:requestId/escalate
exports.escalateToProcurement = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { notes } = req.body || {};
    const upd = await pool.query(
      `UPDATE part_requests SET status = 'escalated', escalated_by = $1, escalated_at = NOW(),
              old_part_notes = COALESCE(old_part_notes, $2), updated_at = NOW()
        WHERE request_id = $3 AND status IN ('pending','rejected')
        RETURNING request_id, request_number`,
      [req.user.user_id, notes || null, requestId]
    );
    if (!upd.rows.length) return res.status(400).json({ success: false, message: 'Request cannot be escalated from its current status' });
    res.json({ success: true, message: 'Escalated to procurement', request: upd.rows[0] });
  } catch (err) {
    console.error('escalateToProcurement:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/part-requests/:requestId/link-spo   body: { spo_id }
exports.linkRequestToSpo = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { spo_id } = req.body || {};
    if (!spo_id) return res.status(400).json({ success: false, message: 'spo_id required' });
    const upd = await pool.query(
      `UPDATE part_requests SET status = 'ordered', spo_id = $1, updated_at = NOW()
        WHERE request_id = $2 AND status IN ('escalated','pending')
        RETURNING request_id`,
      [Number(spo_id), requestId]
    );
    if (!upd.rows.length) return res.status(400).json({ success: false, message: 'Request cannot be linked from its current status' });
    res.json({ success: true, message: 'Linked to spare parts order' });
  } catch (err) {
    console.error('linkRequestToSpo:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/part-requests/:requestId/received   body: { instance_id }
exports.markPartReceived = async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    const { instance_id } = req.body || {};
    if (!instance_id) return res.status(400).json({ success: false, message: 'instance_id required' });

    await client.query('BEGIN');
    const prRes = await client.query(`SELECT * FROM part_requests WHERE request_id = $1 FOR UPDATE`, [requestId]);
    if (!prRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const pr = prRes.rows[0];

    const instRes = await client.query(`SELECT * FROM part_instances WHERE instance_id = $1 FOR UPDATE`, [Number(instance_id)]);
    if (!instRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Part instance not found' }); }
    const inst = instRes.rows[0];
    if (Number(inst.part_id) !== Number(pr.part_id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Part unit does not match the requested part' });
    }

    await client.query(`UPDATE part_instances SET status = 'reserved', updated_at = NOW() WHERE instance_id = $1`, [Number(instance_id)]);
    await client.query(
      `UPDATE part_requests SET status = 'approved', instance_id = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW()
        WHERE request_id = $3`,
      [Number(instance_id), req.user.user_id, requestId]
    );
    await client.query('COMMIT');
    res.json({ success: true, prt_id: inst.prt_id, message: 'Part received and reserved for this request' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('markPartReceived:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// POST /api/part-requests/:requestId/attach
exports.attachPartAndReturnOld = async (req, res) => {
  const { requestId } = req.params;
  const { old_part_returned, old_part_condition, old_part_notes } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reqRes = await client.query(
      `SELECT pr.*, p.part_name, p.cost AS part_cost, p.category,
              pi.prt_id, pi.unit_cost AS instance_cost,
              t.ttspl_id, t.vendor_serial_id, t.current_stage_id
         FROM part_requests pr
         JOIN parts p ON p.part_id = pr.part_id
         LEFT JOIN part_instances pi ON pi.instance_id = pr.instance_id
         JOIN tickets t ON t.ticket_id = pr.ticket_id
        WHERE pr.request_id = $1 FOR UPDATE OF pr`,
      [requestId]
    );
    if (!reqRes.rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });

    const r = reqRes.rows[0];
    if (r.status !== 'approved') {
      throw Object.assign(new Error(`Cannot attach part: request status is '${r.status}'. Must be approved.`), { status: 400 });
    }

    const unitCost = parseFloat(r.instance_cost || r.part_cost || 0);
    const isUpgrade = r.request_type === 'upgrade';
    const qty = Number(r.quantity) || 1;

    if (r.instance_id) {
      await client.query(
        `UPDATE part_instances SET status = 'installed', installed_ttspl_id = $1,
                installed_ticket_id = $2, installed_at = NOW(), updated_at = NOW()
          WHERE instance_id = $3`,
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
      await logConfigChange({
        ttsplId: r.ttspl_id, vendorSerialId: r.vendor_serial_id, ticketId: r.ticket_id,
        changedBy: req.user.user_id, changeType: 'upgrade', fieldName: r.config_field,
        oldValue: r.old_value, newValue: r.new_value,
        notes: `Part ${r.part_name} upgraded (${r.old_value || '—'} → ${r.new_value})`,
        partUsedId: r.part_id, partCost: unitCost, db: client,
      });

      const fieldMap = { ram: 'ram', storage: 'storage', display: 'screen_size', processor: 'processor', gpu: 'gpu', os: 'os' };
      const jsonbKey = fieldMap[r.config_field] || r.config_field;
      if (r.vendor_serial_id) {
        await client.query(
          `UPDATE vendor_serial_numbers
              SET extra = jsonb_set(COALESCE(extra, '{}'::jsonb), $1, $2::jsonb), updated_at = NOW()
            WHERE serial_id = $3`,
          [`{${jsonbKey}}`, JSON.stringify(r.new_value), r.vendor_serial_id]
        );
      }
      // Mirror core spec fields onto the ticket row so the header updates instantly.
      if (['ram', 'storage', 'processor'].includes(r.config_field)) {
        await client.query(
          `UPDATE tickets SET ${r.config_field} = $1, updated_at = NOW() WHERE ticket_id = $2`,
          [r.new_value, r.ticket_id]
        );
      }
      configUpdated = true;
    }

    await client.query(
      `UPDATE part_requests SET status = 'attached', attached_by = $1, attached_at = NOW(),
              old_part_returned = $2,
              old_part_returned_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
              old_part_condition = $3, old_part_notes = $4, updated_at = NOW()
        WHERE request_id = $5`,
      [req.user.user_id, Boolean(old_part_returned), old_part_condition || null, old_part_notes || null, requestId]
    );

    // Reusable old part goes back into stock.
    if (old_part_returned && old_part_condition === 'good') {
      await client.query(`UPDATE parts SET quantity = quantity + 1, updated_at = NOW() WHERE part_id = $1`, [r.part_id]);
    }

    await unblockTicket(client, r);

    await logTtsplEvent({
      ttsplId: r.ttspl_id, vendorSerialId: r.vendor_serial_id, eventType: 'part_attached',
      description: `Part attached: ${r.part_name} (${r.prt_id || 'no PRT ID'})${isUpgrade ? ` — Upgrade: ${r.old_value || '—'} → ${r.new_value}` : ''}`,
      metadata: {
        request_id: Number(requestId), part_id: r.part_id, prt_id: r.prt_id, part_name: r.part_name,
        unit_cost: unitCost, is_upgrade: isUpgrade, config_field: r.config_field,
        old_value: r.old_value, new_value: r.new_value, old_part_returned: Boolean(old_part_returned), old_part_condition,
      },
      actorUserId: req.user.user_id, actorName: req.user.name, db: client,
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Part attached successfully', config_updated: configUpdated, ticket_unblocked: Boolean(r.blocks_stage) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('attachPartAndReturnOld:', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// PATCH /api/part-requests/:requestId/cancel
exports.cancelPartRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    await client.query('BEGIN');
    const prRes = await client.query(`SELECT * FROM part_requests WHERE request_id = $1 FOR UPDATE`, [requestId]);
    if (!prRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const pr = prRes.rows[0];
    if (['attached', 'cancelled'].includes(pr.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Cannot cancel a request that is '${pr.status}'` });
    }
    // Only the requester, floor managers or admins may cancel.
    if (!PRIVILEGED.includes(req.user.role) && req.user.role !== 'floor_manager' && Number(pr.requested_by) !== Number(req.user.user_id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You can only cancel your own requests' });
    }
    if (pr.instance_id) {
      await client.query(`UPDATE part_instances SET status = 'in_stock', updated_at = NOW() WHERE instance_id = $1 AND status = 'reserved'`, [pr.instance_id]);
    }
    await client.query(`UPDATE part_requests SET status = 'cancelled', updated_at = NOW() WHERE request_id = $1`, [requestId]);
    await unblockTicket(client, pr);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Part request cancelled' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('cancelPartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// GET /api/part-requests/warehouse-queue
exports.getWarehouseQueue = async (req, res) => {
  try {
    const result = await pool.query(
      `${FULL_SELECT} WHERE pr.status IN ('pending','escalated','ordered','received')
        ORDER BY CASE pr.status WHEN 'pending' THEN 0 WHEN 'received' THEN 1 WHEN 'ordered' THEN 2 ELSE 3 END,
                 pr.created_at ASC`
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/procurement-queue
exports.getProcurementQueue = async (req, res) => {
  try {
    const result = await pool.query(
      `${FULL_SELECT} WHERE pr.status IN ('escalated','ordered') ORDER BY pr.created_at ASC`
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/cost-summary/:ttsplId
exports.getPartCostSummary = async (req, res) => {
  try {
    const { ttsplId } = req.params;
    const ctx = await resolveTtsplAsset(ttsplId);
    if (!ctx) {
      return res.json({
        success: true,
        ttspl_id: ttsplId,
        base_cost: 0,
        parts_cost: 0,
        total_expense: 0,
        parts_breakdown: []
      });
    }

    const aliasArr = ctx.aliases.length ? ctx.aliases : [ctx.canonicalTtspl];

    const breakdown = await pool.query(
      `SELECT pi.prt_id, p.part_name, pi.unit_cost, pi.installed_at,
              COALESCE(pr.request_type, CASE WHEN tp.is_upgrade THEN 'upgrade' ELSE 'replacement' END) AS type
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
         LEFT JOIN part_requests pr ON pr.instance_id = pi.instance_id
         LEFT JOIN ticket_parts tp ON tp.part_id = pi.part_id AND tp.ticket_id = pi.installed_ticket_id
        WHERE UPPER(COALESCE(pi.installed_ttspl_id, '')) = ANY($1::text[])
          AND pi.status = 'installed'
        ORDER BY pi.installed_at ASC`,
      [aliasArr]
    );

    const totals = await pool.query(
      `SELECT COALESCE(SUM(tp.quantity_used * COALESCE(tp.unit_cost, p.cost, 0)),0)::numeric AS parts_cost
         FROM tickets t
         JOIN ticket_parts tp ON tp.ticket_id = t.ticket_id
         LEFT JOIN parts p ON p.part_id = tp.part_id
        WHERE ($1::int IS NOT NULL AND t.vendor_serial_id = $1)
           OR UPPER(COALESCE(t.ttspl_id, '')) = ANY($2::text[])
           OR UPPER(COALESCE(t.serial_number, '')) = ANY($2::text[])`,
      [ctx.serialId, aliasArr]
    );

    const baseRes = ctx.serialId
      ? await pool.query(
        `SELECT COALESCE(MAX(vpd.rate),0)::numeric AS base_cost
           FROM vendor_serial_numbers vsn
           LEFT JOIN vendor_product_details vpd ON vpd.po_id = vsn.po_id
          WHERE vsn.serial_id = $1`,
        [ctx.serialId]
      )
      : await pool.query(
        `SELECT COALESCE(MAX(vpd.rate),0)::numeric AS base_cost
           FROM vendor_serial_numbers vsn
           LEFT JOIN vendor_product_details vpd ON vpd.po_id = vsn.po_id
          WHERE UPPER(COALESCE(vsn.inventory_asset_code, '')) = ANY($1::text[])`,
        [aliasArr]
      );

    const partsCost = parseFloat(totals.rows[0]?.parts_cost || 0);
    const baseCost = parseFloat(baseRes.rows[0]?.base_cost || 0);

    res.json({
      success: true,
      ttspl_id: ctx.canonicalTtspl,
      base_cost: baseCost,
      parts_cost: partsCost,
      total_expense: partsCost + baseCost,
      parts_breakdown: breakdown.rows.map((b) => ({
        prt_id: b.prt_id,
        part_name: b.part_name,
        unit_cost: parseFloat(b.unit_cost || 0),
        installed_at: b.installed_at,
        type: b.type,
      })),
    });
  } catch (err) {
    console.error('getPartCostSummary:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/part-requests/instances?status=&part_id=&category=&limit=
exports.listPartInstances = async (req, res) => {
  try {
    const { status, part_id, category, limit = 200 } = req.query;
    const conditions = [];
    const params = [];
    if (status) { params.push(status); conditions.push(`pi.status = $${params.length}`); }
    if (part_id) { params.push(Number(part_id)); conditions.push(`pi.part_id = $${params.length}`); }
    if (category) { params.push(category); conditions.push(`p.category = $${params.length}`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(Math.min(1000, Number(limit) || 200));

    const result = await pool.query(
      `SELECT pi.instance_id, pi.prt_id, pi.part_id, pi.status, pi.location_code,
              pi.unit_cost, pi.installed_ttspl_id, pi.installed_ticket_id, pi.installed_at,
              pi.received_at, pi.created_at,
              p.part_name, p.category, p.part_type
         FROM part_instances pi
         JOIN parts p ON p.part_id = pi.part_id
         ${where}
         ORDER BY pi.created_at DESC, pi.instance_id DESC
         LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, instances: result.rows });
  } catch (err) {
    console.error('listPartInstances:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Shared: deactivate the block row and decrement the ticket's open counter.
async function unblockTicket(client, pr) {
  const upd = await client.query(
    `UPDATE ticket_part_blocks SET is_active = false, unblocked_at = NOW()
      WHERE ticket_id = $1 AND request_id = $2 AND is_active = true
      RETURNING block_id`,
    [pr.ticket_id, pr.request_id]
  );
  if (upd.rows.length) {
    await client.query(
      `UPDATE tickets SET open_part_requests = GREATEST(0, COALESCE(open_part_requests,0) - 1), updated_at = NOW()
        WHERE ticket_id = $1`,
      [pr.ticket_id]
    );
  }
}
