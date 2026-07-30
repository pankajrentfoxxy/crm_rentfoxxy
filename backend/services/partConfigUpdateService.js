const productionAssetService = require('./productionAssetService');
const { logConfigChange } = require('./ttsplAuditService');
const { inferConfigUpdateFromPart } = require('../utils/partConfigInference');

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

  return true;
}

module.exports = {
  PA_CONFIG_PATCH,
  resolvePartConfigUpdate,
  applyConfigFromPartAttach,
};
