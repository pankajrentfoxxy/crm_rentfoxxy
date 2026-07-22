require('dotenv').config();
const pool = require('../config/db');
async function main() {
  const r = await pool.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
            COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
            COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
            COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
            COALESCE(vsn.extra->>'storage', vpd.storage) AS storage,
            vsn.inventory_status
       FROM vendor_serial_numbers vsn
       LEFT JOIN vendor_product_details vpd
         ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id','')::int
      WHERE vsn.serial_id IN (125,128)`
  );
  console.table(r.rows);
  process.exit(0);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
