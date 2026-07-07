/** Block duplicate floor tickets for the same physical laptop. */
const BLOCKING_STATUSES = ['in_progress', 'on_hold', 'diagnosis_failed', 'out_for_repair'];

function serialIdentityKey({
  vendor_serial_id: vendorSerialIdSnake,
  vendorSerialId,
  serial_id: serialIdSnake,
  serialId,
  serial_number: serialNumberSnake,
  serialNumber,
  ttspl_id: ttsplIdSnake,
  ttsplId,
  ttspl,
} = {}) {
  const vsn = vendorSerialIdSnake ?? vendorSerialId ?? serialIdSnake ?? serialId;
  if (vsn) return `vsn:${vsn}`;
  const sn = String(serialNumberSnake ?? serialNumber ?? '').trim().toLowerCase();
  if (sn) return `sn:${sn}`;
  const tt = String(ttsplIdSnake ?? ttsplId ?? ttspl ?? '').trim().toUpperCase();
  if (tt) return `tt:${tt}`;
  return '';
}

function blockingTicketMessage(blocking) {
  if (!blocking) return '';
  if (blocking.status === 'diagnosis_failed') {
    return `Laptop already has Diagnosis Failed ticket #${blocking.ticket_id}. Send it to vendor repair or resolve it before opening another ticket.`;
  }
  if (blocking.status === 'out_for_repair') {
    return `Laptop is out for vendor repair (ticket #${blocking.ticket_id}). Wait for warehouse receive before opening a new ticket.`;
  }
  return `An open ticket #${blocking.ticket_id} already exists for this laptop (${blocking.status}).`;
}

async function findBlockingTicket(db, {
  serialNumber,
  ttsplId,
  vendorSerialId,
  excludeTicketId,
} = {}) {
  const clauses = [];
  const params = [];

  if (vendorSerialId) {
    params.push(Number(vendorSerialId));
    clauses.push(`t.vendor_serial_id = $${params.length}`);
  }
  const sn = serialNumber && String(serialNumber).trim();
  if (sn) {
    params.push(sn);
    clauses.push(`LOWER(TRIM(t.serial_number)) = LOWER(TRIM($${params.length}))`);
  }
  const tt = ttsplId && String(ttsplId).trim();
  if (tt) {
    params.push(tt);
    clauses.push(`UPPER(TRIM(COALESCE(t.ttspl_id, ''))) = UPPER(TRIM($${params.length}))`);
  }
  if (!clauses.length) return null;

  params.push(BLOCKING_STATUSES);
  let sql = `
    SELECT t.ticket_id, t.status, t.serial_number, t.ttspl_id, t.vendor_serial_id
      FROM tickets t
     WHERE (${clauses.join(' OR ')})
       AND t.status = ANY($${params.length})`;
  if (excludeTicketId) {
    params.push(Number(excludeTicketId));
    sql += ` AND t.ticket_id <> $${params.length}`;
  }
  sql += ' ORDER BY t.ticket_id DESC LIMIT 1';

  const r = await db.query(sql, params);
  return r.rows[0] || null;
}

async function assertSerialAvailableForNewTicket(db, ident, options = {}) {
  const blocking = await findBlockingTicket(db, { ...ident, excludeTicketId: options.excludeTicketId });
  if (blocking) {
    throw new Error(blockingTicketMessage(blocking));
  }
}

async function findActiveVrdcItemForSerial(db, {
  serialId,
  serialNumber,
  ttsplId,
  excludeTicketId,
  excludeDcNumber,
} = {}) {
  const clauses = [];
  const params = [];
  if (serialId) {
    params.push(Number(serialId));
    clauses.push(`i.serial_id = $${params.length}`);
  }
  const sn = serialNumber && String(serialNumber).trim();
  if (sn) {
    params.push(sn);
    clauses.push(`LOWER(TRIM(i.serial_number)) = LOWER(TRIM($${params.length}))`);
  }
  const tt = ttsplId && String(ttsplId).trim();
  if (tt) {
    params.push(tt);
    clauses.push(`UPPER(TRIM(COALESCE(i.ttspl_id, ''))) = UPPER(TRIM($${params.length}))`);
  }
  if (!clauses.length) return null;

  let sql = `
    SELECT i.id, i.ticket_id, i.dc_number, i.serial_number, i.ttspl_id
      FROM vendor_repair_dc_items i
      JOIN vendor_repair_delivery_challans vd ON vd.dc_number = i.dc_number
     WHERE (${clauses.join(' OR ')})
       AND vd.status IN ('draft', 'dispatched', 'partially_returned')`;
  if (excludeTicketId) {
    params.push(Number(excludeTicketId));
    sql += ` AND i.ticket_id <> $${params.length}`;
  }
  if (excludeDcNumber) {
    params.push(excludeDcNumber);
    sql += ` AND i.dc_number <> $${params.length}`;
  }
  sql += ' ORDER BY i.id DESC LIMIT 1';

  const r = await db.query(sql, params);
  return r.rows[0] || null;
}

module.exports = {
  BLOCKING_STATUSES,
  serialIdentityKey,
  blockingTicketMessage,
  findBlockingTicket,
  assertSerialAvailableForNewTicket,
  findActiveVrdcItemForSerial,
};
