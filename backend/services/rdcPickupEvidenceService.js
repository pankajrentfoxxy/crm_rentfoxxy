/**
 * A Return DC collected from My deliveries (no support tickets — e.g. an
 * end-of-rental return), migration 436: six photos of every laptop and the
 * technician's signature on the challan, before the customer's OTP closes it.
 * Support pickups do the same per laptop in Support → My work.
 */
const fs = require('fs');
const path = require('path');
const { parseDcSerials } = require('./challanChargerService');

const SLOTS = ['front', 'back', 'screen', 'keyboard', 'left', 'right'];
const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
const up = (v) => String(v || '').trim().toUpperCase();

async function laptopsOnRdc(db, dcNumber) {
  const rows = (await db.query(
    `SELECT serial_number FROM delivery_challan_lines WHERE dc_number = $1 AND movement_type = 'return'`,
    [dcNumber]
  )).rows;
  const seen = new Set();
  return rows.flatMap((r) => parseDcSerials(r.serial_number))
    .map((l) => ({ ...l, code: up(l.ttspl_id || l.serial_number) }))
    .filter((l) => l.code && !seen.has(l.code) && seen.add(l.code));
}

async function getEvidence(db, dcNumber) {
  const laptops = await laptopsOnRdc(db, dcNumber);
  const photos = (await db.query(
    `SELECT asset_code, slot, path, uploaded_at FROM support_item_photos WHERE dc_number = $1 AND item_id IS NULL`,
    [dcNumber]
  )).rows;
  const head = (await db.query(
    `SELECT technician_esign_url, technician_esign_at, technician_esign_name
       FROM delivery_challan_lines WHERE dc_number = $1 ORDER BY technician_esign_at DESC NULLS LAST LIMIT 1`,
    [dcNumber]
  )).rows[0] || {};
  return {
    dc_number: dcNumber,
    slots: SLOTS,
    laptops: laptops.map((l) => ({ ...l, photos: photos.filter((p) => p.asset_code === l.code) })),
    signature: head.technician_esign_url
      ? { url: head.technician_esign_url, at: head.technician_esign_at, name: head.technician_esign_name }
      : null,
  };
}

/** files: [{ slot, f }] saved by multer under backend/uploads/support. */
async function savePhotos(db, { dcNumber, code, files, userId }) {
  const laptops = await laptopsOnRdc(db, dcNumber);
  const lap = laptops.find((l) => l.code === up(code) || up(l.serial_number) === up(code));
  if (!lap) throw httpError(`${code || 'That laptop'} is not on ${dcNumber}`, 404);
  for (const { slot } of files) if (!SLOTS.includes(slot)) throw httpError('One photo per side of the laptop');
  for (const { slot, f } of files) {
    const rel = `support/${path.basename(f.path)}`;
    const prev = (await db.query(
      `SELECT path FROM support_item_photos WHERE dc_number = $1 AND asset_code = $2 AND slot = $3 AND item_id IS NULL`,
      [dcNumber, lap.code, slot]
    )).rows[0];
    if (prev) {
      await db.query(
        `UPDATE support_item_photos SET path = $4, uploaded_by = $5, uploaded_at = NOW()
          WHERE dc_number = $1 AND asset_code = $2 AND slot = $3 AND item_id IS NULL`,
        [dcNumber, lap.code, slot, rel, userId]
      );
      if (prev.path !== rel) fs.promises.unlink(path.join(__dirname, '..', 'uploads', prev.path)).catch(() => {});
    } else {
      await db.query(
        `INSERT INTO support_item_photos (item_id, dc_number, asset_code, slot, path, uploaded_by) VALUES (NULL, $1, $2, $3, $4, $5)`,
        [dcNumber, lap.code, slot, rel, userId]
      );
    }
  }
  return (await getEvidence(db, dcNumber)).laptops.find((l) => l.code === lap.code);
}

async function sign(db, { dcNumber, esignData, signerName, user }) {
  if (!esignData || !String(esignData).startsWith('data:image')) throw httpError('Signature required');
  const dir = path.join(__dirname, '..', 'uploads', 'support-pickups');
  fs.mkdirSync(dir, { recursive: true });
  const fname = `tech_esign_${String(dcNumber).replace(/[^\w-]+/g, '_')}_${Date.now()}.png`;
  fs.writeFileSync(path.join(dir, fname), Buffer.from(String(esignData).replace(/^data:image\/\w+;base64,/, ''), 'base64'));
  await db.query(
    `UPDATE delivery_challan_lines
        SET technician_esign_url = $2, technician_esign_at = NOW(), technician_esign_name = $3, technician_esign_by = $4, updated_at = NOW()
      WHERE dc_number = $1`,
    [dcNumber, `uploads/support-pickups/${fname}`, String(signerName || user?.name || (user?.user_id
      ? (await db.query('SELECT name FROM users WHERE user_id = $1', [user.user_id])).rows[0]?.name : '') || user?.email || '').trim() || null,
    user?.user_id || null]
  );
}

/** Refuses collection until every laptop has its 6 photos and the challan is signed. */
async function assertComplete(db, dcNumber) {
  const ev = await getEvidence(db, dcNumber);
  const short = ev.laptops.filter((l) => new Set(l.photos.map((p) => p.slot)).size < SLOTS.length);
  if (short.length) throw httpError(`Take all ${SLOTS.length} photos of ${short.map((l) => l.code).join(', ')} first`, 409);
  if (!ev.signature) throw httpError('Sign the Return DC before confirming the pickup', 409);
}

module.exports = { SLOTS, laptopsOnRdc, getEvidence, savePhotos, sign, assertComplete };
