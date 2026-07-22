/**
 * 030 — ERP file_path references → CRM attachment fields
 * Backfills POD images on delivery_challan_lines from ERP delivery_challans.file_path.
 *
 * Paths only — Laravel storage/app/public binaries are NOT copied here.
 * Run `node tools/sync-erp-files.js --apply` after migrate-all when ERP files are on disk.
 * Customer documents were migrated in 007; this module completes legacy file linkage.
 */
const { progress, writeLog } = require('../lib/logger');
const { getCrmId, parseJson, str } = require('../lib/helpers');

function firstFilePath(raw) {
  if (raw == null || raw === '') return null;
  const parsed = parseJson(raw, null);
  if (Array.isArray(parsed) && parsed.length) {
    const first = String(parsed[0] || '').trim();
    return first || null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p) && p.length) return String(p[0]).trim() || null;
    } catch {
      return raw.trim();
    }
    return raw.trim();
  }
  return null;
}

module.exports = {
  id: '030',
  name: 'attachments',
  async run({ erp, crm, batchSize }) {
    const [countRows] = await erp.query(
      `SELECT COUNT(*) AS cnt FROM \`delivery_challans\`
        WHERE file_path IS NOT NULL AND file_path != '' AND file_path != 'null'`
    );
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let updated = 0;
    let skipped = 0;

    const [rows] = await erp.query(
      `SELECT id, file_path, date_and_time, submitted_name, updated_at
         FROM \`delivery_challans\`
        WHERE file_path IS NOT NULL AND file_path != '' AND file_path != 'null'
        ORDER BY id`
    );

    for (const row of rows) {
      processed += 1;

      const crmLineId = await getCrmId(crm, 'delivery_challans', row.id);
      if (crmLineId == null) {
        skipped += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('attachments', processed, total);
        }
        continue;
      }

      const podPath = firstFilePath(row.file_path);
      if (!podPath) {
        skipped += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('attachments', processed, total);
        }
        continue;
      }

      const podTs = row.date_and_time ? new Date(row.date_and_time) : row.updated_at || null;
      const { rowCount } = await crm.query(
        `UPDATE delivery_challan_lines
            SET pod_image_url = COALESCE(NULLIF(TRIM(pod_image_url), ''), $2),
                pod_submitted_at = COALESCE(pod_submitted_at, $3),
                pod_submitted_by = COALESCE(pod_submitted_by, NULL),
                submitted_name = COALESCE(NULLIF(TRIM(submitted_name), ''), $4),
                updated_at = NOW()
          WHERE id = $1
            AND (pod_image_url IS NULL OR TRIM(pod_image_url) = '')`,
        [crmLineId, podPath, podTs, str(row.submitted_name, 255, null)]
      );

      if (rowCount > 0) updated += 1;

      if (processed % batchSize === 0 || processed === total) {
        progress('attachments', processed, total);
      }
    }

    writeLog(
      'migration',
      `030 complete: pod_backfill=${updated} skipped=${skipped} scanned=${total}`
    );
    return updated;
  },
};
