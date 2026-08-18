'use strict';

const { nextFinancialYearNumber, entityForQuotationType } = require('./salesManagementService');
const { resolveHsnForPersist } = require('../constants/hsnDefaults');

async function loadTicketCustomer(client, ticketId) {
  const r = await client.query(
    `SELECT t.ticket_id, t.customer_id, t.site_label, t.contact_name, t.contact_phone,
            COALESCE(c.company_name, c.name) AS customer_name, c.email
       FROM support_tickets_v2 t
       LEFT JOIN customers c ON c.customer_id = t.customer_id
      WHERE t.ticket_id = $1`,
    [ticketId]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  return r.rows[0];
}

async function loadWoAssets(client, woId) {
  return (await client.query(
    `SELECT a.line_id, a.serial_id, a.ttspl_id, a.serial_number
       FROM support_work_order_assets l
       JOIN support_ticket_assets a ON a.line_id = l.line_id
      WHERE l.wo_id = $1`,
    [woId]
  )).rows;
}

async function insertChallan(client, {
  dcNumber, ticket, wo, purpose, movement, remarks, entries, first,
}) {
  const hsnCode = resolveHsnForPersist({ transactionType: purpose === 'service_return' ? 'repair' : 'rental', role: null });
  const entityCode = entityForQuotationType('rental');
  await client.query(
    `INSERT INTO delivery_challan_lines
        (dc_number, movement_type, support_ticket_id, customer_id, customer_name, email,
         customer_shipping_address, brand, model_name, quantity, serial_number,
         dc_purpose, remarks, status, created_by, created_at, updated_at,
         entity_code, hsn_code, pre_dispatch_qc_passed)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,
             $12,$13,'pending',$14,NOW(),NOW(),$15,$16,FALSE)`,
    [
      dcNumber,
      movement,
      ticket.ticket_id,
      ticket.customer_id,
      ticket.customer_name,
      ticket.email || null,
      JSON.stringify({ address: ticket.site_label || '', contact: ticket.contact_name }),
      first.brand || null,
      first.model || null,
      Math.max(1, entries.length),
      JSON.stringify(entries),
      purpose,
      remarks,
      wo.created_by || null,
      entityCode,
      hsnCode,
    ]
  );
}

async function generateReturnDc(client, wo, opts = {}) {
  const purpose = opts.purpose || 'repair_pickup';
  const ticket = await loadTicketCustomer(client, wo.ticket_id);
  const assets = await loadWoAssets(client, wo.wo_id);
  const dcNumber = await nextFinancialYearNumber('delivery_challan', client);
  const entries = assets.map((a) => `${a.serial_id || ''}|${a.serial_number || ''}|${a.ttspl_id || ''}`);
  let first = {};
  if (assets[0] && assets[0].serial_id) {
    const spec = await client.query(
      `SELECT extra FROM vendor_serial_numbers WHERE serial_id = $1`,
      [assets[0].serial_id]
    );
    first = spec.rows[0]?.extra || {};
  }
  await insertChallan(client, {
    dcNumber,
    ticket,
    wo,
    purpose,
    movement: 'inbound',
    remarks: opts.remarks || (purpose === 'return' ? `Return pickup ${wo.wo_number}` : `Repair pickup ${wo.wo_number}`),
    entries,
    first,
  });
  await client.query(
    `UPDATE support_work_orders SET document_number = $2, updated_at = NOW() WHERE wo_id = $1`,
    [wo.wo_id, dcNumber]
  );
  return dcNumber;
}

async function generateServiceDc(client, wo) {
  const ticket = await loadTicketCustomer(client, wo.ticket_id);
  const assets = await loadWoAssets(client, wo.wo_id);
  const dcNumber = await nextFinancialYearNumber('service_dc', client);
  const entries = assets.map((a) => `${a.serial_id || ''}|${a.serial_number || ''}|${a.ttspl_id || ''}`);
  let first = {};
  if (assets[0] && assets[0].serial_id) {
    const spec = await client.query(
      `SELECT extra FROM vendor_serial_numbers WHERE serial_id = $1`,
      [assets[0].serial_id]
    );
    first = spec.rows[0]?.extra || {};
  }
  await insertChallan(client, {
    dcNumber,
    ticket,
    wo,
    purpose: 'service_return',
    movement: 'outbound',
    remarks: `Service return ${wo.wo_number}`,
    entries,
    first,
  });
  await client.query(
    `UPDATE support_work_orders SET document_number = $2, updated_at = NOW() WHERE wo_id = $1`,
    [wo.wo_id, dcNumber]
  );
  return dcNumber;
}

async function generateReplacementDc(client, wo, opts = {}) {
  const ticket = await loadTicketCustomer(client, wo.ticket_id);
  const assets = opts.entries
    ? []
    : await loadWoAssets(client, wo.wo_id);
  const dcNumber = await nextFinancialYearNumber('delivery_challan', client);
  const entries = opts.entries || assets.map((a) => `${a.serial_id || ''}|${a.serial_number || ''}|${a.ttspl_id || ''}`);
  let first = opts.first || {};
  if (!opts.first && assets[0] && assets[0].serial_id) {
    const spec = await client.query(
      `SELECT extra FROM vendor_serial_numbers WHERE serial_id = $1`,
      [assets[0].serial_id]
    );
    first = spec.rows[0]?.extra || {};
  }
  await insertChallan(client, {
    dcNumber,
    ticket,
    wo,
    purpose: 'replacement',
    movement: 'outbound',
    remarks: opts.remarks || `Replacement delivery ${wo.wo_number}`,
    entries,
    first,
  });
  await client.query(
    `UPDATE support_work_orders SET document_number = $2, updated_at = NOW() WHERE wo_id = $1`,
    [wo.wo_id, dcNumber]
  );
  return dcNumber;
}

async function generatePartDc(client, wo, opts = {}) {
  const ticket = await loadTicketCustomer(client, wo.ticket_id);
  const dcNumber = await nextFinancialYearNumber('part_dc', client);
  const entries = opts.entries || [`part|${opts.partName || ''}|${wo.wo_number}`];
  await insertChallan(client, {
    dcNumber,
    ticket,
    wo,
    purpose: 'part_delivery',
    movement: 'outbound',
    remarks: opts.remarks || `Part delivery ${wo.wo_number}`,
    entries,
    first: opts.first || {},
  });
  await client.query(
    `UPDATE support_work_orders SET document_number = $2, updated_at = NOW() WHERE wo_id = $1`,
    [wo.wo_id, dcNumber]
  );
  return dcNumber;
}

async function generatePartReturnDc(client, wo, opts = {}) {
  const ticket = await loadTicketCustomer(client, wo.ticket_id);
  const dcNumber = await nextFinancialYearNumber('part_return_dc', client);
  const entries = opts.entries || [`old-part|${opts.partName || ''}|${wo.wo_number}`];
  await insertChallan(client, {
    dcNumber,
    ticket,
    wo,
    purpose: 'part_return',
    movement: 'inbound',
    remarks: opts.remarks || `Part return ${wo.wo_number}`,
    entries,
    first: opts.first || {},
  });
  await client.query(
    `UPDATE support_work_orders SET document_number = $2, updated_at = NOW() WHERE wo_id = $1`,
    [wo.wo_id, dcNumber]
  );
  return dcNumber;
}

module.exports = {
  generateReturnDc,
  generateServiceDc,
  generateReplacementDc,
  generatePartDc,
  generatePartReturnDc,
  loadWoAssets,
};
