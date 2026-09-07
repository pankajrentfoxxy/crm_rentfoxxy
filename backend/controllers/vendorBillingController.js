const pool = require('../config/db');
const { generateVendorBill } = require('../services/billingSchedulerService');
const {
  recordPayment,
  recordFullPayment,
  listPayments,
} = require('../services/paymentLedgerService');

async function nextDebitNoteNumber() {
  const res = await pool.query(
    `UPDATE sm_document_sequences
     SET last_value = last_value + 1
     WHERE doc_type = 'vendor_debit_note'
     RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  return res.rows[0].number;
}

function parseMonthList(raw) {
  if (raw == null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(
    list.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
  )];
}

const GENERATE_SKIP_MESSAGES = {
  'No rental serials': 'This vendor has no rental or rent-to-own laptops received by the end of that month.',
  'No active serials in this month': 'No laptops were on rent for this vendor in that month.',
};

function generateSkipMessage(reason) {
  return GENERATE_SKIP_MESSAGES[reason] || reason || 'Nothing to bill for this vendor and month.';
}

exports.listBillableVendors = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.vendor_id,
              COALESCE(NULLIF(v.business_name, ''), v.first_name) AS vendor_name
       FROM vendors v
       WHERE v.deleted_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM vendor_purchase_orders vpo
             WHERE vpo.vendor_id = v.vendor_id
               AND vpo.deleted_at IS NULL
               AND vpo.purchase_order_type IN ('rental_purchase', 'rent_to_own')
           )
           OR EXISTS (
             SELECT 1 FROM vendor_monthly_bills vb
             WHERE vb.vendor_id = v.vendor_id
           )
         )
       ORDER BY vendor_name ASC, v.vendor_id`
    );
    res.json({ success: true, vendors: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listVendorBills = async (req, res) => {
  try {
    const {
      vendor_id,
      month,
      months,
      year,
      status,
      search,
      page = 1,
      limit = 25,
    } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(parseInt(limit, 10) || 25, 100);
    const params = [];
    const where = ['1=1'];
    if (vendor_id) {
      params.push(vendor_id);
      where.push(`vb.vendor_id = $${params.length}`);
    }
    const monthList = parseMonthList(months != null && String(months).trim() !== '' ? months : month);
    if (monthList.length === 1) {
      params.push(monthList[0]);
      where.push(`vb.bill_month = $${params.length}`);
    } else if (monthList.length > 1) {
      params.push(monthList);
      where.push(`vb.bill_month = ANY($${params.length}::int[])`);
    }
    if (year) {
      params.push(year);
      where.push(`vb.bill_year = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`vb.status = $${params.length}`);
    }
    const qSearch = String(search || '').trim();
    if (qSearch) {
      params.push(`%${qSearch}%`);
      const n = params.length;
      where.push(`(
        vb.bill_number ILIKE $${n}
        OR COALESCE(v.business_name, '') ILIKE $${n}
        OR COALESCE(v.first_name, '') ILIKE $${n}
        OR COALESCE(v.last_name, '') ILIKE $${n}
        OR COALESCE(vb.notes, '') ILIKE $${n}
      )`);
    }
    const whereSql = where.join(' AND ');
    const offset = (pageNum - 1) * pageSize;
    const listParams = [...params, pageSize, offset];

    const [listRes, countRes, summaryRes] = await Promise.all([
      pool.query(
        `SELECT vb.*, COALESCE(v.business_name, v.first_name) AS vendor_name,
                jsonb_array_length(COALESCE(vb.line_items, '[]'::jsonb)) AS unit_count
         FROM vendor_monthly_bills vb
         LEFT JOIN vendors v ON v.vendor_id = vb.vendor_id
         WHERE ${whereSql}
         ORDER BY vb.bill_year DESC, vb.bill_month DESC, vb.bill_id DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM vendor_monthly_bills vb
         LEFT JOIN vendors v ON v.vendor_id = vb.vendor_id
         WHERE ${whereSql}`,
        params
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE vb.status = 'generated')::int AS generated_count,
           COALESCE(SUM(vb.total_payable) FILTER (WHERE vb.status = 'generated'), 0) AS generated_total,
           COUNT(*) FILTER (WHERE vb.status = 'approved')::int AS approved_count,
           COALESCE(SUM(vb.total_payable) FILTER (WHERE vb.status = 'approved'), 0) AS approved_total,
           COUNT(*) FILTER (WHERE vb.status = 'paid')::int AS paid_count,
           COALESCE(SUM(vb.total_payable) FILTER (WHERE vb.status = 'paid'), 0) AS paid_total
         FROM vendor_monthly_bills vb
         LEFT JOIN vendors v ON v.vendor_id = vb.vendor_id
         WHERE ${whereSql}`,
        params
      ),
    ]);

    const total = countRes.rows[0]?.total || 0;

    res.json({
      success: true,
      bills: listRes.rows,
      summary: summaryRes.rows[0] || {},
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getVendorBill = async (req, res) => {
  try {
    const { billId } = req.params;
    const result = await pool.query(
      `SELECT vb.*, COALESCE(v.business_name, v.first_name) AS vendor_name, v.gst_number
       FROM vendor_monthly_bills vb
       LEFT JOIN vendors v ON v.vendor_id = vb.vendor_id
       WHERE vb.bill_id = $1`,
      [billId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    res.json({ success: true, bill: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.generateVendorBill = async (req, res) => {
  try {
    const { vendor_id, month, year } = req.body || {};
    if (!vendor_id || !month || !year) {
      return res.status(400).json({ success: false, message: 'vendor_id, month, year required' });
    }
    const result = await generateVendorBill(Number(vendor_id), Number(month), Number(year));
    if (result.skipped && !result.bill_id) {
      return res.status(422).json({
        success: false,
        skipped: true,
        reason: result.reason,
        message: generateSkipMessage(result.reason),
      });
    }
    const bill = await pool.query(
      `SELECT vb.*, COALESCE(v.business_name, v.first_name) AS vendor_name FROM vendor_monthly_bills vb
       LEFT JOIN vendors v ON v.vendor_id = vb.vendor_id
       WHERE vb.bill_id = $1`,
      [result.bill_id]
    );
    if (result.skipped) {
      const num = bill.rows[0]?.bill_number;
      return res.status(409).json({
        success: false,
        skipped: true,
        bill_id: result.bill_id,
        bill: bill.rows[0],
        message: num
          ? `Bill ${num} already exists for this vendor and month`
          : 'Bill already exists for this vendor and month',
      });
    }
    res.json({ success: true, ...result, bill: bill.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.approveVendorBill = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE vendor_monthly_bills
       SET status = 'approved', approved_by = $1, updated_at = NOW()
       WHERE bill_id = $2 AND status = 'generated'
       RETURNING *`,
      [req.user?.user_id || null, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Bill not found or not in generated status' });
    }
    res.json({ success: true, bill: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markVendorBillPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_reference, payment_date, method } = req.body || {};
    const result = await recordFullPayment(pool, {
      partyType: 'vendor',
      billId: Number(id),
      reference: payment_reference || null,
      method: method || 'adjustment',
      recordedBy: req.user?.user_id || null,
    });
    if (result.skipped) {
      const bill = await pool.query(`SELECT * FROM vendor_monthly_bills WHERE bill_id = $1`, [id]);
      if (!bill.rows.length) {
        return res.status(404).json({ success: false, message: 'Bill not found' });
      }
      return res.json({ success: true, bill: bill.rows[0], message: result.reason });
    }
    const bill = await pool.query(`SELECT * FROM vendor_monthly_bills WHERE bill_id = $1`, [id]);
    res.json({ success: true, bill: bill.rows[0], payment: result.payment });
  } catch (err) {
    res.status(err.message === 'Bill not found' ? 404 : 500).json({ success: false, message: err.message });
  }
};

exports.recordBillPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, payment_date, method, reference, notes } = req.body || {};
    if (!amount) {
      return res.status(400).json({ success: false, message: 'amount is required' });
    }
    const result = await recordPayment(pool, {
      partyType: 'vendor',
      billId: Number(id),
      amount,
      paymentDate: payment_date,
      method,
      reference,
      notes,
      recordedBy: req.user?.user_id || null,
    });
    const bill = await pool.query(`SELECT * FROM vendor_monthly_bills WHERE bill_id = $1`, [id]);
    res.status(201).json({
      success: true,
      payment: result.payment,
      amount_paid: result.amount_paid,
      status: result.status,
      bill: bill.rows[0],
    });
  } catch (err) {
    const code = err.message === 'Bill not found' ? 404 : 500;
    res.status(code).json({ success: false, message: err.message });
  }
};

exports.listBillPayments = async (req, res) => {
  try {
    const { billId, id } = req.params;
    const targetId = billId || id;
    const payments = await listPayments({ billId: Number(targetId) });
    const bill = await pool.query(
      `SELECT bill_id, total_payable, amount_paid, status FROM vendor_monthly_bills WHERE bill_id = $1`,
      [targetId]
    );
    if (!bill.rows.length) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    res.json({ success: true, payments, bill: bill.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.listDebitNotes = async (req, res) => {
  try {
    const { vendor_id, status } = req.query;
    const params = [];
    const where = ['1=1'];
    if (vendor_id) {
      params.push(vendor_id);
      where.push(`dn.vendor_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`dn.status = $${params.length}`);
    }
    const result = await pool.query(
      `SELECT dn.*, COALESCE(v.business_name, v.first_name) AS vendor_name
       FROM vendor_debit_notes dn
       LEFT JOIN vendors v ON v.vendor_id = dn.vendor_id
       WHERE ${where.join(' AND ')}
       ORDER BY dn.created_at DESC`,
      params
    );
    res.json({ success: true, debit_notes: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Auto-create a DRAFT debit note when a floor ticket Force-Fails a unit back to
 * the vendor. Amount starts at 0 for accounts to fill; linked to the return
 * ticket + serial + PO. Idempotent per return ticket. Runs on the given db
 * (pool or a caller's client).
 * @returns {Promise<object|null>} the debit note row, or null if skipped.
 */
async function createReturnDebitNote(db, { ticket, reason, actorUserId = null }) {
  const client = db || pool;
  if (!ticket || !ticket.vendor_serial_id) return null;

  const existing = await client.query(
    `SELECT debit_note_id FROM vendor_debit_notes WHERE return_ticket_id = $1`,
    [ticket.ticket_id]
  );
  if (existing.rows.length) return null; // already raised

  const vp = await client.query(
    `SELECT vpo.vendor_id, vpo.po_id,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
      WHERE vsn.serial_id = $1`,
    [ticket.vendor_serial_id]
  );
  if (!vp.rows.length || !vp.rows[0].vendor_id) return null;
  const { vendor_id, po_id, ttspl_id } = vp.rows[0];

  const dnNumber = await nextDebitNoteNumber();
  const ins = await client.query(
    `INSERT INTO vendor_debit_notes
      (debit_note_number, vendor_id, po_id, reason, description, amount,
       quantity, unit_rate, ttspl_ids, created_by, serial_id, return_ticket_id)
     VALUES ($1,$2,$3,$4,$5,0,1,0,$6::jsonb,$7,$8,$9)
     RETURNING *`,
    [
      dnNumber, vendor_id, po_id || null,
      'Return to vendor',
      `Unit ${ttspl_id || ticket.serial_number} returned to vendor via floor QC fail` +
        `${reason ? ` — ${reason}` : ''}. Set amount and approve to adjust the next vendor bill.`,
      JSON.stringify([ttspl_id].filter(Boolean)),
      actorUserId, ticket.vendor_serial_id, ticket.ticket_id,
    ]
  );
  console.log(`[vendor-return] Draft debit note ${dnNumber} for vendor ${vendor_id}, ticket ${ticket.ticket_id}`);
  return ins.rows[0];
}
exports.createReturnDebitNote = createReturnDebitNote;

exports.createDebitNote = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.vendor_id || !body.reason) {
      return res.status(400).json({ success: false, message: 'vendor_id and reason required' });
    }
    const dnNumber = await nextDebitNoteNumber();
    const amount = parseFloat(body.amount || 0);
    const result = await pool.query(
      `INSERT INTO vendor_debit_notes
        (debit_note_number, vendor_id, po_id, reason, description, amount,
         quantity, unit_rate, ttspl_ids, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       RETURNING *`,
      [
        dnNumber,
        body.vendor_id,
        body.po_id || null,
        body.reason,
        body.description || null,
        amount,
        body.quantity || 0,
        body.unit_rate || 0,
        JSON.stringify(body.ttspl_ids || []),
        req.user?.user_id || null,
      ]
    );
    res.status(201).json({ success: true, debit_note: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.approveDebitNote = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE vendor_debit_notes
       SET status = 'approved', approved_by = $1, updated_at = NOW()
       WHERE debit_note_id = $2 AND status = 'pending'
       RETURNING *`,
      [req.user?.user_id || null, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Debit note not found or not pending' });
    }
    res.json({ success: true, debit_note: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
