const DISPATCH_QC_TEAM_NAME = 'Dispatch QC Team';
const DISPATCH_QC_SECTION = 'dispatch_qc';

/**
 * Users eligible for Dispatch QC assignment / actions:
 * - dispatch_qc role
 * - team_member / team_lead on Dispatch QC Team
 * - dispatch_qc permission section (role default or user override) with can_edit
 */
async function queryDispatchQcEligibleMembers(pool, teamId) {
  const r = await pool.query(
    `SELECT u.user_id, u.name, u.role,
            COUNT(t.ticket_id) FILTER (WHERE t.status = 'in_progress')::int AS active_tickets
     FROM users u
     LEFT JOIN tickets t ON t.assigned_user_id = u.user_id AND t.status = 'in_progress'
     WHERE COALESCE(u.active, true) = true
       AND (
         u.role = 'dispatch_qc'
         OR (
           $1::int IS NOT NULL
           AND u.role IN ('team_member', 'team_lead')
           AND (
             u.team_id = $1
             OR EXISTS (
               SELECT 1 FROM user_teams ut
               WHERE ut.user_id = u.user_id AND ut.team_id = $1
             )
           )
         )
         OR COALESCE(
           (SELECT up.can_edit
            FROM user_permissions up
            WHERE up.user_id = u.user_id AND up.section = $2
            LIMIT 1),
           (SELECT rp.can_edit
            FROM role_permissions rp
            WHERE rp.role = u.role AND rp.section = $2
            LIMIT 1),
           false
         ) = true
       )
     GROUP BY u.user_id, u.name, u.role
     ORDER BY active_tickets ASC, u.name ASC`,
    [teamId, DISPATCH_QC_SECTION]
  );
  return r.rows;
}

function userHasDispatchQcTeam(teamNames) {
  if (!Array.isArray(teamNames)) return false;
  return teamNames.some(
    (n) => String(n).trim().toLowerCase() === DISPATCH_QC_TEAM_NAME.toLowerCase()
  );
}

module.exports = {
  DISPATCH_QC_TEAM_NAME,
  DISPATCH_QC_SECTION,
  queryDispatchQcEligibleMembers,
  userHasDispatchQcTeam,
};
