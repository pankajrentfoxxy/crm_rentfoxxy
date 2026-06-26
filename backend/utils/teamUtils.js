/**
 * Teams table may contain duplicate team_name rows (legacy migrations).
 * Always resolve to the canonical team_id (lowest id per normalized name).
 */
const pool = require('../config/db');

function normalizeTeamName(name) {
  return String(name || '').trim().toLowerCase();
}

let canonicalCache = null;
let canonicalCacheAt = 0;
const CACHE_MS = 60_000;

async function loadCanonicalTeamMaps(force = false) {
  const now = Date.now();
  if (!force && canonicalCache && now - canonicalCacheAt < CACHE_MS) {
    return canonicalCache;
  }

  const { rows } = await pool.query(
    `SELECT team_id, team_name FROM teams WHERE TRIM(COALESCE(team_name, '')) <> '' ORDER BY team_id`
  );

  const byName = new Map();
  const idToCanonical = new Map();

  for (const row of rows) {
    const key = normalizeTeamName(row.team_name);
    if (!key) continue;
    let canonical = byName.get(key);
    if (!canonical || Number(row.team_id) < Number(canonical.team_id)) {
      canonical = { team_id: Number(row.team_id), team_name: row.team_name };
      byName.set(key, canonical);
    }
  }

  for (const row of rows) {
    const key = normalizeTeamName(row.team_name);
    const canonical = byName.get(key);
    if (canonical) idToCanonical.set(Number(row.team_id), canonical.team_id);
  }

  canonicalCache = { byName, idToCanonical, displayTeams: [...byName.values()] };
  canonicalCacheAt = now;
  return canonicalCache;
}

function invalidateCanonicalTeamCache() {
  canonicalCache = null;
  canonicalCacheAt = 0;
}

async function getDisplayTeams() {
  const { displayTeams } = await loadCanonicalTeamMaps();
  return [...displayTeams].sort((a, b) =>
    String(a.team_name).localeCompare(String(b.team_name))
  );
}

async function normalizeTeamIds(teamIds) {
  if (!Array.isArray(teamIds) || !teamIds.length) return [];
  const { idToCanonical } = await loadCanonicalTeamMaps();
  const out = [];
  for (const raw of teamIds) {
    const id = parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    const canonical = idToCanonical.get(id) ?? id;
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}

module.exports = {
  normalizeTeamName,
  loadCanonicalTeamMaps,
  invalidateCanonicalTeamCache,
  getDisplayTeams,
  normalizeTeamIds,
};
