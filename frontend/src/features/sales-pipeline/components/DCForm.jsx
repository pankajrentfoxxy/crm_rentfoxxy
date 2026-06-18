import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { BillingAddressPanel } from '../../operation-management/components/CustomerAddressPanels';
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
  const [courierTrackingUrl, setCourierTrackingUrl] = useState('');
  const [porterTrackingId, setPorterTrackingId] = useState('');
  const [porterOrderId, setPorterOrderId] = useState('');
  const [porterBookingUrl, setPorterBookingUrl] = useState('');
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

      if (data.use_attached) {
        // New flow: laptops are already attached to the SO with QC tickets.
        // Build read-only lines from the attached serials — no re-selection.
        const lines = (data.sales_order_lines || []).map((line) => {
          const attached = (data.attached_serials || []).filter((a) => a.line_id === line.id);
          return {
            ...line,
            ship_qty: attached.length,
            attachedUnits: attached,
            serials: attached.map((a) => `${a.serial_id}|${a.serial_number || ''}|${a.ttspl_id || ''}`),
            serialOptions: [],
            remark: line.remark || '',
            preAttached: true,
          };
        });
        setLineStates(lines.filter((l) => l.attachedUnits.length > 0));
        return;
      }

      // Legacy flow: manual serial selection.
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

  // Delivery address(es) set on the attached serials (Phase 13). When all serials
  // share one address we use it for the DC; differing addresses get a warning.
  const { deliveryAddress, addressMismatch } = useMemo(() => {
    const attached = (meta?.attached_serials || []).filter((a) => a.delivery_address);
    if (!attached.length) {
      return { deliveryAddress: meta?.shipping_address || null, addressMismatch: false };
    }
    const key = (a) => JSON.stringify(a.delivery_address || {});
    const distinct = new Set(attached.map(key));
    return {
      deliveryAddress: attached[0].delivery_address,
      addressMismatch: distinct.size > 1,
    };
  }, [meta]);

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
    if (meta?.use_attached && !meta?.all_attached_qc_passed) {
      toast.error('All attached laptops must pass pre-dispatch QC before generating the DC');
      return;
    }
    if (meta?.use_attached && lineStates.every((l) => !(l.serials || []).length)) {
      toast.error('No laptops attached to this sales order yet');
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
    if (shipBy === 'by_porter' && !porterTrackingId.trim()) {
      toast.error('Enter the Porter Tracking / Booking ID');
      return;
    }
    if (shipBy === 'by_hand' && !deliveryPersonId) {
      toast.error('Select a delivery technician');
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
        courier_tracking_url: shipBy === 'by_courier' ? courierTrackingUrl : null,
        porter_tracking_id: shipBy === 'by_porter' ? porterTrackingId : null,
        porter_order_id: shipBy === 'by_porter' ? porterOrderId : null,
        porter_booking_url: shipBy === 'by_porter' ? porterBookingUrl : null,
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
        customer_shipping_address: deliveryAddress || meta?.shipping_address,
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
                  {line.preAttached ? (
                    <div className="divide-y border rounded-lg">
                      {(line.attachedUnits || []).map((a) => (
                        <div key={a.allocation_id} className="flex items-center justify-between px-3 py-1.5">
                          <span className="font-mono text-xs text-blue-700">{a.ttspl_id || a.serial_number}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${a.qc_status === 'passed' ? 'bg-emerald-100 text-emerald-700' : a.qc_status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            QC {a.qc_status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
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
                  )}
                </div>
              ))}
              {meta.use_attached && !meta.all_attached_qc_passed && (
                <p className="text-xs text-amber-600">
                  ⚠ Some attached laptops have not passed pre-dispatch QC yet. Complete QC before generating the DC.
                </p>
              )}
              {badSerials.map((b) => (
                <p key={b.serial} className="text-xs text-red-600">
                  {b.serial} is not QC passed (status: {b.status}). Remove before proceeding.
                </p>
              ))}
              <div className="space-y-3">
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={shipBy} onChange={(e) => setShipBy(e.target.value)}>
                  <option value="">Ship By *</option>
                  <option value="by_courier">Courier</option>
                  <option value="by_porter">Porter</option>
                  <option value="by_hand">Inhouse Technician</option>
                </select>
                {shipBy === 'by_courier' && (
                  <div className="grid grid-cols-2 gap-3">
                    <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Courier Name" value={courierName} onChange={(e) => setCourierName(e.target.value)} />
                    <input className="border rounded-lg px-3 py-2 text-sm" placeholder="AWB Number" value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} />
                    <input className="border rounded-lg px-3 py-2 text-sm col-span-2" placeholder="Tracking URL (optional)" value={courierTrackingUrl} onChange={(e) => setCourierTrackingUrl(e.target.value)} />
                  </div>
                )}
                {shipBy === 'by_porter' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Porter Tracking ID / Booking ID*</label>
                      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. PRT-2025060001" value={porterTrackingId} onChange={(e) => setPorterTrackingId(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Porter Order ID (optional)</label>
                      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter platform order ID" value={porterOrderId} onChange={(e) => setPorterOrderId(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Booking URL / Tracking Link (optional)</label>
                      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://porter.in/track/..." value={porterBookingUrl} onChange={(e) => setPorterBookingUrl(e.target.value)} />
                    </div>
                  </div>
                )}
                {shipBy === 'by_hand' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Assign to Delivery Technician*</label>
                    <select className="w-full border rounded-lg px-3 py-2 text-sm" value={deliveryPersonId} onChange={(e) => setDeliveryPersonId(e.target.value)}>
                      <option value="">Select technician…</option>
                      {(meta.delivery_technicians || []).filter((t) => t.is_active).map((t) => (
                        <option key={t.technician_id} value={t.technician_id}>
                          {t.first_name} {t.last_name || ''} {t.phone ? `— ${t.phone}` : ''}
                        </option>
                      ))}
                    </select>
                    {!(meta.delivery_technicians || []).length && (
                      <p className="text-xs text-amber-600 mt-1">
                        No delivery technicians registered. Add via Delivery Register → Technicians.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-1 p-3 bg-blue-50 rounded-lg border border-blue-100">
                <h4 className="text-xs font-semibold text-blue-900 uppercase mb-2">Delivery Address</h4>
                {deliveryAddress ? (
                  <div className="text-sm text-blue-800">
                    {deliveryAddress.name && <p className="font-medium">{deliveryAddress.name}</p>}
                    {deliveryAddress.phone && <p>{deliveryAddress.phone}</p>}
                    {deliveryAddress.address && <p>{deliveryAddress.address}</p>}
                    <p>{[deliveryAddress.city, deliveryAddress.state, deliveryAddress.pincode || deliveryAddress.zip_code].filter(Boolean).join(', ')}</p>
                    {deliveryAddress.landmark && <p className="text-xs text-blue-600">📍 {deliveryAddress.landmark}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-amber-700">No delivery address set. Using billing address.</p>
                )}
                {addressMismatch && (
                  <p className="text-xs text-amber-700 mt-2">
                    ⚠ These laptops have different delivery addresses. Consider creating a separate DC for each address.
                  </p>
                )}
              </div>

              <BillingAddressPanel billing={meta.billing_address} gstNumber={meta.gst_number} />
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
