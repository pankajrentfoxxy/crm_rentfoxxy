/**
 * Part naming clean-up — rule-based proposals for the existing catalogue
 * (scripts/part-naming-cleanup-report.js writes them to a CSV; after review
 * scripts/apply-part-naming-cleanup.js applies the approved rows).
 *
 * Pure functions: no DB access here, so the rules are unit-tested
 * (test/partNaming.test.js). A proposal is CONFIDENT only when the old name
 * states the thing plainly and the structure validates; everything else is
 * REVIEW with the reason spelt out.
 */
const { normalizePartStructure, kindSchema, fitsRule } = require('../constants/partNaming');

const CONFIDENT = 'OK';
const REVIEW = 'REVIEW';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** "8GB", "8 GB", "1Tb" → "8 GB" / "1 TB"; bare numbers only when allowBare. */
function capacityFrom(text, { allowBare = false } = {}) {
  const t = String(text || '');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(gb|tb)\b/i);
  if (m) return { value: `${Number(m[1])} ${m[2].toUpperCase()}`, bare: false };
  if (allowBare) {
    const b = t.match(/\b(\d{2,4})\b/);
    if (b) return { value: `${Number(b[1])} GB`, bare: true };
  }
  return null;
}

function ramTypeFrom(text) {
  const m = String(text || '').match(/\b(lp)?ddr\s*([345])(x|l)?\b/i);
  if (!m) return null;
  return `${m[1] ? 'LP' : ''}DDR${m[2]}${m[3] ? m[3].toUpperCase() : ''}`;
}

/**
 * Laptop models mentioned in a text ("7490", "E7470", "5402 battery"),
 * resolved against the Asset Configuration model list.
 * `modelIndex` = [{ brand, model }] (asset_config_brand_models).
 */
function laptopFrom(texts, brandHint, modelIndex = []) {
  const numbers = new Set();
  for (const t of texts) {
    for (const m of String(t || '').matchAll(/\b([a-z]{0,2}\d{3,4}[a-z]?)\b/gi)) {
      const tok = m[1].toLowerCase();
      if (/^\d{3}$/.test(tok)) continue; // 480, 512, 320 are capacities, not models
      if (/^(ddr|lp)/.test(tok)) continue;
      numbers.add(tok);
    }
  }
  if (!numbers.size) return null;
  const hint = clean(brandHint).toLowerCase();
  for (const num of numbers) {
    const bare = num.replace(/^[a-z]+/, '');
    const hits = modelIndex.filter(({ brand, model }) => {
      if (hint && String(brand).toLowerCase() !== hint) return false;
      const words = String(model).toLowerCase().split(/[\s()/-]+/);
      return words.includes(num) || words.includes(bare);
    });
    // Prefer the plain model over "(Touch Screen)" variants.
    const plain = hits.filter((h) => !/\(/.test(h.model));
    const pick = plain.length ? plain : hits;
    const exact = pick.filter((h) => String(h.model).toLowerCase().split(/[\s()/-]+/).includes(num));
    const list = exact.length ? exact : pick;
    const brands = [...new Set(list.map((h) => h.brand))];
    if (list.length === 1 || (brands.length === 1 && list.length > 0 && new Set(list.map((h) => h.model)).size === 1)) {
      return { brand: list[0].brand, model: list[0].model, token: num, exact: exact.length > 0 };
    }
    if (list.length > 1) return { ambiguous: list.map((h) => `${h.brand} ${h.model}`), token: num };
    return { unknown: num };
  }
  return null;
}

/**
 * Rules, first match wins. Each returns { category, kind, specs?, sure?, why? }.
 * `sure: false` forces REVIEW even when the structure validates.
 */
const RULES = [
  // --- tools & consumables first: their names contain part words ("keyboard tester")
  [/keyb?o?a?rd\s*tester/, () => ({ category: 'tools', kind: 'tester', specs: { detail: 'Keyboard' } })],
  [/keyb?o?a?rd\s*sti[ck]k?er/, () => ({ category: 'consumable', kind: 'sticker', specs: { detail: 'Keyboard' } })],
  [/logo\s*sticker/, (t) => ({ category: 'consumable', kind: 'sticker', specs: { detail: `Logo${/lenovo/.test(t) ? ' (Lenovo)' : ''}` } })],
  [/hot\s*air\s*gun|airgun/, () => ({ category: 'tools', kind: 'hot_air' })],
  [/tweezer/, () => ({ category: 'tools', kind: 'tweezers' })],
  [/desoldering\s*pump/, () => ({ category: 'tools', kind: 'desoldering_pump' })],
  [/desoldering\s*wire|desoldering\s*wick/, () => ({ category: 'consumable', kind: 'desoldering_wire' })],
  [/soldering\s*iron/, () => ({ category: 'tools', kind: 'soldering_iron' })],
  [/solder\s*wire|solderwire/, () => ({ category: 'consumable', kind: 'solder_wire' })],
  [/screw\s*driver|screwdriver/, (t) => ({ category: 'tools', kind: 'screwdriver', specs: { detail: [/electric/.test(t) && 'Electric', (t.match(/(\d+)\s*in\s*1/) || [])[1] && `${t.match(/(\d+)\s*in\s*1/)[1]} in 1`].filter(Boolean).join(' ') } })],
  [/(\d+)\s*volt.*(\d+)\s*amp|power\s*supply/, (t) => {
    const v = t.match(/(\d+)\s*volt/); const a = t.match(/(\d+)\s*amp/);
    return { category: 'tools', kind: 'power_supply', specs: { detail: [v && `${v[1]}V`, a && `${a[1]}A`].filter(Boolean).join(' ') } };
  }],
  [/volt\s*m[ie]+ter|multimeter/, () => ({ category: 'tools', kind: 'multimeter', specs: { detail: 'Voltmeter' }, sure: false, why: 'old name "C2C VOLTMIETER"' })],
  [/knife/, () => ({ category: 'tools', kind: 'opening_tool', specs: { detail: 'Ironbits knife' } })],
  [/stencil/, () => ({ category: 'tools', kind: 'stencil' })],
  [/despenser|dispenser/, () => ({ category: 'tools', kind: 'dispenser', specs: { detail: 'IPA' }, sure: false, why: '"IP DESPENSER" read as an IPA dispenser' })],
  [/cooling\s*paste|thermal\s*paste/, () => ({ category: 'consumable', kind: 'thermal_paste' })],
  [/th[ae]rmal\s*tape/, () => ({ category: 'consumable', kind: 'thermal_tape' })],
  [/screen\s*tape/, () => ({ category: 'consumable', kind: 'tape', specs: { detail: 'Screen' } })],
  [/ip\s*flux/, () => ({ category: 'consumable', kind: 'cleaning', specs: { detail: 'IPA', unit: 'ltr' }, sure: false, why: '"IP FLUX 1LTR" read as IPA (isopropyl) — could be flux' })],
  [/flux/, (t) => ({ category: 'consumable', kind: 'flux', specs: { detail: /paste/.test(t) ? 'Paste' : '' } })],
  [/screw/, (t, p) => ({ category: 'consumable', kind: 'screws', specs: { detail: /mix/.test(t) ? 'Mixed' : '', unit: /1000\s*pcs/i.test(p.description || '') ? 'box' : '' } })],
  [/gloves?/, () => ({ category: 'consumable', kind: 'gloves' })],
  [/lamination/, () => ({ category: 'consumable', kind: 'lamination' })],
  [/polarizer/, (t) => ({ category: 'consumable', kind: 'screen_repair', specs: { detail: `Polarizer ${(t.match(/(\d+)\s*degree/) || [])[1] || ''}°`.replace(' °', '') } })],
  [/\blgp\b/, () => ({ category: 'consumable', kind: 'screen_repair', specs: { detail: 'LGP' } })],
  [/blue\s*paper/, () => ({ category: 'consumable', kind: 'screen_repair', specs: { detail: 'Blue paper' } })],
  [/\ba\s*paper/, () => ({ category: 'consumable', kind: 'screen_repair', specs: { detail: 'A paper' } })],
  [/shiner/, () => ({ category: 'consumable', kind: 'cleaning', specs: { detail: 'Shiner' } })],
  [/\bwd\s*-?40\b/, () => ({ category: 'consumable', kind: 'cleaning', specs: { detail: 'WD40' } })],

  // --- accessories
  [/pendrive|pen\s*drive/, () => ({ category: 'accessory', kind: 'pendrive' })],
  [/earphone|headphone/, () => ({ category: 'accessory', kind: 'earphone', sure: false, why: 'looks like a test entry' })],
  [/\bmou(se|ch)\b/, (t) => ({ category: 'accessory', kind: 'mouse', specs: { detail: /wire\s*less|wireless/.test(t) ? 'Wireless' : '' } })],
  [/magic\s*keyboard/, () => ({ category: 'accessory', kind: 'external_keyboard', specs: { detail: 'Magic Keyboard' }, sure: false, why: 'tablet accessory?' })],
  [/\bpencil\b|stylus/, () => ({ category: 'accessory', kind: 'stylus', specs: { detail: 'Pencil' }, sure: false, why: 'tablet accessory?' })],
  [/phone\s*cover/, () => ({ category: 'accessory', kind: 'other', specs: { detail: 'Phone cover' }, sure: false, why: 'looks like a test entry' })],

  // --- battery
  [/cmos/, () => ({ category: 'battery', kind: 'cmos_battery', sure: false, why: 'old name says "cmos battery wire 2pin" — CMOS battery or its wire?' })],
  [/battery\s*connector/, () => ({ category: 'battery', kind: 'battery_connector' })],
  [/battery/, () => ({ category: 'battery', kind: 'battery' })],
  [/^cell$/, () => ({ category: 'battery', kind: 'battery', sure: false, why: '"Cell" — a battery cell?' })],

  // --- power
  [/adapter|charger/, () => ({ category: 'power', kind: 'adapter' })],
  [/power\s*cable/, () => ({ category: 'power', kind: 'power_cable' })],
  [/dc\s*jack/, () => ({ category: 'power', kind: 'dc_jack' })],

  // --- storage
  [/nvme|ssd|hdd|hard\s*disk/, (t) => {
    const kind = /hdd|hard\s*disk/.test(t) ? 'hdd' : 'ssd';
    const cap = capacityFrom(t, { allowBare: true });
    const specs = { capacity: cap ? cap.value : '', interface: /nvme/.test(t) ? 'NVMe' : '' };
    const odd = kind === 'hdd' && cap && cap.value === '512 GB';
    return {
      category: 'storage', kind, specs,
      sure: !(cap && cap.bare) && !odd,
      why: [cap && cap.bare && `"${t}" has no unit — read as GB`, odd && '512 GB is an SSD size — HDD or SSD?'].filter(Boolean).join('; '),
    };
  }],

  // --- RAM (after "ram slot")
  [/ram\s*slot|expansion\s*slot/, () => ({ category: 'motherboard', kind: 'ram_slot' })],
  [/\bram\b|ddr\d/, (t, p) => ({ category: 'ram', kind: 'ram', specs: { capacity: (capacityFrom(t) || {}).value || '', ram_type: ramTypeFrom(`${t} ${p.part_type || ''}`) || '', form: 'SODIMM' } })],

  // --- board level
  [/processor|\bi[3579]\b/, (t) => ({ category: 'motherboard', kind: 'processor', specs: { detail: `Intel ${(t.match(/\bi[3579]\b/) || ['i?'])[0]}` } })],
  [/motherboard|mother\s*board/, () => ({ category: 'motherboard', kind: 'motherboard' })],
  [/graphic|gpu/, () => ({ category: 'motherboard', kind: 'gpu' })],
  [/ic-?\s*l3|\bic\b/, () => ({ category: 'motherboard', kind: 'chip', specs: { detail: 'L3 IC parts' }, sure: false, why: '"IC-L3 PARTS"' })],
  [/multipin|conector|connector/, (t) => ({ category: 'motherboard', kind: 'chip', specs: { detail: `Multipin connector ${(t.match(/(\d+)\s*pin/) || [])[1] || ''}-pin`.replace(' -pin', '') }, sure: false, why: 'board connector — chip level?' })],
  [/^pcb$/, () => ({ category: 'motherboard', kind: 'chip', specs: { detail: 'PCB' }, sure: false, why: '"PCB" — which board?' })],
  [/logi\s*card|logic\s*card/, () => ({ category: 'general', kind: 'other', specs: { detail: 'Logic card' }, sure: false, why: '"logi card"' })],

  // --- cooling
  [/heat\s*sink/, () => ({ category: 'cooling', kind: 'heat_sink' })],
  [/\bfan\b/, () => ({ category: 'cooling', kind: 'fan' })],

  // --- keyboard / touchpad
  [/trackpad\s*cable|touchpad\s*cable/, () => ({ category: 'keyboard', kind: 'touchpad_cable' })],
  [/touch\s*pad\s*\+\s*keyboard|c\s*\+\s*kb?\b/, () => ({ category: 'keyboard', kind: 'keyboard_c_panel', sure: false, why: 'keyboard + C panel (palmrest with touchpad)?' })],
  [/click|botam|button/, (t) => ({ category: 'keyboard', kind: 'touchpad_buttons', sure: /click/.test(t), why: /click/.test(t) ? '' : '"botam" read as touchpad buttons' })],
  [/track\s*ball|trackpoint/, () => ({ category: 'keyboard', kind: 'touchpad_buttons', sure: false, why: '"Track ball" — trackpoint cap?' })],
  [/touch\s*pad|trackpad/, () => ({ category: 'keyboard', kind: 'touchpad' })],
  [/backlight|backlit/, () => ({ category: 'keyboard', kind: 'keyboard', specs: { backlight: 'Backlit' }, sure: false, why: 'old name only says "backlight" — a backlit keyboard?' })],
  [/keyboard|keybord/, () => ({ category: 'keyboard', kind: 'keyboard' })],

  // --- display
  [/lvds|edp/, () => ({ category: 'display', kind: 'display_cable' })],
  [/display\s*glass|touch\s*glass/, () => ({ category: 'display', kind: 'touch_glass', sure: false, why: 'fits "MI" — a phone part?' })],
  [/screen|display\s*panel/, () => ({ category: 'display', kind: 'screen' })],

  // --- body
  [/camera\s*bezel/, (t) => ({ category: 'body', kind: 'body_other', specs: { detail: /sigl|single/.test(t) ? 'Single camera bezel' : 'Camera bezel' } })],
  [/ba[sz]e?l|bezel/, () => ({ category: 'body', kind: 'b_panel' })],
  [/^\s*a\s*\+?\s*b\s*$/, () => ({ category: 'body', kind: 'ab_panel', sure: false, why: '"ab" read as A+B panel' })],
  [/^\s*c\s*\+\s*d\s*$/, () => ({ category: 'body', kind: 'cd_panel' })],
  [/\ba\s*panel|cover\s*a\b|front\s*cover|forent\s*cover/, () => ({ category: 'body', kind: 'a_panel' })],
  [/\bc\s*panel|palm\s*rest|palmrest/, (t) => ({ category: 'body', kind: 'c_panel', sure: !/back\s*cover/.test(t), why: /back\s*cover/.test(t) ? '"Back Cover Palmrest" — C panel or D panel?' : '' })],
  [/\bd\s*panel|^base$|bottom/, () => ({ category: 'body', kind: 'd_panel' })],
  [/^panel$/, () => ({ category: 'display', kind: 'screen', sure: false, why: '"Panel" — screen or body panel?' })],
  [/hinge/, () => ({ category: 'body', kind: 'hinge' })],

  // --- other laptop components
  [/speaker/, () => ({ category: 'general', kind: 'speaker' })],
  [/webcam|web\s*cam/, () => ({ category: 'general', kind: 'webcam' })],
  [/wi-?fi/, () => ({ category: 'general', kind: 'wifi_card' })],
  [/camera\s*cable/, () => ({ category: 'general', kind: 'cable', specs: { detail: 'Camera' } })],
  [/\bf\s*f\s*cable|ffc/, () => ({ category: 'general', kind: 'cable', specs: { detail: 'FFC' } })],
  [/trackwire|track\s*wire/, () => ({ category: 'general', kind: 'cable', specs: { detail: 'Track wire' }, sure: false, why: '"Trackwire"' })],
  [/optical|dvd/, () => ({ category: 'general', kind: 'optical_drive' })],
];

/** Brands on the row that name a real laptop brand (not "Competaible", "MI" …). */
function realBrand(part, knownBrands) {
  const list = Array.isArray(part.compatible_brands) ? part.compatible_brands : [];
  for (const b of list) {
    const hit = knownBrands.find((k) => k.toLowerCase() === clean(b).toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * Propose a structure for one existing part.
 * ctx = { modelIndex: [{brand, model}], knownBrands: [names] }
 * Returns { status, reasons[], structure, name, spec_key, errors[] }.
 */
function proposeForPart(part, ctx = {}) {
  const modelIndex = ctx.modelIndex || [];
  const knownBrands = ctx.knownBrands || [...new Set(modelIndex.map((m) => m.brand))];
  const name = clean(part.part_name);
  const t = name.toLowerCase();
  const reasons = [];

  let guess = null;
  for (const [re, build] of RULES) {
    if (re.test(t)) { guess = build(t, part) || null; break; }
  }
  // Nothing in the name, but the row's category says RAM / storage ("4GB", "320 GB").
  if (!guess && String(part.category).toLowerCase() === 'ram') {
    guess = { category: 'ram', kind: 'ram', specs: { capacity: (capacityFrom(t) || {}).value || '', ram_type: ramTypeFrom(`${t} ${part.part_type || ''}`) || '', form: 'SODIMM' } };
  }
  if (!guess && String(part.category).toLowerCase() === 'storage' && capacityFrom(t)) {
    guess = { category: 'storage', kind: 'hdd', specs: { capacity: capacityFrom(t).value }, sure: false, why: 'the name gives only a capacity — HDD or SSD?' };
  }
  if (!guess) {
    return {
      status: REVIEW,
      reasons: [`no rule recognises "${name}" — choose the category and kind by hand`],
      structure: { category: '', kind: '', specs: {}, default_fitment: 'unset', compatible_brands: [], compatible_models: [] },
      name: '',
      spec_key: null,
      errors: [],
    };
  }
  if (guess.sure === false) reasons.push(guess.why || 'guess from an unclear name');

  // Fits: a laptop model in the name / part_type / description, resolved
  // against Asset Configuration; else a real brand on the row.
  const brandHint = realBrand(part, knownBrands);
  const texts = [part.part_name, part.part_type, part.description];
  const noFits = fitsRule(guess.category, guess.kind) === 'none';
  const lap = noFits ? null
    : laptopFrom(texts, brandHint, modelIndex) || (brandHint ? null : laptopFrom(texts, null, modelIndex));
  let fit = { default_fitment: 'unset', compatible_brands: [], compatible_models: [] };
  if (lap && lap.brand) {
    fit = { default_fitment: 'specific', compatible_brands: [lap.brand], compatible_models: [lap.model] };
    if (!lap.exact) reasons.push(`"${lap.token}" matched ${lap.brand} ${lap.model} loosely`);
  } else if (lap && lap.ambiguous) {
    reasons.push(`"${lap.token}" matches several laptops: ${lap.ambiguous.slice(0, 4).join(', ')}`);
    if (brandHint) fit = { default_fitment: 'specific', compatible_brands: [brandHint], compatible_models: [] };
  } else if (lap && lap.unknown) {
    reasons.push(`"${lap.unknown}" is not a model in Asset Configuration`);
    if (brandHint) fit = { default_fitment: 'specific', compatible_brands: [brandHint], compatible_models: [] };
  } else if (brandHint && part.default_fitment === 'specific') {
    fit = { default_fitment: 'specific', compatible_brands: [brandHint], compatible_models: part.compatible_models || [] };
  }
  const junkBrands = noFits ? [] : (part.compatible_brands || []).filter((b) => !knownBrands.some((k) => k.toLowerCase() === clean(b).toLowerCase()));
  if (junkBrands.length) reasons.push(`drops "${junkBrands.join(', ')}" from fits brands (not a laptop brand)`);

  const structure = {
    category: guess.category,
    kind: guess.kind,
    specs: Object.fromEntries(Object.entries(guess.specs || {}).filter(([, v]) => clean(v))),
    ...fit,
  };
  const n = normalizePartStructure({ ...structure, name_override: false });
  const errors = n.ok ? [] : n.errors;
  // Missing required details → REVIEW with a readable name preview.
  if (!n.ok) reasons.push(...n.errors.map((e) => `needs: ${e}`));
  const k = kindSchema(structure.category, structure.kind);
  const status = n.ok && guess.sure !== false && reasons.every((r) => r.startsWith('drops')) ? CONFIDENT : REVIEW;
  return {
    status,
    reasons,
    structure: { ...structure, specs: n.value.specs },
    name: n.value.generated_name || (k ? k.name : ''),
    spec_key: n.ok ? n.value.spec_key : null,
    errors,
  };
}

/** Mark proposals that collide (same spec_key) as REVIEW — a merge is a person's call. */
function markDuplicates(rows) {
  const byKey = new Map();
  for (const r of rows) {
    // Complete proposals collide on spec_key; incomplete ones on their name.
    const key = r.proposal.spec_key || (r.proposal.name ? `name:${r.proposal.name.toLowerCase()}` : null);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const ids = group.map((g) => `#${g.part.part_id}`);
    for (const g of group) {
      g.proposal.status = REVIEW;
      g.proposal.duplicate_of = ids.filter((i) => i !== `#${g.part.part_id}`);
      g.proposal.reasons.push(`same part as ${g.proposal.duplicate_of.join(', ')} — merge stock by hand (not done by the script), or give one a different detail`);
    }
  }
  return rows;
}

/** "capacity=8 GB; ram_type=DDR4" ⇄ { capacity: '8 GB', ram_type: 'DDR4' } */
function specsToCell(specs = {}) {
  return Object.entries(specs).filter(([k, v]) => !k.startsWith('_') && clean(v)).map(([k, v]) => `${k}=${v}`).join('; ');
}
function specsFromCell(cell) {
  const out = {};
  for (const part of String(cell || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = clean(part.slice(0, i));
    const v = clean(part.slice(i + 1));
    if (k && v) out[k] = v;
  }
  return out;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((c) => c !== '')) rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

module.exports = {
  CONFIDENT,
  REVIEW,
  RULES,
  capacityFrom,
  ramTypeFrom,
  laptopFrom,
  proposeForPart,
  markDuplicates,
  specsToCell,
  specsFromCell,
  csvCell,
  parseCsv,
};
