#!/usr/bin/env node
/**
 * Compare lead assignments: refurb source vs CRM target.
 * Reports unmapped assignees and CRM leads missing assignment vs source.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { getCrmPool, closePools } = require('../lib/db');
const { createRefurbSource, closeRefurbPool } = require('../lib/refurbSource');
const { parseCopyBlock, defaultDumpPath } = require('../lib/refurbSqlDump');
const { buildUserIdMap, mapUserId } = require('../lib/refurbUserMap');

async function loadSource(source, sqlDumpPath) {
  if (source) {
    const [users] = await source.query(
      `SELECT user_id, name, email, role FROM users WHERE email IS NOT NULL AND TRIM(email) <> ''`
    );
    const [leads] = await source.query(
      `SELECT lead_id, assigned_user_id, assigned_by, name, email FROM leads ORDER BY lead_id`
    );
    return { users, leads, mode: 'db' };
  }
  if (!sqlDumpPath || !fs.existsSync(sqlDumpPath)) {
    throw new Error('Refurb DB unavailable and SQL dump not found');
  }
  const users = parseCopyBlock(sqlDumpPath, 'users').filter((u) => u.email);
  const leads = parseCopyBlock(sqlDumpPath, 'leads');
  return { users, leads, mode: 'sql_dump' };
}

async function main() {
  const sqlDumpPath = process.env.REFURB_SQL_DUMP_PATH || defaultDumpPath();

  let source = null;
  try {
    source = await createRefurbSource();
  } catch {
    source = null;
  }

  const crm = getCrmPool();
  const src = await loadSource(source, sqlDumpPath);
  const userMap = await buildUserIdMap(
    source || { query: async () => [parseCopyBlock(sqlDumpPath, 'users')] },
    crm
  );

  let srcAssigned = 0;
  let wouldMap = 0;
  let wouldMiss = 0;
  let crmMissing = 0;
  let crmHasWhenSrcAssigned = 0;
  const missedUsers = new Map();
  const samples = [];

  const crmLeads = await crm.query(
    `SELECT lead_id, assigned_user_id, name FROM leads ORDER BY lead_id`
  );
  const crmByLeadId = new Map(crmLeads.rows.map((r) => [Number(r.lead_id), r]));

  for (const lead of src.leads) {
    const leadId = Number(lead.lead_id);
    const srcAssignee = lead.assigned_user_id != null ? Number(lead.assigned_user_id) : null;
    if (!srcAssignee) continue;
    srcAssigned += 1;

    const mapped = mapUserId(userMap, srcAssignee);
    const finalId = mapped;

    if (finalId) wouldMap += 1;
    else {
      wouldMiss += 1;
      const srcUser = src.users.find((u) => Number(u.user_id) === srcAssignee);
      const key = srcAssignee;
      if (!missedUsers.has(key)) {
        missedUsers.set(key, {
          source_user_id: srcAssignee,
          name: srcUser?.name || '?',
          email: srcUser?.email || null,
        });
      }
    }

    const crmLead = crmByLeadId.get(leadId);
    if (!crmLead) continue;
    if (srcAssignee && !crmLead.assigned_user_id) {
      crmMissing += 1;
      if (samples.length < 15) {
        samples.push({
          lead_id: leadId,
          name: crmLead.name,
          source_assignee: srcAssignee,
          mapped_crm_user: mapped,
          crm_assignee: crmLead.assigned_user_id,
        });
      }
    } else if (srcAssignee && crmLead.assigned_user_id) {
      crmHasWhenSrcAssigned += 1;
    }
  }

  console.log('\n=== Lead assignment comparison ===');
  console.log('Source mode:', src.mode);
  console.log('User map entries (email):', userMap.size);
  console.log('Source leads with assignee:', srcAssigned);
  console.log('Would map with current logic+id fallback:', wouldMap);
  console.log('Would miss assignee mapping:', wouldMiss);
  console.log('CRM leads assigned when source had assignee:', crmHasWhenSrcAssigned);
  console.log('CRM leads UNASSIGNED but source had assignee:', crmMissing);

  if (missedUsers.size) {
    console.log('\nUnmapped source users (sample):');
    [...missedUsers.values()].slice(0, 20).forEach((u) => {
      console.log(`  #${u.source_user_id} ${u.name} <${u.email || 'no email'}>`);
    });
  }

  if (samples.length) {
    console.log('\nSample CRM-unassigned leads (source had owner):');
    samples.forEach((s) => console.log(s));
  }

  await closeRefurbPool?.();
  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
