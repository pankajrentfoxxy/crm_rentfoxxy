/**
 * Purchase order rules (Procure-to-stock safety fixes, decisions D1/D2/D13).
 *
 * One place for "can this PO be changed / approved / cancelled", so the laptop
 * and spare-part controllers, and their tests, read the same rules.
 *
 *   draft → pending_approval → approved → (vendor_accepted) → processing → completed
 *                         ↘ rejected ↘ (edit returns it to draft)
 */

/** A PO can be edited only before it is submitted, or after it was turned down. */
const EDITABLE = new Set(['', 'draft', 'pending', 'rejected', 'vendor_rejected']);

function canEditPo(status) {
  return EDITABLE.has(String(status || '').toLowerCase());
}

/** Editing a turned-down PO sends it back to draft so it goes through approval again. */
function statusAfterEdit(status) {
  const s = String(status || '').toLowerCase();
  return s === 'rejected' || s === 'vendor_rejected' || s === 'pending' || s === '' ? 'draft' : s;
}

/**
 * D1: the approver must not be the person who created or submitted the PO.
 * Unknown creator/submitter (older POs) cannot block approval.
 */
function approvalConflict({ approverId, creatorId, submitterId }) {
  const a = Number(approverId);
  if (!a) return null;
  if (creatorId && Number(creatorId) === a) return 'You created this purchase order, so someone else must approve it.';
  if (submitterId && Number(submitterId) === a) return 'You submitted this purchase order, so someone else must approve it.';
  return null;
}

/** Laptops (or parts) already received against a PO. */
async function receivedCount(db, { poId, spoId }) {
  const { rows } = await db.query(
    poId
      ? 'SELECT COUNT(*)::int AS n FROM vendor_serial_numbers WHERE po_id = $1 AND deleted_at IS NULL'
      : 'SELECT COUNT(*)::int AS n FROM vendor_serial_numbers WHERE spo_id = $1 AND deleted_at IS NULL',
    [poId || spoId]
  );
  return rows[0]?.n || 0;
}

/** Who created / submitted a laptop PO, from its activity log and status stamp. */
async function poPeople(db, po) {
  const c = await db.query(
    `SELECT created_by FROM purchase_order_activities
      WHERE po_id = $1 AND COALESCE(action, activity_type) = 'created' AND created_by IS NOT NULL
      ORDER BY created_at ASC LIMIT 1`,
    [po.po_id]
  );
  return {
    creatorId: c.rows[0]?.created_by || null,
    // At pending_approval the status stamp is whoever submitted it.
    submitterId: String(po.status || '').toLowerCase() === 'pending_approval' ? po.status_updated_by_admin_id : null,
  };
}

/** Same for a spare-parts PO, from the vendor audit log. */
async function sparePoPeople(db, spo) {
  const { rows } = await db.query(
    `SELECT action, actor_user_id, payload FROM vendor_audit_logs
      WHERE entity_type = 'spare_parts_po' AND entity_id = $1
        AND action IN ('create', 'status_change')
      ORDER BY created_at ASC`,
    [String(spo.spo_id)]
  );
  const creator = rows.find((r) => r.action === 'create');
  const submits = rows.filter((r) => r.action === 'status_change' && (r.payload?.to === 'pending'));
  return {
    creatorId: creator?.actor_user_id || null,
    submitterId: submits.length ? submits[submits.length - 1].actor_user_id : null,
  };
}

/** Spare POs can be received once approved (they used to be receivable as drafts). */
const SPARE_RECEIVABLE = new Set(['approved', 'processing', 'completed', 'vendor_accepted', 'sent']);
function spareReceivable(status) {
  return SPARE_RECEIVABLE.has(String(status || '').toLowerCase());
}

function normalizeState(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

module.exports = {
  canEditPo, statusAfterEdit, approvalConflict, receivedCount, poPeople, sparePoPeople,
  spareReceivable, normalizeState,
};
