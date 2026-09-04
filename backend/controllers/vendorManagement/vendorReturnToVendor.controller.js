const pool = require('../../config/db');
const {
  actorFromReq,
  requireWarehouseRole,
  listEligibleLaptops,
  listReturnDcs,
  getReturnDc,
  createReturnDc,
  dispatchReturnDc,
  completeVendorReturn,
  cancelReturnDc,
} = require('../../services/vendorReturnToVendorService');

function handleError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ success: false, message: err.message });
}

exports.listEligible = async (req, res) => {
  try {
    const result = await listEligibleLaptops({
      vendorId: req.query.vendor_id,
      poId: req.query.po_id,
      search: req.query.search,
      page: Number(req.query.page) || 1,
      limit: Math.min(200, Number(req.query.limit) || 50),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
};

exports.listDcs = async (req, res) => {
  try {
    const result = await listReturnDcs({
      status: req.query.status,
      vendorId: req.query.vendor_id,
      page: Number(req.query.page) || 1,
      limit: Math.min(100, Number(req.query.limit) || 25),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
};

exports.getDc = async (req, res) => {
  try {
    const dc = await getReturnDc(req.params.dcNumber);
    if (!dc) return res.status(404).json({ success: false, message: 'Return DC not found' });
    res.json({ success: true, dc });
  } catch (err) {
    handleError(res, err);
  }
};

exports.createDc = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const body = req.body || {};
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const created = await createReturnDc(client, {
      serialIds: body.serial_ids || body.serialIds || [],
      vendorId: body.vendor_id || body.vendorId,
      poId: body.po_id || body.poId,
      returnReason: body.return_reason || body.returnReason,
      remarks: body.remarks,
      warehouseName: body.warehouse_name,
      warehouseAddress: body.warehouse_address,
      vendorName: body.vendor_name,
      vendorAddress: body.vendor_address,
      billingAddress: body.billing_address,
      shippingAddress: body.shipping_address,
      contactPerson: body.contact_person,
      contactMobile: body.contact_mobile,
      itemReturnReasons: body.item_return_reasons || body.itemReturnReasons || {},
      ...actor,
    });
    await client.query('COMMIT');
    const dc = created?.dc_number ? await getReturnDc(created.dc_number) : null;
    res.status(201).json({ success: true, dc });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.dispatchDc = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const dc = await dispatchReturnDc(client, {
      dcNumber: req.params.dcNumber,
      ...(req.body || {}),
      ...actor,
    });
    await client.query('COMMIT');
    res.json({ success: true, dc });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.completeDc = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const dc = await completeVendorReturn(client, {
      dcNumber: req.params.dcNumber,
      ...actor,
    });
    await client.query('COMMIT');
    res.json({ success: true, dc });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};

exports.cancelDc = async (req, res) => {
  const client = await pool.connect();
  try {
    requireWarehouseRole(req.user?.role);
    const actor = actorFromReq(req);
    await client.query('BEGIN');
    const dc = await cancelReturnDc(client, {
      dcNumber: req.params.dcNumber,
      ...actor,
    });
    await client.query('COMMIT');
    res.json({ success: true, dc });
  } catch (err) {
    await client.query('ROLLBACK');
    handleError(res, err);
  } finally {
    client.release();
  }
};
