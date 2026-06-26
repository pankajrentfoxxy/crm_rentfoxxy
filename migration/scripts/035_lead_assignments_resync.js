/**
 * 035 — Backfill lead owner assignments from refurb source → CRM.
 *
 * Fixes leads migrated with assigned_user_id = NULL when source had an owner.
 * Safe to re-run: only fills NULL CRM assignments (never overwrites existing owners).
 */
const { progress, writeLog } = require('../lib/logger');
const { buildUserIdMap, mapUserId } = require('../lib/refurbUserMap');

async function migrate({ source, crm, batchSize, forceAssign = false }) {
  const userMap = await buildUserIdMap(source, crm);
  writeLog('migration', `035 user map: ${userMap.size} matched`);
  if (userMap.unmappedUsers?.length) {
    writeLog(
      'migration',
      `035 unmapped source users: ${userMap.unmappedUsers.length} (${userMap.unmappedUsers
        .slice(0, 6)
        .map((u) => `#${u.sourceId}<${u.email || u.name}>`)
        .join(', ')})`
    );
  }

  const [rows] = await source.query(
    `SELECT lead_id, assigned_user_id, assigned_by, assigned_at
       FROM leads
      WHERE assigned_user_id IS NOT NULL
      ORDER BY lead_id`
  );

  let processed = 0;
  let updated = 0;
  let skippedHasOwner = 0;
  let skippedUnmapped = 0;
  let skippedMissingLead = 0;
  const total = rows.length;

  for (const row of rows) {
    processed += 1;
    const leadId = Number(row.lead_id);
    const mappedOwner = mapUserId(userMap, row.assigned_user_id);
    const mappedBy = mapUserId(userMap, row.assigned_by);

    const { rows: existing } = await crm.query(
      `SELECT lead_id, assigned_user_id FROM leads WHERE lead_id = $1`,
      [leadId]
    );
    if (!existing.length) {
      skippedMissingLead += 1;
      if (processed % batchSize === 0 || processed === total) {
        progress('lead_assignments', processed, total);
      }
      continue;
    }

    if (mappedOwner) {
      if (existing[0].assigned_user_id === mappedOwner) {
        skippedHasOwner += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('lead_assignments', processed, total);
        }
        continue;
      }
      if (existing[0].assigned_user_id != null && !forceAssign) {
        skippedHasOwner += 1;
        if (processed % batchSize === 0 || processed === total) {
          progress('lead_assignments', processed, total);
        }
        continue;
      }

      const result = await crm.query(
        `UPDATE leads
            SET assigned_user_id = $2,
                assigned_by = COALESCE($3, assigned_by),
                assigned_at = COALESCE(assigned_at, $4),
                updated_at = GREATEST(updated_at, NOW())
          WHERE lead_id = $1`,
        [leadId, mappedOwner, mappedBy, row.assigned_at || null]
      );
      if (result.rowCount > 0) updated += 1;
    } else if (forceAssign && existing[0].assigned_user_id != null) {
      const result = await crm.query(
        `UPDATE leads
            SET assigned_user_id = NULL,
                updated_at = GREATEST(updated_at, NOW())
          WHERE lead_id = $1`,
        [leadId]
      );
      if (result.rowCount > 0) updated += 1;
    } else {
      skippedUnmapped += 1;
    }

    if (processed % batchSize === 0 || processed === total) {
      progress('lead_assignments', processed, total);
    }
  }

  // Backfill lead_assignments child rows where mapped
  const [assignRows] = await source.query(`SELECT * FROM lead_assignments ORDER BY assignment_id`);
  let childUpdated = 0;
  for (const row of assignRows) {
    const leadId = Number(row.lead_id);
    const assignedTo = mapUserId(userMap, row.assigned_to);
    const assignedBy = mapUserId(userMap, row.assigned_by);
    if (!assignedTo) continue;
    await crm.query(
      `INSERT INTO lead_assignments (
         assignment_id, lead_id, assigned_to, assigned_by, assigned_at, batch_id
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (assignment_id) DO UPDATE SET
         assigned_to = EXCLUDED.assigned_to,
         assigned_by = EXCLUDED.assigned_by,
         assigned_at = EXCLUDED.assigned_at,
         batch_id = EXCLUDED.batch_id`,
      [
        row.assignment_id,
        leadId,
        assignedTo,
        assignedBy,
        row.assigned_at || new Date(),
        row.batch_id || null,
      ]
    );
    childUpdated += 1;
  }

  writeLog(
    'migration',
    `035 assignments: updated=${updated} skipped_has_owner=${skippedHasOwner} skipped_unmapped=${skippedUnmapped} skipped_missing_lead=${skippedMissingLead} child_rows=${childUpdated}`
  );
  return updated + childUpdated;
}

module.exports = {
  id: '035',
  name: 'lead_assignments_resync',
  migrate,
  async run(ctx) {
    return migrate(ctx);
  },
};
