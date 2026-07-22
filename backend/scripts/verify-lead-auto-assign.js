require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const { getNextAutoAssignee, getAutoAssignConfig } = require('../services/leadAutoAssignService');
const { getLeadEmailSyncStatus } = require('../services/leadEmailIngestionService');

(async () => {
  try {
    const nextId = await getNextAutoAssignee();
    const config = await getAutoAssignConfig();
    const syncStatus = await getLeadEmailSyncStatus();
    const user = nextId
      ? (await pool.query('SELECT user_id, name, email FROM users WHERE user_id = $1', [nextId])).rows[0]
      : null;

    console.log('Auto-assign verification:');
    console.log(JSON.stringify({
      env: {
        LEAD_AUTO_ASSIGN_USER_ID: process.env.LEAD_AUTO_ASSIGN_USER_ID || null,
        LEAD_AUTO_ASSIGN_EMAIL: process.env.LEAD_AUTO_ASSIGN_EMAIL || null,
      },
      getNextAutoAssignee: nextId,
      assignee: user,
      dbConfig: config,
      emailSyncStatus: {
        configured: syncStatus.configured,
        autoAssignUserId: syncStatus.autoAssignUserId,
        autoAssignEmail: syncStatus.autoAssignEmail,
      },
      ok: nextId === 31,
    }, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    pool.end();
  }
})();
