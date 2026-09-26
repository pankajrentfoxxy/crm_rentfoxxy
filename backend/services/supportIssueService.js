/**
 * Support issue process (claude/carret-support.md, rework A+B; migration 348).
 *
 * Reported: every laptop on a ticket raised from now on says Type > Subtype >
 * Issue from support_issue_catalog. Staff pick all three; a customer (QR page,
 * portal) picks Type > Subtype and the issue starts as that subtype's
 * "Unspecified" until the lead or technician sets it.
 *
 * Found: before the job counts as done, what was actually wrong (same three
 * levels), the root cause and what fixed it. Laptops without a reported issue
 * (every ticket raised before this) are left alone.
 */

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** Which fixes fit which finish. */
const RESOLUTIONS_FOR = {
  fixed: ['RES-FOS', 'RES-PRT', 'RES-RMT', 'RES-KNW', 'RES-INF'],
  working: ['RES-NFF'],
  replacement_required: ['RES-SWP'],
  workshop: ['RES-RPR', 'RES-PRT', 'RES-NFF'],
};

async function catalogTree(db) {
  const rows = (await db.query(
    `SELECT catalog_id AS id, parent_id, level, code, name, requires_photo, chargeable_default
       FROM support_issue_catalog
      WHERE active
      ORDER BY level, sort_order, name`
  )).rows;
  const types = rows.filter((r) => r.level === 1).map((t) => ({ id: t.id, code: t.code, name: t.name, subtypes: [] }));
  const byId = new Map(types.map((t) => [t.id, t]));
  const subs = new Map();
  for (const s of rows.filter((r) => r.level === 2)) {
    const node = { id: s.id, code: s.code, name: s.name, issues: [] };
    subs.set(s.id, node);
    byId.get(s.parent_id)?.subtypes.push(node);
  }
  for (const i of rows.filter((r) => r.level === 3)) {
    subs.get(i.parent_id)?.issues.push({ id: i.id, code: i.code, name: i.name, requires_photo: i.requires_photo, chargeable: i.chargeable_default });
  }
  const causes = (await db.query(
    `SELECT cause_id AS id, code, name, default_liability FROM support_root_causes WHERE active ORDER BY sort_order`
  )).rows;
  const fixes = (await db.query(
    `SELECT code_id AS id, code, name FROM support_resolution_codes WHERE active ORDER BY sort_order`
  )).rows;
  return { types, root_causes: causes, resolutions: fixes, resolutions_for: RESOLUTIONS_FOR };
}

/**
 * Checks a Type > Subtype > Issue choice hangs together. Without an issue (a
 * customer's choice) the subtype's Unspecified row is used.
 */
async function resolveIssue(db, { type_id: typeId, subtype_id: subtypeId, issue_id: issueId } = {}, { requireIssue = true, what = 'the issue' } = {}) {
  const t = Number(typeId);
  const s = Number(subtypeId);
  if (!t || !s) throw fail(`Choose the type and subtype of ${what}`);
  if (requireIssue && !Number(issueId)) throw fail(`Choose ${what}`);
  const chain = (await db.query(
    `SELECT t.catalog_id AS type_id, t.name AS type_name, s.catalog_id AS subtype_id, s.name AS subtype_name, s.code AS subtype_code
       FROM support_issue_catalog s
       JOIN support_issue_catalog t ON t.catalog_id = s.parent_id AND t.level = 1
      WHERE s.catalog_id = $1 AND s.level = 2 AND t.catalog_id = $2`,
    [s, t]
  )).rows[0];
  if (!chain) throw fail(`The subtype does not belong to that type (${what})`);
  let issue;
  if (Number(issueId)) {
    issue = (await db.query(
      `SELECT catalog_id AS id, name FROM support_issue_catalog WHERE catalog_id = $1 AND level = 3 AND parent_id = $2`,
      [Number(issueId), s]
    )).rows[0];
    if (!issue) throw fail(`The issue does not belong to that subtype (${what})`);
  } else {
    issue = (await db.query(
      `SELECT catalog_id AS id, name FROM support_issue_catalog WHERE code = $1 AND level = 3`,
      [`${chain.subtype_code}-UNS`]
    )).rows[0];
    if (!issue) throw fail(`No "Unspecified" issue under ${chain.subtype_name}`);
  }
  return {
    type_id: chain.type_id,
    subtype_id: chain.subtype_id,
    issue_id: issue.id,
    label: `${chain.type_name} › ${chain.subtype_name} › ${issue.name}`,
  };
}

/** Pulls reported_type_id / reported_subtype_id / reported_issue_id off a request item. */
function reportedFrom(item = {}) {
  return { type_id: item.reported_type_id, subtype_id: item.reported_subtype_id, issue_id: item.reported_issue_id };
}

/** Writes the reported issue on a laptop (and the readable label old screens show). */
async function setReported(db, itemId, rep) {
  await db.query(
    `UPDATE support_ticket_items
        SET reported_type_id = $2, reported_subtype_id = $3, reported_issue_id = $4,
            issue_category_id = NULL, issue_category_label = $5, updated_at = NOW()
      WHERE id = $1`,
    [itemId, rep.type_id, rep.subtype_id, rep.issue_id, rep.label]
  );
}

/**
 * Records what was wrong, why and what fixed it. `finish` picks the allowed
 * fixes (fixed / working / replacement_required / workshop); a finish with one
 * possible fix takes it without asking.
 */
async function recordFinding(db, item, body = {}, { finish, userId }) {
  const allowed = RESOLUTIONS_FOR[finish];
  if (!allowed) throw fail('Unknown finish');
  const found = await resolveIssue(db, {
    type_id: body.found_type_id ?? item.reported_type_id,
    subtype_id: body.found_subtype_id ?? item.reported_subtype_id,
    issue_id: body.found_issue_id ?? (body.found_subtype_id ? null : item.reported_issue_id),
  }, { what: 'what was actually wrong' });
  if (/› Unspecified$/.test(found.label) && finish !== 'working') throw fail('Say what was actually wrong — not "Unspecified"');

  let causeId = Number(body.root_cause_id) || null;
  if (!causeId && finish === 'working') {
    causeId = (await db.query(`SELECT cause_id FROM support_root_causes WHERE code = 'RC-UNK'`)).rows[0]?.cause_id;
  }
  if (!causeId) throw fail('Choose why it happened (root cause)');
  const cause = (await db.query('SELECT cause_id FROM support_root_causes WHERE cause_id = $1 AND active', [causeId])).rows[0];
  if (!cause) throw fail('Unknown root cause');

  const fixCode = body.resolution_code || (allowed.length === 1 ? allowed[0] : null)
    || (body.resolution_code_id ? (await db.query('SELECT code FROM support_resolution_codes WHERE code_id = $1', [Number(body.resolution_code_id)])).rows[0]?.code : null);
  if (!fixCode) throw fail('Choose what fixed it');
  if (!allowed.includes(fixCode)) throw fail('That fix does not match how the job finished');
  const fix = (await db.query('SELECT code_id FROM support_resolution_codes WHERE code = $1', [fixCode])).rows[0];

  const notes = String(body.resolution_notes || '').trim() || null;
  await db.query(
    `UPDATE support_ticket_items
        SET found_type_id = $2, found_subtype_id = $3, found_issue_id = $4,
            root_cause_id = $5, resolution_code_id = $6, resolution_notes = $7,
            finding_by = $8, finding_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [item.id, found.type_id, found.subtype_id, found.issue_id, causeId, fix.code_id, notes, userId || null]
  );
  return { found: found.label, root_cause_id: causeId, resolution: fixCode };
}

/** Laptops (of the given ids) raised under the process whose finding is still missing. */
async function missingFindings(db, itemIds) {
  if (!itemIds.length) return [];
  return (await db.query(
    `SELECT id, COALESCE(unique_serial_number, serial_number) AS code
       FROM support_ticket_items
      WHERE id = ANY($1::int[]) AND item_type = 'complaint'
        AND reported_issue_id IS NOT NULL AND found_issue_id IS NULL`,
    [itemIds]
  )).rows;
}

module.exports = { RESOLUTIONS_FOR, catalogTree, resolveIssue, reportedFrom, setReported, recordFinding, missingFindings, fail };
