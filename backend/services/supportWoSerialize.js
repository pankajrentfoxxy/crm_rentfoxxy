'use strict';

const SAFE = [
  'wo_id', 'wo_number', 'ticket_id', 'ticket_number', 'customer_id', 'wo_type', 'status',
  'assigned_to', 'assignment_group_id', 'scheduled_start', 'scheduled_end',
  'slot_start', 'slot_end', 'method', 'notes', 'document_number', 'outcome',
  'priority', 'sla_due_at', 'distance_km', 'accepted_at', 'en_route_at', 'on_site_at',
  'completed_at', 'created_at', 'updated_at', 'replacement_group_id', 'linked_wo_id',
  'previous_wo_id', 'floor_ticket_id', 'courier_partner', 'courier_other_name',
  'courier_direction', 'courier_awb', 'courier_pickup_date', 'courier_declared_value',
  'courier_packaging_note', 'remote_contact_window', 'batch_group_id',
  'otp_sent_at', 'otp_sent_to', 'otp_send_count', 'otp_bypassed',
  'custody_user_id', 'custody_since', 'eway_bill_number', 'skips_travel',
  'site_label', 'site_pincode', 'contact_name', 'contact_phone',
  'requires_eway_bill', 'time_spent_minutes',
];

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 4) return '••••';
  return `••••••${d.slice(-4)}`;
}

function serializeWorkOrder(row) {
  if (!row) return null;
  const out = {};
  for (const k of SAFE) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  if (row.otp_sent_to) out.otp_sent_to = maskPhone(row.otp_sent_to);
  out.otp_pending = Boolean(row.otp_sent_at && !row.otp_verified_at && !row.otp_bypassed);
  out.otp_locked = false;
  return out;
}

function normalizeScan(value) {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '');
}

function matchesAsset(value, asset) {
  const n = normalizeScan(value);
  if (!n || !asset) return false;
  return [asset.ttspl_id, asset.serial_number, asset.inventory_asset_code, asset.serial_id]
    .some((v) => v != null && normalizeScan(v) === n);
}

module.exports = { serializeWorkOrder, maskPhone, normalizeScan, matchesAsset };
