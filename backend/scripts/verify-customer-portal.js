/**
 * Smoke-checks the customer portal read models against real data.
 * Usage: node scripts/verify-customer-portal.js [customerId]
 */
require('dotenv').config();
const pool = require('../config/db');
const svc = require('../services/customerPortalService');

async function main() {
  const wanted = process.argv[2] ? Number(process.argv[2]) : null;

  // Prefer customers that actually have orders so the checks are meaningful.
  const { rows } = wanted
    ? await pool.query(
      `SELECT customer_id, COALESCE(company_name, name) AS n FROM customers WHERE customer_id = $1`,
      [wanted]
    )
    : await pool.query(
      `SELECT c.customer_id, COALESCE(c.company_name, c.name) AS n
         FROM customers c
        WHERE EXISTS (SELECT 1 FROM sales_order_lines s WHERE s.customer_id = c.customer_id)
        ORDER BY c.customer_id
        LIMIT 3`
    );

  if (!rows.length) {
    console.log('No matching customers found.');
    return;
  }

  for (const c of rows) {
    const id = c.customer_id;
    console.log(`\n=== customer ${id} — ${c.n}`);

    const kpis = await svc.getCustomerDashboard(id);
    console.log('  dashboard:', JSON.stringify(kpis));

    const orders = await svc.listCustomerOrders(id, { limit: 3 });
    console.log(`  orders: total=${orders.pagination.total}`);
    if (orders.orders[0]) {
      const o = orders.orders[0];
      console.log('    first:', JSON.stringify({
        so: o.sales_order_number,
        type: o.order_type,
        qty: o.quantity,
        dcs: o.dc_numbers,
        delivery: o.delivery_status,
        order: o.order_status,
        payment: o.payment_status,
        items: o.items.length,
      }));
      const detail = await svc.getCustomerOrder(id, o.sales_order_number);
      console.log('    detail:', detail
        ? JSON.stringify({
          lines: detail.lines.length,
          serials: detail.serials.length,
          dcs: detail.delivery_challans.length,
          payments: detail.payments.length,
          total: detail.total_value,
        })
        : 'NULL');
    }

    const tickets = await svc.listCustomerTickets(id, { limit: 3 });
    console.log(`  tickets: total=${tickets.pagination.total}`);
    if (tickets.tickets[0]) {
      const t = tickets.tickets[0];
      console.log('    first:', JSON.stringify({
        no: t.ticket_number,
        type: t.ticket_type,
        ttspl: t.ttspl_id,
        stage: t.stage,
        label: t.stage_label,
        status: t.status,
      }));
      const td = await svc.getCustomerTicket(id, t.ticket_id);
      console.log('    detail:', td ? `${td.items.length} item(s), stage=${td.stage}` : 'NULL');
    }

    const laptops = await svc.listCustomerLaptops(id, { limit: 3 });
    console.log(`  laptops: total=${laptops.pagination.total}`);
    if (laptops.laptops[0]) {
      console.log('    first:', JSON.stringify({
        ttspl: laptops.laptops[0].ttspl_id,
        config: laptops.laptops[0].config,
        status: laptops.laptops[0].status,
      }));
    }

    const dels = await svc.listCustomerDeliveries(id, { limit: 3 });
    console.log(`  deliveries: total=${dels.pagination.total}`);
    if (dels.deliveries[0]) {
      const dc = dels.deliveries[0].dc_number;
      const dd = await svc.getCustomerDelivery(id, dc);
      console.log(`    detail ${dc}:`, dd
        ? `status=${dd.status} units=${dd.units.length} timeline=${dd.timeline.length}`
        : 'NULL');
    }

    // Cross-tenant guard: another customer's order must not resolve.
    const { rows: other } = await pool.query(
      `SELECT sales_order_number FROM sales_order_lines
        WHERE customer_id IS NOT NULL AND customer_id <> $1 LIMIT 1`,
      [id]
    );
    if (other[0]) {
      const leak = await svc.getCustomerOrder(id, other[0].sales_order_number);
      console.log(`  cross-tenant order ${other[0].sales_order_number}:`,
        leak ? 'LEAKED (BUG)' : 'blocked (ok)');
    }
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('FAILED:', err.message);
    console.error(err.stack.split('\n').slice(0, 8).join('\n'));
    pool.end();
    process.exitCode = 1;
  });
