'use strict';
const pool = require('../config/db');
const path = require('path');
const fs   = require('fs');
const { generateChallanPdf } = require('../services/supportPartChallanPdfService');

// Display ticket number is derived from the support ticket id (no dedicated
// column exists on support_tickets), e.g. STK-0045.
const TICKET_NUMBER_SQL = `('STK-' || LPAD(st.id::text, 4, '0'))`;

// ── helpers ──────────────────────────────────────────────────────────────────

async function nextSprNumber(db = pool) {
  const r = await db.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1, updated_at = NOW()
     WHERE doc_type = 'support_part_request' RETURNING last_value`
  );
  return `SPR-${String(r.rows[0].last_value).padStart(4, '0')}`;
}

async function nextSpcNumber(db = pool) {
  const r = await db.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1, updated_at = NOW()
     WHERE doc_type = 'support_part_challan' RETURNING last_value`
  );
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `SPC-${dateStr}-${String(r.rows[0].last_value).padStart(4, '0')}`;
}

function saveEsignFile(base64Data, prefix) {
  const dir = path.join(__dirname, '../uploads/support-parts');
  fs.mkdirSync(dir, { recursive: true });
  const safePrefix = String(prefix).replace(/[^\w-]/g, '_');
  const filename = `${safePrefix}_esign_${Date.now()}.png`;
  const b64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(path.join(dir, filename), Buffer.from(b64, 'base64'));
  return `uploads/support-parts/${filename}`;
}

// ── RAISE PART REQUEST ────────────────────────────────────────────────────────

exports.raiseSupportPartRequest = async (req, res) => {
  const { support_ticket_id, support_item_id, ttspl_id, serial_number,
          part_id, quantity, reason } = req.body;

  if (!support_ticket_id || !part_id || !quantity) {
    return res.status(400).json({ success: false,
      message: 'support_ticket_id, part_id, quantity are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tkRes = await client.query(
      'SELECT id FROM support_tickets WHERE id = $1', [support_ticket_id]
    );
    if (!tkRes.rows.length)
      throw Object.assign(new Error('Support ticket not found'), { status: 404 });

    const partRes = await client.query(
      `SELECT p.*, pi_count.available
       FROM parts p
       LEFT JOIN (
         SELECT part_id, COUNT(*) AS available
         FROM part_instances WHERE status = 'in_stock'
         GROUP BY part_id
       ) pi_count ON pi_count.part_id = p.part_id
       WHERE p.part_id = $1 AND NOT COALESCE(p.archived, FALSE)`,
      [part_id]
    );
    if (!partRes.rows.length)
      throw Object.assign(new Error('Part not found'), { status: 404 });
    const part = partRes.rows[0];

    const reqNumber = await nextSprNumber(client);
    const { rows } = await client.query(
      `INSERT INTO support_part_requests
         (request_number, support_ticket_id, support_item_id, ttspl_id,
          serial_number, requested_by, assigned_to_tech, part_id, quantity,
          reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'pending')
       RETURNING *`,
      [reqNumber, support_ticket_id, support_item_id || null, ttspl_id || null,
       serial_number || null, req.user.user_id, part_id, Number(quantity), reason || null]
    );
    const spr = rows[0];

    await client.query('COMMIT');
    const available = Number(part.available || 0);
    res.status(201).json({
      success: true,
      request: { ...spr, part_name: part.part_name, stock_available: available },
      in_stock: available > 0,
      message: available > 0
        ? 'Request raised. Awaiting warehouse approval.'
        : 'Request raised. Part is out of stock - warehouse will procure.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── LIST REQUESTS (warehouse queue + technician view) ─────────────────────────

exports.listSupportPartRequests = async (req, res) => {
  try {
    const { status, for_warehouse, assigned_to_tech, support_ticket_id } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (status) {
      where += ` AND spr.status = $${params.length + 1}`;
      params.push(status);
    }
    if (for_warehouse === 'true') {
      where += ` AND spr.status IN ('pending','approved','challan_generated')`;
    }
    if (assigned_to_tech) {
      where += ` AND spr.assigned_to_tech = $${params.length + 1}`;
      params.push(Number(assigned_to_tech));
    }
    if (support_ticket_id) {
      where += ` AND spr.support_ticket_id = $${params.length + 1}`;
      params.push(Number(support_ticket_id));
    }
    // Tech sees only own requests
    if (req.user.role === 'support_tech') {
      where += ` AND spr.assigned_to_tech = $${params.length + 1}`;
      params.push(req.user.user_id);
    }

    const { rows } = await pool.query(
      `SELECT spr.*,
              p.part_name, p.category, p.location_code, p.cost AS unit_cost,
              pi.prt_id, pi.location_code AS instance_location,
              tech.name AS tech_name, tech.email AS tech_email,
              approver.name AS approved_by_name,
              st.customer_name, ${TICKET_NUMBER_SQL} AS support_ticket_number,
              spc.challan_number, spc.tech_esign_url, spc.pdf_path
       FROM support_part_requests spr
       JOIN parts p ON p.part_id = spr.part_id
       LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
       JOIN users tech ON tech.user_id = spr.assigned_to_tech
       LEFT JOIN users approver ON approver.user_id = spr.approved_by
       JOIN support_tickets st ON st.id = spr.support_ticket_id
       LEFT JOIN support_part_challans spc ON spc.id = spr.challan_id
       ${where}
       ORDER BY spr.created_at DESC`,
      params
    );

    res.json({ success: true, requests: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── WAREHOUSE: APPROVE + GENERATE CHALLAN ────────────────────────────────────

exports.approveAndGenerateChallan = async (req, res) => {
  const { request_ids } = req.body;
  if (!Array.isArray(request_ids) || !request_ids.length) {
    return res.status(400).json({ success: false, message: 'request_ids required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqRes = await client.query(
      `SELECT spr.*, p.part_name, p.cost AS unit_cost
       FROM support_part_requests spr
       JOIN parts p ON p.part_id = spr.part_id
       WHERE spr.id = ANY($1::int[]) AND spr.status = 'pending'
       FOR UPDATE OF spr`,
      [request_ids]
    );
    if (!reqRes.rows.length)
      throw new Error('No pending requests found for given IDs');

    const requests = reqRes.rows;
    const techIds = [...new Set(requests.map((r) => r.assigned_to_tech))];
    const ticketIds = [...new Set(requests.map((r) => r.support_ticket_id))];
    if (techIds.length > 1)
      throw new Error('All requests must belong to the same technician');
    if (ticketIds.length > 1)
      throw new Error('All requests must belong to the same support ticket');

    const techId   = techIds[0];
    const ticketId = ticketIds[0];
    const ttsplId  = requests[0].ttspl_id;

    const challanItems = [];
    for (const reqRow of requests) {
      let instRes = await client.query(
        `SELECT * FROM part_instances
         WHERE part_id = $1 AND status = 'in_stock'
         ORDER BY received_at ASC LIMIT 1 FOR UPDATE`,
        [reqRow.part_id]
      );
      let instance = instRes.rows[0];

      if (!instance && Number(reqRow.quantity) > 0) {
        const partQtyRes = await client.query(
          'SELECT quantity, cost FROM parts WHERE part_id = $1', [reqRow.part_id]
        );
        if (Number(partQtyRes.rows[0]?.quantity || 0) > 0) {
          const { generatePrtId } = require('../services/partIdService');
          const prtId = await generatePrtId(new Date(), client);
          const newInst = await client.query(
            `INSERT INTO part_instances (prt_id, part_id, unit_cost, status, notes)
             VALUES ($1,$2,$3,'in_stock','Auto-created from legacy stock') RETURNING *`,
            [prtId, reqRow.part_id, Number(partQtyRes.rows[0]?.cost || 0)]
          );
          instance = newInst.rows[0];
        }
      }
      if (!instance)
        throw new Error(`Part "${reqRow.part_name}" is out of stock. Reject or escalate.`);

      await client.query(
        `UPDATE part_instances SET status = 'reserved', updated_at = NOW()
         WHERE instance_id = $1`,
        [instance.instance_id]
      );
      await client.query(
        `UPDATE support_part_requests
         SET status = 'approved', instance_id = $1, approved_by = $2, approved_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [instance.instance_id, req.user.user_id, reqRow.id]
      );

      challanItems.push({
        part_request_id: reqRow.id,
        part_id: reqRow.part_id,
        instance_id: instance.instance_id,
        prt_id: instance.prt_id,
        part_name: reqRow.part_name,
        quantity: reqRow.quantity,
        unit_cost: Number(instance.unit_cost || reqRow.unit_cost || 0),
      });
    }

    const challanNumber = await nextSpcNumber(client);
    const challanRes = await client.query(
      `INSERT INTO support_part_challans
         (challan_number, support_ticket_id, ttspl_id, issued_to, issued_by, status)
       VALUES ($1,$2,$3,$4,$5,'draft')
       RETURNING *`,
      [challanNumber, ticketId, ttsplId || null, techId, req.user.user_id]
    );
    const challan = challanRes.rows[0];

    for (const item of challanItems) {
      await client.query(
        `INSERT INTO support_challan_items
           (challan_id, part_request_id, part_id, instance_id, prt_id,
            part_name, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [challan.id, item.part_request_id, item.part_id, item.instance_id,
         item.prt_id, item.part_name, item.quantity, item.unit_cost]
      );
      await client.query(
        `UPDATE support_part_requests SET challan_id = $1, status = 'challan_generated',
           updated_at = NOW() WHERE id = $2`,
        [challan.id, item.part_request_id]
      );
    }

    await client.query('COMMIT');

    generateChallanPdf(challan.id, challanNumber).catch((e) =>
      console.error('challan PDF error:', e.message)
    );

    res.status(201).json({
      success: true,
      challan_id: challan.id,
      challan_number: challanNumber,
      items: challanItems,
      message: `Challan ${challanNumber} created. Technician must come to sign.`
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── TECHNICIAN: E-SIGN CHALLAN → ISSUE PARTS ─────────────────────────────────

exports.signAndIssueChallan = async (req, res) => {
  const challanId = parseInt(req.params.challanId, 10);
  const { esign_data, signer_name } = req.body;

  if (!esign_data || !esign_data.startsWith('data:image'))
    return res.status(400).json({ success: false, message: 'e-sign image required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const chalRes = await client.query(
      `SELECT sc.*, u.name AS tech_name
       FROM support_part_challans sc
       JOIN users u ON u.user_id = sc.issued_to
       WHERE sc.id = $1 FOR UPDATE OF sc`,
      [challanId]
    );
    if (!chalRes.rows.length)
      throw Object.assign(new Error('Challan not found'), { status: 404 });
    const challan = chalRes.rows[0];

    if (!['draft', 'challan_generated'].includes(challan.status))
      throw new Error(`Challan is already ${challan.status}`);

    const esignUrl = saveEsignFile(esign_data, `challan_${challan.challan_number}`);

    await client.query(
      `UPDATE support_part_challans SET
         tech_esign_url = $1, tech_esign_at = NOW(), tech_esign_name = $2,
         issued_by = $3, issued_at = NOW(), status = 'issued', updated_at = NOW()
       WHERE id = $4`,
      [esignUrl, signer_name || challan.tech_name, req.user.user_id, challanId]
    );

    const itemsRes = await client.query(
      'SELECT * FROM support_challan_items WHERE challan_id = $1', [challanId]
    );
    for (const item of itemsRes.rows) {
      if (item.instance_id) {
        await client.query(
          `UPDATE part_instances SET status = 'with_technician', updated_at = NOW()
           WHERE instance_id = $1`,
          [item.instance_id]
        );
        await client.query(
          `UPDATE parts SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
           WHERE part_id = $2`,
          [item.quantity, item.part_id]
        );
      }
      await client.query(
        `UPDATE support_part_requests SET status = 'issued', issued_at = NOW(),
           updated_at = NOW() WHERE id = $1`,
        [item.part_request_id]
      );
    }

    await client.query('COMMIT');

    generateChallanPdf(challanId, challan.challan_number, esignUrl).catch((e) =>
      console.error('challan PDF error:', e.message)
    );

    res.json({
      success: true,
      challan_number: challan.challan_number,
      message: 'Parts issued to technician. Challan signed.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── MARK PART AS USED ─────────────────────────────────────────────────────────

exports.markPartUsed = async (req, res) => {
  const reqId = parseInt(req.params.requestId, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM support_part_requests WHERE id = $1 FOR UPDATE', [reqId]
    );
    if (!r.rows.length) throw Object.assign(new Error('Request not found'), { status: 404 });
    const spr = r.rows[0];

    if (spr.assigned_to_tech !== req.user.user_id && !['admin', 'support_lead', 'manager'].includes(req.user.role))
      throw Object.assign(new Error('Not authorised'), { status: 403 });
    if (spr.status !== 'issued')
      throw new Error(`Cannot mark used: status is '${spr.status}'`);

    await client.query(
      `UPDATE support_part_requests SET status='used', used_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [reqId]
    );
    if (spr.instance_id) {
      await client.query(
        `UPDATE part_instances SET status='installed',
           installed_ttspl_id=$1, installed_at=NOW(), updated_at=NOW()
         WHERE instance_id=$2`,
        [spr.ttspl_id, spr.instance_id]
      );
    }
    await client.query(
      `UPDATE support_challan_items SET return_status='used' WHERE part_request_id=$1`, [reqId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Part marked as used on laptop.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── RETURN PART ───────────────────────────────────────────────────────────────

exports.returnPart = async (req, res) => {
  const reqId = parseInt(req.params.requestId, 10);
  const { method, esign_data, signer_name } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT * FROM support_part_requests WHERE id=$1 FOR UPDATE', [reqId]
    );
    if (!r.rows.length) throw Object.assign(new Error('Not found'), { status: 404 });
    const spr = r.rows[0];

    if (!['issued', 'return_requested'].includes(spr.status))
      throw new Error(`Cannot return: status is '${spr.status}'`);

    if (method === 'pickup_request') {
      await client.query(
        `UPDATE support_part_requests SET status='return_requested',
           return_requested_at=NOW(), updated_at=NOW() WHERE id=$1`, [reqId]
      );
      await client.query(
        `UPDATE support_challan_items SET return_status='held' WHERE part_request_id=$1`, [reqId]
      );
      await client.query('COMMIT');
      return res.json({ success: true, message: 'Return request raised. Warehouse will collect.' });
    }

    // method='self' — warehouse confirms with e-sign
    if (!esign_data || !esign_data.startsWith('data:image'))
      throw new Error('Warehouse e-sign required to confirm return');

    const whEsignUrl = saveEsignFile(esign_data, `return_${spr.request_number}`);

    if (spr.instance_id) {
      await client.query(
        `UPDATE part_instances SET status='in_stock', installed_ttspl_id=NULL,
           removed_at=NOW(), condition_on_removal='good', updated_at=NOW()
         WHERE instance_id=$1`,
        [spr.instance_id]
      );
      await client.query(
        `UPDATE parts SET quantity=quantity+$1, updated_at=NOW() WHERE part_id=$2`,
        [spr.quantity, spr.part_id]
      );
    }

    await client.query(
      `UPDATE support_part_requests SET status='returned', returned_at=NOW(),
         returned_to=$1, updated_at=NOW() WHERE id=$2`,
      [req.user.user_id, reqId]
    );
    await client.query(
      `UPDATE support_challan_items SET return_status='returned' WHERE part_request_id=$1`, [reqId]
    );

    let challanNumberForPdf = null;
    if (spr.challan_id) {
      const chRes = await client.query(
        `UPDATE support_part_challans SET
           wh_esign_url=$1, wh_esign_at=NOW(), wh_esign_name=$2,
           status = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM support_challan_items
               WHERE challan_id=$3 AND return_status='held'
             ) THEN 'fully_returned' ELSE 'partially_returned' END,
           updated_at=NOW()
         WHERE id=$3 RETURNING challan_number`,
        [whEsignUrl, signer_name || req.user.email || 'Warehouse', spr.challan_id]
      );
      challanNumberForPdf = chRes.rows[0]?.challan_number || null;
    }

    await client.query('COMMIT');

    if (spr.challan_id && challanNumberForPdf) {
      generateChallanPdf(spr.challan_id, challanNumberForPdf).catch((e) =>
        console.error('challan PDF error:', e.message)
      );
    }

    res.json({ success: true, message: 'Part returned to warehouse. Stock updated.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};

// ── WAREHOUSE: ACCEPT RETURN (when pickup method) ─────────────────────────────

exports.acceptReturn = async (req, res) => {
  req.body.method = 'self';
  return exports.returnPart(req, res);
};

// ── TECHNICIAN BUCKET ─────────────────────────────────────────────────────────

exports.getTechnicianBucket = async (req, res) => {
  try {
    const isTech = req.user.role === 'support_tech';
    const params = [];
    let techFilter = '';
    if (isTech) {
      params.push(req.user.user_id);
      techFilter = `AND spr.assigned_to_tech = $1`;
    }

    const { rows } = await pool.query(`
      SELECT spr.*,
             p.part_name, p.category, p.location_code,
             pi.prt_id, pi.location_code AS instance_location,
             u.name AS tech_name, u.email AS tech_email,
             st.customer_name, ${TICKET_NUMBER_SQL} AS ticket_number,
             spc.challan_number, spc.pdf_path
      FROM support_part_requests spr
      JOIN parts p ON p.part_id = spr.part_id
      LEFT JOIN part_instances pi ON pi.instance_id = spr.instance_id
      JOIN users u ON u.user_id = spr.assigned_to_tech
      JOIN support_tickets st ON st.id = spr.support_ticket_id
      LEFT JOIN support_part_challans spc ON spc.id = spr.challan_id
      WHERE spr.status IN ('issued','return_requested')
      ${techFilter}
      ORDER BY spr.issued_at DESC NULLS LAST
    `, params);

    const grouped = {};
    rows.forEach((r) => {
      const key = r.assigned_to_tech;
      if (!grouped[key]) grouped[key] = { tech_id: key, tech_name: r.tech_name, parts: [] };
      grouped[key].parts.push(r);
    });

    res.json({ success: true, bucket: Object.values(grouped), total: rows.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET CHALLAN ───────────────────────────────────────────────────────────────

exports.getChallan = async (req, res) => {
  try {
    const challanId = parseInt(req.params.challanId, 10);
    const challanRes = await pool.query(
      `SELECT sc.*, u.name AS tech_name, u.email AS tech_email,
              ist.name AS issued_by_name,
              st.customer_name, st.id AS ticket_id,
              ${TICKET_NUMBER_SQL} AS ticket_number
       FROM support_part_challans sc
       JOIN users u ON u.user_id = sc.issued_to
       LEFT JOIN users ist ON ist.user_id = sc.issued_by
       JOIN support_tickets st ON st.id = sc.support_ticket_id
       WHERE sc.id = $1`,
      [challanId]
    );
    if (!challanRes.rows.length)
      return res.status(404).json({ success: false, message: 'Challan not found' });

    const items = await pool.query(
      'SELECT * FROM support_challan_items WHERE challan_id = $1 ORDER BY id', [challanId]
    );

    res.json({ success: true, challan: challanRes.rows[0], items: items.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── WAREHOUSE QUEUE ───────────────────────────────────────────────────────────

exports.getWarehouseQueue = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT spr.*,
             p.part_name, p.category, p.quantity AS stock_qty,
             p.location_code, p.cost AS unit_cost,
             COALESCE(pi_count.available, 0) AS instances_available,
             u.name AS tech_name,
             st.customer_name, ${TICKET_NUMBER_SQL} AS ticket_number
      FROM support_part_requests spr
      JOIN parts p ON p.part_id = spr.part_id
      LEFT JOIN (
        SELECT part_id, COUNT(*) AS available
        FROM part_instances WHERE status='in_stock' GROUP BY part_id
      ) pi_count ON pi_count.part_id = p.part_id
      JOIN users u ON u.user_id = spr.assigned_to_tech
      JOIN support_tickets st ON st.id = spr.support_ticket_id
      WHERE spr.status IN ('pending','return_requested')
      ORDER BY spr.created_at ASC
    `);

    const pending = rows.filter((r) => r.status === 'pending');
    const returns = rows.filter((r) => r.status === 'return_requested');
    res.json({ success: true, pending, returns, total: rows.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
