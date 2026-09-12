import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle, Download, Truck, XCircle } from 'lucide-react';
import { PageHeader, Button } from '../../../components/ui/primitives';
import { getBackendOrigin } from '../../../utils/api';
import {
  cancelReturnToVendorDc,
  completeReturnToVendorDc,
  dispatchReturnToVendorDc,
  downloadReturnToVendorDcPdf,
  fetchReturnToVendorDc,
} from '../vendorManagementApi';
import VrdcDispatchFields, { validateVrdcDispatch } from '../../floor-pipeline/components/VrdcDispatchFields';
import { vendorRepairDispatchModeLabel } from '../../floor-pipeline/vendorRepairUi';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function uploadUrl(p) {
  if (!p) return null;
  if (String(p).startsWith('http')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${String(p).replace(/^\/?uploads\//, '')}`;
}

export default function ReturnToVendorDetailPage() {
  const { dcNumber } = useParams();
  const [dc, setDc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [shipBy, setShipBy] = useState('');
  const [dispatchFields, setDispatchFields] = useState({});
  const [deliveryTechnicians, setDeliveryTechnicians] = useState([]);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchReturnToVendorDc(dcNumber);
      setDc(res.data?.dc || null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load return DC');
    } finally {
      setLoading(false);
    }
  }, [dcNumber]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchDeliveryTechnicians({ limit: 200 })
      .then((data) => setDeliveryTechnicians(data?.data || data?.technicians || []))
      .catch(() => {});
  }, []);

  const run = async (action, fn) => {
    setBusy(action);
    try {
      const res = await fn();
      setDc(res.data?.dc || dc);
      toast.success('Updated');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Action failed');
    } finally {
      setBusy('');
    }
  };

  const handleDispatch = () => {
    const dispatchErr = validateVrdcDispatch(shipBy, dispatchFields);
    if (dispatchErr) {
      toast.error(dispatchErr);
      return;
    }
    return run('dispatch', () => dispatchReturnToVendorDc(dcNumber, {
      ship_by: shipBy,
      courier_name: dispatchFields.courier_name,
      awb_number: dispatchFields.awb_number,
      courier_tracking_url: dispatchFields.courier_tracking_url,
      porter_tracking_id: dispatchFields.porter_tracking_id,
      porter_order_id: dispatchFields.porter_order_id,
      porter_booking_url: dispatchFields.porter_booking_url,
      delivery_person_id: dispatchFields.delivery_person_id || undefined,
      vehicle_number: dispatchFields.vehicle_number || undefined,
      vendor_pickup_person: dispatchFields.vendor_pickup_person || undefined,
      vendor_pickup_mobile: dispatchFields.vendor_pickup_mobile || undefined,
    }));
  };

  const handleDownloadPdf = async () => {
    setPdfBusy(true);
    try {
      await downloadReturnToVendorDcPdf(dcNumber);
    } catch (err) {
      toast.error(err.message || 'PDF download failed');
    } finally {
      setPdfBusy(false);
    }
  };

  const technicianName = (() => {
    if (!dc?.delivery_person_id) return null;
    const t = deliveryTechnicians.find((row) => String(row.technician_id) === String(dc.delivery_person_id));
    if (!t) return `Technician #${dc.delivery_person_id}`;
    return [t.first_name, t.last_name].filter(Boolean).join(' ') || `Technician #${dc.delivery_person_id}`;
  })();

  if (loading) {
    return <p className="text-sm text-slate-500 p-6">Loading…</p>;
  }
  if (!dc) {
    return (
      <div className="p-6">
        <p className="text-red-600">Return DC not found</p>
        <Link to="/vendor-management/return-to-vendor" className="text-blue-600 text-sm">Back</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={dc.dc_number}
        subtitle={`${dc.vendor_name || 'Vendor'}${dc.po_number || dc.po_id ? ` · PO ${dc.po_number || dc.po_id}` : (dc.items?.length > 1 ? ' · Multiple POs' : '')}`}
        actions={(
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              loading={pdfBusy}
              onClick={handleDownloadPdf}
            >
              <Download className="w-4 h-4" /> Download PDF
            </Button>
            <Link to="/vendor-management/return-to-vendor" className="text-sm text-blue-600 inline-flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" /> Back
            </Link>
          </div>
        )}
      />

      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm md:col-span-1 space-y-2 text-sm">
          <p><span className="text-slate-500">Status:</span> <strong className="capitalize">{dc.status}</strong></p>
          <p><span className="text-slate-500">Return reason:</span> {dc.return_reason || '—'}</p>
          <p><span className="text-slate-500">Return date:</span> {fmtDateTime(dc.return_date)}</p>
          <p><span className="text-slate-500">Dispatched:</span> {fmtDateTime(dc.dispatched_at)}</p>
          <p><span className="text-slate-500">Vendor received:</span> {fmtDateTime(dc.vendor_received_at)}</p>
          {dc.ship_by || dc.dispatch_mode ? (
            <p><span className="text-slate-500">Send mode:</span> {vendorRepairDispatchModeLabel(dc.ship_by, dc.dispatch_mode)}</p>
          ) : null}
          {(dc.ship_by === 'by_courier' || dc.dispatch_mode === 'courier') && dc.courier_name ? (
            <p>
              <span className="text-slate-500">Courier:</span> {dc.courier_name}
              {dc.awb_number ? ` · AWB ${dc.awb_number}` : ''}
              {dc.courier_tracking_url ? (
                <> · <a href={dc.courier_tracking_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Track</a></>
              ) : null}
            </p>
          ) : null}
          {(dc.ship_by === 'by_porter' || dc.dispatch_mode === 'porter') && dc.porter_tracking_id ? (
            <p><span className="text-slate-500">Porter:</span> {dc.porter_tracking_id}</p>
          ) : null}
          {(dc.ship_by === 'by_hand' || dc.dispatch_mode === 'inhouse') && technicianName ? (
            <p><span className="text-slate-500">Delivery person:</span> {technicianName}</p>
          ) : null}
          {(dc.ship_by === 'by_vendor_pickup' || dc.dispatch_mode === 'vendor_pickup')
            && (dc.vendor_pickup_person || dc.vendor_pickup_mobile || dc.vehicle_number) ? (
            <p>
              <span className="text-slate-500">Vendor pickup:</span>{' '}
              {dc.vendor_pickup_person || '—'}
              {dc.vendor_pickup_mobile ? ` · ${dc.vendor_pickup_mobile}` : ''}
              {dc.vehicle_number ? ` · ${dc.vehicle_number}` : ''}
            </p>
          ) : null}
          {uploadUrl(dc.delivery_pod_path) ? (
            <div className="pt-2 border-t space-y-1">
              <p className="text-slate-500 text-xs uppercase font-semibold">
                {dc.delivery_pod_type === 'esign' ? 'Vendor / receiver e-signature' : 'Proof of delivery'}
              </p>
              <a href={uploadUrl(dc.delivery_pod_path)} target="_blank" rel="noreferrer">
                <img
                  src={uploadUrl(dc.delivery_pod_path)}
                  alt="Vendor e-signature"
                  className="max-h-28 w-full object-contain rounded border bg-white"
                />
              </a>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm md:col-span-2">
          <h3 className="font-semibold text-slate-900 mb-2">Laptops on this return</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 bg-slate-50">
                <tr>
                  <th className="px-2 py-2 text-left">Asset ID</th>
                  <th className="px-2 py-2 text-left">Serial</th>
                  <th className="px-2 py-2 text-left">PO</th>
                  <th className="px-2 py-2 text-left">Warehouse</th>
                  <th className="px-2 py-2 text-left">Reason</th>
                  <th className="px-2 py-2 text-left">Item status</th>
                </tr>
              </thead>
              <tbody>
                {(dc.items || []).map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-2 py-2 font-medium">{item.ttspl_id}</td>
                    <td className="px-2 py-2">{item.serial_number}</td>
                    <td className="px-2 py-2">{item.po_number || item.po_id}</td>
                    <td className="px-2 py-2 text-xs">
                      {[item.warehouse_carret, item.warehouse_carret_slot].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="px-2 py-2 text-xs">{item.return_reason || '—'}</td>
                    <td className="px-2 py-2 capitalize text-xs">{item.item_status?.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {dc.status === 'draft' && (
        <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Truck className="w-4 h-4" /> Dispatch to vendor</h3>
          <div className="max-w-xl">
            <VrdcDispatchFields
              shipBy={shipBy}
              onShipByChange={setShipBy}
              fields={dispatchFields}
              onFieldsChange={setDispatchFields}
              deliveryTechnicians={deliveryTechnicians}
              disabled={busy === 'dispatch'}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              loading={busy === 'dispatch'}
              onClick={handleDispatch}
            >
              <Truck className="w-4 h-4" /> Dispatch
            </Button>
            <Button
              variant="secondary"
              loading={busy === 'cancel'}
              onClick={() => run('cancel', () => cancelReturnToVendorDc(dcNumber))}
            >
              <XCircle className="w-4 h-4" /> Cancel DC
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            On dispatch, inventory is updated (laptop removed from warehouse stock).
            By hand assigns the technician — they see it in My Deliveries / Technician Bucket,
            then mark Reached → vendor e-sign (no TTSPL scan, no customer OTP).
          </p>
        </div>
      )}

      {dc.status === 'dispatched' && (
        <div className="rounded-xl border bg-emerald-50 border-emerald-200 p-4 space-y-3">
          {(dc.ship_by === 'by_hand' || dc.dispatch_mode === 'inhouse') ? (
            <p className="text-sm text-emerald-900">
              Assigned to <strong>{technicianName || 'the delivery partner'}</strong>.
              They mark delivery in <strong>My Deliveries</strong> (Reached → vendor e-sign).
              Use the button below only if warehouse is confirming instead.
            </p>
          ) : (
            <p className="text-sm text-emerald-900">Mark complete when the vendor confirms receipt of all laptops.</p>
          )}
          <Button
            loading={busy === 'complete'}
            onClick={() => run('complete', () => completeReturnToVendorDc(dcNumber))}
          >
            <CheckCircle className="w-4 h-4" /> Vendor Return Completed
          </Button>
        </div>
      )}
    </div>
  );
}
