const productionAssetService = require('./productionAssetService');
const { logConfigChange } = require('./ttsplAuditService');
const { inferConfigUpdateFromPart } = require('../utils/partConfigInference');

const MISSING_PART_KEYS = {
  storage: 'storage',
  ram: 'ram',
};

const PA_CONFIG_PATCH = {
  ram: 'ram',
  storage: 'storage',
  processor: 'processor',
  gpu: 'gpu',
  display: 'screen_size',
};

/**
 * Resolve config_field / new_value for a part attach (explicit upgrade or inferred RAM/storage).
 */
function resolvePartConfigUpdate(partRequestOrPart, ticket, { isUpgrade = false } = {}) {
  if (isUpgrade && partRequestOrPart.config_field && partRequestOrPart.new_value) {
    return {
      configField: partRequestOrPart.config_field,
      newValue: partRequestOrPart.new_value,
      oldValue: partRequestOrPart.old_value || ticket[partRequestOrPart.config_field] || '',
      changeType: 'upgrade',
    };
  }

  return inferConfigUpdateFromPart(
    {
      part_name: partRequestOrPart.part_name,
      category: partRequestOrPart.category,
      part_type: partRequestOrPart.part_type,
    },
    { ram: ticket.ram, storage: ticket.storage, ssd: ticket.storage }
  );
}

function filterMissingParts(list, configField) {
  const dropKey = MISSING_PART_KEYS[String(configField || '').toLowerCase()];
  if (!dropKey || !Array.isArray(list)) return list || [];
  return list.filter((item) => String(item).toLowerCase() !== dropKey);
}

/** Clear missing-part flags on inventory, ticket, and production asset after RAM/SSD attach. */
async function clearMissingPartFlags(client, { ticket, configField, productionAssetId = null }) {
  const dropKey = MISSING_PART_KEYS[String(configField || '').toLowerCase()];
  if (!dropKey) return;

  if (ticket?.vendor_serial_id) {
    const vs = await client.query(
      `SELECT missing_parts, extra FROM vendor_serial_numbers WHERE serial_id = $1`,
      [ticket.vendor_serial_id]
    );
    const row = vs.rows[0] || {};
    let extra = row.extra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch { extra = {}; }
    }
    const nextMissing = filterMissingParts(row.missing_parts || extra.missing_parts, configField);
    extra.missing_parts = nextMissing;
    await client.query(
      `UPDATE vendor_serial_numbers
          SET missing_parts = $2::jsonb,
              extra = jsonb_set(COALESCE(extra, '{}'::jsonb), '{missing_parts}', $2::jsonb),
              updated_at = NOW()
        WHERE serial_id = $1`,
      [ticket.vendor_serial_id, JSON.stringify(nextMissing)]
    );
  }

  if (ticket?.ticket_id) {
    const tr = await client.query(
      `SELECT missing_parts FROM tickets WHERE ticket_id = $1`,
      [ticket.ticket_id]
    );
    const nextMissing = filterMissingParts(tr.rows[0]?.missing_parts, configField);
    await client.query(
      `UPDATE tickets SET missing_parts = $2::jsonb, updated_at = NOW() WHERE ticket_id = $1`,
      [ticket.ticket_id, JSON.stringify(nextMissing)]
    );
  }

  let paId = productionAssetId;
  if (!paId && ticket?.ticket_id) {
    const pa = await productionAssetService.getByTicket(client, ticket.ticket_id);
    paId = pa?.production_asset_id;
  }
  if (!paId && ticket?.vendor_serial_id) {
    const pa = await productionAssetService.getByVendorSerial(client, ticket.vendor_serial_id);
    paId = pa?.production_asset_id;
  }
  if (paId) {
    const pr = await client.query(
      `SELECT missing_parts FROM production_assets WHERE production_asset_id = $1`,
      [paId]
    );
    const nextMissing = filterMissingParts(pr.rows[0]?.missing_parts, configField);
    await client.query(
      `UPDATE production_assets SET missing_parts = $2::jsonb, updated_at = NOW() WHERE production_asset_id = $1`,
      [paId, JSON.stringify(nextMissing)]
    );
  }
}

/**
 * Mirror RAM/storage (and other) config to production asset, ticket header, and audit log.
 */
async function applyConfigFromPartAttach(client, {
  ticket,
  configField,
  newValue,
  oldValue,
  changeType = 'replacement',
  unitCost = 0,
  partId = null,
  partName = '',
  stageName = null,
  notes = null,
  userId = null,
  userName = null,
}) {
  if (!configField || !newValue || !ticket?.ticket_id) return false;

  const field = String(configField).toLowerCase();
  const nextValue = String(newValue).trim();
  const prevValue = oldValue != null ? String(oldValue) : (ticket[field] || '');

  await logConfigChange({
    ttsplId: ticket.ttspl_id,
    vendorSerialId: ticket.vendor_serial_id,
    ticketId: ticket.ticket_id,
    changedBy: userId,
    changeType,
    fieldName: field,
    oldValue: prevValue,
    newValue: nextValue,
    notes: notes || `Part ${partName} attached (${prevValue || '—'} → ${nextValue})`,
    partUsedId: partId,
    partCost: unitCost,
    db: client,
  });

  const paPatch = PA_CONFIG_PATCH[field];
  let wroteViaProductionAsset = false;
  let productionAssetId = null;
  if (paPatch) {
    let pa = await productionAssetService.getByTicket(client, ticket.ticket_id);
    if (!pa && ticket.vendor_serial_id) {
      pa = await productionAssetService.getByVendorSerial(client, ticket.vendor_serial_id);
    }
    if (!pa && ticket.vendor_serial_id) {
      pa = await productionAssetService.createFromGrn(client, {
        ticketId: ticket.ticket_id,
        serialNumber: ticket.serial_number,
        ttsplId: ticket.ttspl_id,
        vendorSerialId: ticket.vendor_serial_id,
        configSource: ticket,
      });
    }
    if (pa?.production_asset_id) {
      productionAssetId = pa.production_asset_id;
      await productionAssetService.updateConfig(
        client,
        pa.production_asset_id,
        { [paPatch]: nextValue },
        userId,
        stageName
      );
      wroteViaProductionAsset = true;
    }
  }

  if (!wroteViaProductionAsset) {
    const fieldMap = {
      ram: 'ram',
      storage: 'storage',
      display: 'screen_size',
      processor: 'processor',
      gpu: 'gpu',
      os: 'os',
    };
    const jsonbKey = fieldMap[field] || field;
    if (ticket.vendor_serial_id) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET extra = jsonb_set(COALESCE(extra, '{}'::jsonb), $1, $2::jsonb), updated_at = NOW()
          WHERE serial_id = $3`,
        [`{${jsonbKey}}`, JSON.stringify(nextValue), ticket.vendor_serial_id]
      );
    }
    if (['ram', 'storage', 'processor'].includes(field)) {
      await client.query(
        `UPDATE tickets SET ${field} = $1, updated_at = NOW() WHERE ticket_id = $2`,
        [nextValue, ticket.ticket_id]
      );
    }
  }

  await clearMissingPartFlags(client, { ticket, configField: field, productionAssetId });

  return true;
}

/** Revert config inferred or recorded on a part attach (detach flow). */
async function revertConfigFromPartDetach(client, {
  partRequestOrPart,
  ticket,
  isUpgrade = false,
  userId = null,
  userName = null,
  stageName = null,
  reason = null,
}) {
  if (isUpgrade && partRequestOrPart.config_field && partRequestOrPart.old_value != null) {
    return applyConfigFromPartAttach(client, {
      ticket,
      configField: partRequestOrPart.config_field,
      newValue: partRequestOrPart.old_value,
      oldValue: partRequestOrPart.new_value,
      changeType: 'correction',
      partId: partRequestOrPart.part_id,
      partName: partRequestOrPart.part_name,
      stageName,
      notes: reason || `Revert upgrade — attached part removed (${partRequestOrPart.part_name})`,
      userId,
      userName,
    });
  }

  const resolved = resolvePartConfigUpdate(partRequestOrPart, ticket, { isUpgrade: false });
  if (!resolved?.configField || resolved.newValue == null) return false;

  return applyConfigFromPartAttach(client, {
    ticket,
    configField: resolved.configField,
    newValue: resolved.oldValue || '',
    oldValue: resolved.newValue,
    changeType: 'correction',
    partId: partRequestOrPart.part_id,
    partName: partRequestOrPart.part_name,
    stageName,
    notes: reason || `Revert part attach — ${partRequestOrPart.part_name} removed`,
    userId,
    userName,
  });
}

module.exports = {
  PA_CONFIG_PATCH,
  MISSING_PART_KEYS,
  resolvePartConfigUpdate,
  applyConfigFromPartAttach,
  revertConfigFromPartDetach,
  clearMissingPartFlags,
};
