/**
 * Demo lifecycle — list demo agreements and record the delivery+7d keep/return
 * decision. "Keep" converts the unit to a rental with an agreed billing-start
 * date; "return" raises a support pickup ticket (the support pickup flow then
 * returns the unit to inventory via the state machine).
 */
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { isRestricted, isCustomerTypeAllowed } = require('../services/customerAccessScope');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD, or null. */
function validYmd(v) {
  if (typeof v !== 'string' || !YMD.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

exports.listDemoAgreements = async (req, res) => {
  try {
    const { status } = req.query; // pending | overdue | decided
    const search = (req.query.search || '').trim();
    const params = [];
    let where = '1=1';
    if (status === 'pending') where = "d.decision = 'pending'";
    else if (status === 'overdue') where = "d.decision = 'pending' AND d.decision_due_at < NOW()";
    else if (status === 'decided') where = "d.decision <> 'pending'";

    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      where += ` AND (
        d.ttspl_id ILIKE $${i}
        OR CAST(d.customer_id AS TEXT) LIKE $${i}
        OR COALESCE(c.company_name, '') ILIKE $${i}
        OR COALESCE(c.name, '') ILIKE $${i}
        OR EXISTS (
          SELECT 1 FROM vendor_serial_numbers vsn
           WHERE vsn.serial_id = d.serial_id
             AND vsn.serial_number ILIKE $${i}
        )
      )`;
    }

    // Customer Access scope — hide demos for customers outside the caller's scope
    if (isRestricted(req.allowedCustomerTypes)) {
      params.push(req.allowedCustomerTypes);
      where += ` AND (d.customer_id IS NULL OR c.customer_type = ANY($${params.length}::text[]))`;
    }

    const { rows } = await pool.query(
      `SELECT d.*, c.company_name, c.name AS customer_name,
              vsn.serial_number, vsn.rent_monthly_rate, c.customer_type,
              (d.decision = 'pending' AND d.decision_due_at < NOW()) AS is_overdue
         FROM demo_agreements d
         LEFT JOIN customers c ON c.customer_id = d.customer_id
         LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = d.serial_id
        WHERE ${where}
        ORDER BY d.decision_due_at ASC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('listDemoAgreements:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.decideDemo = async (req, res) => {
  const client = await pool.connect();
  try {
    const demoId = parseInt(req.params.demoId, 10);
    const { decision } = req.body || {};
    if (!['keep', 'return'].includes(decision)) {
      return res.status(400).json({ success: false, message: "decision must be 'keep' or 'return'" });
    }
    // Keep: billing start must be a real date and the rate, when given, a positive number.
    let keepStart = null;
    let keepRate = null;
    if (decision === 'keep') {
      const rawStart = req.body.rent_start_date;
      keepStart = rawStart == null || rawStart === '' ? new Date().toISOString().slice(0, 10) : validYmd(String(rawStart));
      if (!keepStart) {
        return res.status(400).json({ success: false, message: 'Billing start date must be a valid date (YYYY-MM-DD)' });
      }
      const rawRate = req.body.monthly_rate;
      if (rawRate != null && rawRate !== '') {
        keepRate = Number(rawRate);
        if (!Number.isFinite(keepRate) || keepRate <= 0) {
          return res.status(400).json({ success: false, message: 'Monthly rate must be a positive number' });
        }
      }
    }

    await client.query('BEGIN');
    const dRes = await client.query('SELECT * FROM demo_agreements WHERE demo_id = $1 FOR UPDATE', [demoId]);
    if (!dRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Demo agreement not found' });
    }
    const demo = dRes.rows[0];
    // Customer Access scope: the list hides these demos, so deciding one is refused too.
    if (isRestricted(req.allowedCustomerTypes) && demo.customer_id) {
      const ct = await client.query('SELECT customer_type FROM customers WHERE customer_id = $1', [demo.customer_id]);
      if (!isCustomerTypeAllowed(req.allowedCustomerTypes, ct.rows[0]?.customer_type)) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Demo agreement not found' });
      }
    }
    if (demo.decision !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: `Already decided: ${demo.decision}` });
    }

    if (decision === 'keep') {
      const rentStartDate = keepStart;
      let monthlyRate = keepRate;
      if (demo.serial_id) {
        if (monthlyRate == null) {
          const rateRes = await client.query(
            `SELECT rent_monthly_rate FROM vendor_serial_numbers WHERE serial_id = $1`,
            [demo.serial_id]
          );
          monthlyRate = parseFloat(rateRes.rows[0]?.rent_monthly_rate) || null;
        }
        await inventorySM.convertDemoToRental(client, demo.serial_id, {
          rentStartDate,
          rentMonthlyRate: monthlyRate,
          actorUserId: req.user.user_id,
          actorName: req.user.name,
        });
      }
      await client.query(
        `UPDATE demo_agreements
            SET decision='keep', decided_at=NOW(), decided_by=$2, rent_start_date=$3, updated_at=NOW()
          WHERE demo_id=$1`,
        [demoId, req.user.user_id, rentStartDate]
      );
    } else {
      // return -> raise a support pickup ticket; support completion returns the unit.
      const custRes = await client.query(
        `SELECT name, company_name, phone FROM customers WHERE customer_id = $1`,
        [demo.customer_id]
      );
      const cust = custRes.rows[0] || {};
      const tRes = await client.query(
        `INSERT INTO support_tickets
           (customer_id, customer_name, customer_phone, status, created_by, last_activity_at,
            priority, top_level_remarks, ticket_category, ttspl_id)
         VALUES ($1, $2, $3, 'open', $4, NOW(),
            'high', $5, 'pickup', $6)
         RETURNING id`,
        [demo.customer_id, cust.name || cust.company_name || 'Customer', cust.phone || null,
         req.user.user_id,
         `Demo return pickup for ${demo.ttspl_id || ''}`.trim(), demo.ttspl_id]
      );
      const pickupTicketId = tRes.rows[0].id;
      await client.query(
        `UPDATE demo_agreements
            SET decision='return', decided_at=NOW(), decided_by=$2,
                pickup_ticket_id=$3, updated_at=NOW()
          WHERE demo_id=$1`,
        [demoId, req.user.user_id, pickupTicketId]
      );
    }

    await client.query('COMMIT');

    if (decision === 'keep' && demo.customer_id && demo.serial_id) {
      try {
        const { maybeInvoiceOnRentalDelivery } = require('../services/billingSchedulerService');
        await maybeInvoiceOnRentalDelivery({
          customerId: demo.customer_id,
          serialIds: [demo.serial_id],
          quotationType: 'rental',
        });
      } catch (billingErr) {
        console.error('decideDemo on-delivery invoice:', billingErr.message);
      }
    }

    res.json({ success: true, message: `Demo marked '${decision}'` });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('decideDemo:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};
