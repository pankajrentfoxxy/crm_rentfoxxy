import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle, Truck, XCircle } from 'lucide-react';
import { PageHeader, Button } from '../../../components/ui/primitives';
import {
  cancelReturnToVendorDc,
  completeReturnToVendorDc,
  dispatchReturnToVendorDc,
  fetchReturnToVendorDc,
} from '../vendorManagementApi';

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function ReturnToVendorDetailPage() {
  const { dcNumber } = useParams();
  const [dc, setDc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [dispatchForm, setDispatchForm] = useState({
    ship_by: 'by_courier',
    courier_name: '',
    awb_number: '',
    delivery_person_id: '',
  });

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
        subtitle={`${dc.vendor_name || 'Vendor'} · PO ${dc.po_number || dc.po_id || '—'}`}
        actions={(
          <Link to="/vendor-management/return-to-vendor" className="text-sm text-blue-600 inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        )}
      />

      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm md:col-span-1 space-y-2 text-sm">
          <p><span className="text-slate-500">Status:</span> <strong className="capitalize">{dc.status}</strong></p>
          <p><span className="text-slate-500">Return reason:</span> {dc.return_reason || '—'}</p>
          <p><span className="text-slate-500">Return date:</span> {fmtDateTime(dc.return_date)}</p>
          <p><span className="text-slate-500">Dispatched:</span> {fmtDateTime(dc.dispatched_at)}</p>
          <p><span className="text-slate-500">Vendor received:</span> {fmtDateTime(dc.vendor_received_at)}</p>
          {dc.courier_name ? (
            <p><span className="text-slate-500">Courier:</span> {dc.courier_name} {dc.awb_number ? `· AWB ${dc.awb_number}` : ''}</p>
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
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <label>
              Ship by
              <select
                className="mt-1 w-full border rounded-lg px-2 py-1.5"
                value={dispatchForm.ship_by}
                onChange={(e) => setDispatchForm((f) => ({ ...f, ship_by: e.target.value }))}
              >
                <option value="by_courier">Courier</option>
                <option value="by_hand">By hand</option>
                <option value="by_porter">Porter</option>
              </select>
            </label>
            <label>
              Courier name *
              <input
                className="mt-1 w-full border rounded-lg px-2 py-1.5"
                value={dispatchForm.courier_name}
                onChange={(e) => setDispatchForm((f) => ({ ...f, courier_name: e.target.value }))}
              />
            </label>
            <label>
              AWB / tracking *
              <input
                className="mt-1 w-full border rounded-lg px-2 py-1.5"
                value={dispatchForm.awb_number}
                onChange={(e) => setDispatchForm((f) => ({ ...f, awb_number: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              loading={busy === 'dispatch'}
              onClick={() => run('dispatch', () => dispatchReturnToVendorDc(dcNumber, dispatchForm))}
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
          </p>
        </div>
      )}

      {dc.status === 'dispatched' && (
        <div className="rounded-xl border bg-emerald-50 border-emerald-200 p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-emerald-900">Mark complete when the vendor confirms receipt of all laptops.</p>
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
