/**
 * Part naming redesign (wave 2, builder 8): the name generator, structure
 * validation, the frontend copy staying identical, the clean-up proposer and
 * the parts API refusing duplicates / unstructured parts.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
process.env.OUTBOUND_MESSAGING_ENABLED = 'false';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const naming = require('../constants/partNaming');
const { CATALOGUE_PART_CATEGORIES, PART_CATEGORIES } = require('../constants/laptopConditions');
const cleanup = require('../services/partNamingCleanup');
const { planFromRows } = require('../scripts/apply-part-naming-cleanup');

const { generatePartName, normalizePartStructure, specKey, matchesPartSearch } = naming;
const dell = (models) => ({ default_fitment: 'specific', compatible_brands: ['Dell'], compatible_models: models });

describe('part name generator', () => {
  it('builds the names the brief asks for', () => {
    assert.equal(generatePartName({ category: 'ram', kind: 'ram', specs: { capacity: '8 GB', ram_type: 'DDR4', form: 'SODIMM' } }), 'RAM 8 GB DDR4 SODIMM');
    assert.equal(generatePartName({ category: 'storage', part_type: 'ssd', specs: { capacity: '512 GB', interface: 'NVMe' } }), 'SSD 512 GB NVMe');
    assert.equal(generatePartName({ category: 'battery', kind: 'battery', ...dell(['Latitude 5420']) }), 'Battery · Dell Latitude 5420');
    assert.equal(generatePartName({ category: 'body', kind: 'd_panel', ...dell(['Latitude 7490']) }), 'D Panel · Dell Latitude 7490');
  });

  it('shows optional words only when they say something', () => {
    const screen = (touch) => generatePartName({ category: 'display', kind: 'screen', specs: { size: '14.0"', resolution: 'FHD', touch } });
    assert.equal(screen('Touch'), 'Screen 14.0" FHD Touch');
    assert.equal(screen('Non-touch'), 'Screen 14.0" FHD');
    assert.equal(generatePartName({ category: 'keyboard', kind: 'keyboard', specs: { layout: 'US', backlight: 'Backlit' }, ...dell(['Latitude 5420']) }), 'Keyboard US Backlit · Dell Latitude 5420');
    assert.equal(generatePartName({ category: 'keyboard', kind: 'keyboard', specs: { backlight: 'Non-backlit' }, default_fitment: 'universal' }), 'Keyboard · Universal');
    // Universal is only named where fits are required (RAM fits any laptop that takes it).
    assert.equal(generatePartName({ category: 'ram', kind: 'ram', specs: { capacity: '4 GB', ram_type: 'DDR3L', form: 'SODIMM' }, default_fitment: 'universal' }), 'RAM 4 GB DDR3L SODIMM');
    assert.equal(generatePartName({ category: 'consumable', kind: 'thermal_paste', specs: { unit: 'tube' } }), 'Thermal Paste (tube)');
    assert.equal(generatePartName({ category: 'consumable', kind: 'sticker', specs: { detail: 'Keyboard' } }), 'Keyboard Sticker');
    assert.equal(generatePartName({ category: 'general', kind: 'other', specs: { detail: 'Logic card' } }), 'Logic card');
  });

  it('fits: brand not repeated, two models listed, more counted, brand only', () => {
    assert.equal(naming.fitsText(dell(['Dell Latitude 5420'])), 'Dell Latitude 5420');
    assert.equal(naming.fitsText(dell(['Latitude 5420', 'Latitude 5520'])), 'Dell Latitude 5420, Latitude 5520');
    assert.equal(naming.fitsText(dell(['Latitude 5420', 'Latitude 5520', 'Latitude 5430'])), 'Dell Latitude 5420 +2');
    assert.equal(naming.fitsText(dell([])), 'Dell (all models)');
  });

  it('never exceeds parts.part_name (100)', () => {
    const long = generatePartName({ category: 'general', kind: 'other', specs: { detail: 'x'.repeat(60) }, ...dell(['M'.repeat(60)]) });
    assert.ok(long.length <= 100, long.length);
  });
});

describe('part structure validation', () => {
  it('refuses a missing category, kind, required spec or out-of-list value', () => {
    assert.deepEqual(normalizePartStructure({}).errors, ['Choose a category']);
    assert.match(normalizePartStructure({ category: 'ram' }).errors.join(), /kind/);
    assert.match(normalizePartStructure({ category: 'ram', kind: 'ram', specs: { capacity: '8 GB' } }).errors.join(), /Type is required/);
    assert.match(normalizePartStructure({ category: 'ram', kind: 'ram', specs: { capacity: '7 GB', ram_type: 'DDR4' } }).errors.join(), /Capacity must be one of/);
    assert.match(normalizePartStructure({ category: 'power', kind: 'adapter' }).errors.join(), /Watt is required/);
    assert.match(normalizePartStructure({ category: 'general', kind: 'other' }).errors.join(), /Component is required/);
  });

  it('battery / body / keyboard must say which laptops they fit; specific needs a brand', () => {
    assert.match(normalizePartStructure({ category: 'battery', kind: 'battery' }).errors.join(), /fits/);
    assert.match(normalizePartStructure({ category: 'body', kind: 'c_panel', default_fitment: 'specific' }).errors.join(), /brand/);
    assert.equal(normalizePartStructure({ category: 'body', kind: 'c_panel', default_fitment: 'universal' }).ok, true);
  });

  it('canonicalises case and defaults, drops unknown spec keys, keeps the old name for search only', () => {
    const r = normalizePartStructure({ category: 'RAM', kind: 'Ram', specs: { capacity: '8 gb', ram_type: 'ddr4', colour: 'green', _was: '8GB' } });
    assert.equal(r.ok, true, r.errors.join());
    assert.deepEqual(r.value.specs, { capacity: '8 GB', ram_type: 'DDR4', form: 'SODIMM', _was: '8GB' });
    assert.equal(r.value.part_name, 'RAM 8 GB DDR4 SODIMM');
    assert.equal(r.value.part_type, 'ram');
    assert.ok(!r.value.spec_key.includes('_was'));
  });

  it('consumables and tools carry no fits', () => {
    const r = normalizePartStructure({ category: 'tools', kind: 'soldering_iron', ...dell(['Latitude 5420']) });
    assert.equal(r.value.default_fitment, 'unset');
    assert.deepEqual(r.value.compatible_brands, []);
  });

  it('own name: required when ticked, generated name kept alongside', () => {
    assert.match(normalizePartStructure({ category: 'power', kind: 'power_cable', name_override: true, part_name: ' ' }).errors.join(), /Type the part name/);
    const r = normalizePartStructure({ category: 'power', kind: 'power_cable', name_override: true, part_name: 'Mickey cable' });
    assert.equal(r.value.part_name, 'Mickey cable');
    assert.equal(r.value.generated_name, 'Power Cable');
  });

  it('identity: same structure = same key whatever the case, brand prefix or unset/universal', () => {
    const a = specKey({ category: 'battery', part_type: 'battery', specs: {}, ...dell(['Latitude 5420']) });
    const b = specKey({ category: 'battery', kind: 'battery', specs: {}, ...dell(['dell latitude 5420']) });
    assert.equal(a, b);
    const c = specKey({ category: 'ram', kind: 'ram', specs: { capacity: '8 GB' }, default_fitment: 'unset' });
    const d = specKey({ category: 'ram', kind: 'ram', specs: { capacity: '8 gb' }, default_fitment: 'universal' });
    assert.equal(c, d);
    assert.notEqual(a, specKey({ category: 'battery', kind: 'battery', specs: {}, ...dell(['Latitude 5520']) }));
  });

  it('search matches every word, with or without the space before GB', () => {
    const p = { part_name: 'RAM 8 GB DDR4 SODIMM', category: 'ram', part_type: 'ram', specs: { capacity: '8 GB', ram_type: 'DDR4', _was: '8GB stick' } };
    assert.ok(matchesPartSearch(p, '8gb ddr4'));
    assert.ok(matchesPartSearch(p, 'ddr4 8 gb'));
    assert.ok(matchesPartSearch(p, 'stick'));
    assert.ok(!matchesPartSearch(p, '16gb'));
    assert.ok(matchesPartSearch({ part_name: 'Battery · Dell Latitude 5420', category: 'battery', compatible_models: ['Latitude 5420'] }, 'battery 5420'));
  });
});

describe('categories and the frontend copy', () => {
  it('every catalogue category has a spec schema; GRN missing-part list unchanged', () => {
    for (const c of CATALOGUE_PART_CATEGORIES) assert.ok(naming.PART_SPEC_SCHEMA[c.value], c.value);
    assert.deepEqual(PART_CATEGORIES.map((c) => c.value), ['ram', 'storage', 'display', 'battery', 'keyboard', 'motherboard', 'cooling', 'power', 'body', 'general']);
    for (const [cat, s] of Object.entries(naming.PART_SPEC_SCHEMA)) {
      for (const k of s.kinds) assert.ok(k.value.length <= 50, `${cat}/${k.value} fits parts.part_type`);
    }
  });

  it('frontend/src/constants/partNaming.js is the same code between the SHARED markers', () => {
    const block = (file) => {
      const s = fs.readFileSync(file, 'utf8');
      return s.slice(s.indexOf('// ---- BEGIN SHARED'), s.indexOf('// ---- END SHARED ----'));
    };
    const back = block(path.join(__dirname, '../constants/partNaming.js'));
    const front = block(path.join(__dirname, '../../frontend/src/constants/partNaming.js'));
    assert.ok(back.length > 1000);
    assert.equal(front, back);
  });

  it('the frontend laptopConditions lists the same catalogue categories', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../frontend/src/constants/laptopConditions.js'), 'utf8');
    const cjs = src.replace(/export (const|function) /g, '$1 ').concat('\nmodule.exports = { PART_CATEGORIES, CATALOGUE_PART_CATEGORIES };');
    const m = { exports: {} };
    vm.runInNewContext(cjs, { module: m, exports: m.exports });
    assert.deepEqual(JSON.parse(JSON.stringify(m.exports.CATALOGUE_PART_CATEGORIES)).map((c) => c.value), CATALOGUE_PART_CATEGORIES.map((c) => c.value));
  });
});

describe('clean-up proposer', () => {
  const modelIndex = [
    { brand: 'Dell', model: 'Latitude 7490' }, { brand: 'Dell', model: 'Latitude 5420' },
    { brand: 'Dell', model: 'Latitude 5420 (Touch Screen)' }, { brand: 'Dell', model: 'Latitude E7470' },
  ];
  const propose = (part) => cleanup.proposeForPart({ category: 'general', part_type: 'general', ...part }, { modelIndex, knownBrands: ['Dell', 'HP'] });

  it('clear names are OK with the generated name', () => {
    assert.equal(propose({ part_name: '8 GB DDR4 RAM' }).name, 'RAM 8 GB DDR4 SODIMM');
    assert.equal(propose({ part_name: '8 GB DDR4 RAM' }).status, cleanup.CONFIDENT);
    assert.equal(propose({ part_name: '500 GB NVMe SSD' }).name, 'SSD 500 GB NVMe');
    assert.equal(propose({ part_name: 'KEYBORD TESTER' }).name, 'Keyboard Tester');
    const d = propose({ part_name: 'D PANEL', part_type: '7490', compatible_brands: ['Dell'] });
    assert.equal(d.name, 'D Panel · Dell Latitude 7490');
    assert.equal(d.status, cleanup.CONFIDENT);
  });

  it('unclear names are REVIEW with the reason', () => {
    const ram = propose({ part_name: '4GB', category: 'ram' });
    assert.equal(ram.status, cleanup.REVIEW);
    assert.match(ram.reasons.join(), /Type is required/);
    assert.match(propose({ part_name: 'Laptop Battery' }).reasons.join(), /fits/);
    assert.match(propose({ part_name: 'CAP' }).reasons.join(), /no rule/);
    assert.match(propose({ part_name: '180 SSD' }).reasons.join(), /no unit/);
    assert.match(propose({ part_name: 'Cooling Fan', compatible_brands: ['Competaible'] }).reasons.join(), /drops "Competaible"/);
  });

  it('two parts proposed as the same part are both REVIEW', () => {
    const rows = cleanup.markDuplicates([
      { part: { part_id: 1 }, proposal: propose({ part_name: '1 TB HDD' }) },
      { part: { part_id: 2 }, proposal: propose({ part_name: '1Tb HDD' }) },
    ]);
    assert.ok(rows.every((r) => r.proposal.status === cleanup.REVIEW && r.proposal.duplicate_of.length === 1));
  });

  it('CSV specs round-trip and the apply plan re-validates every approved row', () => {
    assert.deepEqual(cleanup.specsFromCell(cleanup.specsToCell({ capacity: '8 GB', ram_type: 'DDR4' })), { capacity: '8 GB', ram_type: 'DDR4' });
    const csv = [
      'part_id,apply,current_name,category,kind,specs,fits,fits_brand,fits_models,own_name',
      '4,yes,8 GB DDR4 RAM,ram,ram,"capacity=8 GB; ram_type=DDR4",unset,,,',
      '11,yes,Laptop Battery,battery,battery,,unset,,,',
      '12,,Laptop Charger,power,adapter,,unset,,,',
      '13,yes,x,ram,ram,"capacity=8 GB; ram_type=DDR4",unset,,,',
      '14,yes,Magic,accessory,external_keyboard,detail=Magic,unset,,,Apple Magic Keyboard',
    ].join('\n');
    const { plan, problems } = planFromRows(cleanup.parseCsv(csv));
    assert.deepEqual(plan.map((p) => p.id), [4, 13, 14]);
    assert.equal(plan[2].value.part_name, 'Apple Magic Keyboard');
    assert.equal(plan[2].value.name_override, true);
    assert.equal(problems.length, 2);
    assert.match(problems.join(), /#11 .*fits/);
    assert.match(problems.join(), /#13 and #4 would be the same part/);
  });
});

describe('parts API — structure enforced (rolled back)', () => {
  const h = require('./helpers/rollbackHarness');
  const partCtrl = require('../controllers/partController');
  let db;
  let user;
  const tag = `ZZNAME${Date.now()}`;

  before(async () => {
    db = await h.open();
    user = (await db.query("SELECT user_id, role, name, email FROM users WHERE role = 'super_admin' ORDER BY user_id LIMIT 1")).rows[0];
  });
  after(async () => { await h.close(); });

  const body = (extra = {}) => ({ category: 'general', kind: 'other', specs: { detail: `${tag} webcam` }, cost: 100, ...extra });

  it('create generates the name, stores kind / specs / key, links the spare catalogue', async () => {
    const r = await h.call(partCtrl.createPart, { user, body: body({ part_name: 'ignored — generated' }) });
    assert.equal(r.code, 201, JSON.stringify(r.body));
    const p = r.body.part;
    assert.equal(p.part_name, `${tag} webcam`);
    assert.equal(p.part_type, 'other');
    assert.equal(p.name_override, false);
    assert.ok(p.spec_key.startsWith('general|other|'));
    const cat = (await db.query('SELECT name, category, part_type FROM vendor_spare_parts_catalog WHERE floor_part_id = $1', [p.part_id])).rows[0];
    assert.deepEqual(cat, { name: p.part_name, category: 'general', part_type: 'other' });
  });

  it('refuses an unstructured part and a duplicate structure (409 with the existing id)', async () => {
    const bare = await h.call(partCtrl.createPart, { user, body: { part_name: `${tag} loose`, category: 'general' } });
    assert.equal(bare.code, 400);
    const first = await h.call(partCtrl.createPart, { user, body: body({ specs: { detail: `${tag} dup` } }) });
    assert.equal(first.code, 201);
    const again = await h.call(partCtrl.createPart, { user, body: body({ specs: { detail: ` ${tag.toLowerCase()}  DUP ` }, name_override: true, part_name: 'Different name' }) });
    assert.equal(again.code, 409);
    assert.equal(again.body.part_id, first.body.part.part_id);
  });

  it('update with specs regenerates the name; a plain edit keeps it; old screens cannot rename a structured part', async () => {
    const made = await h.call(partCtrl.createPart, { user, body: body({ specs: { detail: `${tag} upd` } }) });
    const id = made.body.part.part_id;
    const up = await h.call(partCtrl.updatePart, { user, params: { id }, body: { specs: { detail: `${tag} upd2` } } });
    assert.equal(up.code, 200, JSON.stringify(up.body));
    assert.equal(up.body.part.part_name, `${tag} upd2`);
    const plain = await h.call(partCtrl.updatePart, { user, params: { id }, body: { min_threshold: 7, part_name: `${tag} upd2`, category: 'general' } });
    assert.equal(plain.code, 200);
    assert.equal(plain.body.part.min_threshold, 7);
    const rename = await h.call(partCtrl.updatePart, { user, params: { id }, body: { part_name: 'Something else' } });
    assert.equal(rename.code, 400);
    assert.match(rename.body.message, /Parts catalogue/);
  });

  it('update refuses turning one part into a copy of another', async () => {
    const a = await h.call(partCtrl.createPart, { user, body: body({ specs: { detail: `${tag} a` } }) });
    const b = await h.call(partCtrl.createPart, { user, body: body({ specs: { detail: `${tag} b` } }) });
    const r = await h.call(partCtrl.updatePart, { user, params: { id: b.body.part.part_id }, body: { specs: { detail: `${tag} A` } } });
    assert.equal(r.code, 409);
    assert.equal(r.body.part_id, a.body.part.part_id);
  });

  it('battery model number + photo: a laptop battery yes, a CMOS battery / connector no, old names as before', () => {
    const { isBatteryPart } = partCtrl;
    assert.equal(isBatteryPart({ category: 'battery', part_type: 'battery', part_name: 'Battery · Dell Latitude 5420' }), true);
    assert.equal(isBatteryPart({ category: 'battery', part_type: 'cmos_battery', part_name: 'CMOS Battery' }), false);
    assert.equal(isBatteryPart({ category: 'battery', part_type: 'battery_connector', part_name: 'Battery Connector' }), false);
    assert.equal(isBatteryPart({ category: 'general', part_type: 'general', part_name: 'Laptop Battery' }), true);
  });

  it('search finds a part by any words of its structure', async () => {
    await h.call(partCtrl.createPart, { user, body: { category: 'ram', kind: 'ram', specs: { capacity: '64 GB', ram_type: 'LPDDR5', form: 'SODIMM' }, name_override: true, part_name: `${tag} big ram` } });
    const r = await h.call(partCtrl.getAllParts, { user, query: { search: '64gb lpddr5', limit: 50 } });
    assert.equal(r.code, 200);
    assert.ok(r.body.parts.some((p) => p.part_name === `${tag} big ram`));
    assert.ok('specs' in r.body.parts[0] && 'name_override' in r.body.parts[0]);
  });
});
