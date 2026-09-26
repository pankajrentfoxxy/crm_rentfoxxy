/**
 * D12 — a draft debit note for every laptop that goes back to its vendor.
 *
 * Only floor QC fail used to raise one; return challans and replacements did
 * not, so accounts had nothing to adjust the next vendor bill against. A draft
 * has amount 0: accounts sets the amount and approves it.
 *
 * Runs in the caller's transaction (number included), so a rolled-back return
 * leaves no note and burns no number. One pending note per laptop: a laptop
 * that already has one (e.g. from floor QC fail) is not given a second when it
 * then leaves on a return challan.
 */
const pool = require('../config/db');

const SOURCE_TEXT = {
  floor_qc_fail: 'failed QC on the floor',
  return_challan: 'returned to the vendor on a return challan',
  replacement: 'kept by the vendor, who sent a replacement',
  rejected_at_receipt: 'rejected at the door on receipt',
  vendor_kept: 'kept by the vendor, who could not repair it',
};

async function nextDebitNoteNumber(db) {
  const r = await db.query(
    `UPDATE sm_document_sequences SET last_value = last_value + 1
      WHERE doc_type = 'vendor_debit_note'
      RETURNING prefix || LPAD(last_value::text, 4, '0') AS number`
  );
  if (!r.rows.length) throw new Error('vendor_debit_note sequence missing');
  return r.rows[0].number;
}

/**
 * @returns the new note, or null when the laptop already has a pending note
 *          or has no vendor PO.
 */
async function draftForReturn(db, { serialId, source, sourceRef = null, reason = '', actorUserId = null, returnTicketId = null }) {
  const client = db || pool;
  if (!serialId) return null;
  const open = await client.query(
    `SELECT debit_note_id FROM vendor_debit_notes
      WHERE serial_id = $1 AND COALESCE(status, 'pending') = 'pending' LIMIT 1`,
    [serialId]
  );
  if (open.rows.length) return null;
  const vp = (await client.query(
    `SELECT vpo.vendor_id, vpo.po_id, vsn.serial_number,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
      WHERE vsn.serial_id = $1`,
    [serialId]
  )).rows[0];
  if (!vp?.vendor_id) return null;
  const number = await nextDebitNoteNumber(client);
  const what = SOURCE_TEXT[source] || 'returned to the vendor';
  const ins = await client.query(
    `INSERT INTO vendor_debit_notes
       (debit_note_number, vendor_id, po_id, reason, description, amount, quantity, unit_rate, ttspl_ids,
        created_by, serial_id, return_ticket_id, source, source_ref)
     VALUES ($1, $2, $3, 'Return to vendor', $4, 0, 1, 0, $5::jsonb, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      number, vp.vendor_id, vp.po_id,
      `${vp.ttspl_id || vp.serial_number} ${what}${sourceRef ? ` (${sourceRef})` : ''}${reason ? ` — ${reason}` : ''}. Set the amount and approve to adjust the next vendor bill.`,
      JSON.stringify([vp.ttspl_id].filter(Boolean)),
      actorUserId, serialId, returnTicketId, source, sourceRef,
    ]
  );
  return ins.rows[0];
}

module.exports = { draftForReturn, nextDebitNoteNumber };
