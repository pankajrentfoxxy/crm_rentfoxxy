#!/usr/bin/env node
/**
 * Apply verified ERP brand/model corrections for customer-held laptops.
 * Brand lives in its own column; model does not repeat the brand.
 *
 *   node scripts/fix-customer-brand-model-mismatch.js           (dry-run)
 *   node scripts/fix-customer-brand-model-mismatch.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { logTtsplEvent } = require('../services/ttsplAuditService');
const { invalidateInventoryListCachesFireAndForget } = require('../services/inventoryListCache');

const COMMIT = process.argv.includes('--commit');
const DEPLOYED = ['rented', 'on_demo', 'sold', 'reserved', 'dispatch_ready', 'in_transit', 'out_stock'];

const BRANDS = [
  { key: 'dell', aliases: ['dell'], label: 'Dell' },
  { key: 'hp', aliases: ['hp', 'hewlett', 'hewlett-packard', 'hewlett packard'], label: 'HP' },
  { key: 'lenovo', aliases: ['lenovo'], label: 'Lenovo' },
  { key: 'apple', aliases: ['apple', 'macbook', 'mac book'], label: 'Apple' },
  { key: 'asus', aliases: ['asus'], label: 'Asus' },
];
const FAMILIES = [
  { brand: 'dell', tokens: ['latitude', 'inspiron', 'xps', 'precision', 'vostro', 'optiplex', 'alienware'] },
  { brand: 'hp', tokens: ['elitebook', 'probook', 'elite book', 'zbook', 'pavilion', 'spectre', 'envy', 'fortis', 'elite dragonfly', 'omen', 'elitedesk', 'prodesk'] },
  { brand: 'lenovo', tokens: ['thinkpad', 'think pad', 'ideapad', 'idea pad', 'thinkbook', 'think book', 'yoga', 'legion'] },
  { brand: 'apple', tokens: ['macbook', 'imac', 'mac mini'] },
  { brand: 'asus', tokens: ['zenbook', 'vivobook', 'tuf gaming', 'rog '] },
];
const STRIP_PREFIXES = [
  'hewlett-packard', 'hewlett packard', 'lenovo', 'apple', 'asus', 'dell', 'hp', 'laptop',
];

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();
}
function detectBrandFromText(text) {
  const n = ` ${norm(text)} `;
  const hits = [];
  for (const b of BRANDS) {
    for (const a of b.aliases) {
      const re = new RegExp(`(?:^|\\s)${a.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?:\\s|$)`);
      if (re.test(n)) {
        hits.push(b.key);
        break;
      }
    }
  }
  return [...new Set(hits)];
}
function detectFamilyBrand(text) {
  const n = ` ${norm(text)} `;
  const hits = [];
  for (const f of FAMILIES) {
    if (f.tokens.some((t) => n.includes(t))) hits.push(f.brand);
  }
  return [...new Set(hits)];
}
function canonicalBrand(text) {
  return detectBrandFromText(text)[0] || null;
}
function titleBrand(k) {
  return (BRANDS.find((b) => b.key === k) || {}).label || k;
}
function cleanModelName(model) {
  let s = String(model || '').replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
  let changed = true;
  while (changed && s) {
    changed = false;
    const lower = s.toLowerCase();
    for (const p of STRIP_PREFIXES) {
      if (lower === p) {
        s = '';
        changed = true;
        break;
      }
      if (lower.startsWith(`${p} `)) {
        s = s.slice(p.length).trim();
        changed = true;
        break;
      }
    }
  }
  return s;
}

function collectFixes(rows) {
  const fixes = [];
  for (const r of rows) {
    const brandRaw = String(r.brand || '').trim();
    const modelRaw = String(r.model || '').replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
    const storedBrand = canonicalBrand(brandRaw);
    const implied = [...new Set([...detectBrandFromText(modelRaw), ...detectFamilyBrand(modelRaw)])];
    const conflicting = implied.filter((b) => storedBrand && b !== storedBrand);
    if (!conflicting.length) continue;
    const newBrand = titleBrand(conflicting[0]);
    const newModel = cleanModelName(modelRaw);
    if (!newBrand || !newModel) continue;
    if (brandRaw === newBrand && modelRaw === newModel) continue;
    fixes.push({
      serial_id: r.serial_id,
      ttspl: r.ttspl || '',
      serial_number: r.serial_number,
      customer_id: r.customer_id,
      old_brand: brandRaw,
      old_model: modelRaw,
      new_brand: newBrand,
      new_model: newModel,
    });
  }
  return fixes;
}

async function main() {
  const { rows } = await pool.query(
    `SELECT vsn.serial_id,
            vsn.inventory_asset_code AS ttspl,
            vsn.serial_number,
            vsn.current_customer_id AS customer_id,
            COALESCE(vsn.extra->>'brand', vsn.grn_received_config->>'brand') AS brand,
            COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vsn.grn_received_config->>'model') AS model
       FROM vendor_serial_numbers vsn
      WHERE vsn.deleted_at IS NULL
        AND vsn.current_customer_id IS NOT NULL
        AND vsn.inventory_status = ANY($1::text[])
        AND COALESCE(vsn.extra->>'part_type', '') <> 'spare'`,
    [DEPLOYED]
  );

  const fixes = collectFixes(rows);
  const byBrand = {};
  for (const f of fixes) {
    byBrand[f.new_brand] = (byBrand[f.new_brand] || 0) + 1;
  }

  console.log('Customer-held laptops scanned:', rows.length);
  console.log('Units to correct:', fixes.length);
  console.log('By suggested brand:', byBrand);
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');
  if (!fixes.length) {
    await pool.end();
    return;
  }

  if (!COMMIT) {
    const sample = fixes.filter((f) => ['TTSPL6869', 'TTSPL5327'].includes(f.ttspl));
    console.log('Examples:', sample.length ? sample : fixes.slice(0, 3));
    console.log('Dry-run OK — pass --commit to apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  const counts = {
    vsn: 0,
    inventory: 0,
    invoice_lines: 0,
    invoices: 0,
    tickets: 0,
    support_items: 0,
    customer_inventory: 0,
  };

  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE brand_fix (
        serial_id int PRIMARY KEY,
        ttspl text,
        serial_number text,
        old_brand text,
        old_model text,
        new_brand text,
        new_model text
      )
    `);
    for (const f of fixes) {
      await client.query(
        `INSERT INTO brand_fix (serial_id, ttspl, serial_number, old_brand, old_model, new_brand, new_model)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [f.serial_id, f.ttspl, f.serial_number, f.old_brand, f.old_model, f.new_brand, f.new_model]
      );
    }

    const vsnUp = await client.query(`
      UPDATE vendor_serial_numbers vsn
         SET extra = COALESCE(vsn.extra, '{}'::jsonb)
                     || jsonb_build_object(
                          'brand', f.new_brand,
                          'model', f.new_model,
                          'model_name', f.new_model,
                          'spec_source', 'brand_model_erp_correction',
                          'spec_corrected_at', NOW(),
                          'previous_brand', f.old_brand,
                          'previous_model', f.old_model
                        ),
             grn_received_config = COALESCE(vsn.grn_received_config, '{}'::jsonb)
                     || jsonb_build_object('brand', f.new_brand, 'model', f.new_model),
             updated_at = NOW()
        FROM brand_fix f
       WHERE vsn.serial_id = f.serial_id
         AND vsn.deleted_at IS NULL
    `);
    counts.vsn = vsnUp.rowCount;

    const invUp = await client.query(`
      UPDATE inventory i
         SET brand = f.new_brand,
             model = f.new_model,
             updated_at = NOW()
        FROM brand_fix f
       WHERE (
               i.serial_number = f.serial_number
               OR (f.ttspl <> '' AND i.machine_number = f.ttspl)
             )
         AND (i.brand IS DISTINCT FROM f.new_brand OR i.model IS DISTINCT FROM f.new_model)
    `);
    counts.inventory = invUp.rowCount;

    const cilUp = await client.query(`
      UPDATE customer_invoice_lines cil
         SET brand = f.new_brand,
             model = f.new_model
        FROM brand_fix f
       WHERE (cil.serial_id = f.serial_id OR (f.ttspl <> '' AND cil.ttspl_id = f.ttspl))
         AND (cil.brand IS DISTINCT FROM f.new_brand OR cil.model IS DISTINCT FROM f.new_model)
    `);
    counts.invoice_lines = cilUp.rowCount;

    const invRes = await client.query(`
      SELECT ci.invoice_id, ci.line_items
        FROM customer_invoices ci
       WHERE EXISTS (
         SELECT 1
           FROM jsonb_array_elements(COALESCE(ci.line_items, '[]'::jsonb)) e
           JOIN brand_fix f
             ON (NULLIF(e->>'serial_id','')::int = f.serial_id
                 OR (f.ttspl <> '' AND e->>'ttspl_id' = f.ttspl))
       )
    `);
    const fixBySerial = new Map(fixes.map((f) => [f.serial_id, f]));
    const fixByTtspl = new Map(fixes.filter((f) => f.ttspl).map((f) => [f.ttspl, f]));

    for (const inv of invRes.rows) {
      const lines = Array.isArray(inv.line_items) ? inv.line_items : [];
      let changed = false;
      const next = lines.map((line) => {
        const sid = Number(line.serial_id);
        const f = (Number.isFinite(sid) && fixBySerial.get(sid)) || fixByTtspl.get(line.ttspl_id);
        if (!f) return line;
        if (line.brand === f.new_brand && line.model === f.new_model) return line;
        changed = true;
        return { ...line, brand: f.new_brand, model: f.new_model };
      });
      if (!changed) continue;
      await client.query(
        `UPDATE customer_invoices SET line_items = $2::jsonb, updated_at = NOW() WHERE invoice_id = $1`,
        [inv.invoice_id, JSON.stringify(next)]
      );
      counts.invoices += 1;
    }

    const tkUp = await client.query(`
      UPDATE tickets t
         SET brand = f.new_brand,
             model = f.new_model,
             updated_at = NOW()
        FROM brand_fix f
       WHERE (
               t.vendor_serial_id = f.serial_id
               OR (f.ttspl <> '' AND t.ttspl_id = f.ttspl)
               OR t.serial_number = f.serial_number
             )
         AND (t.brand IS DISTINCT FROM f.new_brand OR t.model IS DISTINCT FROM f.new_model)
    `);
    counts.tickets = tkUp.rowCount;

    const stiUp = await client.query(`
      UPDATE support_ticket_items i
         SET brand = f.new_brand,
             model = f.new_model
        FROM brand_fix f
       WHERE (
               (f.ttspl <> '' AND (i.ttspl_id = f.ttspl OR i.unique_serial_number = f.ttspl))
               OR i.serial_number = f.serial_number
             )
         AND (i.brand IS DISTINCT FROM f.new_brand OR i.model IS DISTINCT FROM f.new_model)
    `);
    counts.support_items = stiUp.rowCount;

    const ciUp = await client.query(`
      UPDATE customer_inventory ci
         SET model_name = f.new_model,
             updated_at = NOW()
        FROM brand_fix f
       WHERE (
               (f.ttspl <> '' AND ci.unique_serial_number = f.ttspl)
               OR ci.serial_number = f.serial_number
             )
         AND ci.model_name IS DISTINCT FROM f.new_model
    `);
    counts.customer_inventory = ciUp.rowCount;

    for (const f of fixes) {
      await logTtsplEvent({
        ttsplId: f.ttspl || f.serial_number,
        vendorSerialId: f.serial_id,
        eventType: 'brand_model_erp_correction',
        description: `Brand/model ${f.old_brand} / ${f.old_model} → ${f.new_brand} / ${f.new_model}`,
        metadata: {
          old_brand: f.old_brand,
          old_model: f.old_model,
          new_brand: f.new_brand,
          new_model: f.new_model,
        },
        actorName: 'fix-customer-brand-model-mismatch',
        db: client,
      });
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  invalidateInventoryListCachesFireAndForget();

  const verify = await pool.query(
    `SELECT inventory_asset_code, extra->>'brand' AS brand, extra->>'model' AS model
       FROM vendor_serial_numbers
      WHERE inventory_asset_code IN ('TTSPL6869','TTSPL5327') AND deleted_at IS NULL`
  );
  const invLine = await pool.query(
    `SELECT brand, model FROM customer_invoice_lines
      WHERE invoice_id = 1392 AND ttspl_id IN ('TTSPL6869','TTSPL5327')`
  );

  console.log('\nUpdated:', counts);
  console.log('Verify TTSPL6869 / TTSPL5327:', verify.rows);
  console.log('INV-1009 lines:', invLine.rows);
  await pool.end();
}

main().catch((e) => {
  console.error('Failed:', e.message || e);
  process.exit(1);
});
