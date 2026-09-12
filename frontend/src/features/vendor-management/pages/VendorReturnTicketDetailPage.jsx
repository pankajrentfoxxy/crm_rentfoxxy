import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Mail, Package, Truck, XCircle } from 'lucide-react';
import { PageHeader, Button } from '../../../components/ui/primitives';
import {
  cancelVendorReturnTicket,
  cancelVendorReturnTicketItems,
  createVendorReturnTicketDc,
  fetchVendorReturnTicket,
  notifyVendorReturnTicket,
} from '../vendorManagementApi';

const STATUS_LABEL = {
  requested: 'Return Requested',
  notified: 'Vendor Notified · Pending Pickup',
  partially_picked: 'Partially Picked Up',
  picked: 'Pickup Completed',
  completed: 'Return Completed',
  cancelled: 'Cancelled',
};

const ITEM_LABEL = {
  requested: 'Requested',
  rental_stopped: 'Rental stopped',
  dc_created: 'On return DC',
  handed_over: 'Handed over',
  vendor_received: 'Vendor received',
  cancelled: 'Cancelled',
};

const ITEM_CLASS = {
  requested: 'bg-slate-100 text-slate-700',
  rental_stopped: 'bg-blue-100 text-blue-800',
  dc_created: 'bg-indigo-100 text-indigo-800',
  handed_over: 'bg-amber-100 text-amber-800',
  vendor_received: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-700',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function VendorReturnTicketDetailPage() {
  const { ticketNumber } = useParams();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [confirmNotify, setConfirmNotify] = useState(false);
  const [dcPick, setDcPick] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchVendorReturnTicket(ticketNumber);
      setTicket(res.data?.ticket || null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketNumber]);

  useEffect(() => { load(); }, [load]);

  const items = ticket?.items || [];
  const live = items.filter((i) => i.item_status !== 'cancelled');
  const pickupReady = items.filter((i) => i.item_status === 'rental_stopped');
  const derived = ticket?.derived_status || ticket?.status;
  const canNotify = derived === 'requested' && live.length > 0 && !ticket?.vendor_notified_at;
  const canCreateDc = pickupReady.length > 0;

  useEffect(() => {
    setDcPick(new Set(pickupReady.map((i) => i.serial_id)));
  }, [ticket?.ticket_number, pickupReady.length]);

  const togglePick = (serialId) => {
    setDcPick((prev) => {
      const next = new Set(prev);
      if (next.has(serialId)) next.delete(serialId);
      else next.add(serialId);
      return next;
    });
  };

  const selectedReady = useMemo(
    () => pickupReady.filter((i) => dcPick.has(i.serial_id)),
    [pickupReady, dcPick]
  );

  const run = async (action, fn, okMsg) => {
    setBusy(action);
    try {
      const res = await fn();
      setTicket(res.data?.ticket || ticket);
      toast.success(okMsg || 'Updated');
      await load();
      return res;
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Action failed');
      return null;
    } finally {
      setBusy('');
    }
  };

  const handleNotify = async () => {
    setConfirmNotify(false);
    await run('notify', () => notifyVendorReturnTicket(ticketNumber), 'Vendor notified — rental stopped');
  };

  const handleCreateDc = async () => {
    if (!selectedReady.length) {
      toast.error('Select at least one laptop for this pickup');
      return;
    }
    setBusy('dc');
    try {
      const res = await createVendorReturnTicketDc(ticketNumber, {
        serial_ids: selectedReady.map((i) => i.serial_id),
      });
      const dcNumber = res.data?.dc_number;
      toast.success(`Return DC ${dcNumber || ''} created`);
      if (dcNumber) {
        navigate(`/vendor-management/return-to-vendor/${encodeURIComponent(dcNumber)}`);
        return;
      }
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to create return DC');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <p className="text-sm text-slate-500 p-6">Loading…</p>;
  if (!ticket) {
    return (
      <div className="p-6">
        <p className="text-red-600">Return ticket not found</p>
        <Link to="/vendor-management/return-ticket" className="text-blue-600 text-sm">Back</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={ticket.ticket_number}
        subtitle={`${ticket.vendor_name || 'Vendor'} · ${live.length} laptop${live.length === 1 ? '' : 's'}`}
        actions={(
          <Link to="/vendor-management/return-ticket" className="text-sm text-blue-600 inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        )}
      />

      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm space-y-2 text-sm">
          <p>
            <span className="text-slate-500">Status:</span>{' '}
            <strong>{STATUS_LABEL[derived] || derived}</strong>
          </p>
          <p><span className="text-slate-500">Request date:</span> {fmtDate(ticket.request_date)}</p>
          <p><span className="text-slate-500">Vendor email:</span> {ticket.vendor_email || ticket.vendor_email_live || '—'}</p>
          <p><span className="text-slate-500">Notified:</span> {fmtDate(ticket.vendor_notified_at)}</p>
          <p><span className="text-slate-500">Return reason:</span> {ticket.return_reason || '—'}</p>
          {ticket.notify_error ? (
            <p className="text-red-700 text-xs border border-red-200 bg-red-50 rounded-lg px-2 py-1">
              Notify error: {ticket.notify_error}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm md:col-span-2">
          <h3 className="font-semibold text-slate-900 mb-2">Laptops</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 bg-slate-50">
                <tr>
                  <th className="px-2 py-2 text-left">Asset ID</th>
                  <th className="px-2 py-2 text-left">Serial</th>
                  <th className="px-2 py-2 text-left">PO</th>
                  <th className="px-2 py-2 text-left">Rate</th>
                  <th className="px-2 py-2 text-left">Item status</th>
                  <th className="px-2 py-2 text-left">DC</th>
                  <th className="px-2 py-2 text-left" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-2 py-2 font-medium">{item.ttspl_id}</td>
                    <td className="px-2 py-2">{item.serial_number}</td>
                    <td className="px-2 py-2 text-xs">{item.po_number || item.po_id || '—'}</td>
                    <td className="px-2 py-2 text-xs">
                      {item.monthly_rent_rate != null ? `₹${Number(item.monthly_rent_rate).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${ITEM_CLASS[item.item_status] || 'bg-slate-100'}`}>
                        {ITEM_LABEL[item.item_status] || item.item_status}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {item.dc_number ? (
                        <Link
                          className="text-blue-600 hover:underline"
                          to={`/vendor-management/return-to-vendor/${encodeURIComponent(item.dc_number)}`}
                        >
                          {item.dc_number}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-2 py-2">
                      {['requested', 'rental_stopped'].includes(item.item_status) ? (
                        <button
                          type="button"
                          disabled={busy === 'cancel-item'}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          onClick={() => run(
                            'cancel-item',
                            () => cancelVendorReturnTicketItems(ticketNumber, { serial_ids: [item.serial_id] }),
                            'Laptop removed from ticket'
                          )}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {canNotify && (
        <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Mail className="w-4 h-4" /> Notify vendor & stop rental</h3>
          <p className="text-sm text-slate-600">
            This emails <strong>{ticket.vendor_email || ticket.vendor_email_live || 'the vendor'}</strong> and
            stops vendor rental for <strong>{live.length}</strong> laptop{live.length === 1 ? '' : 's'} from today.
            The laptops stay in the warehouse until pickup.
          </p>
          {!confirmNotify ? (
            <Button onClick={() => setConfirmNotify(true)}>
              <Mail className="w-4 h-4" /> Notify vendor & stop rental
            </Button>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-sm text-amber-950">
                This stops the vendor rental for {live.length} laptop{live.length === 1 ? '' : 's'} from today
                and emails {ticket.vendor_name}. The laptops stay in the warehouse until pickup.
              </p>
              <div className="flex gap-2">
                <Button loading={busy === 'notify'} onClick={handleNotify}>Confirm and send</Button>
                <Button variant="secondary" onClick={() => setConfirmNotify(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {canCreateDc && (
        <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Truck className="w-4 h-4" /> Vendor arrived — create VRTDC
          </h3>
          <p className="text-sm text-slate-600">
            Tick the laptops the vendor is collecting now. Remaining units stay on this ticket for a later pickup.
          </p>
          <div className="space-y-1">
            {pickupReady.map((item) => (
              <label key={item.serial_id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={dcPick.has(item.serial_id)}
                  onChange={() => togglePick(item.serial_id)}
                />
                <span className="font-medium">{item.ttspl_id}</span>
                <span className="text-slate-500">{item.serial_number}</span>
              </label>
            ))}
          </div>
          <Button loading={busy === 'dc'} disabled={!selectedReady.length} onClick={handleCreateDc}>
            <Package className="w-4 h-4" /> Create return DC ({selectedReady.length})
          </Button>
        </div>
      )}

      {(ticket.dcs || []).length > 0 && (
        <div className="rounded-xl border bg-white p-4 shadow-sm space-y-2">
          <h3 className="font-semibold">Linked return DCs</h3>
          <ul className="text-sm space-y-1">
            {ticket.dcs.map((dc) => (
              <li key={dc.dc_number}>
                <Link
                  className="text-blue-600 hover:underline font-medium"
                  to={`/vendor-management/return-to-vendor/${encodeURIComponent(dc.dc_number)}`}
                >
                  {dc.dc_number}
                </Link>
                <span className="text-slate-500"> · {dc.status} · {dc.item_count} laptop{dc.item_count === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {['requested', 'notified'].includes(derived) && (
        <div>
          <Button
            variant="secondary"
            loading={busy === 'cancel'}
            onClick={() => run(
              'cancel',
              () => cancelVendorReturnTicket(ticketNumber, {}),
              'Ticket cancelled'
            )}
          >
            <XCircle className="w-4 h-4" /> Cancel ticket
          </Button>
        </div>
      )}
    </div>
  );
}
