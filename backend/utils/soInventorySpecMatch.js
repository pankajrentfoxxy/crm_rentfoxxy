/**
 * Normalized laptop spec matching for SO inventory pick + serial attach.
 * Aligns CRM Settings asset config labels with migrated GRN/extra values.
 */
const { compareKey } = require('./assetConfigNormalize');

function partialSpecMatch(dbValue, inputValue) {
  if (!inputValue) return true;
  return String(dbValue || '').toLowerCase().includes(String(inputValue).toLowerCase());
}

function normalizedSpecMatch(dbValue, inputValue, entityKey, context = {}) {
  if (!inputValue) return true;
  if (!dbValue) return false;
  return compareKey(entityKey, dbValue, context) === compareKey(entityKey, inputValue, context);
}

function normalizedModelMatch(dbModel, inputModel, brandHint = '') {
  if (!inputModel) return true;
  if (!dbModel) return false;
  const dbNorm = compareKey('models', dbModel, { brandName: brandHint }).toLowerCase();
  const inNorm = compareKey('models', inputModel, { brandName: brandHint }).toLowerCase();
  if (dbNorm === inNorm) return true;
  return dbNorm.includes(inNorm) || inNorm.includes(dbNorm);
}

function brandMatchesRow(row, brand) {
  if (!brand) return true;
  const b = String(brand).toLowerCase();
  const brandHay = String(row.brand || '').toLowerCase();
  const modelHay = String(row.pd_model || row.product_model_name || row.model || row.model_name || '').toLowerCase();
  return brandHay.includes(b) || modelHay.includes(b);
}

/** SO line (sales_order_lines) vs serial row from vendor_serial_numbers.
 *  Match on processor + generation + RAM + storage only — sales-side brand/model
 *  labels (e.g. catalog "Assamble") must not block attaching real inventory units. */
function serialMatchesSoLine(line, serial) {
  if (line.processor && !normalizedSpecMatch(serial.processor, line.processor, 'processors')) return false;
  if (line.generation && !normalizedSpecMatch(serial.generation, line.generation, 'generations')) return false;
  if (line.ram && !normalizedSpecMatch(serial.ram, line.ram, 'ram')) return false;
  if (line.storage && !normalizedSpecMatch(serial.storage, line.storage, 'storage')) return false;

  return true;
}

function configMismatchMessage(line, serial) {
  const parts = [];

  if (line.processor && !normalizedSpecMatch(serial.processor, line.processor, 'processors')) {
    parts.push(`processor line=${line.processor} serial=${serial.processor || '—'}`);
  }
  if (line.generation && !normalizedSpecMatch(serial.generation, line.generation, 'generations')) {
    parts.push(`generation line=${line.generation} serial=${serial.generation || '—'}`);
  }
  if (line.ram && !normalizedSpecMatch(serial.ram, line.ram, 'ram')) {
    parts.push(`ram line=${line.ram} serial=${serial.ram || '—'}`);
  }
  if (line.storage && !normalizedSpecMatch(serial.storage, line.storage, 'storage')) {
    parts.push(`storage line=${line.storage} serial=${serial.storage || '—'}`);
  }

  if (!parts.length) {
    return `Config mismatch: line is ${line.model_name}, serial is ${serial.model}`;
  }
  return `Config mismatch (${parts.join('; ')})`;
}

module.exports = {
  partialSpecMatch,
  normalizedSpecMatch,
  normalizedModelMatch,
  brandMatchesRow,
  serialMatchesSoLine,
  configMismatchMessage,
};
