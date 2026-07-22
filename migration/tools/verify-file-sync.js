require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');

(async () => {
  const c = getCrmPool();
  const checks = [
    `SELECT COUNT(*) FILTER (WHERE pod_image_url LIKE 'uploads/legacy/%') AS ok,
            COUNT(*) FILTER (WHERE pod_image_url IS NOT NULL AND TRIM(pod_image_url) <> ''
              AND pod_image_url NOT LIKE 'uploads/legacy/%') AS legacy
       FROM delivery_challan_lines`,
    `SELECT COUNT(*) FILTER (WHERE pdf_path LIKE 'uploads/legacy/%') AS ok,
            COUNT(*) FILTER (WHERE pdf_path IS NOT NULL AND TRIM(pdf_path) <> ''
              AND pdf_path NOT LIKE 'uploads/legacy/%') AS legacy
       FROM sales_order_lines`,
    `SELECT COUNT(*) FILTER (WHERE invoice_path LIKE 'uploads/legacy/%') AS ok,
            COUNT(*) FILTER (WHERE invoice_path IS NOT NULL AND TRIM(invoice_path) <> ''
              AND invoice_path NOT LIKE 'uploads/legacy/%') AS legacy
       FROM vendor_purchase_orders`,
  ];
  for (const sql of checks) {
    const { rows } = await c.query(sql);
    console.log(rows[0]);
  }
  const bad = await c.query(
    `SELECT pod_image_url FROM delivery_challan_lines
      WHERE pod_image_url IS NOT NULL AND TRIM(pod_image_url) <> ''
        AND pod_image_url NOT LIKE 'uploads/legacy/%' LIMIT 5`
  );
  if (bad.rows.length) {
    console.log('sample unmigrated pod paths:', bad.rows);
  }
  const soPdf = await c.query(
    `SELECT pdf_path FROM sales_order_lines
      WHERE pdf_path IS NOT NULL AND TRIM(pdf_path) <> '' LIMIT 8`
  );
  console.log('sample SO pdf_path:', soPdf.rows);
  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
