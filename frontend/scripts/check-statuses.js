#!/usr/bin/env node
/**
 * The canonical status list exists twice — backend/constants/statuses.js and
 * frontend/src/config/statuses.js — because there is no shared package between
 * them. Part 1 §6.2 says they come "from the same source"; this is what makes
 * that true, by failing when they drift.
 *
 * It lives here rather than in backend/test/ because Part 1 acceptance 10 caps
 * the backend diff at backend/constants/statuses.js.
 */
const fs = require('fs');
const path = require('path');

const BE = path.resolve(__dirname, '../../backend/constants/statuses.js');
const FE = path.resolve(__dirname, '../src/config/statuses.js');

/** Pull value/family pairs out of the shared table both files declare. */
function parse(file) {
  const src = fs.readFileSync(file, 'utf8');
  const rows = [...src.matchAll(/value:\s*ASSET_STATUS\.([A-Z_]+),\s*family:\s*FAMILY\.([A-Z_]+)/g)];
  const consts = [...src.matchAll(/^\s{2}([A-Z_]+):\s*'([a-z_]+)',$/gm)];
  const byName = Object.fromEntries(consts.map((m) => [m[1], m[2]]));
  return rows.map((m) => ({ status: byName[m[1]] || m[1], family: m[2].toLowerCase() }));
}

let be, fe;
try {
  be = parse(BE);
  fe = parse(FE);
} catch (err) {
  console.error('check-statuses: could not read a status file —', err.message);
  process.exit(1);
}

const problems = [];
if (!be.length || !fe.length) problems.push(`parsed ${be.length} backend and ${fe.length} frontend entries — expected 12 each`);
if (be.length !== fe.length) problems.push(`length differs: backend ${be.length}, frontend ${fe.length}`);

const beMap = Object.fromEntries(be.map((r) => [r.status, r.family]));
const feMap = Object.fromEntries(fe.map((r) => [r.status, r.family]));

for (const s of Object.keys(beMap)) {
  if (!(s in feMap)) problems.push(`"${s}" is in the backend list and not the frontend one`);
  else if (beMap[s] !== feMap[s]) problems.push(`"${s}" family differs: backend ${beMap[s]}, frontend ${feMap[s]}`);
}
for (const s of Object.keys(feMap)) {
  if (!(s in beMap)) problems.push(`"${s}" is in the frontend list and not the backend one`);
}

// Order is meaningful — the list is in lifecycle order, which is how filters present it.
be.forEach((r, i) => {
  if (fe[i] && fe[i].status !== r.status) {
    problems.push(`position ${i}: backend "${r.status}" vs frontend "${fe[i].status}" — lists must stay in the same lifecycle order`);
  }
});

if (problems.length) {
  console.error('check-statuses: the two canonical lists disagree.\n');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log(`check-statuses: clean — ${be.length} statuses, families match, order matches.`);
