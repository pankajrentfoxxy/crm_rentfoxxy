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

/**
 * Record manual QC2 pick so the next round-robin continues from this user.
 */
async function recordAssigneeForTeam(client, teamId, userId) {
    if (teamId == null || userId == null) return;
    await client.query(
        `INSERT INTO qc_round_robin_state (team_id, last_assigned_user_id, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (team_id) DO UPDATE
         SET last_assigned_user_id = EXCLUDED.last_assigned_user_id,
             updated_at = CURRENT_TIMESTAMP`,
        [teamId, userId]
    );
}

async function findLastStageWorker(client, ticketId, stageName) {
    const r = await client.query(
        `SELECT wl.user_id
         FROM work_logs wl
         INNER JOIN stages s ON s.stage_id = wl.stage_id
         WHERE wl.ticket_id = $1 AND s.stage_name = $2
         ORDER BY wl.start_time DESC
         LIMIT 1`,
        [ticketId, stageName]
    );
    return r.rows[0]?.user_id ?? null;
}

/**
 * Pick a QC assignee inside the caller's transaction (avoids nested pool connections).
 * Falls back to the ticket's previous worker at the target stage, then any team member.
 */
async function resolveQcAssignee(client, { teamId, ticketId, targetStageName, transitionKey }) {
    if (teamId == null) return null;

    let userId = null;
    try {
        userId = await pickNextAssigneeForTeam(client, teamId);
    } catch (err) {
        console.error('QC round-robin failed:', err.message);
    }

    if (!userId && transitionKey === 'QC2→QC1' && ticketId) {
        userId = await findLastStageWorker(client, ticketId, 'QC1');
    }

    if (!userId && targetStageName) {
        userId = await findLastStageWorker(client, ticketId, targetStageName);
    }

    if (!userId) {
        const ids = await fetchOrderedMemberIds(client, teamId);
        userId = ids[0] ?? null;
        if (userId) {
            await recordAssigneeForTeam(client, teamId, userId);
        }
    }

    return userId;
}

module.exports = {
    fetchOrderedMemberIds,
    pickNextAssigneeForTeam,
    pickNextAssigneeForTeamPool,
    recordAssigneeForTeam,
    findLastStageWorker,
    resolveQcAssignee
};
