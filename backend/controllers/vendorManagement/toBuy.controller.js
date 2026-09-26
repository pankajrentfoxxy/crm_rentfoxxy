/** Procure → To buy (see services/toBuyService.js). */
const svc = require('../../services/toBuyService');

const send = (res, e, where) => {
  if (e instanceof svc.ToBuyError) return res.status(e.status).json({ success: false, message: e.message });
  console.error(`toBuy.${where}:`, e);
  return res.status(500).json({ success: false, message: 'Server error' });
};

exports.list = async (req, res) => {
  try {
    const [laptops, parts] = await Promise.all([svc.listLaptopShortfalls(), svc.listPartNeeds()]);
    res.json({ success: true, laptops, parts });
  } catch (e) { send(res, e, 'list'); }
};

exports.linkOptions = async (req, res) => {
  try { res.json({ success: true, ...(await svc.linkablePurchaseOrders()) }); } catch (e) { send(res, e, 'linkOptions'); }
};

exports.linkLaptop = async (req, res) => {
  const id = Number(req.params.id);
  const poId = req.body?.po_id == null || req.body.po_id === '' ? null : Number(req.body.po_id);
  if (!Number.isInteger(id) || (poId !== null && !Number.isInteger(poId))) return res.status(400).json({ success: false, message: 'Bad request' });
  try { res.json({ success: true, data: await svc.linkLaptopRequest(id, poId, req.user) }); } catch (e) { send(res, e, 'linkLaptop'); }
};

exports.linkPart = async (req, res) => {
  const id = Number(req.params.id);
  const spoId = Number(req.body?.spo_id);
  if (!Number.isInteger(id) || !Number.isInteger(spoId)) return res.status(400).json({ success: false, message: 'Pick a spare-parts order' });
  try { res.json({ success: true, data: await svc.linkPartRequest(id, spoId, req.user) }); } catch (e) { send(res, e, 'linkPart'); }
};

exports.moveOn = async (req, res) => {
  const so = String(req.body?.sales_order_number || '').trim();
  if (!so) return res.status(400).json({ success: false, message: 'sales_order_number required' });
  try { res.json({ success: true, data: await svc.moveOrderOn(so, req.user) }); } catch (e) { send(res, e, 'moveOn'); }
};
