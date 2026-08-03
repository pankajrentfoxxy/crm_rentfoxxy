const { normalizeRam, normalizeStorage } = require('./assetConfigNormalize');

function isStoragePart(part) {
  const cat = String(part?.category || part?.part_type || '').toLowerCase();
  const name = String(part?.part_name || '').toLowerCase();
  return cat.includes('storage')
    || cat.includes('ssd')
    || cat.includes('hdd')
    || /\b(ssd|hdd|nvme|emmc|storage)\b/.test(name);
}

function isRamPart(part) {
  const cat = String(part?.category || part?.part_type || '').toLowerCase();
  const name = String(part?.part_name || '').toLowerCase();
  return cat.includes('ram')
    || cat.includes('memory')
    || /\bram\b/.test(name)
    || /\b\d+\s*gb\s*(ddr\d|ram)?\b/.test(name);
}

/**
 * When a RAM or storage part is attached/replaced, derive the config field update
 * from the catalog part name (e.g. "512 GB SSD" → storage "512GB SSD").
 */
function inferConfigUpdateFromPart(part, currentValues = {}) {
  if (!part?.part_name) return null;

  if (isStoragePart(part)) {
    const newValue = normalizeStorage(part.part_name);
    if (!newValue) return null;
    return {
      configField: 'storage',
      newValue,
      oldValue: currentValues.storage || currentValues.ssd || '',
      changeType: 'replacement',
    };
  }

  if (isRamPart(part)) {
    const newValue = normalizeRam(part.part_name);
    if (!newValue) return null;
    return {
      configField: 'ram',
      newValue,
      oldValue: currentValues.ram || '',
      changeType: 'replacement',
    };
  }

  return null;
}

module.exports = {
  inferConfigUpdateFromPart,
  isStoragePart,
  isRamPart,
};
