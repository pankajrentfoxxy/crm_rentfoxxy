import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BillingAddressPanel, ShippingAddressPanel } from '../../features/operation-management/components/CustomerAddressPanels';
import SearchableMultiSelect from '../../features/operation-management/components/SearchableMultiSelect';
import { createDeliveryChallan, fetchAvailableSerials, fetchDeliveryChallanMeta } from '../../utils/salesManagementApi';

const COURIERS = [
  { value: 'dtdc', label: 'DTDC' },
  { value: 'blue_dart', label: 'Blue Dart' },
  { value: 'flipkart', label: 'Flipkart' },
  { value: 'amazon', label: 'Amazon' },
];

function ReadOnlyField({ label, value }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <input readOnly className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm" value={value || ''} />
    </div>
  );
}

export default function DeliveryChallanAddPage() {
  const [params] = useSearchParams();
  const salesOrderNumber = params.get('sales_order_number');
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [lineStates, setLineStates] = useState([]);
  const [shipBy, setShipBy] = useState('');
  const [courierName, setCourierName] = useState('');
  const [awbNumber, setAwbNumber] = useState('');
  const [deliveryPersonId, setDeliveryPersonId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadSerials = async (index, linesOverride, quotationType) => {
    const line = (linesOverride || lineStates)[index];
    if (!line) return;
    try {
      const data = await fetchAvailableSerials({
        brand: line.brand,
        model_name: line.model_name,
        processor: line.processor,
        generation: line.generation,
        quotation_type: quotationType ?? meta?.quotation_type,
      });
      setLineStates((prev) => prev.map((row, i) => (i === index ? { ...row, serialOptions: data.serials || [] } : row)));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!salesOrderNumber) return;
    fetchDeliveryChallanMeta(salesOrderNumber).then((data) => {
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
        fetchAvailableSerials({
          brand: line.brand,
          model_name: line.model_name,
          processor: line.processor,
          generation: line.generation,
          quotation_type: data.quotation_type,
        }).then((serialData) => {
          setLineStates((prev) => prev.map((row, i) => (i === index ? { ...row, serialOptions: serialData.serials || [] } : row)));
        }).catch(() => {});
      });
    }).catch(() => setError('Failed to load delivery challan data'));
  }, [salesOrderNumber]);

  const updateLine = (index, patch) => {
    setLineStates((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const isRental = meta?.quotation_type === 'rental' || meta?.quotation_type === 'demo';

  const submit = async (e) => {
    e.preventDefault();
    if (!shipBy) {
      setError('Please select Ship By');
      return;
    }
    if (shipBy === 'by_hand' && !deliveryPersonId) {
      setError('Please select delivery person');
      return;
    }
    if (shipBy === 'by_courier' && (!courierName || !awbNumber)) {
      setError('Courier name and AWB number are required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await createDeliveryChallan({
        challan_number: meta?.dc_number,
        sales_order_number: salesOrderNumber,
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
      navigate('/operation-management/delivery-challans');
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!salesOrderNumber) {
    return <p className="p-4 text-red-600">Missing sales_order_number in URL</p>;
  }

  if (meta && !lineStates.length) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-800">
          No shippable quantity left on this sales order.
        </div>
        <Link to="/operation-management/sales-orders" className="inline-block mt-4 text-cyan-700 text-sm">Back to sales orders</Link>
      </div>
    );
  }

  const billing = meta?.billing_address;
  const shipping = meta?.shipping_address;

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-800">Delivery Challan Form</h1>
        <Link to="/operation-management/delivery-challans" className="text-sm text-cyan-700 hover:underline">Back to list</Link>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold border-b pb-3 mb-4">Delivery Challan Form</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <ReadOnlyField label="Challan Number" value={meta?.dc_number} />
            <ReadOnlyField label="Sales Order Number" value={salesOrderNumber} />
            <ReadOnlyField label="Quotation Number" value={meta?.quotation_number} />
            <ReadOnlyField label="Quotation Type" value={meta?.quotation_type} />
            <ReadOnlyField label="Customer Name" value={meta?.customer_name} />
            <ReadOnlyField label="Branch" value={meta?.branch} />
            <ReadOnlyField label="Security Amount" value={meta?.security_amount} />
            <ReadOnlyField label="Shipping Charges" value={meta?.shiping_charges} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
            <BillingAddressPanel billing={billing} gstNumber={meta?.gst_number} />
            <ShippingAddressPanel
              shippingAddresses={shipping ? [shipping] : []}
              selectedIndex={0}
              onSelectIndex={() => {}}
              onAddClick={() => {}}
              selectedAddress={shipping}
              readOnly
            />
          </div>
        </div>

        {lineStates.map((line, index) => (
          <div key={index} className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b bg-gray-50">
              <h3 className="text-sm font-semibold">Assets details {index + 1}</h3>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <ReadOnlyField label="Model" value={line.model_name} />
              <ReadOnlyField label="Processor" value={line.processor} />
              <ReadOnlyField label="Generation" value={line.generation} />
              <ReadOnlyField label="Ram" value={line.ram} />
              <ReadOnlyField label="Storage" value={line.storage} />
              <ReadOnlyField label="Gpu" value={line.gpu} />
              <ReadOnlyField label="Screen Size" value={line.screen_size} />
              <div>
                <label className="text-xs font-medium text-gray-600">Quantity<span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="1"
                  max={line.quantity}
                  required
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={line.ship_qty}
                  onChange={(e) => {
                    const v = Math.min(Number(e.target.value) || 0, line.quantity);
                    updateLine(index, { ship_qty: v, serials: [] });
                  }}
                />
              </div>
              <ReadOnlyField label="Rate" value={line.rate} />
              {isRental ? (
                <ReadOnlyField label="Locking Period (In Month)" value={line.locking_period} />
              ) : (
                <>
                  <ReadOnlyField label="Technical Warranty (in month)" value={line.technical_warranty} />
                  <ReadOnlyField label="Battery/Charger Warranty (in month)" value={line.battery_charger_warranty} />
                </>
              )}
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-gray-600">Remarks</label>
                <textarea
                  rows={2}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={line.remark}
                  onChange={(e) => updateLine(index, { remark: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <SearchableMultiSelect
                  id={`dc-serial-${index}`}
                  label="Serial Number"
                  required
                  placeholder="Please Select"
                  value={line.serials || []}
                  maxSelections={Number(line.ship_qty) || 1}
                  options={(line.serialOptions || []).map((s) => ({
                    value: s.picker_value || s.formatted_serial,
                    label: s.label,
                  }))}
                  emptyMessage="No in-stock serials for this configuration"
                  onChange={(selected) => updateLine(index, { serials: selected })}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Select up to {line.ship_qty} serial(s). Selected: {line.serials?.length || 0}
                </p>
                <button type="button" onClick={() => loadSerials(index)} className="text-xs text-cyan-700 mt-1 hover:underline">
                  Refresh serials
                </button>
              </div>
            </div>
          </div>
        ))}

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Ship By<span className="text-red-500">*</span></label>
              <select required className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" value={shipBy} onChange={(e) => setShipBy(e.target.value)}>
                <option value="">Please Select</option>
                <option value="by_hand">By Hand</option>
                <option value="by_courier">By Courier</option>
              </select>
            </div>
            {shipBy === 'by_courier' ? (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600">Courier Name<span className="text-red-500">*</span></label>
                  <select required className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" value={courierName} onChange={(e) => setCourierName(e.target.value)}>
                    <option value="">Please Select</option>
                    {COURIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">AWB Number<span className="text-red-500">*</span></label>
                  <input required className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} placeholder="Enter AWB Number" />
                </div>
              </>
            ) : null}
            {shipBy === 'by_hand' ? (
              <div>
                <label className="text-xs font-medium text-gray-600">Delivery Person Name<span className="text-red-500">*</span></label>
                <select required className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" value={deliveryPersonId} onChange={(e) => setDeliveryPersonId(e.target.value)}>
                  <option value="">Please Select</option>
                  {(meta?.delivery_persons || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </div>

        {error ? <p className="text-red-600 text-sm">{error}</p> : null}

        <div className="flex justify-end gap-3">
          <Link to="/operation-management/delivery-challans" className="px-5 py-2 border rounded-lg text-sm">Cancel</Link>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-teal-700 text-white rounded-lg text-sm disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
