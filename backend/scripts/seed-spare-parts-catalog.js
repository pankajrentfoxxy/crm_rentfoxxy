#!/usr/bin/env node
/**
 * Seed vendor_spare_parts_catalog from ERP spare_parts master list.
 * Links each row to floor `parts` inventory when missing (for GRN stock sync).
 */
require('dotenv').config();
const pool = require('../config/db');

const ERP_SPARE_PARTS = [
  [1, '500 GB NVMe SSD'], [2, '480 GB NVMe SSD'], [3, '1 TB HDD'], [4, '8 GB DDR4 RAM'],
  [5, '16 GB DDR4 RAM'], [6, 'Intel i5 Processor'], [7, 'Intel i7 Processor'], [8, 'Cooling Fan'],
  [9, 'Laptop Keyboard'], [10, 'Touchpad'], [11, 'Laptop Battery'], [12, 'Laptop Charger Power Adapter'],
  [13, 'Laptop Screen Display Panel'], [14, 'Laptop Hinges'], [15, 'Laptop Speakers'], [16, 'Laptop Webcam'],
  [17, 'Laptop Trackpad Cable'], [18, 'Laptop DC Jack Power Port'], [19, 'Laptop Motherboard'],
  [20, 'Laptop Graphic Card Dedicated GPU'], [21, 'Laptop WiFi Card'], [22, 'Laptop Optical Drive DVD Writer'],
  [23, 'Laptop Back Cover Palmrest'], [24, 'Laptop RAM Slot Expansion Slot'], [25, 'Laptop Heat Sink'],
  [26, 'Track ball'], [27, 'Cell'], [28, 'Power cable'], [30, 'confortable'], [31, 'touch pad + keyboard'],
  [32, 'bazel'], [33, 'BASE'], [34, 'FORENT COVER A'], [35, 'ADAPTER'], [36, 'logi card'], [37, 'botam'],
  [38, 'wired less mouch'], [39, 'click botam'], [40, 'c+k'], [41, 'dc jack'], [42, 'ab'], [43, 'C+D'],
  [44, '256 GB SSD'], [46, '512 GB SSD'], [48, 'HDD 512'], [49, '4GB RAM'], [51, '240 GB SSD'],
  [52, '180 SSD'], [53, '2 GB RAM'], [54, '120 GB SSD'], [55, 'PAN 32'], [56, 'CAMERA CABLE'],
  [57, 'LVDS CABLE'], [58, 'HOT AIRGUN'], [59, 'MULTIPIN CONECTOR 47 PIN'], [60, 'TWEEZER RELIFE'],
  [61, 'FLUX PASTE'], [62, 'DESOLDERING WIRE'], [63, 'DESOLDERING PUMP'], [64, 'SOLDERING IRON'],
  [65, '30VOLT 5AMP POWER SUPPLY'], [66, 'KEYBORD STIKER'], [67, 'THARMAL TAPE'], [68, 'IP FLUX 1LTR'],
  [69, 'KEYBORD TESTER'], [70, 'IP DESPENSER'], [71, 'CAP'], [72, 'PCB'], [73, 'C PANEL'], [74, 'C+KB'],
  [75, 'LAMINATION ROLL'], [76, 'IC-L3 PARTS'], [77, 'SCREEN TAPE'], [78, '135 DEGREE POLARIZER SHEET'],
  [79, '90 DEGREE POLARIZER SHEET'], [80, 'LGP- SCREEN PARTS'], [81, 'BLUE PAPER- SCREEN REPAIRING PARTS'],
  [82, 'A PAPER- SCREEN REPAIRING PARTS'], [83, 'F F CABLE'], [84, 'GLOVES'], [85, 'A PANEL'],
  [86, 'SCREEN'], [87, 'COOLING PASTE'], [88, 'SHINER'], [89, 'SOLDERWIRE'], [90, 'ST'], [91, 'STENCIL'],
  [92, 'Logo Sticker (Lenovo)'], [93, 'C2C VOLTMIETER'],
];

const CATEGORIES = [
  { value: 'ram', label: 'RAM' },
  { value: 'storage', label: 'Storage / SSD' },
  { value: 'display', label: 'Display' },
  { value: 'battery', label: 'Battery' },
  { value: 'keyboard', label: 'Keyboard' },
  { value: 'motherboard', label: 'Motherboard / Chip Level' },
  { value: 'cooling', label: 'Cooling / Thermal' },
  { value: 'power', label: 'Power / Charger' },
  { value: 'body', label: 'Body / Casing' },
  { value: 'general', label: 'General / Other' },
];

function inferCategory(name) {
  const n = String(name).toLowerCase();
  if (/\bram\b|ddr|\d+\s*gb\s*ram/.test(n)) return 'ram';
  if (/ssd|hdd|nvme|storage|\d+\s*gb/.test(n) && !/ram/.test(n)) return 'storage';
  if (/battery|cell\b/.test(n)) return 'battery';
  if (/keyboard|keybord|k\+b|c\+kb|touch pad \+ keyboard/.test(n)) return 'keyboard';
  if (/screen|display|panel|lgp|polarizer|lvds|camera cable/.test(n)) return 'display';
  if (/charger|adapter|power|cable|dc jack|supply/.test(n)) return 'power';
  if (/fan|cooling|thermal|heat sink|cooling paste/.test(n)) return 'cooling';
  if (/hinge|cover|palm|base|bazel|botam|cap\b|sticker|logo|forent cover|lamination|gloves|shiner/.test(n)) return 'body';
  if (/motherboard|processor|gpu|graphic|wifi|webcam|touchpad|trackpad|speaker|optical|pcb|ic-|stencil|solder|flux|tweezer|multipin|volt|hot air|desolder|tester|dispenser|track ball|mouse|mouch/.test(n)) {
    return 'motherboard';
  }
  return 'general';
}

function inferType(name) {
  const n = String(name).toLowerCase();
  if (/ddr4/.test(n)) return 'DDR4';
  if (/nvme/.test(n)) return 'NVMe';
  if (/hdd/.test(n)) return 'HDD';
  if (/sata/.test(n)) return 'SATA';
  if (/i5/.test(n)) return 'Intel i5';
  if (/i7/.test(n)) return 'Intel i7';
  const cap = name.match(/(\d+\s*GB|\d+\s*TB)/i);
  if (cap) return cap[1].toUpperCase().replace(/\s+/g, ' ');
  return null;
}

function inferSpecs(name, category, partType) {
  const bits = [partType, category].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}

async function ensureFloorPart(client, { name, category, part_type, specifications }) {
  const existing = await client.query(
    `SELECT part_id FROM parts WHERE LOWER(part_name) = LOWER($1) LIMIT 1`,
    [name]
  );
  if (existing.rows.length) return existing.rows[0].part_id;

  const ins = await client.query(
    `INSERT INTO parts (part_name, part_type, category, quantity, min_threshold, description)
     VALUES ($1, $2, $3, 0, 5, $4) RETURNING part_id`,
    [name, part_type || category, category, specifications || name]
  );
  return ins.rows[0].part_id;
}

async function upsertCatalogRow(client, erpId, name) {
  const category = inferCategory(name);
  const part_type = inferType(name);
  const specifications = inferSpecs(name, category, part_type);

  const dup = await client.query(
    `SELECT part_id, floor_part_id FROM vendor_spare_parts_catalog
      WHERE erp_spare_part_id = $1 OR LOWER(name) = LOWER($2)
      LIMIT 1`,
    [erpId, name]
  );

  let catalogId;
  if (dup.rows.length) {
    catalogId = dup.rows[0].part_id;
    await client.query(
      `UPDATE vendor_spare_parts_catalog SET
          name = $2, category = $3, part_type = $4, specifications = $5,
          erp_spare_part_id = COALESCE(erp_spare_part_id, $6),
          active = TRUE, updated_at = NOW()
       WHERE part_id = $1`,
      [catalogId, name, category, part_type, specifications, erpId]
    );
  } else {
    const ins = await client.query(
      `INSERT INTO vendor_spare_parts_catalog
         (name, category, part_type, specifications, erp_spare_part_id, active)
       VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING part_id`,
      [name, category, part_type, specifications, erpId]
    );
    catalogId = ins.rows[0].part_id;
  }

  let floorPartId = dup.rows[0]?.floor_part_id || null;
  if (!floorPartId) {
    floorPartId = await ensureFloorPart(client, { name, category, part_type, specifications });
    await client.query(
      `UPDATE vendor_spare_parts_catalog SET floor_part_id = $2, updated_at = NOW() WHERE part_id = $1`,
      [catalogId, floorPartId]
    );
  }

  await client.query(
    `INSERT INTO spare_parts (id, name, status, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 1, updated_at = NOW()`,
    [catalogId, name]
  ).catch(() => {});

  return catalogId;
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let count = 0;
    for (const [erpId, name] of ERP_SPARE_PARTS) {
      await upsertCatalogRow(client, erpId, name);
      count += 1;
    }
    await client.query('COMMIT');
    console.log(`Seeded/updated ${count} spare parts catalog rows.`);
    console.log('Categories:', CATEGORIES.map((c) => c.value).join(', '));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
