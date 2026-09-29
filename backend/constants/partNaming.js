/**
 * Part naming — one structure for every catalogue part, so "Part name" and
 * "Type" can never disagree again.
 *
 *   Category  (fixed list, CATALOGUE_PART_CATEGORIES)
 *   Kind      (fixed list per category; stored in parts.part_type)
 *   Specs     (fixed fields per kind; stored in parts.specs jsonb)
 *   Fits      (laptop brand + models from Asset Configuration; stored in
 *              parts.default_fitment / compatible_brands / compatible_models)
 *
 * The part name is GENERATED from these ("RAM 8 GB DDR4 SODIMM",
 * "SSD 512 GB NVMe", "Battery · Dell Latitude 5420") unless the user sets an
 * explicit override (parts.name_override). Two parts with the same category,
 * kind, specs and fits are the same part (parts.spec_key, unique).
 *
 * The frontend copy is frontend/src/constants/partNaming.js — keep the two
 * identical below the imports; test/partNaming.test.js fails when they drift.
 */
const { CATALOGUE_PART_CATEGORIES } = require('./laptopConditions');

// ---- BEGIN SHARED (identical in frontend/src/constants/partNaming.js) ----

/** Fits: 'required' = choose Universal or specific laptops; 'optional'; 'none' = not asked. */
const RAM_CAPACITIES = ['1 GB', '2 GB', '4 GB', '8 GB', '12 GB', '16 GB', '24 GB', '32 GB', '48 GB', '64 GB'];
const STORAGE_CAPACITIES = ['64 GB', '120 GB', '128 GB', '180 GB', '240 GB', '250 GB', '256 GB', '320 GB', '480 GB', '500 GB', '512 GB', '1 TB', '2 TB', '4 TB'];
const SCREEN_SIZES = ['10.1"', '11.6"', '12.5"', '13.3"', '14.0"', '15.6"', '16.0"', '17.3"'];

const F = {
  detail: (label = 'Detail', required = false, placeholder = '', before = false) => ({ key: 'detail', label, type: 'text', required, placeholder, ...(before ? { before: true } : {}) }),
};

const PART_SPEC_SCHEMA = {
  ram: {
    fits: 'optional',
    kinds: [
      {
        value: 'ram',
        label: 'RAM module',
        name: 'RAM',
        fields: [
          { key: 'capacity', label: 'Capacity', options: RAM_CAPACITIES, required: true },
          { key: 'ram_type', label: 'Type', options: ['DDR3', 'DDR3L', 'DDR4', 'DDR5', 'LPDDR4', 'LPDDR4X', 'LPDDR5'], required: true },
          { key: 'form', label: 'Form', options: ['SODIMM', 'DIMM'], required: true, default: 'SODIMM' },
          { key: 'speed', label: 'Speed', options: ['1333 MHz', '1600 MHz', '2133 MHz', '2400 MHz', '2666 MHz', '3200 MHz', '4800 MHz', '5600 MHz'] },
        ],
      },
    ],
  },
  storage: {
    fits: 'optional',
    kinds: [
      {
        value: 'ssd',
        label: 'SSD',
        name: 'SSD',
        fields: [
          { key: 'capacity', label: 'Capacity', options: STORAGE_CAPACITIES, required: true },
          { key: 'interface', label: 'Interface', options: ['NVMe', 'SATA', 'M.2 SATA'] },
        ],
      },
      {
        value: 'hdd',
        label: 'Hard disk (HDD)',
        name: 'HDD',
        fields: [
          { key: 'capacity', label: 'Capacity', options: STORAGE_CAPACITIES, required: true },
          { key: 'interface', label: 'Interface', options: ['SATA'] },
        ],
      },
    ],
  },
  display: {
    fits: 'optional',
    kinds: [
      {
        value: 'screen',
        label: 'Screen (LCD / LED panel)',
        name: 'Screen',
        fields: [
          { key: 'size', label: 'Size', options: SCREEN_SIZES, required: true },
          { key: 'resolution', label: 'Resolution', options: ['HD', 'HD+', 'FHD', 'QHD', '4K'] },
          { key: 'touch', label: 'Touch', options: ['Non-touch', 'Touch'], nameWhen: ['Touch'] },
        ],
      },
      { value: 'touch_glass', label: 'Touch glass / digitizer', name: 'Touch Glass', fields: [{ key: 'size', label: 'Size', options: SCREEN_SIZES }] },
      { value: 'display_cable', label: 'Display cable (LVDS / eDP)', name: 'Display Cable', fields: [] },
    ],
  },
  battery: {
    fits: 'optional',
    kinds: [
      { value: 'battery', label: 'Laptop battery', name: 'Battery', fits: 'required', fields: [] },
      { value: 'cmos_battery', label: 'CMOS battery', name: 'CMOS Battery', fields: [] },
      { value: 'battery_connector', label: 'Battery connector / cable', name: 'Battery Connector', fields: [] },
    ],
  },
  keyboard: {
    fits: 'optional',
    kinds: [
      {
        value: 'keyboard',
        label: 'Keyboard',
        name: 'Keyboard',
        fits: 'required',
        fields: [
          { key: 'layout', label: 'Layout', options: ['US', 'UK', 'IN'] },
          { key: 'backlight', label: 'Backlight', options: ['Backlit', 'Non-backlit'], nameWhen: ['Backlit'] },
        ],
      },
      {
        value: 'keyboard_c_panel',
        label: 'Keyboard with C panel',
        name: 'Keyboard + C Panel',
        fits: 'required',
        fields: [
          { key: 'layout', label: 'Layout', options: ['US', 'UK', 'IN'] },
          { key: 'backlight', label: 'Backlight', options: ['Backlit', 'Non-backlit'], nameWhen: ['Backlit'] },
        ],
      },
      { value: 'touchpad', label: 'Touchpad', name: 'Touchpad', fields: [] },
      { value: 'touchpad_buttons', label: 'Touchpad click buttons', name: 'Touchpad Buttons', fields: [] },
      { value: 'touchpad_cable', label: 'Touchpad / keyboard cable', name: 'Touchpad Cable', fields: [] },
    ],
  },
  motherboard: {
    fits: 'optional',
    kinds: [
      { value: 'motherboard', label: 'Motherboard', name: 'Motherboard', fits: 'required', fields: [F.detail('Processor on board', false, 'e.g. i5 8th Gen')] },
      { value: 'processor', label: 'Processor', name: 'Processor', fields: [F.detail('Processor', true, 'e.g. Intel i5 8th Gen')] },
      { value: 'gpu', label: 'Graphics card', name: 'Graphics Card', fields: [F.detail('Model', false, 'e.g. 2 GB')] },
      { value: 'chip', label: 'IC / chip / board component', name: 'IC', fields: [F.detail('Chip', true, 'e.g. charging IC')] },
      { value: 'ram_slot', label: 'RAM slot', name: 'RAM Slot', fields: [] },
    ],
  },
  cooling: {
    fits: 'optional',
    kinds: [
      { value: 'fan', label: 'Cooling fan', name: 'Cooling Fan', fits: 'required', fields: [] },
      { value: 'heat_sink', label: 'Heat sink', name: 'Heat Sink', fits: 'required', fields: [] },
    ],
  },
  power: {
    fits: 'optional',
    kinds: [
      {
        value: 'adapter',
        label: 'Charger / adapter',
        name: 'Adapter',
        fields: [
          { key: 'watt', label: 'Watt', options: ['30 W', '45 W', '65 W', '90 W', '130 W', '180 W'], required: true },
          { key: 'connector', label: 'Connector', options: ['Type-C', '4.5 mm', '7.4 mm', 'Slim tip', 'Round pin', 'Magsafe'] },
        ],
      },
      { value: 'power_cable', label: 'Power cable', name: 'Power Cable', fields: [{ key: 'plug', label: 'Plug', options: ['3-pin', '2-pin'] }] },
      { value: 'dc_jack', label: 'DC jack / charging port', name: 'DC Jack', fields: [] },
    ],
  },
  body: {
    fits: 'required',
    kinds: [
      { value: 'a_panel', label: 'A panel — top cover', name: 'A Panel', fields: [] },
      { value: 'b_panel', label: 'B panel — screen bezel', name: 'B Panel', fields: [] },
      { value: 'c_panel', label: 'C panel — palmrest', name: 'C Panel', fields: [] },
      { value: 'd_panel', label: 'D panel — base / bottom', name: 'D Panel', fields: [] },
      { value: 'ab_panel', label: 'A + B panel', name: 'A+B Panel', fields: [] },
      { value: 'cd_panel', label: 'C + D panel', name: 'C+D Panel', fields: [] },
      { value: 'hinge', label: 'Hinges', name: 'Hinges', fields: [] },
      { value: 'body_other', label: 'Other body part', name: '', fields: [F.detail('Body part', true, 'e.g. Camera bezel, Hinge cover')] },
    ],
  },
  general: {
    fits: 'optional',
    kinds: [
      { value: 'speaker', label: 'Speakers', name: 'Speakers', fields: [] },
      { value: 'webcam', label: 'Webcam', name: 'Webcam', fields: [] },
      { value: 'wifi_card', label: 'WiFi card', name: 'WiFi Card', fields: [] },
      { value: 'cable', label: 'Cable (internal)', name: 'Cable', fields: [F.detail('Which cable', true, 'e.g. Camera, FFC', true)] },
      { value: 'optical_drive', label: 'DVD drive', name: 'DVD Drive', fields: [] },
      { value: 'other', label: 'Other component', name: '', fields: [F.detail('Component', true, 'e.g. Logic card')] },
    ],
  },
  consumable: {
    fits: 'none',
    kinds: [
      { value: 'thermal_paste', label: 'Thermal paste', name: 'Thermal Paste' },
      { value: 'thermal_tape', label: 'Thermal tape', name: 'Thermal Tape' },
      { value: 'solder_wire', label: 'Solder wire', name: 'Solder Wire' },
      { value: 'desoldering_wire', label: 'Desoldering wick', name: 'Desoldering Wick' },
      { value: 'flux', label: 'Flux', name: 'Flux' },
      { value: 'screws', label: 'Screws', name: 'Screws' },
      { value: 'sticker', label: 'Sticker', name: 'Sticker', detailBefore: true },
      { value: 'tape', label: 'Tape', name: 'Tape', detailBefore: true },
      { value: 'cleaning', label: 'Cleaning / polish liquid', name: 'Cleaner' },
      { value: 'screen_repair', label: 'Screen repair material', name: 'Screen Repair' },
      { value: 'lamination', label: 'Lamination roll', name: 'Lamination Roll' },
      { value: 'gloves', label: 'Gloves', name: 'Gloves' },
      { value: 'other', label: 'Other consumable', name: '', detailRequired: true },
    ].map((k) => ({
      ...k,
      fields: [
        F.detail(k.value === 'other' ? 'Item' : 'Detail', Boolean(k.detailRequired), 'e.g. Keyboard, IPA, 2x4 mixed', Boolean(k.detailBefore)),
        { key: 'unit', label: 'Counted in', options: ['pcs', 'box', 'pack', 'set', 'roll', 'tube', 'bottle', 'sheet', 'ltr', 'ml', 'gm'], nameAs: 'paren' },
      ],
    })),
  },
  tools: {
    fits: 'none',
    kinds: [
      { value: 'soldering_iron', label: 'Soldering iron / station', name: 'Soldering Iron' },
      { value: 'hot_air', label: 'Hot air gun', name: 'Hot Air Gun' },
      { value: 'desoldering_pump', label: 'Desoldering pump', name: 'Desoldering Pump' },
      { value: 'screwdriver', label: 'Screwdriver set', name: 'Screwdriver Set' },
      { value: 'tweezers', label: 'Tweezers', name: 'Tweezers' },
      { value: 'opening_tool', label: 'Knife / opening tool', name: 'Opening Tool' },
      { value: 'multimeter', label: 'Multimeter / voltmeter', name: 'Multimeter' },
      { value: 'power_supply', label: 'Bench power supply', name: 'Bench Power Supply' },
      { value: 'tester', label: 'Tester', name: 'Tester', detailBefore: true },
      { value: 'stencil', label: 'Stencil', name: 'Stencil' },
      { value: 'dispenser', label: 'Dispenser', name: 'Dispenser' },
      { value: 'other', label: 'Other tool', name: '', detailRequired: true },
    ].map((k) => ({ ...k, fields: [F.detail(k.value === 'other' ? 'Tool' : 'Detail', Boolean(k.detailRequired), 'e.g. 48 in 1, 30V 5A', Boolean(k.detailBefore))] })),
  },
  accessory: {
    fits: 'optional',
    kinds: [
      { value: 'mouse', label: 'Mouse', name: 'Mouse' },
      { value: 'pendrive', label: 'Pendrive', name: 'Pendrive' },
      { value: 'earphone', label: 'Earphone / headset', name: 'Earphone' },
      { value: 'external_keyboard', label: 'External keyboard', name: 'External Keyboard' },
      { value: 'stylus', label: 'Stylus / pencil', name: 'Stylus' },
      { value: 'bag', label: 'Laptop bag', name: 'Laptop Bag' },
      { value: 'other', label: 'Other accessory', name: '', detailRequired: true },
    ].map((k) => ({ ...k, fields: [F.detail(k.value === 'other' ? 'Item' : 'Detail', Boolean(k.detailRequired), 'e.g. Wireless, 32 GB')] })),
  },
};

const PART_NAME_MAX = 100;
const FITMENTS = ['unset', 'universal', 'specific'];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const lc = (v) => clean(v).toLowerCase();

function categorySchema(category) {
  return PART_SPEC_SCHEMA[lc(category)] || null;
}

function kindSchema(category, kind) {
  const cat = categorySchema(category);
  if (!cat) return null;
  return cat.kinds.find((k) => k.value === lc(kind)) || null;
}

/** 'required' | 'optional' | 'none' for this category + kind. */
function fitsRule(category, kind) {
  const cat = categorySchema(category);
  if (!cat) return 'optional';
  const k = kindSchema(category, kind);
  return (k && k.fits) || cat.fits || 'optional';
}

function kindLabel(category, kind) {
  const k = kindSchema(category, kind);
  return k ? k.label : clean(kind);
}

/** Drop the brand when the model already starts with it ("Dell Latitude 5420"). */
function modelWithoutBrand(brand, model) {
  const b = lc(brand);
  const m = clean(model);
  if (b && m.toLowerCase().startsWith(`${b} `)) return m.slice(b.length + 1).trim();
  return m;
}

/** "Dell Latitude 5420", "Dell Latitude 5420, Latitude 5520", "Dell Latitude 5420 +2", "Dell (all models)". */
function fitsText({ default_fitment: fitment, compatible_brands: brands, compatible_models: models } = {}) {
  const f = lc(fitment);
  if (f === 'universal') return 'Universal';
  if (f !== 'specific') return '';
  const brand = clean(Array.isArray(brands) ? brands[0] : brands);
  const list = (Array.isArray(models) ? models : []).map((m) => modelWithoutBrand(brand, m)).filter(Boolean);
  if (!brand) return '';
  if (!list.length) return `${brand} (all models)`;
  if (list.length === 1) return `${brand} ${list[0]}`;
  if (list.length === 2) return `${brand} ${list[0]}, ${list[1]}`;
  return `${brand} ${list[0]} +${list.length - 1}`;
}

/** Name tokens for the specs of one kind, in field order: { before[], after[] }. */
function specTokens(k, specs) {
  const before = [];
  const after = [];
  for (const field of k.fields || []) {
    const v = clean(specs && specs[field.key]);
    if (!v) continue;
    if (field.nameWhen && !field.nameWhen.includes(v)) continue;
    const token = field.nameAs === 'paren' ? `(${v})` : v;
    (field.before ? before : after).push(token);
  }
  return { before, after };
}

/**
 * The generated name. `structure` = { category, part_type|kind, specs,
 * default_fitment, compatible_brands, compatible_models }. Never longer than
 * parts.part_name (100).
 */
function generatePartName(structure = {}) {
  const category = lc(structure.category);
  const kind = lc(structure.kind || structure.part_type);
  const k = kindSchema(category, kind);
  if (!k) return '';
  const { before, after } = specTokens(k, structure.specs || {});
  const head = [...before, k.name, ...after].filter(Boolean).join(' ');
  const rule = fitsRule(category, kind);
  const fits = rule === 'none' ? '' : fitsText(structure);
  // "Universal" only earns a place in the name where fits are required.
  const suffix = fits && !(fits === 'Universal' && rule !== 'required') ? ` · ${fits}` : '';
  let name = `${head}${suffix}`;
  if (name.length > PART_NAME_MAX) name = `${name.slice(0, PART_NAME_MAX - 1).trim()}…`;
  return name;
}

/**
 * Validate and canonicalise a structured part. Returns
 * { ok, errors[], value } where value holds the columns to write:
 * category, part_type, specs, default_fitment, compatible_brands,
 * compatible_models, name_override, part_name, spec_key.
 */
function normalizePartStructure(input = {}) {
  const errors = [];
  const category = lc(input.category);
  const kind = lc(input.kind || input.part_type);
  const cat = categorySchema(category);
  if (!cat) errors.push('Choose a category');
  const k = cat ? kindSchema(category, kind) : null;
  if (cat && !k) errors.push(`Choose what kind of ${category} part it is`);

  const specs = {};
  if (k) {
    const raw = input.specs && typeof input.specs === 'object' ? input.specs : {};
    for (const field of k.fields || []) {
      let v = clean(raw[field.key]);
      if (!v && field.default && field.required) v = field.default;
      if (!v) {
        if (field.required) errors.push(`${field.label} is required`);
        continue;
      }
      if (field.options) {
        const hit = field.options.find((o) => o.toLowerCase() === v.toLowerCase());
        if (!hit) { errors.push(`${field.label} must be one of: ${field.options.join(', ')}`); continue; }
        v = hit;
      } else if (v.length > 60) {
        errors.push(`${field.label} is too long (60 characters at most)`);
        continue;
      }
      specs[field.key] = v;
    }
    // The name a part had before the naming clean-up: kept for search only.
    const was = clean(raw._was);
    if (was) specs._was = was.slice(0, PART_NAME_MAX);
  }

  const rule = k ? fitsRule(category, kind) : 'optional';
  let fitment = FITMENTS.includes(lc(input.default_fitment)) ? lc(input.default_fitment) : 'unset';
  const brands = (Array.isArray(input.compatible_brands) ? input.compatible_brands : [input.compatible_brands])
    .map(clean).filter(Boolean);
  let brand = brands[0] || '';
  let models = (Array.isArray(input.compatible_models) ? input.compatible_models : [])
    .map(clean).filter(Boolean);
  models = [...new Set(models)];
  if (fitment === 'specific' && !brand) errors.push('Choose the laptop brand it fits (or Universal)');
  if (fitment !== 'specific') { brand = ''; models = []; }
  if (rule === 'none') { fitment = 'unset'; brand = ''; models = []; }
  if (rule === 'required' && fitment === 'unset') errors.push('Say which laptops it fits (a brand and model, or Universal)');

  const value = {
    category,
    part_type: kind,
    specs,
    default_fitment: fitment,
    compatible_brands: brand ? [brand] : [],
    compatible_models: models,
    name_override: Boolean(input.name_override),
  };
  const generated = k ? generatePartName(value) : '';
  if (value.name_override) {
    const own = clean(input.part_name);
    if (!own) errors.push('Type the part name, or untick "Use my own name"');
    else if (own.length > PART_NAME_MAX) errors.push(`Part name is too long (${PART_NAME_MAX} characters at most)`);
    value.part_name = own;
  } else {
    value.part_name = generated;
    if (k && !generated) errors.push('The name cannot be generated — fill in the details');
  }
  value.generated_name = generated;
  value.spec_key = k ? specKey(value) : null;
  return { ok: errors.length === 0, errors, value };
}

/**
 * Identity of a part: category + kind + specs + fits, lower-case, sorted.
 * Two parts with the same key are the same part.
 */
function specKey({ category, part_type, kind, specs, default_fitment, compatible_brands, compatible_models } = {}) {
  const c = lc(category);
  const k = lc(kind || part_type);
  const rule = fitsRule(c, k);
  const s = Object.keys(specs || {}).filter((key) => !key.startsWith('_')).sort().map((key) => `${key}=${lc(specs[key])}`).filter((x) => !x.endsWith('=')).join(';');
  let fits = '';
  if (rule !== 'none') {
    const f = lc(default_fitment) || 'unset';
    const brand = lc(Array.isArray(compatible_brands) ? compatible_brands[0] : compatible_brands);
    const models = [...new Set((Array.isArray(compatible_models) ? compatible_models : [])
      .map((m) => lc(modelWithoutBrand(brand, m))).filter(Boolean))].sort();
    // Not tagged and Universal name the same part; only specific laptops split it.
    fits = f === 'specific' ? `specific:${brand}:${models.join(',')}` : 'any';
  }
  return `${c}|${k}|${s}|${fits}`.slice(0, 400);
}

/** Lower-case text to search a part by: name, category, kind, specs, fits, numbers. */
function partSearchText(p = {}) {
  const cat = CATALOGUE_PART_CATEGORIES.find((c) => c.value === lc(p.category));
  const specs = p.specs && typeof p.specs === 'object' ? Object.values(p.specs) : [];
  return [
    p.part_name, cat && cat.label, p.category, kindLabel(p.category, p.part_type), ...specs,
    p.model_number, p.part_sku, p.pin_size, p.default_brand, p.default_model,
    ...(Array.isArray(p.compatible_brands) ? p.compatible_brands : []),
    ...(Array.isArray(p.compatible_models) ? p.compatible_models : []),
  ].filter(Boolean).join(' ').toLowerCase().replace(/(\d)\s+(gb|tb|w|mhz|mm)\b/g, '$1$2');
}

/** Every word of the query appears ("8gb ddr4", "battery 5420", "d panel 7490"). */
function matchesPartSearch(p, query) {
  const words = lc(query).replace(/(\d)\s+(gb|tb|w|mhz|mm)\b/g, '$1$2').split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = partSearchText(p);
  return words.every((w) => hay.includes(w));
}

/** A part is "structured" once it has a kind from its category's list. */
function isStructuredPart(p = {}) {
  return Boolean(kindSchema(p.category, p.part_type)) && p.specs != null && typeof p.specs === 'object';
}

// ---- END SHARED ----

module.exports = {
  PART_SPEC_SCHEMA,
  PART_NAME_MAX,
  RAM_CAPACITIES,
  STORAGE_CAPACITIES,
  SCREEN_SIZES,
  categorySchema,
  kindSchema,
  kindLabel,
  fitsRule,
  fitsText,
  generatePartName,
  normalizePartStructure,
  specKey,
  partSearchText,
  matchesPartSearch,
  isStructuredPart,
};
