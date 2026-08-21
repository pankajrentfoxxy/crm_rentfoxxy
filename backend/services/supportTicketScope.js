'use strict';

const FIELD_TECH_ROLES = new Set(['support_tech', 'technician']);

function isFieldTechnician(user) {
  return !!(user && FIELD_TECH_ROLES.has(user.role));
}

function technicianVisibleSql(alias, userParam) {
  return `(${alias}.assigned_to = ${userParam} OR EXISTS (
    SELECT 1 FROM support_work_orders w_scope
     WHERE w_scope.ticket_id = ${alias}.ticket_id
       AND w_scope.assigned_to = ${userParam}
  ))`;
}

function applyTechnicianTicketScope(user, conds, params, alias = 't') {
  if (!isFieldTechnician(user) || !user.user_id) return;
  params.push(Number(user.user_id));
  conds.push(technicianVisibleSql(alias, `$${params.length}`));
}

async function assertTechnicianCanSeeTicket(db, user, ticketId) {
  if (!isFieldTechnician(user)) return;
  const r = await db.query(
    `SELECT 1 FROM support_tickets_v2 t
      WHERE t.ticket_id = $1 AND ${technicianVisibleSql('t', '$2')}`,
    [ticketId, user.user_id]
  );
  if (!r.rows[0]) {
    throw Object.assign(new Error('Ticket not found'), { status: 404 });
  }
}

module.exports = {
  FIELD_TECH_ROLES,
  isFieldTechnician,
  technicianVisibleSql,
  applyTechnicianTicketScope,
  assertTechnicianCanSeeTicket,
};
