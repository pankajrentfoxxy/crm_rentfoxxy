/**
 * Sales-order serial allocation — warehouse attaches laptops to an SO before
 * the DC. Each attach reserves the unit and creates ONE pre-dispatch QC ticket.
 * DC generation later pulls the attached + QC-passed serials (no re-selection).
 */
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { createSalesOrderQcTicket } = require('../services/grnTicketService');
const { entityForQuotationType } = require('../services/salesManagementService');

// Resolve a serial's full specs from the authoritative source.
const SPEC_SELECT = `
  SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.qc_status, vsn.inventory_status,
         COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
         COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
         COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
         COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
         COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
         COALESCE(vsn.extra->>'storage', vpd.storage) AS storage,
         COALESCE(vsn.extra->>'gpu', vpd.gpu) AS gpu,
         COALESCE(vsn.extra->>'screen_size', vpd.screen_size) AS screen_size
  FROM vendor_serial_numbers vsn
  LEFT JOIN vendor_product_details vpd
    ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
  WHERE vsn.deleted_at IS NULL AND `;

async function getSoHeader(soNumber) {
  const r = await pool.query(
    `SELECT sales_order_number, customer_id, quotation_type, entity_code
       FROM sales_order_lines WHERE sales_order_number = $1 ORDER BY id ASC LIMIT 1`,
    [soNumber]
  );
  return r.rows[0] || null;
}

// GET /sales-orders/:soNumber/serials
exports.listSerials = async (req, res) => {
  try {
    const soNumber = req.params.soNumber;
    const linesRes = await pool.query(
      `SELECT id AS line_id, brand, model_name, processor, generation, ram, storage, gpu, screen_size,
              COALESCE(main_qty, quantity, 0) AS ordered_qty, rate, quotation_type
         FROM sales_order_lines WHERE sales_order_number = $1 ORDER BY id ASC`,
      [soNumber]
    );

    const allocRes = await pool.query(
      `SELECT sos.*, t.status AS ticket_status, s.stage_name AS ticket_stage
         FROM sales_order_serials sos
         LEFT JOIN tickets t ON t.ticket_id = sos.qc_ticket_id
         LEFT JOIN stages s ON s.stage_id = t.current_stage_id
        WHERE sos.sales_order_number = $1 AND sos.status <> 'removed'
        ORDER BY sos.allocation_id ASC`,
      [soNumber]
    );
    const allocations = allocRes.rows;

    const lines = linesRes.rows.map((line) => {
      const attached = allocations.filter((a) => a.line_id === line.line_id);
      return {
        ...line,
        attached_count: attached.length,
        remaining_qty: Math.max(0, Number(line.ordered_qty) - attached.length),
        allocations: attached,
      };
    });

    const allPassed = allocations.length > 0 && allocations.every((a) => a.qc_status === 'passed');
    const totalOrdered = linesRes.rows.reduce((s, l) => s + Number(l.ordered_qty), 0);
    const fullyAttached = allocations.length >= totalOrdered && totalOrdered > 0;

    res.json({
      success: true,
      sales_order_number: soNumber,
      lines,
      allocations,
      summary: {
        total_ordered: totalOrdered,
        total_attached: allocations.length,
        passed: allocations.filter((a) => a.qc_status === 'passed').length,
        pending: allocations.filter((a) => a.qc_status === 'pending').length,
        failed: allocations.filter((a) => a.qc_status === 'failed').length,
        all_passed: allPassed,
        fully_attached: fullyAttached,
        ready_for_dc: fullyAttached && allPassed,
      },
    });
  } catch (err) {
    console.error('listSerials:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /sales-orders/:soNumber/serials   body: { serial_id|serial_number, line_id }
exports.attachSerial = async (req, res) => {
  const client = await pool.connect();
  try {
    const soNumber = req.params.soNumber;
    const body = req.body || {};
    const header = await getSoHeader(soNumber);
    if (!header) return res.status(404).json({ success: false, message: 'Sales order not found' });

    // Resolve the serial.
    const key = body.serial_id || body.serial_number || body.ttspl_id;
    if (!key) return res.status(400).json({ success: false, message: 'serial_id or serial_number required' });
    const cond = body.serial_id ? 'vsn.serial_id = $1' : '(vsn.serial_number = $1 OR vsn.inventory_asset_code = $1)';
    const sr = await client.query(`${SPEC_SELECT} ${cond} LIMIT 1`, [body.serial_id || key]);
    const serial = sr.rows[0];
    if (!serial) return res.status(404).json({ success: false, message: 'Serial not found' });

    // Must be QC-passed (from GRN) and available.
    if (String(serial.qc_status || '').toLowerCase() !== 'passed') {
      return res.status(400).json({ success: false, message: 'Serial has not passed GRN QC yet' });
    }
    if (String(serial.inventory_status || 'in_stock') !== 'in_stock') {
      return res.status(400).json({ success: false, message: `Serial is not available (status: ${serial.inventory_status})` });
    }

    // Already attached somewhere active?
    const dup = await client.query(
      `SELECT allocation_id, sales_order_number FROM sales_order_serials WHERE serial_id = $1 AND status = 'attached'`,
      [serial.serial_id]
    );
    if (dup.rows.length) {
      return res.status(409).json({ success: false, message: `Serial already attached to ${dup.rows[0].sales_order_number}` });
    }

    // Resolve target line: explicit line_id, else match by model with remaining capacity.
    const linesRes = await client.query(
      `SELECT id AS line_id, model_name, processor, COALESCE(main_qty, quantity, 0) AS ordered_qty
         FROM sales_order_lines WHERE sales_order_number = $1 ORDER BY id ASC`,
      [soNumber]
    );
    const attachedCounts = await client.query(
      `SELECT line_id, COUNT(*)::int AS n FROM sales_order_serials
        WHERE sales_order_number = $1 AND status = 'attached' GROUP BY line_id`,
      [soNumber]
    );
    const countByLine = Object.fromEntries(attachedCounts.rows.map((r) => [r.line_id, r.n]));
    const norm = (v) => String(v || '').trim().toLowerCase();

    let line = null;
    if (body.line_id) {
      line = linesRes.rows.find((l) => l.line_id === Number(body.line_id));
    } else {
      line = linesRes.rows.find((l) =>
        norm(l.model_name) === norm(serial.model)
        && (countByLine[l.line_id] || 0) < Number(l.ordered_qty));
    }
    if (!line) {
      return res.status(400).json({ success: false, message: 'No matching order line with remaining capacity for this config' });
    }
    if ((countByLine[line.line_id] || 0) >= Number(line.ordered_qty)) {
      return res.status(400).json({ success: false, message: 'This line is already fully allocated' });
    }
    // Config guard (warn-level): block clearly mismatched model.
    if (norm(line.model_name) !== norm(serial.model)) {
      return res.status(400).json({
        success: false,
        message: `Config mismatch: line is ${line.model_name}, serial is ${serial.model}`,
      });
    }

    const entityCode = header.entity_code || entityForQuotationType(header.quotation_type);

    await client.query('BEGIN');

    // Reserve the unit (in_stock -> reserved).
    await inventorySM.transitionAsset(client, {
      serialId: serial.serial_id,
      toStatus: inventorySM.STATUS.RESERVED,
      customerId: header.customer_id || null,
      entityCode,
      reason: `Attached to ${soNumber}`,
      actorUserId: req.user.user_id,
      actorName: req.user.name,
    });

    // One pre-dispatch QC ticket for this serial.
    const ticket = await createSalesOrderQcTicket(client, {
      serialId: serial.serial_id,
      ttsplId: serial.inventory_asset_code,
      serialNumber: serial.serial_number,
      brand: serial.brand,
      model: serial.model,
      processor: serial.processor,
      generation: serial.generation,
      ram: serial.ram,
      storage: serial.storage,
      salesOrderNumber: soNumber,
      dcNumber: null,
      createdByUserId: req.user.user_id,
    });

    const ins = await client.query(
      `INSERT INTO sales_order_serials
         (sales_order_number, line_id, serial_id, ttspl_id, serial_number,
          qc_ticket_id, qc_status, status, entity_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'pending','attached',$7,$8)
       RETURNING allocation_id`,
      [soNumber, line.line_id, serial.serial_id, serial.inventory_asset_code, serial.serial_number,
       ticket.ok ? ticket.ticket_id : null, entityCode, req.user.user_id]
    );

    // Phase 14: inherit the delivery address planned on the parent SO line (if any).
    await client.query(
      `UPDATE sales_order_serials sos
          SET delivery_address = sol.delivery_address,
              is_wfh = sol.is_wfh,
              delivery_notes = sol.delivery_notes,
              updated_at = NOW()
         FROM sales_order_lines sol
        WHERE sos.allocation_id = $1
          AND sol.id = sos.line_id
          AND sol.delivery_address IS NOT NULL`,
      [ins.rows[0].allocation_id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: 'Serial attached & QC ticket created',
      allocation_id: ins.rows[0].allocation_id,
      qc_ticket_id: ticket.ticket_id || null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (String(err.code) === '23505') {
      return res.status(409).json({ success: false, message: 'Serial already attached' });
    }
    console.error('attachSerial:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// DELETE /sales-orders/:soNumber/serials/:allocId
exports.detachSerial = async (req, res) => {
  const client = await pool.connect();
  try {
    const allocId = parseInt(req.params.allocId, 10);
    await client.query('BEGIN');
    const aRes = await client.query(
      `SELECT * FROM sales_order_serials WHERE allocation_id = $1 FOR UPDATE`, [allocId]
    );
    if (!aRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Allocation not found' });
    }
    const alloc = aRes.rows[0];
    if (alloc.status === 'dispatched') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Cannot detach a dispatched serial' });
    }

    // Return unit to stock.
    if (alloc.serial_id) {
      try {
        await inventorySM.backToStock(client, alloc.serial_id, {
          reason: `Detached from ${alloc.sales_order_number}`,
          actorUserId: req.user.user_id,
          actorName: req.user.name,
        });
      } catch (_) { /* tolerate non-canonical state */ }
    }
    // Cancel the open QC ticket.
    if (alloc.qc_ticket_id) {
      await client.query(
        `UPDATE tickets SET status = 'cancelled', updated_at = NOW()
          WHERE ticket_id = $1 AND status NOT IN ('completed','cancelled')`,
        [alloc.qc_ticket_id]
      );
    }
    await client.query(
      `UPDATE sales_order_serials SET status = 'removed', updated_at = NOW() WHERE allocation_id = $1`,
      [allocId]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Serial detached' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('detachSerial:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};
