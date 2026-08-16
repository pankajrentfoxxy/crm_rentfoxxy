'use strict';
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { nextStkNumber, nextWoNumber } = require('../services/supportNumberService');
const { instantiateWoSteps } = require('../services/supportWorkOrderSteps');
const { logEvent } = require('../services/supportTicketStateService');

if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to run: set ALLOW_DEMO_SEED=true');
  process.exit(1);
}

const RESET = process.argv.includes('--reset');

const DEMO_USERS = [
  { name: 'Demo Support Agent', email: 'demo.support.agent@rentfoxxy.local', role: 'support_agent' },
  { name: 'Demo Support Lead', email: 'demo.support.lead@rentfoxxy.local', role: 'support_lead' },
  { name: 'Demo Support Tech', email: 'demo.support.tech@rentfoxxy.local', role: 'support_tech' },
  { name: 'Demo Support Manager', email: 'demo.support.manager@rentfoxxy.local', role: 'support_manager' },
];

const DEMO_CUSTOMERS = [
  { name: 'Demo Platinum Fleet', email: 'demo.platinum@rentfoxxy.local', tier: 'PLATINUM' },
  { name: 'Demo Gold Office', email: 'demo.gold@rentfoxxy.local', tier: 'GOLD' },
  { name: 'Demo Standard Shop', email: 'demo.standard@rentfoxxy.local', tier: 'STANDARD' },
];

const GROUP_ASSIGN = {
  'demo.support.agent@rentfoxxy.local': { group: 'Remote L1', lead: false },
  'demo.support.lead@rentfoxxy.local': { group: 'Remote L2', lead: true },
  'demo.support.tech@rentfoxxy.local': { group: 'NCR Field', lead: false },
  'demo.support.manager@rentfoxxy.local': { group: 'Chip-level Repair', lead: true },
};

async function catalog(client, code) {
  const r = await client.query(
    `SELECT c.catalog_id, c.code, c.level, c.parent_id
       FROM support_issue_catalog c WHERE c.code = $1`,
    [code]
  );
  if (!r.rows[0]) throw new Error(`catalogue missing ${code}`);
  return r.rows[0];
}

async function chain(client, issueCode) {
  const issue = await catalog(client, issueCode);
  const subtype = await client.query(
    'SELECT catalog_id, parent_id, code FROM support_issue_catalog WHERE catalog_id = $1',
    [issue.parent_id]
  );
  const type = await client.query(
    'SELECT catalog_id, code FROM support_issue_catalog WHERE catalog_id = $1',
    [subtype.rows[0].parent_id]
  );
  return { typeId: type.rows[0].catalog_id, subtypeId: subtype.rows[0].catalog_id, issueId: issue.catalog_id };
}

async function wipeDemo(client) {
  await client.query(`
    DELETE FROM support_ticket_events
     WHERE ticket_id IN (SELECT ticket_id FROM support_tickets_v2 WHERE demo_seed = true)`);
  await client.query(`DELETE FROM support_attachments WHERE demo_seed = true`);
  await client.query(`DELETE FROM support_approvals WHERE demo_seed = true`);
  await client.query(`DELETE FROM customer_invoice_extra_lines WHERE demo_seed = true`);
  await client.query(`DELETE FROM asset_billing_holds WHERE demo_seed = true`);
  await client.query(`DELETE FROM vendor_warranty_claims WHERE demo_seed = true`);
  await client.query(`DELETE FROM customer_buffer_stock WHERE demo_seed = true`);
  await client.query(`
    DELETE FROM support_work_order_actions
     WHERE wo_id IN (SELECT wo_id FROM support_work_orders WHERE demo_seed = true)`);
  await client.query(`
    DELETE FROM support_work_order_steps
     WHERE wo_id IN (SELECT wo_id FROM support_work_orders WHERE demo_seed = true)`);
  await client.query(`
    DELETE FROM support_work_order_assets
     WHERE wo_id IN (SELECT wo_id FROM support_work_orders WHERE demo_seed = true)`);
  await client.query(`DELETE FROM support_work_orders WHERE demo_seed = true`);
  await client.query(`DELETE FROM support_ticket_assets WHERE demo_seed = true`);
  await client.query(`DELETE FROM support_tickets_v2 WHERE demo_seed = true`);
  await client.query(`
    DELETE FROM support_group_members
     WHERE user_id IN (SELECT user_id FROM users WHERE demo_seed = true)`);
  await client.query(`
    DELETE FROM user_skills
     WHERE user_id IN (SELECT user_id FROM users WHERE demo_seed = true)`);
  await client.query(`
    DELETE FROM user_shifts
     WHERE user_id IN (SELECT user_id FROM users WHERE demo_seed = true)`);
  await client.query(`DELETE FROM users WHERE demo_seed = true`);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (RESET) await wipeDemo(client);

    const passwordHash = await bcrypt.hash('DemoSupport!23', 10);
    for (const u of DEMO_USERS) {
      await client.query(
        `INSERT INTO users (name, email, password_hash, remember_pass_plain, role, user_type, status, active, demo_seed)
         VALUES ($1, $2, $3, $4, $5, 'internal', 'active', true, true)
         ON CONFLICT (email) DO UPDATE
           SET role = EXCLUDED.role,
               password_hash = EXCLUDED.password_hash,
               remember_pass_plain = EXCLUDED.remember_pass_plain,
               demo_seed = true,
               active = true,
               status = 'active'`,
        [u.name, u.email, passwordHash, 'DemoSupport!23', u.role]
      );
    }

    for (const c of DEMO_CUSTOMERS) {
      const existing = await client.query('SELECT customer_id FROM customers WHERE email = $1', [c.email]);
      if (existing.rows[0]) {
        await client.query(
          `UPDATE customers SET support_tier = $2, company_name = $3 WHERE email = $1`,
          [c.email, c.tier, c.name]
        );
      } else {
        await client.query(
          `INSERT INTO customers (name, email, company_name, support_tier, status, type)
           VALUES ($1, $2, $3, $4, 1, 'New')`,
          [c.name, c.email, c.name, c.tier]
        );
      }
    }

    const users = {};
    for (const u of DEMO_USERS) {
      const r = await client.query('SELECT user_id FROM users WHERE email = $1', [u.email]);
      users[u.email] = r.rows[0].user_id;
    }
    const customers = {};
    for (const c of DEMO_CUSTOMERS) {
      const r = await client.query('SELECT customer_id FROM customers WHERE email = $1', [c.email]);
      customers[c.tier] = r.rows[0].customer_id;
    }

    const groups = {};
    const gRows = await client.query('SELECT group_id, name FROM support_assignment_groups');
    for (const g of gRows.rows) groups[g.name] = g.group_id;

    for (const [email, spec] of Object.entries(GROUP_ASSIGN)) {
      await client.query(
        `INSERT INTO support_group_members (group_id, user_id, is_lead)
         VALUES ($1,$2,$3)
         ON CONFLICT (group_id, user_id) DO UPDATE SET is_lead = EXCLUDED.is_lead`,
        [groups[spec.group], users[email], spec.lead]
      );
    }

    const skillCodes = ['FIELD_SWAP', 'HARDWARE_BASIC', 'SOFTWARE_L1'];
    for (const code of skillCodes) {
      const s = await client.query('SELECT skill_id FROM support_skills WHERE code = $1', [code]);
      if (!s.rows[0]) continue;
      await client.query(
        `INSERT INTO user_skills (user_id, skill_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [users['demo.support.tech@rentfoxxy.local'], s.rows[0].skill_id]
      );
    }

    const resCode = (await client.query(
      `SELECT code_id FROM support_resolution_codes WHERE active = TRUE ORDER BY sort_order LIMIT 1`
    )).rows[0];
    const rootCause = (await client.query(
      `SELECT cause_id FROM support_root_causes WHERE active = TRUE ORDER BY sort_order LIMIT 1`
    )).rows[0];

    const hwMbd = await chain(client, 'HW-MBD-UNS');
    const hwDis = await chain(client, 'HW-DIS-CRK');
    const hwBat = await chain(client, 'HW-BAT-UNS');
    const swOs = await chain(client, 'SW-OS-UNS');
    const netWif = await chain(client, 'NET-WIF-UNS');
    const logRet = await chain(client, 'LOG-RET-UNS');
    const svcOth = await chain(client, 'SVC-OTH-UNS');

    const agent = users['demo.support.agent@rentfoxxy.local'];
    const lead = users['demo.support.lead@rentfoxxy.local'];
    const tech = users['demo.support.tech@rentfoxxy.local'];
    const manager = users['demo.support.manager@rentfoxxy.local'];

    const specs = [
      { status: 'NEW', pri: 1, cls: 'INCIDENT', cust: 'PLATINUM', chain: hwMbd, wo: null, subject: 'Demo P1 new — board dead' },
      { status: 'TRIAGED', pri: 2, cls: 'INCIDENT', cust: 'GOLD', chain: hwDis, wo: null, subject: 'Demo triaged cracked panel' },
      { status: 'ASSIGNED', pri: 2, cls: 'INCIDENT', cust: 'PLATINUM', chain: hwBat, wo: 'FIELD_VISIT', assignee: tech, subject: 'Demo assigned battery' },
      { status: 'IN_PROGRESS', pri: 1, cls: 'INCIDENT', cust: 'PLATINUM', chain: hwMbd, wo: 'REPAIR_PICKUP', assignee: tech, subject: 'Demo in progress repair pickup', breached: true },
      { status: 'PENDING', pri: 3, cls: 'INCIDENT', cust: 'GOLD', chain: swOs, wo: 'REMOTE_FIX', assignee: agent, subject: 'Demo paused pending customer', paused: true },
      { status: 'RESOLVED', pri: 3, cls: 'INCIDENT', cust: 'STANDARD', chain: netWif, wo: 'REMOTE_FIX', assignee: agent, subject: 'Demo resolved wifi', resolved: true },
      { status: 'CLOSED', pri: 4, cls: 'INCIDENT', cust: 'STANDARD', chain: svcOth, wo: null, subject: 'Demo closed other', closed: true },
      { status: 'CANCELLED', pri: 4, cls: 'REQUEST', cust: 'STANDARD', chain: logRet, wo: 'RETURN_PICKUP', subject: 'Demo cancelled return' },
      { status: 'IN_PROGRESS', pri: 2, cls: 'REQUEST', cust: 'GOLD', chain: logRet, wo: 'RETURN_PICKUP', assignee: tech, subject: 'Demo return pickup' },
      { status: 'ASSIGNED', pri: 2, cls: 'REQUEST', cust: 'PLATINUM', chain: logRet, wo: 'SERVICE_RETURN', assignee: tech, subject: 'Demo service return' },
      { status: 'ASSIGNED', pri: 2, cls: 'INCIDENT', cust: 'GOLD', chain: hwDis, wo: 'REPLACEMENT_DELIVERY', assignee: tech, subject: 'Demo replacement delivery', replace: true },
      { status: 'IN_PROGRESS', pri: 3, cls: 'INCIDENT', cust: 'STANDARD', chain: hwBat, wo: 'PART_DELIVERY', assignee: tech, subject: 'Demo part delivery' },
      { status: 'ASSIGNED', pri: 3, cls: 'INCIDENT', cust: 'GOLD', chain: hwBat, wo: 'PART_RETURN', assignee: tech, subject: 'Demo part return' },
      { status: 'NEW', pri: 3, cls: 'INCIDENT', cust: 'STANDARD', chain: swOs, wo: null, subject: 'Demo software new' },
      { status: 'TRIAGED', pri: 4, cls: 'REQUEST', cust: 'STANDARD', chain: logRet, wo: null, subject: 'Demo request triaged' },
      { status: 'ASSIGNED', pri: 1, cls: 'INCIDENT', cust: 'PLATINUM', chain: hwMbd, wo: 'FIELD_VISIT', assignee: tech, subject: 'Demo P1 field visit' },
      { status: 'IN_PROGRESS', pri: 2, cls: 'INCIDENT', cust: 'GOLD', chain: hwDis, wo: 'REPAIR_PICKUP', assignee: tech, subject: 'Demo chargeable awaiting approval', chargeable: true },
      { status: 'PENDING', pri: 3, cls: 'INCIDENT', cust: 'STANDARD', chain: swOs, wo: 'REMOTE_FIX', assignee: lead, subject: 'Demo pending vendor', pending: 'PENDING_VENDOR' },
      { status: 'IN_PROGRESS', pri: 2, cls: 'INCIDENT', cust: 'PLATINUM', chain: hwMbd, wo: 'REPAIR_PICKUP', assignee: tech, subject: 'Demo repeat asset', repeat: true },
      { status: 'NEW', pri: 4, cls: 'REQUEST', cust: 'GOLD', chain: logRet, wo: null, subject: 'Demo logistics new' },
      { status: 'ASSIGNED', pri: 3, cls: 'INCIDENT', cust: 'STANDARD', chain: netWif, wo: 'FIELD_VISIT', assignee: tech, subject: 'Demo network field' },
      { status: 'IN_PROGRESS', pri: 3, cls: 'INCIDENT', cust: 'GOLD', chain: hwBat, wo: 'PART_DELIVERY', assignee: tech, subject: 'Demo part in progress' },
      { status: 'RESOLVED', pri: 2, cls: 'INCIDENT', cust: 'PLATINUM', chain: hwDis, wo: 'FIELD_VISIT', assignee: tech, subject: 'Demo resolved display', resolved: true },
      { status: 'CLOSED', pri: 3, cls: 'REQUEST', cust: 'STANDARD', chain: logRet, wo: 'RETURN_PICKUP', assignee: tech, subject: 'Demo closed return', closed: true },
      { status: 'IN_PROGRESS', pri: 1, cls: 'INCIDENT', cust: 'PLATINUM', chain: hwMbd, wo: 'REPAIR_PICKUP', assignee: manager, subject: 'Demo chip-level in progress' },
    ];

    let repeatOf = null;
    for (let i = 0; i < specs.length; i += 1) {
      const s = specs[i];
      const number = await nextStkNumber(client);
      const serial = `DEMO-SN-${String(i + 1).padStart(3, '0')}`;
      const ttspl = `TTSPL-DEMO-${String(i + 1).padStart(4, '0')}`;
      const ticket = await client.query(
        `INSERT INTO support_tickets_v2 (
           ticket_number, ticket_class, channel, status, pending_reason,
           priority, impact, urgency, customer_id, site_label,
           contact_name, contact_phone, subject, assignment_group_id, assigned_to,
           sla_resolution_due_at, sla_started_at, sla_paused, sla_breached, sla_resolution_breached,
           created_by, resolved_at, closed_at, demo_seed
         ) VALUES (
           $1,$2,'PHONE',$3,$4,
           $5,2,2,$6,$7,
           $8,'9898989898',$9,$10,$11,
           $12,NOW(),$13,$14,$14,
           $15,$16,$17,true
         ) RETURNING ticket_id`,
        [
          number,
          s.cls,
          s.status,
          s.paused ? 'PENDING_CUSTOMER' : (s.pending || null),
          s.pri,
          customers[s.cust],
          s.cust === 'PLATINUM' ? 'Gurugram HQ' : 'Demo site',
          `Demo contact ${i + 1}`,
          s.subject,
          groups['NCR Field'] || null,
          s.assignee || null,
          s.breached ? new Date(Date.now() - 36 * 3600 * 1000) : (s.closed || s.status === 'CANCELLED' ? null : new Date(Date.now() + 48 * 3600 * 1000)),
          Boolean(s.paused),
          Boolean(s.breached),
          agent,
          s.resolved ? new Date() : null,
          s.closed ? new Date() : null,
        ]
      );
      const ticketId = ticket.rows[0].ticket_id;
      if (i === 0) repeatOf = ticketId;

      const line = await client.query(
        `INSERT INTO support_ticket_assets (
           ticket_id, line_code, ttspl_id, serial_number,
           reported_type_id, reported_subtype_id, reported_issue_id,
           reported_description, impact, urgency, is_repeat, repeat_of_ticket_id,
           line_status, resolution_code_id, root_cause_id, liability,
           chargeable_amount, demo_seed
         ) VALUES (
           $1,'A1',$2,$3,$4,$5,$6,
           $7,2,2,$8,$9,
           $10,$11,$12,$13,
           $14,true
         ) RETURNING line_id`,
        [
          ticketId,
          ttspl,
          serial,
          s.chain.typeId,
          s.chain.subtypeId,
          s.chain.issueId,
          `${s.subject} — customer described the fault in enough detail.`,
          Boolean(s.repeat),
          s.repeat ? repeatOf : null,
          s.resolved || s.closed ? 'RESOLVED' : (s.status === 'CANCELLED' ? 'CANCELLED' : (s.status === 'IN_PROGRESS' || s.status === 'PENDING' ? 'IN_PROGRESS' : 'OPEN')),
          s.resolved || s.closed ? resCode && resCode.code_id : null,
          s.resolved || s.closed ? rootCause && rootCause.cause_id : null,
          s.chargeable ? 'CUSTOMER_CHARGEABLE' : ((s.resolved || s.closed) ? 'COMPANY' : null),
          s.chargeable ? 4500 : null,
        ]
      );
      const lineId = line.rows[0].line_id;

      if (s.wo) {
        const woNumber = await nextWoNumber(client);
        const woStatus = s.status === 'CANCELLED' ? 'CANCELLED'
          : s.resolved || s.closed ? 'COMPLETED'
            : s.status === 'ASSIGNED' ? 'ASSIGNED'
              : s.status === 'IN_PROGRESS' || s.status === 'PENDING' ? 'IN_PROGRESS'
                : 'PENDING_ASSIGNMENT';
        const wo = await client.query(
          `INSERT INTO support_work_orders (
             wo_number, ticket_id, wo_type, status, assigned_to, replacement_group_id, demo_seed
           ) VALUES ($1,$2,$3,$4,$5,$6,true)
           RETURNING wo_id`,
          [woNumber, ticketId, s.wo, woStatus, s.assignee || null, s.replace ? `RG-DEMO-${ticketId}` : null]
        );
        await instantiateWoSteps(client, wo.rows[0].wo_id, s.wo);
        await client.query(
          `INSERT INTO support_work_order_assets (wo_id, line_id) VALUES ($1,$2)`,
          [wo.rows[0].wo_id, lineId]
        );
        if (s.replace) {
          const collectNo = await nextWoNumber(client);
          const collect = await client.query(
            `INSERT INTO support_work_orders (
               wo_number, ticket_id, wo_type, status, assigned_to, replacement_group_id, linked_wo_id, demo_seed
             ) VALUES ($1,$2,'RETURN_PICKUP','ASSIGNED',$3,$4,$5,true)
             RETURNING wo_id`,
            [collectNo, ticketId, s.assignee || null, `RG-DEMO-${ticketId}`, wo.rows[0].wo_id]
          );
          await instantiateWoSteps(client, collect.rows[0].wo_id, 'RETURN_PICKUP');
          await client.query(
            `INSERT INTO support_work_order_assets (wo_id, line_id) VALUES ($1,$2)`,
            [collect.rows[0].wo_id, lineId]
          );
        }
      }

      if (s.chargeable) {
        await client.query(
          `INSERT INTO customer_invoice_extra_lines (
             ticket_id, line_id, customer_id, charge_type, description, amount, status, demo_seed
           ) VALUES ($1,$2,$3,'DAMAGE','Cracked panel — demo charge',4500,'PENDING',true)`,
          [ticketId, lineId, customers[s.cust]]
        );
        await client.query(
          `INSERT INTO support_approvals (
             ticket_id, line_id, approval_type, status, amount, label, requested_by, customer_side, demo_seed
           ) VALUES ($1,$2,'DAMAGE_CHARGE','PENDING',4500,'Demo cracked-panel charge', $3, true, true)`,
          [ticketId, lineId, agent]
        );
      }

      await logEvent(client, {
        ticketId,
        eventType: 'TICKET_CREATED',
        actorId: agent,
        actorKind: 'SYSTEM',
        summary: `Demo ticket ${number} seeded`,
        detail: { demo: true, index: i + 1 },
      });
    }

    await client.query('COMMIT');
    console.log('Support demo seed complete (phase 2).');
    DEMO_USERS.forEach((u) => console.log(`  ${u.role.padEnd(18)} ${u.email}  /  DemoSupport!23`));
    console.log('25 demo tickets created (demo_seed=true), including breached, paused, repeat, chargeable-awaiting-approval.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('seed-support-demo:', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
