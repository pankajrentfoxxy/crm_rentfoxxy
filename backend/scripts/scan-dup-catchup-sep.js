'use strict';

require('dotenv').config();
const pool = require('../config/db');

(async () => {
  const { rows } = await pool.query(`
    SELECT ci.invoice_id, ci.invoice_number, ci.customer_id,
           COALESCE(NULLIF(c.company_name, ''), c.name) AS customer,
           elem->>'ttspl_id' AS ttspl,
           (elem->>'serial_id')::int AS serial_id,
           COUNT(*) FILTER (
             WHERE COALESCE(elem->>'line_type', 'rental') <> 'security'
               AND COALESCE(elem->>'is_security', 'false') NOT IN ('true', 't', '1')
               AND LOWER(COALESCE(elem->>'is_catchup', 'false')) IN ('true', 't', '1', 'yes')
           )::int AS catchup_n,
           COUNT(*) FILTER (
             WHERE COALESCE(elem->>'line_type', 'rental') <> 'security'
               AND COALESCE(elem->>'is_security', 'false') NOT IN ('true', 't', '1')
               AND LOWER(COALESCE(elem->>'is_catchup', 'false')) NOT IN ('true', 't', '1', 'yes')
           )::int AS month_n,
           json_agg(
             json_build_object(
               'catchup', elem->>'is_catchup',
               'start', LEFT(elem->>'rent_start', 10),
               'end', LEFT(elem->>'rent_end', 10),
               'amt', elem->>'amount'
             )
             ORDER BY LEFT(elem->>'rent_start', 10)
           ) FILTER (
             WHERE COALESCE(elem->>'line_type', 'rental') <> 'security'
               AND COALESCE(elem->>'is_security', 'false') NOT IN ('true', 't', '1')
           ) AS spans
      FROM customer_invoices ci
      LEFT JOIN customers c ON c.customer_id = ci.customer_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ci.line_items) = 'array' THEN ci.line_items ELSE '[]'::jsonb END
      ) elem
     WHERE ci.invoice_month = 9 AND ci.invoice_year = 2026
       AND ci.status <> 'cancelled'
     GROUP BY ci.invoice_id, ci.invoice_number, ci.customer_id, c.company_name, c.name,
              elem->>'ttspl_id', elem->>'serial_id'
    HAVING COUNT(*) FILTER (
             WHERE COALESCE(elem->>'line_type', 'rental') <> 'security'
               AND COALESCE(elem->>'is_security', 'false') NOT IN ('true', 't', '1')
               AND LOWER(COALESCE(elem->>'is_catchup', 'false')) IN ('true', 't', '1', 'yes')
           ) > 1
        OR COUNT(*) FILTER (
             WHERE COALESCE(elem->>'line_type', 'rental') <> 'security'
               AND COALESCE(elem->>'is_security', 'false') NOT IN ('true', 't', '1')
               AND LOWER(COALESCE(elem->>'is_catchup', 'false')) NOT IN ('true', 't', '1', 'yes')
           ) > 1
     ORDER BY ci.invoice_number, ttspl
  `);
  console.log('dup groups', rows.length);
  for (const r of rows) {
    console.log(`${r.invoice_number} ${r.customer} ${r.ttspl} cu=${r.catchup_n} mo=${r.month_n} ${JSON.stringify(r.spans)}`);
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
