/**
 * 034 — Migrate floor Tickets module from laptop_refurbishment → CRM.
 *
 * Tables: tickets, activities, work_logs, ticket_parts, part_requests
 * Preserves ticket_id, stage_id (stages are CRM config — must match by name if IDs differ).
 */
const { progress, writeLog } = require('../lib/logger');
const { str, resolveTicketTtsplId } = require('../lib/helpers');
const { setCrmId } = require('../lib/id-map');
const { buildUserIdMap, mapUserId } = require('../lib/refurbUserMap');

const BACKUP_TABLE = 'tickets_refurb_backup_034';

async function ensureBackupTable(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
      ticket_id BIGINT PRIMARY KEY,
      row_data JSONB NOT NULL,
      backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function backupTicketIfNew(crm, ticketId) {
  const { rows } = await crm.query(`SELECT to_jsonb(t.*) AS j FROM tickets t WHERE ticket_id = $1`, [ticketId]);
  if (!rows.length) return;
  await crm.query(
    `INSERT INTO ${BACKUP_TABLE} (ticket_id, row_data) VALUES ($1, $2::jsonb) ON CONFLICT (ticket_id) DO NOTHING`,
    [ticketId, rows[0].j]
  );
}

async function buildTeamIdMap(source, crm) {
  const [srcTeams] = await source.query(`SELECT team_id, team_name FROM teams ORDER BY team_id`);
  const { rows: tgtTeams } = await crm.query(`SELECT team_id, team_name FROM teams ORDER BY team_id`);
  const byName = new Map(tgtTeams.map((t) => [String(t.team_name).trim().toLowerCase(), t.team_id]));
  const validIds = new Set(tgtTeams.map((t) => Number(t.team_id)));
  const map = new Map();
  for (const t of srcTeams) {
    const nameKey = String(t.team_name).trim().toLowerCase();
    if (byName.has(nameKey)) map.set(Number(t.team_id), Number(byName.get(nameKey)));
    else if (validIds.has(Number(t.team_id))) map.set(Number(t.team_id), Number(t.team_id));
    else map.set(Number(t.team_id), null);
  }
  return map;
}

function mapTeamId(teamMap, sourceId) {
  if (sourceId == null) return null;
  const n = Number(sourceId);
  if (!Number.isFinite(n)) return null;
  if (!teamMap.has(n)) return null;
  return teamMap.get(n);
}

async function buildStageIdMap(source, crm) {
  const [srcStages] = await source.query(`SELECT stage_id, stage_name FROM stages ORDER BY stage_id`);
  const { rows: tgtStages } = await crm.query(`SELECT stage_id, stage_name FROM stages ORDER BY stage_id`);
  const byName = new Map(tgtStages.map((s) => [String(s.stage_name).trim().toLowerCase(), s.stage_id]));
  const validIds = new Set(tgtStages.map((s) => Number(s.stage_id)));
  const map = new Map();
  for (const s of srcStages) {
    const nameKey = String(s.stage_name).trim().toLowerCase();
    if (byName.has(nameKey)) map.set(Number(s.stage_id), Number(byName.get(nameKey)));
    else if (validIds.has(Number(s.stage_id))) map.set(Number(s.stage_id), Number(s.stage_id));
    else map.set(Number(s.stage_id), null);
  }
  return map;
}

function mapStageId(stageMap, sourceId) {
  if (sourceId == null) return null;
  const n = Number(sourceId);
  if (!Number.isFinite(n)) return null;
  if (!stageMap.has(n)) return null;
  return stageMap.get(n);
}

async function upsertTicket(crm, row, userMap, stageMap, teamMap) {
  const ticketId = Number(row.ticket_id);
  await backupTicketIfNew(crm, ticketId);

  await crm.query(
    `INSERT INTO tickets (
       ticket_id, serial_number, machine_number, ttspl_id,
       brand, model, processor, ram, storage,
       status, priority, ticket_type,
       current_stage_id, assigned_team_id, assigned_user_id,
       initial_condition, final_grade, initial_cost,
       created_at, updated_at, completed_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'general',$12,$13,$14,$15,$16,$17,$18,$19,$20
     )
     ON CONFLICT (ticket_id) DO UPDATE SET
       serial_number = EXCLUDED.serial_number,
       machine_number = EXCLUDED.machine_number,
       ttspl_id = EXCLUDED.ttspl_id,
       brand = EXCLUDED.brand,
       model = EXCLUDED.model,
       processor = EXCLUDED.processor,
       ram = EXCLUDED.ram,
       storage = EXCLUDED.storage,
       status = EXCLUDED.status,
       priority = EXCLUDED.priority,
       current_stage_id = EXCLUDED.current_stage_id,
       assigned_team_id = EXCLUDED.assigned_team_id,
       assigned_user_id = EXCLUDED.assigned_user_id,
       initial_condition = EXCLUDED.initial_condition,
       final_grade = EXCLUDED.final_grade,
       initial_cost = EXCLUDED.initial_cost,
       updated_at = EXCLUDED.updated_at,
       completed_at = EXCLUDED.completed_at`,
    [
      ticketId,
      str(row.serial_number, 100, `SN-${ticketId}`),
      str(row.machine_number, 100, null),
      resolveTicketTtsplId(row),
      str(row.brand, 50, null),
      str(row.model, 100, null),
      str(row.processor, 100, null),
      str(row.ram, 50, null),
      str(row.storage, 50, null),
      str(row.status, 50, 'in_progress'),
      str(row.priority, 20, 'normal'),
      mapStageId(stageMap, row.current_stage_id),
      mapTeamId(teamMap, row.assigned_team_id),
      mapUserId(userMap, row.assigned_user_id),
      row.initial_condition || null,
      str(row.final_grade, 10, null),
      row.initial_cost != null ? Number(row.initial_cost) : 0,
      row.created_at || new Date(),
      row.updated_at || new Date(),
      row.completed_at || null,
    ]
  );

  await setCrmId(crm, {
    entity: 'refurb_tickets',
    erpId: ticketId,
    crmId: ticketId,
    erpTable: 'tickets',
    crmTable: 'tickets',
  });
}

async function migrateSimpleChild(source, crm, userMap, stageMap, table, sql, mapFn) {
  const [rows] = await source.query(`SELECT * FROM ${table} ORDER BY 1`);
  let n = 0;
  for (const row of rows) {
    const mapped = mapFn(row, userMap, stageMap);
    if (!mapped) continue;
    await crm.query(sql, mapped.params);
    n += 1;
  }
  return n;
}

async function bumpTicketSequences(crm) {
  await crm.query(`SELECT setval('tickets_ticket_id_seq', (SELECT COALESCE(MAX(ticket_id), 1) FROM tickets), true)`);
  await crm.query(
    `SELECT setval('activities_activity_id_seq', (SELECT COALESCE(MAX(activity_id), 1) FROM activities), true)`
  );
  await crm.query(`SELECT setval('work_logs_log_id_seq', (SELECT COALESCE(MAX(log_id), 1) FROM work_logs), true)`);
  await crm.query(`SELECT setval('ticket_parts_id_seq', (SELECT COALESCE(MAX(id), 1) FROM ticket_parts), true)`);
  await crm.query(
    `SELECT setval('part_requests_request_id_seq', (SELECT COALESCE(MAX(request_id), 1) FROM part_requests), true)`
  );
}

module.exports = {
  id: '034',
  name: 'refurb_tickets',
  async run({ source, crm, batchSize }) {
    await ensureBackupTable(crm);
    const userMap = await buildUserIdMap(source, crm);
    const stageMap = await buildStageIdMap(source, crm);
    const teamMap = await buildTeamIdMap(source, crm);
    writeLog('migration', `034 user map: ${userMap.size}, stage map: ${stageMap.size}, team map: ${teamMap.size}`);

    const [countRows] = await source.query('SELECT COUNT(*)::int AS cnt FROM tickets');
    const total = Number(countRows[0].cnt);
    let processed = 0;
    let upserted = 0;

    const [ticketRows] = await source.query('SELECT * FROM tickets ORDER BY ticket_id');
    for (const row of ticketRows) {
      processed += 1;
      await upsertTicket(crm, row, userMap, stageMap, teamMap);
      upserted += 1;
      if (processed % batchSize === 0 || processed === total) progress('refurb_tickets', processed, total);
    }

    const activities = await migrateSimpleChild(
      source,
      crm,
      userMap,
      stageMap,
      'activities',
      `INSERT INTO activities (activity_id, ticket_id, stage_id, user_id, action, notes, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (activity_id) DO UPDATE SET
         ticket_id = EXCLUDED.ticket_id, stage_id = EXCLUDED.stage_id, user_id = EXCLUDED.user_id,
         action = EXCLUDED.action, notes = EXCLUDED.notes, metadata = EXCLUDED.metadata,
         created_at = EXCLUDED.created_at`,
      (row, um, sm) => ({
        params: [
          row.activity_id,
          row.ticket_id,
          mapStageId(sm, row.stage_id),
          mapUserId(um, row.user_id),
          str(row.action, 50, 'note_added'),
          row.notes || null,
          row.metadata != null && typeof row.metadata === 'object' ? JSON.stringify(row.metadata) : row.metadata || null,
          row.created_at || new Date(),
        ],
      })
    );

    const workLogs = await migrateSimpleChild(
      source,
      crm,
      userMap,
      stageMap,
      'work_logs',
      `INSERT INTO work_logs (log_id, ticket_id, user_id, stage_id, start_time, end_time, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (log_id) DO UPDATE SET
         ticket_id = EXCLUDED.ticket_id, user_id = EXCLUDED.user_id, stage_id = EXCLUDED.stage_id,
         start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
         notes = EXCLUDED.notes, created_at = EXCLUDED.created_at`,
      (row, um, sm) => ({
        params: [
          row.log_id,
          row.ticket_id,
          mapUserId(um, row.user_id),
          mapStageId(sm, row.stage_id),
          row.start_time || new Date(),
          row.end_time || null,
          row.notes || null,
          row.created_at || new Date(),
        ],
      })
    );

    let ticketParts = 0;
    try {
      ticketParts = await migrateSimpleChild(
        source,
        crm,
        userMap,
        stageMap,
        'ticket_parts',
        `INSERT INTO ticket_parts (id, ticket_id, part_id, quantity_used, notes, added_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           ticket_id = EXCLUDED.ticket_id, part_id = EXCLUDED.part_id,
           quantity_used = EXCLUDED.quantity_used, notes = EXCLUDED.notes,
           added_at = EXCLUDED.added_at`,
        (row) => ({
          params: [
            row.id,
            row.ticket_id,
            row.part_id != null ? Number(row.part_id) : null,
            Number(row.quantity_used) || 1,
            row.notes || null,
            row.added_at || new Date(),
          ],
        })
      );
    } catch (e) {
      writeLog('migration', `034 ticket_parts skipped: ${e.message}`);
    }

    let partRequests = 0;
    try {
      partRequests = await migrateSimpleChild(
        source,
        crm,
        userMap,
        stageMap,
        'part_requests',
        `INSERT INTO part_requests (
           request_id, ticket_id, part_name, description, status, requested_by, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (request_id) DO UPDATE SET
           ticket_id = EXCLUDED.ticket_id, part_name = EXCLUDED.part_name,
           description = EXCLUDED.description, status = EXCLUDED.status,
           requested_by = EXCLUDED.requested_by, updated_at = EXCLUDED.updated_at`,
        (row, um) => ({
          params: [
            row.request_id,
            row.ticket_id,
            str(row.part_name, 255, 'Part'),
            row.description || null,
            str(row.status, 50, 'pending'),
            mapUserId(um, row.requested_by),
            row.created_at || new Date(),
            row.updated_at || new Date(),
          ],
        })
      );
    } catch (e) {
      writeLog('migration', `034 part_requests skipped: ${e.message}`);
    }

    await bumpTicketSequences(crm);

    const totalRows = upserted + activities + workLogs + ticketParts + partRequests;
    writeLog(
      'migration',
      `034 tickets: ${upserted} tickets, ${activities} activities, ${workLogs} work_logs, ${ticketParts} parts, ${partRequests} part_requests`
    );
    return totalRows;
  },
};
