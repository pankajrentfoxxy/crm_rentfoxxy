'use strict';

const pool = require('../config/db');
const logger = require('../utils/logger');
const { toLocalYmd } = require('./billingMath');
const { recordSecurityDeposits, perUnitSecurity } = require('./billingSecurityService');

const billingLog = logger.child ? logger.child({ module: 'billing-zoho' }) : logger;

async function loadZohoBillingAcks(client, customerId, serialIds) {
  const ids = [...new Set((serialIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  const bySerial = new Map();
  if (!customerId || !ids.length) return bySerial;
  const { rows } = await client.query(
    `SELECT serial_id, rent_billed_through, security_billed, security_amount,
            invoice_id, external_invoice_ref, source
       FROM customer_serial_billing_ack
      WHERE customer_id = $1
        AND serial_id = ANY($2::int[])`,
    [customerId, ids]
  );
  for (const row of rows) {
    bySerial.set(Number(row.serial_id), {
      ...row,
      rent_billed_through: row.rent_billed_through
        ? String(row.rent_billed_through).slice(0, 10)
        : null,
      security_billed: Boolean(row.security_billed),
    });
  }
  return bySerial;
}

function laterOfDates(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

async function listZohoCandidates(clientOrPool, { customerId, invoiceId, invoiceMonth, invoiceYear }) {
  const monthEnd = invoiceMonth && invoiceYear
    ? toLocalYmd(new Date(invoiceYear, invoiceMonth, 0))
    : null;
  const { rows } = await clientOrPool.query(
    `SELECT vsn.serial_id,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
            vsn.serial_number,
            vsn.current_dc_number AS dc_number,
            vsn.rent_start_date::text AS rent_start_date,
            COALESCE(vsn.delivered_at::date, vsn.rent_start_date, vsn.dispatched_at::date)::text AS delivery_date,
            vsn.rent_monthly_rate,
            ack.ack_id IS NOT NULL AS already_zoho,
            ack.rent_billed_through::text AS zoho_billed_through,
            ack.security_billed AS zoho_security_billed,
            ack.external_invoice_ref
       FROM vendor_serial_numbers vsn
       LEFT JOIN customer_serial_billing_ack ack
         ON ack.customer_id = $1
        AND ack.serial_id = vsn.serial_id
      WHERE vsn.current_customer_id = $1
        AND vsn.deleted_at IS NULL
        AND vsn.inventory_status IN ('rented', 'returned', 'in_transit')
        AND vsn.rent_start_date IS NOT NULL
        AND ($2::date IS NULL OR vsn.rent_start_date <= $2::date)
      ORDER BY COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id')`,
    [customerId, monthEnd]
  );

  let onInvoice = new Set();
  if (invoiceId) {
    const inv = await clientOrPool.query(
      `SELECT line_items FROM customer_invoices WHERE invoice_id = $1`,
      [invoiceId]
    );
    const lines = Array.isArray(inv.rows[0]?.line_items) ? inv.rows[0].line_items : [];
    for (const line of lines) {
      if (line?.serial_id) onInvoice.add(Number(line.serial_id));
    }
  }

  return rows.map((row) => ({
    ...row,
    on_invoice: onInvoice.has(Number(row.serial_id)),
  }));
}

async function markInvoiceGeneratedOnZoho({
  invoiceId,
  serialIds,
  rentBilledThrough,
  includeSecurity = true,
  externalReference = null,
  actorUserId = null,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invRes = await client.query(
      `SELECT invoice_id, invoice_number, customer_id, status,
              invoice_month, invoice_year, to_date, billing_source
         FROM customer_invoices
        WHERE invoice_id = $1
        FOR UPDATE`,
      [invoiceId]
    );
    const inv = invRes.rows[0];
    if (!inv) {
      await client.query('ROLLBACK');
      return { error: 'Invoice not found', status: 404 };
    }
    if (String(inv.status || '').toLowerCase() === 'cancelled') {
      await client.query('ROLLBACK');
      return { error: 'Cancelled invoices cannot be marked as Zoho', status: 400 };
    }

    const ids = [...new Set((serialIds || []).map((id) => Number(id)).filter((id) => id > 0))];
    if (!ids.length) {
      await client.query('ROLLBACK');
      return { error: 'Select at least one laptop billed on Zoho', status: 400 };
    }

    const through = String(rentBilledThrough || inv.to_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) {
      await client.query('ROLLBACK');
      return { error: 'rent_billed_through is required (YYYY-MM-DD)', status: 400 };
    }

    const serials = await client.query(
      `SELECT vsn.serial_id,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
              vsn.serial_number,
              vsn.current_dc_number AS dc_number,
              vsn.rent_monthly_rate,
              COALESCE(vsn.delivered_at::date, vsn.rent_start_date, vsn.dispatched_at::date)::text AS delivery_date,
              sos.sales_order_number,
              sol.security_type,
              sol.security_amount,
              sol.rate,
              sol.main_qty,
              sol.quantity
         FROM vendor_serial_numbers vsn
         LEFT JOIN LATERAL (
           SELECT sos.sales_order_number, sos.line_id
             FROM sales_order_serials sos
            WHERE sos.serial_id = vsn.serial_id
              AND COALESCE(sos.status, '') <> 'removed'
            ORDER BY sos.allocation_id DESC
            LIMIT 1
         ) sos ON TRUE
         LEFT JOIN sales_order_lines sol ON sol.id = sos.line_id
        WHERE vsn.serial_id = ANY($1::int[])
          AND vsn.current_customer_id = $2`,
      [ids, inv.customer_id]
    );
    if (!serials.rows.length) {
      await client.query('ROLLBACK');
      return { error: 'None of the selected laptops belong to this customer', status: 400 };
    }

    const ref = String(externalReference || '').trim() || null;
    const securityLines = [];
    const marked = [];

    for (const row of serials.rows) {
      const securityAmount = includeSecurity ? perUnitSecurity(row) : 0;
      await client.query(
        `INSERT INTO customer_serial_billing_ack
          (customer_id, serial_id, source, external_invoice_ref, rent_billed_through,
           security_billed, security_amount, invoice_id, created_by, updated_at)
         VALUES ($1,$2,'zoho',$3,$4::date,$5,$6,$7,$8,NOW())
         ON CONFLICT (customer_id, serial_id)
         DO UPDATE SET
           source = 'zoho',
           external_invoice_ref = COALESCE(EXCLUDED.external_invoice_ref, customer_serial_billing_ack.external_invoice_ref),
           rent_billed_through = GREATEST(customer_serial_billing_ack.rent_billed_through, EXCLUDED.rent_billed_through),
           security_billed = customer_serial_billing_ack.security_billed OR EXCLUDED.security_billed,
           security_amount = COALESCE(EXCLUDED.security_amount, customer_serial_billing_ack.security_amount),
           invoice_id = EXCLUDED.invoice_id,
           updated_at = NOW()`,
        [
          inv.customer_id,
          row.serial_id,
          ref,
          through,
          includeSecurity && securityAmount > 0,
          securityAmount > 0 ? securityAmount : null,
          inv.invoice_id,
          actorUserId,
        ]
      );

      await client.query(
        `UPDATE vendor_serial_numbers
            SET rent_billed_until = CASE
                  WHEN rent_billed_until IS NULL THEN $1::date
                  WHEN rent_billed_until < $1::date THEN $1::date
                  ELSE rent_billed_until
                END,
                updated_at = NOW()
          WHERE serial_id = $2`,
        [through, row.serial_id]
      );

      if (includeSecurity && securityAmount > 0) {
        securityLines.push({
          line_type: 'security',
          is_security: true,
          serial_id: row.serial_id,
          ttspl_id: row.ttspl_id || null,
          serial_number: row.serial_number,
          dc_number: row.dc_number,
          sales_order_number: row.sales_order_number,
          delivery_date: String(row.delivery_date || through).slice(0, 10),
          rent_start: String(row.delivery_date || through).slice(0, 10),
          amount: securityAmount,
        });
      }

      marked.push({
        serial_id: row.serial_id,
        ttspl_id: row.ttspl_id,
        rent_billed_through: through,
        security_billed: includeSecurity && securityAmount > 0,
      });
    }

    if (securityLines.length) {
      await recordSecurityDeposits(client, {
        customerId: inv.customer_id,
        invoiceId: inv.invoice_id,
        invoiceNumber: inv.invoice_number,
        lines: securityLines,
        actorUserId,
      });
      await client.query(
        `UPDATE customer_security_deposits
            SET invoice_id = $1,
                notes = CASE
                  WHEN notes ILIKE '%zoho%' THEN notes
                  ELSE TRIM(BOTH ' · ' FROM COALESCE(notes, '') || ' · billed on Zoho')
                END
          WHERE customer_id = $2
            AND serial_id = ANY($3::int[])
            AND status <> 'refunded'`,
        [inv.invoice_id, inv.customer_id, serials.rows.map((r) => r.serial_id)]
      );
    }

    const noteBit = [
      'Generated on Zoho',
      ref ? `ref ${ref}` : null,
      `laptops ${marked.map((m) => m.ttspl_id || m.serial_id).join(', ')}`,
      `rent through ${through}`,
      includeSecurity ? 'security billed' : null,
    ].filter(Boolean).join(' · ');

    await client.query(
      `UPDATE customer_invoices
          SET billing_source = 'zoho',
              external_reference = COALESCE($1, external_reference),
              notes = CASE
                WHEN COALESCE(notes, '') = '' THEN $2
                WHEN notes ILIKE '%Generated on Zoho%' THEN notes
                ELSE notes || E'\n' || $2
              END,
              status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
              sent_at = COALESCE(sent_at, NOW()),
              updated_at = NOW()
        WHERE invoice_id = $3`,
      [ref, noteBit, inv.invoice_id]
    );

    await client.query('COMMIT');
    billingLog.info(
      { invoiceNumber: inv.invoice_number, customerId: inv.customer_id, marked: marked.length, through },
      'Invoice marked generated on Zoho'
    );
    return {
      invoice_id: inv.invoice_id,
      invoice_number: inv.invoice_number,
      billing_source: 'zoho',
      external_reference: ref,
      serials: marked,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  loadZohoBillingAcks,
  laterOfDates,
  listZohoCandidates,
  markInvoiceGeneratedOnZoho,
};
