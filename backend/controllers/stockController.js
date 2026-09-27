/** Stock screens in the new UI (services/stockService.js, claude/carret-stock.md). */
const pool = require('../config/db');
const svc = require('../services/stockService');
const { getCarretOccupancy } = require('../services/warehouseLocationService');

function sendError(res, e, where) {
  const status = e.status || e.statusCode || 500;
  if (status >= 500) console.error(`${where}:`, e);
  res.status(status).json({ success: false, message: e.message || 'Request failed', code: e.code });
}

async function inTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const wrap = (where, fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { sendError(res, e, where); }
};

exports.listAssets = wrap('stock.listAssets', async (req, res) => {
  const out = await svc.listAssets({
    search: req.query.search, status: req.query.status, view: req.query.view, tag: req.query.tag,
    page: req.query.page, limit: req.query.limit,
  });
  res.json({ success: true, ...out });
});

exports.assetCounts = wrap('stock.assetCounts', async (req, res) => {
  res.json({ success: true, data: await svc.assetCounts() });
});

exports.getAsset = wrap('stock.getAsset', async (req, res) => {
  const a = await svc.getAsset(req.params.id);
  if (!a) return res.status(404).json({ success: false, message: 'Laptop not found' });
  return res.json({ success: true, data: a });
});

exports.readyStock = wrap('stock.readyStock', async (req, res) => {
  res.json({ success: true, ...(await svc.readyStock()) });
});

exports.carrets = wrap('stock.carrets', async (req, res) => {
  const carret = req.query.carret ? Number(req.query.carret) : null;
  res.json({ success: true, data: await getCarretOccupancy(pool, carret), carret_min: svc.CARRET_MIN, carret_max: svc.CARRET_MAX, slots_per_carret: svc.SLOTS_PER_CARRET });
});

exports.retag = wrap('stock.retag', async (req, res) => {
  const out = await inTx((c) => svc.retag(c, { serialIds: req.body.serial_ids, tag: req.body.tag, reason: req.body.reason, user: req.user }));
  res.json({ success: true, data: out, message: `Re-tagged ${out.changed} laptop(s)${out.unchanged ? `, ${out.unchanged} already had that tag` : ''}` });
});

exports.setLocation = wrap('stock.setLocation', async (req, res) => {
  const b = req.body || {};
  const out = await inTx((c) => svc.setLocation(c, { serialId: b.serial_id, carret: b.carret ?? null, slot: b.slot, reason: b.reason, user: req.user }));
  res.json({ success: true, data: out, message: out.to ? `${out.ttspl_id} is now at ${out.to}` : `${out.ttspl_id} taken out of its slot` });
});

exports.listScrapRequests = wrap('stock.listScrapRequests', async (req, res) => {
  res.json({ success: true, data: await svc.listScrapRequests({ status: req.query.status || 'pending' }) });
});

exports.requestScrap = wrap('stock.requestScrap', async (req, res) => {
  const row = await inTx((c) => svc.requestScrap(c, { serialId: req.body.serial_id, reason: req.body.reason, user: req.user }));
  res.status(201).json({ success: true, data: row, message: `Scrap request raised for ${row.asset_code} — a manager must approve it` });
});

exports.decideScrap = wrap('stock.decideScrap', async (req, res) => {
  const approve = req.body.approve === true || req.body.approve === 'true';
  const row = await inTx((c) => svc.decideScrap(c, Number(req.params.id), { approve, note: req.body.note, user: req.user }));
  res.json({ success: true, data: row, message: approve ? `${row.asset_code} scrapped — add it to a scrap challan to hand it to the buyer` : 'Scrap request rejected' });
});

exports.cancelScrapRequest = wrap('stock.cancelScrapRequest', async (req, res) => {
  const row = await inTx((c) => svc.cancelScrapRequest(c, Number(req.params.id), { user: req.user }));
  res.json({ success: true, data: row, message: 'Scrap request withdrawn' });
});

exports.scrappedAwaitingChallan = wrap('stock.scrappedAwaitingChallan', async (req, res) => {
  res.json({ success: true, data: await svc.scrappedAwaitingChallan() });
});

exports.notEarning = wrap('stock.notEarning', async (req, res) => {
  res.json({ success: true, ...(await svc.notEarning({ days: req.query.days })) });
});
