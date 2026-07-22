/**
 * Normalize inventory spec filter options and query params using asset-config rules.
 * Collapses duplicates like "10TH", "10th Gen", "10 Generation" → "10th Gen".
 * RAM/SSD filter labels use spaced format: "8 GB", "256 GB SSD".
 */
const { compareKey, normalizeEntityName, collapseSpaces } = require('./assetConfigNormalize');

const QUERY_KEY_TO_ENTITY = {
  brand: 'brands',
  model: 'models',
  processor: 'processors',
  generation: 'generations',
  ram: 'ram',
  storage: 'storage',
  screen_size: 'screen-sizes',
  gpu: 'gpus',
};

const OPTIONS_KEY_TO_ENTITY = {
  brands: 'brands',
  models: 'models',
  processors: 'processors',
  generations: 'generations',
  rams: 'ram',
  storages: 'storage',
  screen_sizes: 'screen-sizes',
  gpus: 'gpus',
};

function isNoiseValue(value) {
  const s = collapseSpaces(value);
  return !s || s === '-';
}

/** Filter dropdown label for RAM: 8GB / 8 GB / 08 GB / 8 Gb → "8 GB". */
function formatRamFilterLabel(name) {
  let s = collapseSpaces(name).replace(/\bram\b/gi, '').trim();
  const m = s.match(/^0*(\d+)\s*(gb|tb)?$/i);
  if (m) {
    return `${parseInt(m[1], 10)} ${(m[2] || 'GB').toUpperCase()}`;
  }
  return normalizeEntityName('ram', name);
}

/** Filter dropdown label for SSD/storage: 256GB SSD / 256 GB / 256Gb SSD → "256 GB SSD". */
function formatStorageFilterLabel(name) {
  const s = collapseSpaces(name);
  if (!s) return s;

  if (/\+/.test(s)) {
    return s.split('+').map((part) => formatStorageFilterLabel(part.trim())).join(' + ');
  }

  let m = s.match(/^0*(\d+)\s*(gb|tb)?\s*nvme\s*ssd$/i);
  if (m) {
    return `${parseInt(m[1], 10)} ${(m[2] || 'GB').toUpperCase()} NVMe SSD`;
  }

  m = s.match(/^0*(\d+)\s*(gb|tb)?\s*hdd$/i);
  if (m) {
    return `${parseInt(m[1], 10)} ${(m[2] || 'GB').toUpperCase()} HDD`;
  }

  m = s.match(/^0*(\d+)\s*(gb|tb)?\s*ssd$/i);
  if (m) {
    return `${parseInt(m[1], 10)} ${(m[2] || 'GB').toUpperCase()} SSD`;
  }

  m = s.match(/^0*(\d+)\s*ssd$/i);
  if (m) {
    return `${parseInt(m[1], 10)} GB SSD`;
  }

  m = s.match(/^0*(\d+)\s*(gb|tb)?$/i);
  if (m) {
    return `${parseInt(m[1], 10)} ${(m[2] || 'GB').toUpperCase()} SSD`;
  }

  return normalizeEntityName('storage', name);
}

/** Canonical filter label shown in dropdowns (entity-specific formatting). */
function filterDisplayLabel(entityKey, rawValue, context = {}) {
  if (entityKey === 'ram') return formatRamFilterLabel(rawValue);
  if (entityKey === 'storage') return formatStorageFilterLabel(rawValue);
  return normalizeEntityName(entityKey, rawValue, context);
}

function sortFilterLabels(entityKey, labels) {
  if (entityKey === 'ram' || entityKey === 'storage') {
    return [...labels].sort((a, b) => {
      const na = parseInt(String(a).match(/^(\d+)/)?.[1] || '0', 10);
      const nb = parseInt(String(b).match(/^(\d+)/)?.[1] || '0', 10);
      if (na !== nb) return na - nb;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
  }
  return [...labels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Case-insensitive dedupe key (handles leading zeros for RAM/storage). */
function specCompareKey(entityKey, rawValue, context = {}) {
  const trimmed = collapseSpaces(rawValue);
  if (entityKey === 'ram') {
    let s = trimmed.replace(/\bram\b/gi, '').trim();
    const m = s.match(/^0*(\d+)\s*(gb|tb)?$/i);
    if (m) return `${parseInt(m[1], 10)} ${(m[2] || 'GB').toUpperCase()}`.toLowerCase();
  }
  if (entityKey === 'storage') {
    return formatStorageFilterLabel(trimmed).toLowerCase();
  }
  return compareKey(entityKey, trimmed, context);
}

/** Dedupe raw values; return one canonical label per normalized key. */
function uniqueNormalizedSpecOptions(entityKey, values, context = {}) {
  const byKey = new Map();
  for (const raw of values || []) {
    const trimmed = collapseSpaces(raw);
    if (isNoiseValue(trimmed)) continue;
    const key = specCompareKey(entityKey, trimmed, context);
    if (isNoiseValue(key)) continue;
    const label = filterDisplayLabel(entityKey, trimmed, context);
    if (isNoiseValue(label)) continue;
    if (!byKey.has(key)) byKey.set(key, label);
  }
  return sortFilterLabels(entityKey, [...byKey.values()]);
}

/** Normalize an incoming inventory list filter query value. */
function normalizeSpecFilterValue(queryKey, value, context = {}) {
  const entityKey = QUERY_KEY_TO_ENTITY[queryKey];
  const trimmed = collapseSpaces(value);
  if (isNoiseValue(trimmed)) return '';
  if (!entityKey) return trimmed;
  return filterDisplayLabel(entityKey, trimmed, context);
}

/** Normalize all option arrays returned by listInventorySpecFilterOptions. */
function normalizeSpecFilterOptions(options = {}) {
  const out = { ...options };
  for (const [optionsKey, entityKey] of Object.entries(OPTIONS_KEY_TO_ENTITY)) {
    if (Array.isArray(options[optionsKey])) {
      out[optionsKey] = uniqueNormalizedSpecOptions(entityKey, options[optionsKey]);
    }
  }
  return out;
}

module.exports = {
  QUERY_KEY_TO_ENTITY,
  OPTIONS_KEY_TO_ENTITY,
  formatRamFilterLabel,
  formatStorageFilterLabel,
  filterDisplayLabel,
  uniqueNormalizedSpecOptions,
  normalizeSpecFilterValue,
  normalizeSpecFilterOptions,
};
