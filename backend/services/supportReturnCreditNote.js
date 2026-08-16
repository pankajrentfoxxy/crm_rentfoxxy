'use strict';

const { calcReturnCreditNoteAmount, toLocalYmd } = require('./billingMath');

async function nextCreditNoteNumber(client) {
  try {
    const num = await client.query(
      `UPDATE sm_document_sequences SET last_value = last_value + 1
        WHERE doc_type = 'credit_note'
        RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
    );
    if (num.rows[0] && num.rows[0].number) return num.rows[0].number;
  } catch (e) {
    console.error('return credit note sequence:', e);
  }
  return `CN-${Date.now()}`;
}

async function findExisting(client, serialId, woId) {
  const r = await client.query(
    `SELECT * FROM customer_credit_notes
      WHERE serial_id = $1 AND wo_id = $2
      LIMIT 1`,
    [serialId, woId]
  );
  return r.rows[0] || null;
}

/**
 * PLAN D10 — the only place a return credit note is raised.
 * Unique (serial_id, wo_id) makes a retry or double-click a no-op.
 */
async function raiseReturnCreditNoteOnce(client, {
  serialId, customerId, stopDate, woId, actorUserId = null,
}) {
  if (!serialId || !woId) return null;
  if (woId) {
    const wo = (await client.query(
      `SELECT replacement_group_id FROM support_work_orders WHERE wo_id = $1`,
      [woId]
    ).catch(() => ({ rows: [] }))).rows[0];
    if (wo && wo.replacement_group_id) {
      const { sameDaySameRate } = require('./supportReplacementService');
      if (await sameDaySameRate(client, wo)) return null;
    }
  }
  const existing = await findExisting(client, serialId, woId);
  if (existing) return existing;

  const r = await client.query(
    `SELECT serial_id, current_customer_id,
            COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl_id,
            rent_billed_until, rent_monthly_rate
       FROM vendor_serial_numbers WHERE serial_id = $1`,
    [serialId]
  );
  const s = r.rows[0];
  if (!s) return null;

  const custId = customerId || s.current_customer_id;
  if (!custId) return null;

  const returnDate = stopDate || toLocalYmd(new Date());
  const calc = calcReturnCreditNoteAmount({
    rentMonthlyRate: s.rent_monthly_rate,
    returnDate,
    rentBilledUntil: s.rent_billed_until,
  });
  const amount = calc ? calc.amount : 0;
  const unusedDays = calc ? calc.unusedDays : 0;
  const dailyRate = calc ? calc.dailyRate : 0;
  const fromDate = calc ? toLocalYmd(calc.refundStart) : returnDate;
  const toDate = calc ? toLocalYmd(calc.billedUntil) : returnDate;
  const description = calc
    ? `Unit ${s.ttspl_id || s.serial_id} returned on ${returnDate}; ${unusedDays} prepaid day(s) refunded.`
    : `Unit ${s.ttspl_id || s.serial_id} returned on ${returnDate}; no unused prepaid days.`;

  const cnNumber = await nextCreditNoteNumber(client);
  try {
    const ins = await client.query(
      `INSERT INTO customer_credit_notes
        (credit_note_number, customer_id, reason, description, amount,
         quantity, unit_rate, from_date, to_date, ttspl_ids, status, created_by,
         serial_id, wo_id, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'pending',$11,$12,$13,'return_pickup')
       RETURNING *`,
      [
        cnNumber, custId,
        'Rental return — unused prepaid days',
        description,
        amount, unusedDays, dailyRate,
        fromDate, toDate,
        JSON.stringify([s.ttspl_id].filter(Boolean)),
        actorUserId,
        serialId, woId,
      ]
    );
    return ins.rows[0];
  } catch (e) {
    if (e.code === '23505') return findExisting(client, serialId, woId);
    throw e;
  }
}

module.exports = { raiseReturnCreditNoteOnce, nextCreditNoteNumber };
