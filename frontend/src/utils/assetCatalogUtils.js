/** Shared asset catalog helpers — values come from Settings → Asset Configuration API. */

function modelsMap(catalog) {
  if (catalog?.models_by_brand && typeof catalog.models_by_brand === 'object') {
    return catalog.models_by_brand;
  }
  if (catalog?.models && typeof catalog.models === 'object' && !Array.isArray(catalog.models)) {
    return catalog.models;
  }
  return {};
}

function generationsMap(catalog) {
  if (catalog?.generations_by_processor && typeof catalog.generations_by_processor === 'object') {
    return catalog.generations_by_processor;
  }
  if (catalog?.generations && typeof catalog.generations === 'object' && !Array.isArray(catalog.generations)) {
    return catalog.generations;
  }
  return {};
}

export function mergeAssetCatalog(apiCatalog) {
  const c = apiCatalog || {};
  const byBrand = modelsMap(c);
  const byProcessor = generationsMap(c);
  const pick = (key) => (Array.isArray(c[key]) && c[key].length ? c[key] : []);

  return {
    from_asset_config: Boolean(c.from_asset_config),
    brands: pick('brands'),
    models: c.models_flat?.length ? c.models_flat : [...new Set(Object.values(byBrand).flat())],
    models_by_brand: byBrand,
    processors: pick('processors'),
    generations: c.generations_flat?.length ? c.generations_flat : [...new Set(Object.values(byProcessor).flat())],
    generations_by_processor: byProcessor,
    rams: pick('rams'),
    storages: pick('storages'),
    gpus: pick('gpus'),
    screen_sizes: pick('screen_sizes'),
    catalog_rows: Array.isArray(c.catalog_rows) ? c.catalog_rows : [],
  };
}

export function modelsForBrand(brand, catalog) {
  const b = String(brand || '').trim();
  const byBrand = modelsMap(catalog);
  if (b && byBrand[b]?.length) return byBrand[b];
  if (Array.isArray(catalog?.models) && catalog.models.length) return catalog.models;
  return [];
}

export function generationsForProcessor(processor, catalog) {
  const p = String(processor || '').trim();
  const byProc = generationsMap(catalog);
  if (p && byProc[p]?.length) return byProc[p];
  if (Array.isArray(catalog?.generations) && catalog.generations.length) return catalog.generations;
  return [];
}

export const EMPTY_ASSET_CATALOG = mergeAssetCatalog({});
