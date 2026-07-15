/**
 * Clear auto-imported email notes from personal_remarks.
 * Those belong in lead_activities only; personal_remarks is for manual sales notes.
 */
process.env.DB_SSL = 'false';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');

(async () => {
  try {
    const r = await pool.query(`
      UPDATE leads
         SET personal_remarks = NULL,
             updated_at = NOW()
       WHERE personal_remarks ILIKE 'Lead imported from enquiry email%'
      RETURNING lead_id
    `);
    console.log(`Cleared auto-import personal_remarks on ${r.rowCount} lead(s).`);
    if (r.rows.length) {
      console.log('lead_ids:', r.rows.map((x) => x.lead_id).join(', '));
    }
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
