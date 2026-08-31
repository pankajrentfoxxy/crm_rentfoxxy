export function brandNamesMatch(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export function activeLaptopMappedNames(items = []) {
  return (items || [])
    .filter((row) => row.status === 'active')
    .map((row) => row.name)
    .filter(Boolean);
}

function sortAlpha(values = []) {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Build spec filter dropdown options from Laptop Configuration mapping tree. */
export function buildSpecFilterOptionsFromLaptopTree(tree = [], brandName = '', specMasters = {}) {
  const activeBrands = sortAlpha(
    (tree || []).filter((b) => b.status === 'active').map((b) => b.name),
  );

  const brandKeys = Array.isArray(brandName)
    ? brandName.map((n) => String(n || '').trim()).filter(Boolean)
    : String(brandName || '').split(',').map((n) => n.trim()).filter(Boolean);
  let models = [];
  let processors = [];
  let generations = [];

  if (brandKeys.length) {
    const modelSet = new Set();
    const procSet = new Set();
    const genSet = new Set();
    for (const brand of tree || []) {
      if (brand.status !== 'active') continue;
      if (!brandKeys.some((key) => brandNamesMatch(brand.name, key))) continue;
      activeLaptopMappedNames(brand.models).forEach((n) => modelSet.add(n));
      activeLaptopMappedNames(brand.processors).forEach((n) => procSet.add(n));
      activeLaptopMappedNames(brand.generations).forEach((n) => genSet.add(n));
    }
    models = sortAlpha([...modelSet]);
    processors = sortAlpha([...procSet]);
    generations = sortAlpha([...genSet]);
  } else {
    const modelSet = new Set();
    const procSet = new Set();
    const genSet = new Set();
    for (const brand of tree || []) {
      if (brand.status !== 'active') continue;
      activeLaptopMappedNames(brand.models).forEach((n) => modelSet.add(n));
      activeLaptopMappedNames(brand.processors).forEach((n) => procSet.add(n));
      activeLaptopMappedNames(brand.generations).forEach((n) => genSet.add(n));
    }
    models = sortAlpha([...modelSet]);
    processors = sortAlpha([...procSet]);
    generations = sortAlpha([...genSet]);
  }

  return {
    brands: activeBrands,
    models: sortAlpha(models),
    processors: sortAlpha(processors),
    generations: sortAlpha(generations),
    rams: specMasters.rams || [],
    storages: specMasters.storages || [],
    gpus: specMasters.gpus || [],
    screen_sizes: specMasters.screen_sizes || [],
  };
}
