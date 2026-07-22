require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const { TEXT_COLUMNS, JSONB_COLUMNS } = require('./sync-path-utils');
const { crmRelativePath, normalizeErpPath } = require('../lib/fileSync');

(async () => {
  const c = getCrmPool();
  let fixed = 0;

  for (const spec of TEXT_COLUMNS) {
    const { rows } = await c.query(
      `SELECT DISTINCT ${spec.column} AS p FROM ${spec.table}
        WHERE ${spec.column} IS NOT NULL AND TRIM(${spec.column}) <> ''`
    );
    for (const row of rows) {
      const raw = row.p;
      const target = crmRelativePath(raw);
      if (!target || raw === target) continue;
      const r = await c.query(
        `UPDATE ${spec.table} SET ${spec.column} = $1 WHERE ${spec.column} = $2`,
        [target, raw]
      );
      fixed += r.rowCount || 0;
    }
  }

  console.log('fixed rows (exact path rewrite):', fixed);

  const checks = [
    `SELECT COUNT(*) c FROM sales_order_lines WHERE pdf_path LIKE 'storage/app/public/%'`,
    `SELECT COUNT(*) c FROM delivery_challan_lines WHERE pod_image_url NOT LIKE 'uploads/legacy/%' AND pod_image_url IS NOT NULL AND TRIM(pod_image_url)<>''`,
  ];
  for (const sql of checks) {
    console.log(await c.query(sql).then((r) => r.rows[0]));
  }
  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
