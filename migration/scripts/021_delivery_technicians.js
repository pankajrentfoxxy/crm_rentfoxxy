/**
 * 021 — ERP delivery_men → CRM delivery_technicians
 * Powers Delivery Register → Delivery Technicians list (Laravel delivery-man parity).
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, setCrmId, str, parseJson, normalizeEmail } = require('../lib/helpers');

function parseIdentityImages(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  const parsed = parseJson(raw, null);
  if (Array.isArray(parsed)) return parsed;
  if (typeof raw === 'string' && raw.trim() && raw.trim() !== '[]') {
    const s = raw.trim();
    if (s.startsWith('[')) return parseIdentityImages(parsed);
    return [s.replace(/^.*\//, '')];
  }
  return [];
}

function imageFilename(raw) {
  const s = str(raw, 255, '');
  if (!s) return 'migrated-placeholder.png';
  return s.replace(/^.*\//, '');
}

function normalizePasswordHash(raw) {
  const hash = str(raw, 255, '');
  if (!hash) return null;
  // Laravel bcrypt ($2y$) → Node bcryptjs compatible ($2a$)
  return hash.startsWith('$2y$') ? `$2a$${hash.slice(4)}` : hash;
}

async function findExistingTechnician(crm, email, phone, countryCode) {
  const em = normalizeEmail(email);
  if (em) {
    const { rows } = await crm.query(
      `SELECT technician_id FROM delivery_technicians WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [em]
    );
    if (rows.length) return rows[0].technician_id;
  }
  if (phone) {
    const { rows } = await crm.query(
      `SELECT technician_id FROM delivery_technicians
        WHERE phone = $1 AND country_code = $2 LIMIT 1`,
      [phone, countryCode || '91']
    );
    if (rows.length) return rows[0].technician_id;
  }
  return null;
}

async function bumpDeliveryTechnicianSequence(crm) {
  await crm.query(
    `SELECT setval('delivery_technicians_technician_id_seq',
      (SELECT COALESCE(MAX(technician_id), 1) FROM delivery_technicians), true)`
  );
}

module.exports = {
  id: '021',
  name: 'delivery_technicians',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query('SELECT COUNT(*) AS cnt FROM `delivery_men`');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let inserted = 0;
    let mapped = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, name, f_name, l_name, address, country_code, phone, email,
              identity_number, identity_type, identity_image, image, password,
              is_active, created_at, updated_at
         FROM \`delivery_men\`
        ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;

      const existingMap = await getCrmId(crm, 'delivery_men', row.id);
      if (existingMap != null) {
        if (processed % batchSize === 0 || processed === total) {
          progress('delivery_technicians', processed, total);
        }
        continue;
      }

      const firstName = str(row.f_name || row.name, 100, 'Technician');
      const lastName = str(row.l_name, 100, '.') || '.';
      const email = normalizeEmail(row.email);
      const phone = str(row.phone, 50, '');
      const countryCode = str(row.country_code, 10, '91') || '91';

      if (!email || !phone) {
        skipped += 1;
        writeLog('migration', `021 skip delivery_man ${row.id}: missing email or phone`);
        if (processed % batchSize === 0 || processed === total) {
          progress('delivery_technicians', processed, total);
        }
        continue;
      }

      const existingId = await findExistingTechnician(crm, email, phone, countryCode);
      if (existingId != null) {
        await setCrmId(crm, {
          entity: 'delivery_men',
          erpId: row.id,
          crmId: existingId,
          erpTable: 'delivery_men',
          crmTable: 'delivery_technicians',
        });
        mapped += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('delivery_technicians', processed, total);
        }
        continue;
      }

      const passwordHash = normalizePasswordHash(row.password);
      const identityImages = parseIdentityImages(row.identity_image);
      const profileImage = imageFilename(row.image);

      const { rows: userRows } = await crm.query(
        `SELECT user_id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
        [email]
      );
      const linkedUserId = userRows[0]?.user_id ?? null;

      const { rows: ins } = await crm.query(
        `INSERT INTO delivery_technicians (
           user_id, first_name, last_name, phone, email, country_code, address,
           identity_type, identity_number, identity_image, image, password_hash,
           is_active, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15
         ) RETURNING technician_id`,
        [
          linkedUserId,
          firstName,
          lastName,
          phone,
          email,
          countryCode,
          str(row.address, 5000, null),
          str(row.identity_type, 50, null),
          str(row.identity_number, 100, null),
          JSON.stringify(identityImages),
          profileImage,
          passwordHash,
          Number(row.is_active) !== 0,
          row.created_at || new Date(),
          row.updated_at || new Date(),
        ]
      );

      await setCrmId(crm, {
        entity: 'delivery_men',
        erpId: row.id,
        crmId: ins[0].technician_id,
        erpTable: 'delivery_men',
        crmTable: 'delivery_technicians',
      });
      inserted += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('delivery_technicians', processed, total);
      }
    }

    await bumpDeliveryTechnicianSequence(crm);
    writeLog(
      'migration',
      `021 complete: inserted=${inserted} mapped=${mapped} skipped=${skipped} total=${total}`
    );
    return inserted + mapped;
  },
};
