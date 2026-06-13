import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { BillingAddressPanel, ShippingAddressPanel } from '../../operation-management/components/CustomerAddressPanels';
import SearchableMultiSelect from '../../operation-management/components/SearchableMultiSelect';
import { createDC, getAvailableSerials, getDCMeta, listSalesOrders } from '../salesPipelineApi';

export default function DCForm({ open, onClose, prefillSo }) {
  const navigate = useNavigate();
  const [salesOrders, setSalesOrders] = useState([]);
  const [soNumber, setSoNumber] = useState(prefillSo || '');
  const [withoutSo, setWithoutSo] = useState(false);
  const [meta, setMeta] = useState(null);
  const [lineStates, setLineStates] = useState([]);
  const [shipBy, setShipBy] = useState('');
  const [courierName, setCourierName] = useState('');
  const [awbNumber, setAwbNumber] = useState('');
  const [deliveryPersonId, setDeliveryPersonId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    listSalesOrders({ limit: 100 }).then((res) => setSalesOrders(res.data?.sales_orders || [])).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open || !soNumber) return;
    getDCMeta(soNumber).then((res) => {
      const data = res.data;
      setMeta(data);
      const lines = (data.sales_order_lines || []).map((line) => ({
        ...line,
        ship_qty: line.quantity,
        serials: [],
        serialOptions: [],
        remark: line.remark || '',
      }));
      setLineStates(lines);
      lines.forEach((line, index) => {
        getAvailableSerials({
          brand: line.brand,
          model_name: line.model_name,
          processor: line.processor,
          generation: line.generation,
          quotation_type: data.quotation_type,
        }).then((sr) => {
          setLineStates((prev) => prev.map((row, i) => (i === index ? { ...row, serialOptions: sr.data?.serials || [] } : row)));
        }).catch(() => {});
      });
    }).catch(() => toast.error('Failed to load SO data'));
  }, [open, soNumber]);

  useEffect(() => {
    if (prefillSo && open) setSoNumber(prefillSo);
  }, [prefillSo, open]);

  const updateLine = (index, patch) => {
    setLineStates((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const badSerials = lineStates.flatMap((line) =>
    (line.serials || []).map((s) => {
      const opt = (line.serialOptions || []).find((o) => o.value === s || o.serial_number === s);
      if (opt && opt.qc_status && opt.qc_status !== 'qc_passed') {
        return { serial: s, status: opt.qc_status };
      }
      return null;
    }).filter(Boolean)
  );

  const submit = async () => {
    if (!soNumber) {
      toast.error('Select a sales order');
      return;
    }
    if (badSerials.length) {
      toast.error('Remove non-QC-passed serials before proceeding');
      return;
    }
    if (!shipBy) {
      toast.error('Select ship by mode');
      return;
    }
    setSaving(true);
    try {
      const res = await createDC({
        challan_number: meta?.dc_number,
        sales_order_number: soNumber,
        quotation_number: meta?.quotation_number,
        customer_id: meta?.customer_id,
        customer_name: meta?.customer_name,
        email: meta?.customer_email,
        GST_number: meta?.gst_number,
        supply_state: meta?.supply_state,
        security_amount: meta?.security_amount,
        shiping_charges: meta?.shiping_charges,
        branch: meta?.branch,
        quotation_type: meta?.quotation_type,
        ship_by: shipBy,
        courier_name: shipBy === 'by_courier' ? courierName : null,
        awb_number: shipBy === 'by_courier' ? awbNumber : null,
        delivery_person_id: shipBy === 'by_hand' ? deliveryPersonId : null,
        brand: lineStates.map((l) => l.brand || ''),
        Model: lineStates.map((l) => l.model_name),
        Processor: lineStates.map((l) => l.processor),
        Generation: lineStates.map((l) => l.generation),
        RAM: lineStates.map((l) => l.ram),
        Storage: lineStates.map((l) => l.storage),
        quantity: lineStates.map((l) => Number(l.ship_qty) || 0),
        main_qty: lineStates.map((l) => l.main_qty || l.quantity),
        rate: lineStates.map((l) => l.rate),
        locking_period: lineStates.map((l) => l.locking_period || ''),
        technical_warranty: lineStates.map((l) => l.technical_warranty || ''),
        battery_charger_warranty: lineStates.map((l) => l.battery_charger_warranty || ''),
        serial_number: lineStates.map((l) => l.serials),
        remarks: lineStates.map((l) => l.remark || ''),
        customer_shipping_address: meta?.shipping_address,
        customer_billing_address: meta?.billing_address,
      });
      const dc = res.data?.dc_number || meta?.dc_number;
      toast.success(`DC created: ${dc}`);
      onClose();
      if (dc) navigate(`/sales-pipeline/delivery-challans/${dc}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-[640px] bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold text-gray-900">Create Delivery Challan</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={withoutSo} onChange={(e) => setWithoutSo(e.target.checked)} />
            Create without SO
          </label>
          {!withoutSo && (
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={soNumber} onChange={(e) => setSoNumber(e.target.value)}>
              <option value="">Sales Order #</option>
              {salesOrders.map((so) => <option key={so.sales_order_number} value={so.sales_order_number}>{so.sales_order_number} — {so.customer_name}</option>)}
            </select>
          )}
          {meta && (
            <>
              <p className="text-sm text-gray-600">
                DC: <strong>{meta.dc_number}</strong> · {meta.customer_name || '—'} · {meta.quotation_type}
              </p>
              {lineStates.map((line, index) => (
                <div key={index} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{line.brand} {line.model_name} × {line.ship_qty}</p>
                    {line.rate ? (
                      <span className="text-xs text-gray-600">
                        Rate: ₹{Number(line.rate).toLocaleString('en-IN')}
                        {meta.quotation_type === 'rental' ? '/mo' : ''}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-500">
                    {[line.processor, line.generation, line.ram, line.storage].filter(Boolean).join(' · ') || 'Config from catalog'}
                  </p>
                  <SearchableMultiSelect
                    label="Serial Numbers (QC passed)"
                    options={(line.serialOptions || []).map((s) => ({
                      value: s.serial_id ? `${s.serial_id}|${s.serial_number}|${s.inventory_asset_code || ''}` : s.serial_number,
                      label: `${s.inventory_asset_code || s.serial_number} — ${[s.processor, s.ram, s.storage].filter(Boolean).join(' / ') || s.brand || ''}`,
                    }))}
                    value={line.serials}
                    onChange={(serials) => updateLine(index, { serials })}
                    maxSelections={Number(line.ship_qty) || 1}
                  />
                </div>
              ))}
              {badSerials.map((b) => (
                <p key={b.serial} className="text-xs text-red-600">
                  {b.serial} is not QC passed (status: {b.status}). Remove before proceeding.
                </p>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <select className="border rounded-lg px-3 py-2 text-sm" value={shipBy} onChange={(e) => setShipBy(e.target.value)}>
                  <option value="">Ship By *</option>
                  <option value="by_courier">Courier</option>
                  <option value="by_porter">Porter</option>
                  <option value="by_hand">Inhouse Technician</option>
                </select>
                {shipBy === 'by_courier' && (
                  <>
                    <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Courier Name" value={courierName} onChange={(e) => setCourierName(e.target.value)} />
                    <input className="border rounded-lg px-3 py-2 text-sm" placeholder="AWB" value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} />
                  </>
                )}
                {shipBy === 'by_hand' && (
                  <select className="border rounded-lg px-3 py-2 text-sm" value={deliveryPersonId} onChange={(e) => setDeliveryPersonId(e.target.value)}>
                    <option value="">Delivery Technician *</option>
                    {(meta.delivery_persons || meta.delivery_technicians || []).map((t) => (
                      <option key={t.id || t.user_id} value={t.id || t.user_id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <BillingAddressPanel billing={meta.billing_address} gstNumber={meta.gst_number} />
              <ShippingAddressPanel
                shippingAddresses={[meta.shipping_address].filter(Boolean)}
                selectedIndex={0}
                onSelectIndex={() => {}}
                onAddClick={() => {}}
                selectedAddress={meta.shipping_address}
                readOnly
              />
            </>
          )}
        </div>
        <div className="border-t p-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" disabled={saving || !meta} onClick={submit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create DC</button>
        </div>
      </aside>
    </div>
  );
}
