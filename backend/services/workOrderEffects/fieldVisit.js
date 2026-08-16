'use strict';

const { logEvent } = require('../supportTicketStateService');

async function onCreate() { return null; }
async function onAssign() { return null; }
async function onCancel() { return null; }

async function onComplete(client, wo, body) {
  const outcome = String(body.outcome || '').toUpperCase();
  if (outcome === 'RESOLVED') {
    const fos = await client.query(
      `SELECT code_id FROM support_resolution_codes WHERE code = 'RES-FOS' LIMIT 1`
    );
    if (fos.rows[0] && body.line_id) {
      await client.query(
        `UPDATE support_ticket_assets
            SET resolution_code_id = COALESCE(resolution_code_id, $2),
                updated_at = NOW()
          WHERE line_id = $1`,
        [body.line_id, fos.rows[0].code_id]
      );
    }
    return { suggested_next_wo_type: null };
  }
  if (outcome === 'NOT_RESOLVED') {
    let suggested = null;
    if (body.found_issue_id) {
      const cat = await client.query(
        `SELECT default_wo_type FROM support_issue_catalog WHERE catalog_id = $1`,
        [body.found_issue_id]
      );
      suggested = cat.rows[0]?.default_wo_type || null;
    }
    await client.query(
      `UPDATE support_work_orders SET suggested_next_wo_type = $2 WHERE wo_id = $1`,
      [wo.wo_id, suggested]
    );
    await logEvent(client, {
      ticketId: wo.ticket_id,
      woId: wo.wo_id,
      eventType: 'NEXT_WO_SUGGESTED',
      actorKind: 'SYSTEM',
      summary: suggested ? `Suggested ${suggested}` : 'No next work order suggested',
      detail: { suggested_next_wo_type: suggested },
    });
    return { suggested_next_wo_type: suggested };
  }
  return {};
}

module.exports = { onCreate, onAssign, onComplete, onCancel };
