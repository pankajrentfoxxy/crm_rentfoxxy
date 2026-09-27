#!/usr/bin/env node
/**
 * Laptop brand / model clean-up (27 Sep 2026).
 *
 *   node scripts/laptop-brand-cleanup.js [--tag QA-2026-09-27]            → writes the review CSV + dry run (rolls back)
 *   node scripts/laptop-brand-cleanup.js --commit [--include-medium]      → applies high (and medium) rows, backup JSON first
 *
 * Problems fixed on vendor_serial_numbers.extra (laptops: po_id set, no spo_id):
 *   - brand does not match the model family (Thinkpad under "Dell", Elitebook under "Dell", Latitude under "HP" …)
 *   - the model repeats the brand ("Dell Dell Precision 3561") or starts with another brand ("Lenovo Thinkpad T450")
 *   - brand spelt off the Asset Configuration list ("Dell Inc.", "LENOVO") or empty
 * Fix: brand = the family's brand (Asset Configuration spelling); model / model_name = the model without a
 * leading brand word (the edit screen stores it that way). Linked open floor tickets and the production
 * record are re-synced (same as the Edit item description screen) and each change is logged on the laptop.
 *
 * Confidence: high = family keyword and serial pattern agree (or only a spelling fix); medium = family keyword
 * only; low = keyword and serial disagree (listed, never applied).
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { syncLinkedTicketsFromItemDescription } = require('../services/qcProcessIntakeService');
const { logTtsplEvent } = require('../services/ttsplAuditService');

const FAMILIES = [
  { brand: 'Lenovo', re: /\b(think\s?pad|ideapad|thinkbook|yoga|legion|lenovo)\b/i },
  { brand: 'HP', re: /\b(elite\s?book|pro\s?book|z\s?book|pavilion|envy|spectre|omen|hp)\b/i },
  { brand: 'Dell', re: /\b(latitude|precision|inspiron|vostro|xps|alienware|dell)\b/i },
  { brand: 'Apple', re: /\b(mac\s?book|imac|apple)\b/i },
  { brand: 'Asus', re: /\b(vivobook|zenbook|expertbook|rog|tuf|asus)\b/i },
];
const BRAND_WORDS = /^(dell(\s+inc\.?)?|lenovo|hp|hewlett[\s-]packard|apple|asus)\s+/i;

/** Serial number shape → maker, as corroboration only. */
function serialMaker(serial) {
  const s = String(serial || '').trim().toUpperCase();
  // Old ThinkPad / ThinkCentre serials are 7 characters too (R86KFF9, L9DL734, PB5CVWB).
  if (/^(R8|R9|L9|PB|MP|MJ|PK)[0-9A-Z]{5}$/.test(s)) return 'Lenovo';
  if (/^[0-9A-Z]{7}$/.test(s)) return 'Dell'; // service tag
  if (/^(PC|PF|PG|R9|MP|LR|MJ|S1|PW|PB)[0-9A-Z]{6}$/.test(s)) return 'Lenovo';
  if (/^(5CG|5CD|CND|CNU|5CB|8CG|2CE|CZC|MXL|5CH|CNF)[0-9A-Z]{7}$/.test(s)) return 'HP';
  if (/^(C02|FVF|F5K|DMP|FVH|C1M|C17|H4T|G8W)[0-9A-Z]{7,9}$/.test(s) || /^[A-Z0-9]{12}$/.test(s)) return 'Apple';
  return null;
}

function familyBrand(model) {
  const hit = FAMILIES.find((f) => f.re.test(String(model || '')));
  return hit ? hit.brand : null;
}

function stripBrand(model) {
  let m = String(model || '').trim();
  for (let i = 0; i < 3 && BRAND_WORDS.test(m); i += 1) m = m.replace(BRAND_WORDS, '').trim();
  return m;
}

const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

(async () => {
  const commit = process.argv.includes('--commit');
  const includeMedium = process.argv.includes('--include-medium');
  const tagArg = process.argv.indexOf('--tag');
  const tag = tagArg > 0 ? process.argv[tagArg + 1] : `QA-${new Date().toISOString().slice(0, 10)}`;
  const brandNames = (await pool.query('SELECT name FROM asset_config_brands WHERE deleted_at IS NULL')).rows.map((r) => r.name);
  const canonical = (b) => brandNames.find((n) => n.toLowerCase() === String(b || '').toLowerCase()) || b;

  const { rows } = await pool.query(
    `SELECT serial_id, serial_number, COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl_id, inventory_status,
            extra->>'brand' AS brand, extra->>'model' AS model, extra->>'model_name' AS model_name
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND po_id IS NOT NULL AND spo_id IS NULL`
  );

  const plan = [];
  for (const r of rows) {
    const model = r.model || r.model_name || '';
    const fam = familyBrand(stripBrand(model)) || familyBrand(model);
    const brandNow = String(r.brand || '').trim();
    const brandNowCanon = /^dell\s+inc\.?$/i.test(brandNow) ? 'Dell' : canonical(brandNow);
    const targetBrand = fam ? canonical(fam) : brandNowCanon;
    const targetModel = stripBrand(model);
    const doubled = /^(\w+)\s+\1\s/i.test(model);
    const brandWrong = fam && brandNowCanon.toLowerCase() !== targetBrand.toLowerCase();
    const spelling = !brandWrong && brandNow && brandNow !== brandNowCanon;
    const empty = !brandNow && Boolean(fam);
    const modelChange = targetModel && targetModel !== model && (doubled || brandWrong || BRAND_WORDS.test(model) && brandWrong);
    if (!brandWrong && !spelling && !empty && !doubled) continue;

    const sm = serialMaker(r.serial_number);
    let confidence;
    let evidence;
    // A different maker's part filed under a laptop brand ("Lenovo Gigabyte B365M") — never guess.
    const otherMaker = /\b(gigabyte|msi|intel\s+nuc|asrock|samsung|lg|acer|microsoft)\b/i.test(model);
    if (otherMaker) {
      confidence = 'low';
      evidence = `model "${model}" names another maker — check the item`;
    } else if (spelling && !doubled) {
      confidence = 'high';
      evidence = `brand spelt "${brandNow}" — Asset Configuration has "${brandNowCanon}"`;
    } else if (sm && sm === targetBrand) {
      confidence = 'high';
      evidence = `model "${model}" is a ${targetBrand} family; serial ${r.serial_number} has the ${sm} pattern`;
    } else if (sm && sm !== targetBrand) {
      confidence = 'low';
      evidence = `model "${model}" says ${targetBrand} but serial ${r.serial_number} looks ${sm} — check the laptop`;
    } else {
      confidence = doubled && !brandWrong ? 'high' : 'medium';
      evidence = doubled && !brandWrong
        ? `brand repeated in the model "${model}"`
        : `model "${model}" is a ${targetBrand} family; serial ${r.serial_number} does not show a maker`;
    }
    plan.push({
      serial_id: r.serial_id,
      ttspl_id: r.ttspl_id,
      serial_number: r.serial_number,
      status: r.inventory_status,
      brand_now: brandNow,
      model_now: model,
      brand_new: targetBrand,
      model_new: (doubled || brandWrong || empty) && targetModel ? targetModel : model,
      problem: [brandWrong && 'brand does not match model', doubled && 'brand repeated in model', spelling && 'brand spelling', empty && 'no brand'].filter(Boolean).join('; '),
      evidence,
      confidence,
      model_change: Boolean(modelChange),
    });
  }

  const dir = path.join(__dirname, '..', '..', 'claude', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const csvFile = path.join(dir, `laptop-brand-cleanup-${tag}.csv`);
  const cols = ['serial_id', 'ttspl_id', 'serial_number', 'status', 'brand_now', 'model_now', 'brand_new', 'model_new', 'problem', 'evidence', 'confidence'];
  fs.writeFileSync(csvFile, [cols.join(','), ...plan.map((p) => cols.map((c) => csvEsc(p[c])).join(','))].join('\n'));

  const count = (k) => plan.reduce((m, p) => ({ ...m, [p[k]]: (m[p[k]] || 0) + 1 }), {});
  console.log(`${plan.length} laptops listed → ${csvFile}`);
  console.log('by confidence', count('confidence'));
  console.log('by problem', count('problem'));

  const selected = plan.filter((p) => p.confidence === 'high' || (includeMedium && p.confidence === 'medium'));
  const c = await pool.connect();
  const backup = [];
  let applied = 0;
  let stale = 0;
  let ticketsSynced = 0;
  try {
    await c.query('BEGIN');
    for (const p of selected) {
      const cur = (await c.query(
        `SELECT serial_id, serial_number, inventory_asset_code, extra FROM vendor_serial_numbers WHERE serial_id = $1 FOR UPDATE`,
        [p.serial_id]
      )).rows[0];
      const ex = cur?.extra || {};
      if (!cur || String(ex.brand || '').trim() !== p.brand_now || (ex.model || ex.model_name || '') !== p.model_now) { stale += 1; continue; }
      backup.push({ serial_id: p.serial_id, brand: ex.brand ?? null, model: ex.model ?? null, model_name: ex.model_name ?? null });
      const delta = { brand: p.brand_new, model: p.model_new };
      if (ex.model_name !== undefined) delta.model_name = p.model_new;
      await c.query(
        `UPDATE vendor_serial_numbers SET extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE serial_id = $1`,
        [p.serial_id, JSON.stringify(delta)]
      );
      const itemDesc = {
        brand: p.brand_new, model: p.model_new, processor: ex.processor, generation: ex.generation,
        ram: ex.ram, storage: ex.storage || ex.ssd, gpu: ex.gpu, screen_size: ex.screen_size,
      };
      const sync = await syncLinkedTicketsFromItemDescription(c, {
        serialId: p.serial_id, serialNumber: cur.serial_number, inventoryAssetCode: cur.inventory_asset_code, itemDesc, userId: null,
      });
      ticketsSynced += sync?.updated || 0;
      await logTtsplEvent({
        ttsplId: cur.inventory_asset_code || cur.serial_number,
        vendorSerialId: p.serial_id,
        eventType: 'item_description_updated',
        description: `Brand / model corrected: ${p.brand_now || '—'} ${p.model_now} → ${p.brand_new} ${p.model_new} (${p.problem})`,
        metadata: { before: { brand: p.brand_now, model: p.model_now }, after: delta, source: 'laptop-brand-cleanup', tag },
        actorName: 'laptop-brand-cleanup',
        db: c,
      });
      applied += 1;
    }
    console.log(`${commit ? 'COMMIT' : 'DRY RUN'} — ${includeMedium ? 'high + medium' : 'high only'}: ${selected.length} selected, ${applied} applied, ${stale} stale, ${ticketsSynced} open floor tickets re-synced`);
    if (commit) {
      const bdir = path.join(__dirname, '..', 'backups');
      fs.mkdirSync(bdir, { recursive: true });
      const bfile = path.join(bdir, `laptop-brand-cleanup-${Date.now()}.json`);
      fs.writeFileSync(bfile, JSON.stringify(backup, null, 2));
      await c.query('COMMIT');
      console.log(`COMMITTED (before-values: ${bfile})`);
    } else {
      await c.query('ROLLBACK');
      console.log('Dry run — rolled back. Add --commit (and --include-medium) to apply.');
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
