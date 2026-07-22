/**
 * 002 — ERP admin → CRM users (ADDITIVE ONLY)
 * See migration/AUTH_TABLES.md
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, setCrmId } = require('../lib/id-map');

const DEFAULT_CRM_ROLE = 'team_member';

function mapErpAdminRole(row) {
  if (Number(row.is_superadmin) === 1) return 'admin';
  if (Number(row.admin_role_id) === 1) return 'admin';
  return DEFAULT_CRM_ROLE;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

module.exports = {
  id: '002',
  name: 'erp_admin_users_additive',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `admins`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let mapped = 0;
    let inserted = 0;
    let skipped = 0;

    const [admins] = await erp.query(
      'SELECT id, name, email, password, phone, admin_role_id, is_superadmin, status FROM `admins` ORDER BY id'
    );

    for (const row of admins) {
      processed += 1;
      const email = normalizeEmail(row.email);
      if (!email) {
        skipped += 1;
        continue;
      }

      const existingMap = await getCrmId(crm, 'users', row.id);
      if (existingMap != null) {
        skipped += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('ERP admins', processed, total);
        }
        continue;
      }

      const { rows: existingUsers } = await crm.query(
        'SELECT user_id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1',
        [email]
      );

      if (existingUsers.length > 0) {
        await setCrmId(crm, {
          entity: 'users',
          erpId: row.id,
          crmId: existingUsers[0].user_id,
          erpTable: 'admins',
          crmTable: 'users',
        });
        mapped += 1;
        writeLog('migration', `002: mapped ERP admin ${row.id} → existing CRM user ${existingUsers[0].user_id} (${email})`);
      } else {
        const role = mapErpAdminRole(row);
        const name = String(row.name || email.split('@')[0] || 'ERP User').slice(0, 100);
        const passwordHash = String(row.password || '').slice(0, 255);
        if (!passwordHash) {
          skipped += 1;
          writeLog('migration', `002: skip admin ${row.id} — no password`);
          continue;
        }

        const { rows: insertedRows } = await crm.query(
          `INSERT INTO users (
             name, email, password_hash, role, mobile_no, active, status, user_type, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'internal', NOW(), NOW())
           RETURNING user_id`,
          [
            name,
            email.slice(0, 100),
            passwordHash,
            role,
            row.phone ? String(row.phone).slice(0, 50) : null,
            Number(row.status) !== 0,
            Number(row.status) === 0 ? 'inactive' : 'active',
          ]
        );

        const crmUserId = insertedRows[0].user_id;
        await setCrmId(crm, {
          entity: 'users',
          erpId: row.id,
          crmId: crmUserId,
          erpTable: 'admins',
          crmTable: 'users',
        });
        inserted += 1;
        writeLog('migration', `002: inserted CRM user ${crmUserId} from ERP admin ${row.id} (${email}, role=${role})`);
      }

      if (processed % batchSize === 0 || processed === total) {
        progress('ERP admins', processed, total);
      }
    }

    writeLog('migration', `002 complete: mapped=${mapped} inserted=${inserted} skipped=${skipped} total=${total}`);
    return mapped + inserted;
  },
};
