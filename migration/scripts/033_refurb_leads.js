/**
 * 033 — Migrate Leads module from laptop_refurbishment (revemp_backend) → CRM.
 *
 * Source: restored PostgreSQL backup (laptop_refurbishment_backup.sql)
 * Tables: leads, lead_activities, lead_assignments, lead_remarks,
 *         lead_company_research, lead_followup_notifications
 *
 * Idempotent: upserts by source lead_id; child rows upsert by PK.
 */
const { progress, writeLog } = require('../lib/logger');
const { str } = require('../lib/helpers');
const { setCrmId } = require('../lib/id-map');
const { buildUserIdMap, mapUserId } = require('../lib/refurbUserMap');

const BACKUP_TABLE = 'leads_refurb_backup_033';

async function ensureBackupTable(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
      lead_id BIGINT PRIMARY KEY,
      row_data JSONB NOT NULL,
      backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function backupLeadIfNew(crm, leadId) {
  const { rows } = await crm.query(`SELECT to_jsonb(l.*) AS j FROM leads l WHERE lead_id = $1`, [leadId]);
  if (!rows.length) return;
  await crm.query(
    `INSERT INTO ${BACKUP_TABLE} (lead_id, row_data) VALUES ($1, $2::jsonb) ON CONFLICT (lead_id) DO NOTHING`,
    [leadId, rows[0].j]
  );
}

function mapLeadId(leadIdMap, sourceId) {
  if (sourceId == null) return null;
  const k = Number(sourceId);
  return leadIdMap.get(k) ?? k;
}

async function upsertLead(crm, row, userMap, leadIdMap) {
  const sourceId = Number(row.lead_id);
  const assignedUserId = mapUserId(userMap, row.assigned_user_id);
  const assignedBy = mapUserId(userMap, row.assigned_by);
  const duplicateOf = row.duplicate_of != null ? mapLeadId(leadIdMap, row.duplicate_of) : null;

  await backupLeadIfNew(crm, sourceId);

  const lastActivityAt = row.updated_at || row.created_at || new Date();

  await crm.query(
    `INSERT INTO leads (
       lead_id, name, company_name, company_brand, email, phone, city, source,
       status, lead_stage, assigned_user_id, assigned_by, assigned_at,
       follow_up_date, is_duplicate, duplicate_of, rejection_reason,
       research_status, research_requested_at,
       brand, processor, generation, ram, storage, personal_remarks,
       quotation_accept_token, quotation_accepted_at, quotation_last_sent_at,
       quotation_last_estimate_no, quotation_last_to_email,
       inquiry_type, shipping_same_as_billing, last_activity_at,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,
       $9,$10,$11,$12,$13,
       $14,$15,$16,$17,
       $18,$19,
       $20,$21,$22,$23,$24,$25,
       $26,$27,$28,$29,$30,
       'rental', TRUE, $31,
       $32,$33
     )
     ON CONFLICT (lead_id) DO UPDATE SET
       name = EXCLUDED.name,
       company_name = EXCLUDED.company_name,
       company_brand = EXCLUDED.company_brand,
       email = EXCLUDED.email,
       phone = EXCLUDED.phone,
       city = EXCLUDED.city,
       source = EXCLUDED.source,
       status = EXCLUDED.status,
       lead_stage = EXCLUDED.lead_stage,
       assigned_user_id = EXCLUDED.assigned_user_id,
       assigned_by = EXCLUDED.assigned_by,
       assigned_at = EXCLUDED.assigned_at,
       follow_up_date = EXCLUDED.follow_up_date,
       is_duplicate = EXCLUDED.is_duplicate,
       duplicate_of = EXCLUDED.duplicate_of,
       rejection_reason = EXCLUDED.rejection_reason,
       research_status = EXCLUDED.research_status,
       research_requested_at = EXCLUDED.research_requested_at,
       brand = EXCLUDED.brand,
       processor = EXCLUDED.processor,
       generation = EXCLUDED.generation,
       ram = EXCLUDED.ram,
       storage = EXCLUDED.storage,
       personal_remarks = EXCLUDED.personal_remarks,
       quotation_accept_token = EXCLUDED.quotation_accept_token,
       quotation_accepted_at = EXCLUDED.quotation_accepted_at,
       quotation_last_sent_at = EXCLUDED.quotation_last_sent_at,
       quotation_last_estimate_no = EXCLUDED.quotation_last_estimate_no,
       quotation_last_to_email = EXCLUDED.quotation_last_to_email,
       last_activity_at = GREATEST(leads.last_activity_at, EXCLUDED.last_activity_at),
       updated_at = EXCLUDED.updated_at`,
    [
      sourceId,
      str(row.name, 255, 'Unknown'),
      str(row.company_name, 255, null),
      str(row.company_brand, 255, null),
      str(row.email, 255, null),
      str(row.phone, 50, null),
      str(row.city, 100, null),
      str(row.source, 100, null),
      str(row.status, 50, 'Pending'),
      str(row.lead_stage, 200, null),
      assignedUserId,
      assignedBy,
      row.assigned_at || null,
      row.follow_up_date || null,
      Boolean(row.is_duplicate),
      duplicateOf,
      row.rejection_reason || null,
      str(row.research_status, 50, 'pending'),
      row.research_requested_at || null,
      str(row.brand, 120, null),
      str(row.processor, 100, null),
      str(row.generation, 50, null),
      str(row.ram, 50, null),
      str(row.storage, 100, null),
      row.personal_remarks || null,
      str(row.quotation_accept_token, 64, null),
      row.quotation_accepted_at || null,
      row.quotation_last_sent_at || null,
      str(row.quotation_last_estimate_no, 50, null),
      str(row.quotation_last_to_email, 255, null),
      lastActivityAt,
      row.created_at || new Date(),
      row.updated_at || new Date(),
    ]
  );

  leadIdMap.set(sourceId, sourceId);
  await setCrmId(crm, {
    entity: 'refurb_leads',
    erpId: sourceId,
    crmId: sourceId,
    erpTable: 'leads',
    crmTable: 'leads',
  });
}

async function migrateChildRows(source, crm, userMap, leadIdMap, table, upsertSql, mapRow) {
  const [rows] = await source.query(`SELECT * FROM ${table} ORDER BY 1`);
  let n = 0;
  for (const row of rows) {
    const mapped = mapRow(row, userMap, leadIdMap);
    if (!mapped) continue;
    await crm.query(upsertSql, mapped.params);
    n += 1;
  }
  return n;
}

async function bumpLeadSequences(crm) {
  await crm.query(`SELECT setval('leads_lead_id_seq', (SELECT COALESCE(MAX(lead_id), 1) FROM leads), true)`);
  await crm.query(
    `SELECT setval('lead_activities_activity_id_seq', (SELECT COALESCE(MAX(activity_id), 1) FROM lead_activities), true)`
  );
  await crm.query(
    `SELECT setval('lead_assignments_assignment_id_seq', (SELECT COALESCE(MAX(assignment_id), 1) FROM lead_assignments), true)`
  );
  await crm.query(
    `SELECT setval('lead_remarks_remark_id_seq', (SELECT COALESCE(MAX(remark_id), 1) FROM lead_remarks), true)`
  );
  await crm.query(
    `SELECT setval('lead_company_research_research_id_seq', (SELECT COALESCE(MAX(research_id), 1) FROM lead_company_research), true)`
  );
  await crm.query(
    `SELECT setval('lead_followup_notifications_notification_id_seq', (SELECT COALESCE(MAX(notification_id), 1) FROM lead_followup_notifications), true)`
  );
}

module.exports = {
  id: '033',
  name: 'refurb_leads',
  async run({ source, crm, batchSize }) {
    await ensureBackupTable(crm);
    const userMap = await buildUserIdMap(source, crm);
    writeLog('migration', `033 user map: ${userMap.size} source users matched by email`);

    const [countRows] = await source.query('SELECT COUNT(*)::int AS cnt FROM leads');
    const total = Number(countRows[0].cnt);
    const leadIdMap = new Map();
    let processed = 0;
    let upserted = 0;

    const [leadRows] = await source.query('SELECT * FROM leads ORDER BY lead_id');
    for (const row of leadRows) {
      processed += 1;
      await upsertLead(crm, row, userMap, leadIdMap);
      upserted += 1;
      if (processed % batchSize === 0 || processed === total) progress('refurb_leads', processed, total);
    }

    const activities = await migrateChildRows(
      source,
      crm,
      userMap,
      leadIdMap,
      'lead_activities',
      `INSERT INTO lead_activities (
         activity_id, lead_id, user_id, action, status_from, status_to, stage_from, stage_to, notes, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (activity_id) DO UPDATE SET
         lead_id = EXCLUDED.lead_id, user_id = EXCLUDED.user_id, action = EXCLUDED.action,
         status_from = EXCLUDED.status_from, status_to = EXCLUDED.status_to,
         stage_from = EXCLUDED.stage_from, stage_to = EXCLUDED.stage_to,
         notes = EXCLUDED.notes, created_at = EXCLUDED.created_at`,
      (row, um, lm) => {
        const leadId = mapLeadId(lm, row.lead_id);
        if (!leadId) return null;
        return {
          params: [
            row.activity_id,
            leadId,
            mapUserId(um, row.user_id),
            str(row.action, 100, null),
            str(row.status_from, 50, null),
            str(row.status_to, 50, null),
            str(row.stage_from, 200, null),
            str(row.stage_to, 200, null),
            row.notes || null,
            row.created_at || new Date(),
          ],
        };
      }
    );

    const assignments = await migrateChildRows(
      source,
      crm,
      userMap,
      leadIdMap,
      'lead_assignments',
      `INSERT INTO lead_assignments (
         assignment_id, lead_id, assigned_to, assigned_by, assigned_at, batch_id
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (assignment_id) DO UPDATE SET
         lead_id = EXCLUDED.lead_id, assigned_to = EXCLUDED.assigned_to,
         assigned_by = EXCLUDED.assigned_by, assigned_at = EXCLUDED.assigned_at,
         batch_id = EXCLUDED.batch_id`,
      (row, um, lm) => {
        const leadId = mapLeadId(lm, row.lead_id);
        if (!leadId) return null;
        return {
          params: [
            row.assignment_id,
            leadId,
            mapUserId(um, row.assigned_to),
            mapUserId(um, row.assigned_by),
            row.assigned_at || new Date(),
            row.batch_id || null,
          ],
        };
      }
    );

    const remarks = await migrateChildRows(
      source,
      crm,
      userMap,
      leadIdMap,
      'lead_remarks',
      `INSERT INTO lead_remarks (remark_id, lead_id, user_id, note, created_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (remark_id) DO UPDATE SET
         lead_id = EXCLUDED.lead_id, user_id = EXCLUDED.user_id,
         note = EXCLUDED.note, created_at = EXCLUDED.created_at`,
      (row, um, lm) => {
        const leadId = mapLeadId(lm, row.lead_id);
        if (!leadId) return null;
        return {
          params: [
            row.remark_id,
            leadId,
            mapUserId(um, row.user_id),
            str(row.note, 10000, ''),
            row.created_at || new Date(),
          ],
        };
      }
    );

    const research = await migrateChildRows(
      source,
      crm,
      userMap,
      leadIdMap,
      'lead_company_research',
      `INSERT INTO lead_company_research (
         research_id, lead_id, industry, pincode, cin, entity_type, roc, revenue, employees,
         gst, address, city, state, raw_response, researched_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
       ON CONFLICT (lead_id) DO UPDATE SET
         industry = EXCLUDED.industry, pincode = EXCLUDED.pincode, cin = EXCLUDED.cin,
         entity_type = EXCLUDED.entity_type, roc = EXCLUDED.roc, revenue = EXCLUDED.revenue,
         employees = EXCLUDED.employees, gst = EXCLUDED.gst, address = EXCLUDED.address,
         city = EXCLUDED.city, state = EXCLUDED.state, raw_response = EXCLUDED.raw_response,
         researched_at = EXCLUDED.researched_at`,
      (row, _um, lm) => {
        const leadId = mapLeadId(lm, row.lead_id);
        if (!leadId) return null;
        const raw =
          row.raw_response != null && typeof row.raw_response === 'object'
            ? JSON.stringify(row.raw_response)
            : row.raw_response || null;
        return {
          params: [
            row.research_id,
            leadId,
            str(row.industry, 255, null),
            str(row.pincode, 20, null),
            str(row.cin, 100, null),
            str(row.entity_type, 100, null),
            str(row.roc, 100, null),
            str(row.revenue, 100, null),
            str(row.employees, 50, null),
            str(row.gst, 50, null),
            row.address || null,
            str(row.city, 100, null),
            str(row.state, 100, null),
            raw,
            row.researched_at || new Date(),
          ],
        };
      }
    );

    const followups = await migrateChildRows(
      source,
      crm,
      userMap,
      leadIdMap,
      'lead_followup_notifications',
      `INSERT INTO lead_followup_notifications (
         notification_id, lead_id, follow_up_at, recipient_email, channel, notified_at
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (notification_id) DO UPDATE SET
         lead_id = EXCLUDED.lead_id, follow_up_at = EXCLUDED.follow_up_at,
         recipient_email = EXCLUDED.recipient_email, channel = EXCLUDED.channel,
         notified_at = EXCLUDED.notified_at`,
      (row, _um, lm) => {
        const leadId = mapLeadId(lm, row.lead_id);
        if (!leadId) return null;
        return {
          params: [
            row.notification_id,
            leadId,
            row.follow_up_at,
            str(row.recipient_email, 255, null),
            str(row.channel, 50, 'email'),
            row.notified_at || null,
          ],
        };
      }
    );

    await bumpLeadSequences(crm);

    const totalRows = upserted + activities + assignments + remarks + research + followups;
    writeLog(
      'migration',
      `033 leads: ${upserted} leads, ${activities} activities, ${assignments} assignments, ${remarks} remarks, ${research} research, ${followups} followup notifications`
    );
    return totalRows;
  },
};
