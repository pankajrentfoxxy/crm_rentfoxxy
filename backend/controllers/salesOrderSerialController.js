/**
 * Sales-order serial allocation — warehouse attaches laptops to an SO before
 * the DC. Each attach reserves the unit and creates ONE pre-dispatch QC ticket.
 * DC generation later pulls the attached + QC-passed serials (no re-selection).
 */
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { createSalesOrderQcTicket } = require('../services/grnTicketService');
const { entityForQuotationType, healStaleReturnedPassedSerials } = require('../services/salesManagementService');
const {
  serialMatchesSoLine,
  configMismatchMessage,
} = require('../utils/soInventorySpecMatch');
const { ACTIVITY_TYPES, safeLogSalesOrderActivity } = require('../services/salesOrderActivityService');
const { invalidateInventoryListCachesFireAndForget } = require('../services/inventoryListCache');

// Resolve a serial's full specs from the authoritative source.
const SPEC_SELECT = `
  SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.qc_status, vsn.inventory_status,
         COALESCE(
           NULLIF(TRIM(vsn.extra->>'brand'), ''),
           NULLIF(TRIM(vsn.grn_received_config->>'brand'), ''),
           NULLIF(TRIM(vpd.brand), '')
         ) AS brand,
         COALESCE(
           NULLIF(TRIM(vsn.extra->>'model'), ''),
           NULLIF(TRIM(vsn.extra->>'model_name'), ''),
           NULLIF(TRIM(vsn.grn_received_config->>'model'), ''),
           NULLIF(TRIM(vpd.model), '')
         ) AS model,
         COALESCE(
           NULLIF(TRIM(vsn.extra->>'processor'), ''),
           NULLIF(TRIM(vsn.grn_received_config->>'processor'), ''),
           NULLIF(TRIM(vpd.processor), '')
         ) AS processor,
         COALESCE(
           NULLIF(TRIM(vsn.extra->>'generation'), ''),
           NULLIF(TRIM(vsn.grn_received_config->>'generation'), ''),
           NULLIF(TRIM(vpd.generation), '')
         ) AS generation,
         COALESCE(
           NULLIF(TRIM(vsn.extra->>'ram'), ''),
           NULLIF(TRIM(vsn.grn_received_config->>'ram'), ''),
           NULLIF(TRIM(vpd.ram), '')
         ) AS ram,
         COALESCE(
           NULLIF(TRIM(vsn.extra->>'storage'), ''),
           NULLIF(TRIM(vsn.extra->>'ssd'), ''),
           NULLIF(TRIM(vsn.grn_received_config->>'storage'), ''),
           NULLIF(TRIM(vpd.storage), '')
         ) AS storage,
         COALESCE(
           NULLIF(TRIM(vsn.extra->>'gpu'), ''),
           NULLIF(TRIM(vsn.grn_received_config->>'gpu'), ''),
           NULLIF(TRIM(vpd.gpu), '')
         ) AS gpu,
         COALESCE(
           NULLIF(TRIM(vsn.extra->>'screen_size'), ''),
           NULLIF(TRIM(vsn.grn_received_config->>'screen_size'), ''),
           NULLIF(TRIM(vpd.screen_size), '')
         ) AS screen_size
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
      `SELECT sos.*, t.status AS ticket_status, s.stage_name AS ticket_stage,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'brand'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'brand'), ''),
                NULLIF(TRIM(vpd.brand), '')
              ) AS serial_brand,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'model'), ''),
                NULLIF(TRIM(vsn.extra->>'model_name'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'model'), ''),
                NULLIF(TRIM(vpd.model), '')
              ) AS serial_model,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'processor'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'processor'), ''),
                NULLIF(TRIM(vpd.processor), '')
              ) AS serial_processor,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'generation'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'generation'), ''),
                NULLIF(TRIM(vpd.generation), '')
              ) AS serial_generation,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'ram'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'ram'), ''),
                NULLIF(TRIM(vpd.ram), '')
              ) AS serial_ram,
              COALESCE(
                NULLIF(TRIM(vsn.extra->>'storage'), ''),
                NULLIF(TRIM(vsn.extra->>'ssd'), ''),
                NULLIF(TRIM(vsn.grn_received_config->>'storage'), ''),
                NULLIF(TRIM(vpd.storage), '')
              ) AS serial_storage
         FROM sales_order_serials sos
         LEFT JOIN tickets t ON t.ticket_id = sos.qc_ticket_id
         LEFT JOIN stages s ON s.stage_id = t.current_stage_id
         LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
         LEFT JOIN vendor_product_details vpd
           ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
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

    await healStaleReturnedPassedSerials(client);
    const sr2 = await client.query(`${SPEC_SELECT} ${cond} LIMIT 1`, [body.serial_id || key]);
    const freshSerial = sr2.rows[0] || serial;

    // Must be QC-passed (from GRN) and available on shelf.
    if (String(freshSerial.qc_status || '').toLowerCase() !== 'passed') {
      return res.status(400).json({ success: false, message: 'Serial has not passed GRN QC yet' });
    }
    const shelfStatus = String(freshSerial.inventory_status || 'in_stock').toLowerCase();
    if (!['in_stock', 'passed'].includes(shelfStatus)) {
      return res.status(400).json({
        success: false,
        message: `Serial is not available (status: ${freshSerial.inventory_status}). Complete production QC or release from return first.`,
      });
    }

    const serialForAttach = freshSerial;

    // Already attached somewhere active?
    const dup = await client.query(
      `SELECT allocation_id, sales_order_number FROM sales_order_serials WHERE serial_id = $1 AND status = 'attached'`,
      [serialForAttach.serial_id]
    );
    if (dup.rows.length) {
      return res.status(409).json({ success: false, message: `Serial already attached to ${dup.rows[0].sales_order_number}` });
    }

    // Resolve target line: explicit line_id, else match by normalized config with remaining capacity.
    const linesRes = await client.query(
      `SELECT id AS line_id, brand, model_name, processor, generation, ram, storage, gpu, screen_size,
              COALESCE(main_qty, quantity, 0) AS ordered_qty
         FROM sales_order_lines WHERE sales_order_number = $1 ORDER BY id ASC`,
      [soNumber]
    );
    const attachedCounts = await client.query(
      `SELECT line_id, COUNT(*)::int AS n FROM sales_order_serials
        WHERE sales_order_number = $1 AND status = 'attached' GROUP BY line_id`,
      [soNumber]
    );
    const countByLine = Object.fromEntries(attachedCounts.rows.map((r) => [r.line_id, r.n]));

    let line = null;
    if (body.line_id) {
      line = linesRes.rows.find((l) => l.line_id === Number(body.line_id));
    } else {
      line = linesRes.rows.find(
        (l) =>
          serialMatchesSoLine(l, serialForAttach) &&
          (countByLine[l.line_id] || 0) < Number(l.ordered_qty)
      );
    }
    if (!line) {
      return res.status(400).json({ success: false, message: 'No matching order line with remaining capacity for this config' });
    }
    if ((countByLine[line.line_id] || 0) >= Number(line.ordered_qty)) {
      return res.status(400).json({ success: false, message: 'This line is already fully allocated' });
    }
    if (!serialMatchesSoLine(line, serialForAttach)) {
      return res.status(400).json({
        success: false,
        message: configMismatchMessage(line, serialForAttach),
      });
    }

    const entityCode = header.entity_code || entityForQuotationType(header.quotation_type);

    await client.query('BEGIN');

    // Reserve the unit (in_stock -> reserved).
    await inventorySM.transitionAsset(client, {
      serialId: serialForAttach.serial_id,
      toStatus: inventorySM.STATUS.RESERVED,
      customerId: header.customer_id || null,
      entityCode,
      reason: `Attached to ${soNumber}`,
      actorUserId: req.user.user_id,
      actorName: req.user.name,
    });

    // One pre-dispatch QC ticket for this serial.
    const ticket = await createSalesOrderQcTicket(client, {
      serialId: serialForAttach.serial_id,
      ttsplId: serialForAttach.inventory_asset_code,
      serialNumber: serialForAttach.serial_number,
      brand: serialForAttach.brand,
      model: serialForAttach.model,
      processor: serialForAttach.processor,
      generation: serialForAttach.generation,
      ram: serialForAttach.ram,
      storage: serialForAttach.storage,
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
      [soNumber, line.line_id, serialForAttach.serial_id, serialForAttach.inventory_asset_code, serialForAttach.serial_number,
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
    invalidateInventoryListCachesFireAndForget();

    let qcTicket = null;
    if (ticket.ticket_id) {
      const tRes = await pool.query(
        `SELECT t.ticket_id, t.serial_number, t.ttspl_id, t.brand, t.model, t.processor, t.ram, t.storage,
                t.priority, t.ticket_type, t.sales_order_number, t.vendor_serial_id, t.highlighted,
                s.stage_name, tm.team_name
           FROM tickets t
           LEFT JOIN stages s ON s.stage_id = t.current_stage_id
           LEFT JOIN teams tm ON tm.team_id = t.assigned_team_id
          WHERE t.ticket_id = $1`,
        [ticket.ticket_id]
      );
      qcTicket = tRes.rows[0] || null;
    }

    res.status(201).json({
      success: true,
      message: 'Serial attached & QC ticket created',
      allocation_id: ins.rows[0].allocation_id,
      qc_ticket_id: ticket.ticket_id || null,
      qc_ticket: qcTicket,
      serial: {
        serial_id: serialForAttach.serial_id,
        serial_number: serialForAttach.serial_number,
        ttspl_id: serialForAttach.inventory_asset_code,
        brand: serialForAttach.brand,
        model: serialForAttach.model,
        processor: serialForAttach.processor,
        generation: serialForAttach.generation,
        ram: serialForAttach.ram,
        storage: serialForAttach.storage,
      },
    });

    await safeLogSalesOrderActivity({
      salesOrderNumber: soNumber,
      activityType: ACTIVITY_TYPES.LAPTOP,
      action: 'laptop_attached',
      description: `${req.user?.name || 'User'} attached laptop ${serialForAttach.inventory_asset_code || serialForAttach.serial_number} to this Sales Order.`,
      metadata: {
        allocation_id: ins.rows[0].allocation_id,
        serial_id: serialForAttach.serial_id,
        ttspl_id: serialForAttach.inventory_asset_code,
        serial_number: serialForAttach.serial_number,
      },
      user: req.user,
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
    const toPendingInventory = !!req.body?.to_pending_inventory;
    const pendingReason = String(req.body?.reason || 'dispatch_qc_failed').trim();
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

    if (toPendingInventory && alloc.serial_id) {
      try {
        const paSvc = require('../services/productionAssetService');
        let pa = await paSvc.getByVendorSerial(client, alloc.serial_id);
        if (!pa) {
          pa = await paSvc.createFromGrn(client, {
            ticketId: alloc.qc_ticket_id || null,
            serialNumber: alloc.serial_number,
            ttsplId: alloc.ttspl_id,
            vendorSerialId: alloc.serial_id,
            configSource: alloc,
          });
        }
        if (pa?.production_asset_id) {
          await paSvc.markPendingInventory(client, pa.production_asset_id, req.user.user_id, {
            source: 'dispatch_qc',
            reason: pendingReason,
            remarks: req.body?.remarks || `Detached from ${alloc.sales_order_number}`,
            sales_order_number: alloc.sales_order_number,
            allocation_id: alloc.allocation_id,
          });
        }
      } catch (paErr) {
        console.error('detachSerial pending inventory:', paErr.message);
      }
      // Always free reserved shelf status so the unit can be re-attached / searched.
      try {
        await inventorySM.backToStock(client, alloc.serial_id, {
          reason: `Detached from ${alloc.sales_order_number} (pending inventory)`,
          actorUserId: req.user.user_id,
          actorName: req.user.name,
        });
      } catch (_) { /* tolerate non-canonical state */ }
    } else if (alloc.serial_id) {
      // Return unit to stock.
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
    invalidateInventoryListCachesFireAndForget();
    res.json({ success: true, message: 'Serial detached' });

    await safeLogSalesOrderActivity({
      salesOrderNumber: alloc.sales_order_number,
      activityType: ACTIVITY_TYPES.LAPTOP,
      action: 'laptop_removed',
      description: `${req.user?.name || 'User'} removed laptop ${alloc.ttspl_id || alloc.serial_number} from this Sales Order.`,
      metadata: {
        allocation_id: allocId,
        serial_id: alloc.serial_id,
        ttspl_id: alloc.ttspl_id,
        serial_number: alloc.serial_number,
      },
      user: req.user,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('detachSerial:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};
