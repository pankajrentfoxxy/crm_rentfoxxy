/**
 * Exercises the customer portal HTTP endpoints against a running backend using a
 * temporary portal session. Usage: node scripts/verify-customer-portal-http.js [customerId]
 */
require('dotenv').config();
const crypto = require('crypto');
const pool = require('../config/db');

// Override with PORTAL_VERIFY_HOST when another process also listens on this port.
const HOST = process.env.PORTAL_VERIFY_HOST || 'localhost';
const BASE = `http://${HOST}:${process.env.PORT || 5001}/api/customer-portal`;

async function call(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { parseError: true };
  }
  return { status: res.status, body };
}

function summarize(path, { status, body }) {
  const ok = status === 200 && body.success;
  const detail = (() => {
    if (!ok) return body.message || `HTTP ${status}`;
    if (body.kpis) return JSON.stringify(body.kpis);
    if (body.orders) return `${body.orders.length} row(s), total ${body.pagination?.total}`;
    if (body.tickets) return `${body.tickets.length} row(s), total ${body.pagination?.total}`;
    if (body.laptops) return `${body.laptops.length} row(s), total ${body.pagination?.total}`;
    if (body.deliveries) return `${body.deliveries.length} row(s), total ${body.pagination?.total}`;
    if (body.order) return `SO detail: ${body.order.lines.length} line(s), ${body.order.delivery_challans.length} DC(s)`;
    if (body.ticket) return `ticket detail: stage=${body.ticket.stage}, ${body.ticket.items.length} item(s)`;
    if (body.delivery) return `DC detail: status=${body.delivery.status}, ${body.delivery.units.length} unit(s)`;
    if (body.invoices) return `${body.invoices.length} invoice(s)`;
    return 'ok';
  })();
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${status}  ${path}\n          ${detail}`);
  return ok;
}

async function main() {
  let customerId = Number(process.argv[2]) || 0;
  if (!customerId) {
    // The middleware rejects customers without portal access, so pick one that
    // is enabled and actually has orders to look at.
    const { rows } = await pool.query(
      `SELECT c.customer_id
         FROM customers c
        WHERE c.portal_enabled = TRUE
          AND EXISTS (SELECT 1 FROM sales_order_lines s WHERE s.customer_id = c.customer_id)
        ORDER BY (SELECT COUNT(*) FROM sales_order_lines s WHERE s.customer_id = c.customer_id) DESC
        LIMIT 1`
    );
    if (!rows.length) {
      console.log('No portal-enabled customer with orders found.');
      await pool.end();
      return;
    }
    customerId = rows[0].customer_id;
  }
  const token = crypto.randomBytes(48).toString('hex');
  await pool.query(
    `INSERT INTO customer_portal_sessions (customer_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
    [customerId, token]
  );
  console.log(`Temporary session created for customer ${customerId}\n`);

  let allOk = true;
  const check = async (path) => {
    const result = await call(token, path);
    allOk = summarize(path, result) && allOk;
    return result.body;
  };

  try {
    console.log('Core lists');
    await check('/me');
    await check('/dashboard');
    const orders = await check('/orders?limit=3');
    const tickets = await check('/tickets?limit=3');
    await check('/laptops?limit=3');
    const deliveries = await check('/deliveries?limit=3');
    await check('/invoices');

    console.log('\nFilters');
    await check('/orders?order_status=active&limit=2');
    await check('/orders?order_status=delivered&limit=2');
    await check('/orders?delivery_status=delivered&limit=2');
    await check('/orders?order_type=replacement&limit=2');
    await check('/orders?search=SO&limit=2');
    await check('/orders?date_from=2020-01-01&date_to=2030-01-01&limit=2');
    await check('/tickets?ticket_type=pickup&limit=2');
    await check('/tickets?status=closed&limit=2');
    await check('/tickets?stage=closed&limit=2');
    await check('/laptops?lifecycle=returned&limit=2');
    await check('/laptops?search=TTSPL&limit=2');
    await check('/deliveries?status=delivered&limit=2');
    await check('/deliveries?status=in_transit&limit=2');

    console.log('\nDetail routes (slash-containing document numbers)');
    if (orders.orders?.[0]) {
      await check(`/orders/${encodeURIComponent(orders.orders[0].sales_order_number)}`);
    }
    if (tickets.tickets?.[0]) {
      await check(`/tickets/${tickets.tickets[0].ticket_id}`);
    }
    if (deliveries.deliveries?.[0]) {
      await check(`/deliveries/${encodeURIComponent(deliveries.deliveries[0].dc_number)}`);
    }

    console.log('\nAuthorization (each must be rejected)');
    const { rows: foreign } = await pool.query(
      `SELECT sales_order_number FROM sales_order_lines
        WHERE customer_id IS NOT NULL AND customer_id <> $1 LIMIT 1`,
      [customerId]
    );
    const { rows: foreignDc } = await pool.query(
      `SELECT dc_number FROM delivery_challan_lines
        WHERE customer_id IS NOT NULL AND customer_id <> $1 LIMIT 1`,
      [customerId]
    );
    const { rows: foreignTicket } = await pool.query(
      `SELECT id FROM support_tickets WHERE customer_id <> $1
         AND COALESCE(portal_customer_id, -1) <> $1 LIMIT 1`,
      [customerId]
    );

    const mustReject = async (path) => {
      const { status, body } = await call(token, path);
      const rejected = status === 404 || status === 400 || body.success === false;
      console.log(`  ${rejected ? 'PASS' : 'FAIL — LEAK'}  ${status}  ${path}`);
      allOk = rejected && allOk;
    };
    if (foreign[0]) await mustReject(`/orders/${encodeURIComponent(foreign[0].sales_order_number)}`);
    if (foreignDc[0]) await mustReject(`/deliveries/${encodeURIComponent(foreignDc[0].dc_number)}`);
    if (foreignTicket[0]) await mustReject(`/tickets/${foreignTicket[0].id}`);

    console.log('\nTicket creation');
    const post = async (body) => {
      const res = await fetch(`${BASE}/tickets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };

    // A laptop belonging to somebody else must be refused.
    const { rows: foreignAsset } = await pool.query(
      `SELECT COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl
         FROM vendor_serial_numbers
        WHERE current_customer_id IS NOT NULL AND current_customer_id <> $1
          AND deleted_at IS NULL
          AND COALESCE(inventory_asset_code, extra->>'ttspl_id') IS NOT NULL
        LIMIT 1`,
      [customerId]
    );
    if (foreignAsset[0]) {
      const res = await post({
        subject: 'Cross-tenant probe',
        description: 'This request references a laptop that belongs to another customer.',
        ticket_type: 'Laptop Not Working',
        ttspl_id: foreignAsset[0].ttspl,
      });
      const blocked = res.status === 400;
      console.log(`  ${blocked ? 'PASS' : 'FAIL — LEAK'}  ${res.status}  POST /tickets with another customer's TTSPL (${foreignAsset[0].ttspl})`);
      console.log(`          ${res.body.message || ''}`);
      allOk = blocked && allOk;
    }

    // Own laptop must be accepted, then rolled back.
    const { rows: ownAsset } = await pool.query(
      `SELECT COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl
         FROM vendor_serial_numbers
        WHERE current_customer_id = $1 AND deleted_at IS NULL
          AND COALESCE(inventory_asset_code, extra->>'ttspl_id') IS NOT NULL
        LIMIT 1`,
      [customerId]
    );
    if (ownAsset[0]) {
      const res = await post({
        subject: 'Portal verification ticket',
        description: 'Automated verification of the customer portal ticket creation flow.',
        ticket_type: 'Laptop Not Working',
        ttspl_id: ownAsset[0].ttspl,
      });
      const created = res.status === 201 && res.body.ticket_id;
      console.log(`  ${created ? 'PASS' : 'FAIL'}  ${res.status}  POST /tickets with own TTSPL (${ownAsset[0].ttspl})`);
      allOk = Boolean(created) && allOk;

      if (created) {
        const detail = await call(token, `/tickets/${res.body.ticket_id}`);
        const visible = detail.status === 200 && detail.body.ticket?.stage === 'received';
        console.log(`  ${visible ? 'PASS' : 'FAIL'}  ${detail.status}  new ticket readable, stage=${detail.body.ticket?.stage}, ttspl=${detail.body.ticket?.ttspl_id}`);
        allOk = visible && allOk;

        await pool.query(`DELETE FROM support_ticket_items WHERE ticket_id = $1`, [res.body.ticket_id]);
        await pool.query(`DELETE FROM support_tickets WHERE id = $1`, [res.body.ticket_id]);
        console.log(`          cleaned up test ticket ${res.body.ticket_number}`);
      }
    }

    console.log('\nUnauthenticated');
    const noAuth = await fetch(`${BASE}/dashboard`);
    console.log(`  ${noAuth.status === 401 ? 'PASS' : 'FAIL'}  ${noAuth.status}  /dashboard without a token`);
    allOk = noAuth.status === 401 && allOk;

    console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
    process.exitCode = allOk ? 0 : 1;
  } finally {
    await pool.query(`DELETE FROM customer_portal_sessions WHERE token = $1`, [token]);
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
});
