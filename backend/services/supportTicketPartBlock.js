/**
 * Outstanding-part check for SUPPORT tickets.
 *
 * closeTicket and cancelTicket only ever looked at support_ticket_items, so a
 * ticket could close with parts still out. services/ticketPartBlockService.js
 * does this job for FLOOR tickets (part_requests + ticket_part_blocks), but
 * support tickets use a different table — support_part_requests — and had no
 * equivalent. Measured before this was added: 45 part requests still open on
 * closed or cancelled tickets, 26 of them 'issued', i.e. physically with a
 * technician and already decremented from stock, with no open ticket left to
 * drive markPartUsed or returnPart.
 */

/**
 * Statuses that mean the part is accounted for. Anything else is still out.
 * Listing the SETTLED states rather than the open ones is deliberate: the
 * lifecycle has a dozen in-flight statuses (approved, dispatched, in_transit,
 * courier_in_transit, delivered, challan_generated, …) and a new one must
 * default to "still outstanding", not to "safe to ignore".
 */
const SETTLED_STATUSES = ['used', 'returned', 'cancelled', 'not_applicable', 'rejected'];

async function getSupportTicketPartBlock(db, ticketId) {
  const { rows } = await db.query(
    `SELECT pr.id AS request_id, pr.request_number, pr.status, pr.quantity,
            COALESCE(p.part_name, pr.ttspl_id, '') AS part_name
       FROM support_part_requests pr
       LEFT JOIN parts p ON p.part_id = pr.part_id
      WHERE pr.support_ticket_id = $1
        AND LOWER(COALESCE(pr.status, '')) <> ALL($2::text[])
      ORDER BY pr.id`,
    [ticketId, SETTLED_STATUSES]
  );

  if (!rows.length) return { blocked: false, count: 0, requests: [] };

  const describe = (r) => `${r.part_name || r.request_number || `#${r.request_id}`} (${r.status})`;
  const issued = rows.filter((r) => String(r.status).toLowerCase() === 'issued');

  let message = `${rows.length} part request(s) are still open on this ticket: ${rows.map(describe).join(', ')}.`;
  if (issued.length) {
    message += ` ${issued.length} of them are already issued and out of stock — mark them used or returned first,`
      + ' otherwise the stock is written off with no record.';
  } else {
    message += ' Settle them (used / returned / cancelled) before closing.';
  }

  return { blocked: true, count: rows.length, issuedCount: issued.length, requests: rows, message };
}

module.exports = { getSupportTicketPartBlock, SETTLED_STATUSES };
