const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const src = new ErpSqlDumpSource(resolveDumpPath());
const pos = src.getTableRows('purchase_orders');
for (const id of [27, 28]) {
  const r = pos.find((x) => String(x.id) === String(id));
  console.log('PO', id, {
    number: r?.purchase_order_number,
    vendor_id: r?.vendor_id,
    status: r?.status,
  });
}
const dcs = src.getTableRows('delivery_challans');
console.log('DC total rows', dcs.length);
const distinctDc = new Set(dcs.map((r) => r.dc_number));
console.log('Distinct dc_number', distinctDc.size);
const pending = dcs.filter((r) => String(r.status).toLowerCase() === 'pending');
const delivered = dcs.filter((r) => String(r.status).toLowerCase() === 'delivered');
console.log('pending rows', pending.length, 'distinct pending dc', new Set(pending.map((r) => r.dc_number)).size);
console.log('delivered rows', delivered.length, 'distinct delivered dc', new Set(delivered.map((r) => r.dc_number)).size);

const sos = src.getTableRows('sales_orders');
console.log('SO lines', sos.length, 'distinct SO', new Set(sos.map((r) => r.sales_order_number)).size);
