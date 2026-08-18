'use strict';

function currentFinancialYear(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  const a = String(startYear % 100).padStart(2, '0');
  const b = String((startYear + 1) % 100).padStart(2, '0');
  return { label: `${a}-${b}` };
}

/** STK-26-27-00412 — FY-formatted, same idea as nextFinancialYearNumber. */
async function nextStkNumber(db) {
  const { label } = currentFinancialYear();
  const r = await db.query(
    `UPDATE sm_document_sequences
        SET last_value = last_value + 1, updated_at = NOW()
      WHERE doc_type = 'support_ticket_v2'
      RETURNING last_value`
  );
  if (!r.rows[0]) {
    throw new Error('sm_document_sequences row missing for support_ticket_v2');
  }
  return `STK-${label}-${String(r.rows[0].last_value).padStart(5, '0')}`;
}

/** WO-000412 */
async function nextWoNumber(db) {
  const r = await db.query(
    `UPDATE sm_document_sequences
        SET last_value = last_value + 1, updated_at = NOW()
      WHERE doc_type = 'support_work_order'
      RETURNING last_value`
  );
  if (!r.rows[0]) {
    throw new Error('sm_document_sequences row missing for support_work_order');
  }
  return `WO-${String(r.rows[0].last_value).padStart(6, '0')}`;
}

function legacyTicketNumber(legacyId) {
  return `STK-${String(legacyId).padStart(4, '0')}`;
}

module.exports = { nextStkNumber, nextWoNumber, currentFinancialYear, legacyTicketNumber };
