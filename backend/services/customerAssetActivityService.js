const pool = require('../config/db');
const { parseExtra } = require('./qcManagementService');
const { logTtsplEvent, logConfigChange } = require('./ttsplAuditService');

const SPEC_FIELDS = [
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'processor', label: 'Processor' },
  { key: 'generation', label: 'Generation' },
  { key: 'ram', label: 'RAM' },
  { key: 'storage', label: 'Storage' },
  { key: 'gpu', label: 'GPU' },
  { key: 'screen_size', label: 'Screen size' },
];

function normalizeAssetDateField(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function displayValue(field, value) {
  if (value == null || value === '') return '—';
  if (field === 'rent_monthly_rate') {
    const n = Number(value);
    return Number.isFinite(n) ? `₹${n}` : String(value);
  }
  if (field === 'delivered_at') return normalizeAssetDateField(value) || '—';
  return String(value);
}

function buildAssetBeforeState(row, extra) {
  return {
    brand: extra.brand || row.inv_brand || '',
    model: extra.model || extra.model_name || row.inv_model || '',
    processor: extra.processor || row.inv_processor || '',
    generation: extra.generation || '',
    ram: extra.ram || row.inv_ram || '',
    storage: extra.storage || row.inv_storage || '',
    gpu: extra.gpu || '',
    screen_size: extra.screen_size || '',
    rent_monthly_rate: row.rent_monthly_rate ?? null,
    dc_number: row.current_dc_number || '',
    delivered_at: normalizeAssetDateField(row.delivered_at) || '',
  };
}

function buildAssetChangeSet(before, { specPayload, rentMonthlyRate, dcNumber, deliveredAt }) {
  const changes = [];

  for (const { key, label } of SPEC_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(specPayload, key)) continue;
    const oldValue = before[key] ?? '';
    const newValue = specPayload[key] ?? '';
    if (String(oldValue) !== String(newValue)) {
      changes.push({ field: key, label, oldValue: oldValue || null, newValue: newValue || null });
    }
  }

  if (rentMonthlyRate !== undefined) {
    const oldRate = before.rent_monthly_rate;
    const newRate = rentMonthlyRate;
    const oldStr = oldRate == null || oldRate === '' ? '' : String(oldRate);
    const newStr = newRate == null || newRate === '' ? '' : String(newRate);
    if (oldStr !== newStr) {
      changes.push({
        field: 'rent_monthly_rate',
        label: 'Monthly rate',
        oldValue: oldRate,
        newValue: newRate,
      });
    }
  }

  if (dcNumber !== undefined) {
    const oldDc = before.dc_number || '';
    const newDc = dcNumber || '';
    if (String(oldDc) !== String(newDc)) {
      changes.push({
        field: 'dc_number',
        label: 'DC number',
        oldValue: oldDc || null,
        newValue: newDc || null,
      });
    }
  }

  if (deliveredAt !== undefined) {
    const oldDate = before.delivered_at || '';
    const newDate = deliveredAt || '';
    if (String(oldDate) !== String(newDate)) {
      changes.push({
        field: 'delivered_at',
        label: 'Delivery date',
        oldValue: oldDate || null,
        newValue: newDate || null,
      });
    }
  }

  return changes;
}

function formatActivityDescription(ttsplId, changes) {
  const parts = [`Customer asset updated (${ttsplId || 'unit'})`];
  for (const ch of changes) {
    parts.push(
      `${ch.label} ${displayValue(ch.field, ch.oldValue)} → ${displayValue(ch.field, ch.newValue)}`
    );
  }
  return parts.join(' · ');
}

async function logCustomerAssetEdit({
  customerId,
  serialId,
  ttsplId,
  serialNumber,
  changes,
  actorUserId,
  actorName,
}) {
  if (!changes.length) return null;

  const description = formatActivityDescription(ttsplId || serialNumber, changes);
  const changesJson = changes.map((ch) => ({
    field: ch.field,
    label: ch.label,
    old_value: ch.oldValue,
    new_value: ch.newValue,
  }));

  await pool.query(
    `INSERT INTO customer_asset_activity
      (customer_id, vendor_serial_id, ttspl_id, serial_number, action, description, changes, actor_user_id)
     VALUES ($1, $2, $3, $4, 'asset_updated', $5, $6::jsonb, $7)`,
    [
      customerId,
      serialId,
      ttsplId || null,
      serialNumber || null,
      description,
      JSON.stringify(changesJson),
      actorUserId || null,
    ]
  );

  if (ttsplId || serialNumber) {
    await logTtsplEvent({
      ttsplId: ttsplId || serialNumber,
      vendorSerialId: serialId,
      eventType: 'customer_asset_updated',
      description,
      metadata: { customer_id: customerId, changes: changesJson },
      actorUserId,
      actorName,
    });

    for (const ch of changes) {
      await logConfigChange({
        ttsplId: ttsplId || serialNumber,
        vendorSerialId: serialId,
        changedBy: actorUserId,
        changeType: 'customer_asset_edit',
        fieldName: ch.field,
        oldValue: displayValue(ch.field, ch.oldValue),
        newValue: displayValue(ch.field, ch.newValue),
        notes: `Customer #${customerId} asset edit`,
      });
    }
  }

  return { description, changes: changesJson };
}

async function listCustomerAssetActivity(customerId, { limit = 20, serialId } = {}) {
  const params = [customerId];
  let where = 'a.customer_id = $1';
  if (serialId) {
    params.push(serialId);
    where += ` AND a.vendor_serial_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(limit, 1), 100));
  const { rows } = await pool.query(
    `SELECT a.id, a.customer_id, a.vendor_serial_id, a.ttspl_id, a.serial_number,
            a.action, a.description, a.changes, a.created_at,
            COALESCE(u.name, 'System') AS actor_name
       FROM customer_asset_activity a
       LEFT JOIN users u ON u.user_id = a.actor_user_id
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

module.exports = {
  buildAssetBeforeState,
  buildAssetChangeSet,
  logCustomerAssetEdit,
  listCustomerAssetActivity,
  normalizeAssetDateField,
};
