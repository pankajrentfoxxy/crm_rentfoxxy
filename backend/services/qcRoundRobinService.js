/**
 * Round-robin assignment of tickets to active members of a QC (or any) team.
 * Persists last pick per team in qc_round_robin_state (see migrations).
 */
const pool = require('../config/db');

async function fetchOrderedMemberIds(client, teamId) {
    const res = await client.query(
        `SELECT DISTINCT u.user_id
         FROM users u
         LEFT JOIN user_teams ut ON u.user_id = ut.user_id AND ut.team_id = $1
         WHERE (u.team_id = $1 OR ut.team_id = $1)
           AND COALESCE(u.active, true) = true
         ORDER BY u.user_id ASC`,
        [teamId]
    );
    return res.rows.map((r) => r.user_id);
}

/**
 * @param {import('pg').PoolClient} client — must be inside BEGIN (uses FOR UPDATE)
 * @param {number} teamId — teams.team_id for QC1 or QC2 stage
 * @returns {Promise<number|null>}
 */
async function pickNextAssigneeForTeam(client, teamId) {
    if (teamId == null) return null;
    const ids = await fetchOrderedMemberIds(client, teamId);
    if (ids.length === 0) return null;
    if (ids.length === 1) return ids[0];

    const stRes = await client.query(
        `SELECT last_assigned_user_id FROM qc_round_robin_state WHERE team_id = $1 FOR UPDATE`,
        [teamId]
    );
    let nextIdx = 0;
    if (stRes.rows.length > 0) {
        const last = stRes.rows[0].last_assigned_user_id;
        const lastIdx = last != null ? ids.indexOf(last) : -1;
        nextIdx = (lastIdx + 1) % ids.length;
    }
    const picked = ids[nextIdx];
    await client.query(
        `INSERT INTO qc_round_robin_state (team_id, last_assigned_user_id, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (team_id) DO UPDATE
         SET last_assigned_user_id = EXCLUDED.last_assigned_user_id,
             updated_at = CURRENT_TIMESTAMP`,
        [teamId, picked]
    );
    return picked;
}

/**
 * Short transaction when no outer client exists (e.g. moveToNextStage).
 */
async function pickNextAssigneeForTeamPool(db, teamId) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const userId = await pickNextAssigneeForTeam(client, teamId);
        await client.query('COMMIT');
        return userId;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = {
    pickNextAssigneeForTeam,
    pickNextAssigneeForTeamPool
};
