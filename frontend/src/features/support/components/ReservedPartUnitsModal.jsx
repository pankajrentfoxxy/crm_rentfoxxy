import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Loader2, Package, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { getReservedPartUnits } from '../supportPartsApi';

function fmtWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/**
 * Drill-down: which floor PRQ / support SPR is holding each reserved unit
 * for a catalog part. Opened from the Support Parts Queue "Reserved" badge.
 */
export default function ReservedPartUnitsModal({ open, partId, partName, onClose }) {
  const [loading, setLoading] = useState(false);
  const [part, setPart] = useState(null);
  const [units, setUnits] = useState([]);

  useEffect(() => {
    if (!open || !partId) return;
    let alive = true;
    setLoading(true);
    setUnits([]);
    setPart(null);
    getReservedPartUnits(partId)
      .then(({ data }) => {
        if (!alive) return;
        setPart(data.part || null);
        setUnits(data.units || []);
      })
      .catch((err) => {
        if (!alive) return;
        toast.error(err.response?.data?.message || 'Could not load reserved units');
        onClose?.();
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, partId, onClose]);

  if (!open) return null;

  const title = part?.part_name || partName || 'Part';

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <button type="button" className="fixed inset-0 bg-black/50" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 my-8 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900">Reserved units</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {title}
              {units.length ? ` · ${units.length} reserved` : ''}
            </p>
          </div>
          <button type="button" className="p-2 rounded-lg hover:bg-slate-100" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : units.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No reserved units for this part right now.
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <p className="text-xs text-slate-500">
              These units are not pickable for Support Parts approve until the holding
              request releases them (or they are returned to stock).
            </p>
            {units.map((u) => {
              const held = u.held_by;
              return (
                <div key={u.instance_id} className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Package className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-semibold text-slate-800 truncate">
                        {u.prt_id}
                        {u.serial_number ? ` · ${u.serial_number}` : ''}
                      </p>
                      {u.asset_code && (
                        <p className="font-mono text-[11px] text-slate-400">{u.asset_code}</p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Reserved {fmtWhen(u.updated_at || u.received_at)}
                        {u.location_code ? ` · ${u.location_code}` : ''}
                      </p>
                    </div>
                  </div>

                  {held ? (
                    <div className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-950 space-y-1">
                      <p>
                        <span className="font-semibold">Held by </span>
                        <span className="font-mono font-semibold">{held.label}</span>
                        {held.status ? (
                          <span className="text-amber-800"> · {String(held.status).replace(/_/g, ' ')}</span>
                        ) : null}
                      </p>
                      {held.kind === 'floor_prq' && (
                        <p className="text-amber-800">
                          Floor ticket #{held.ticket_id}
                          {held.stage_name ? ` · ${held.stage_name}` : ''}
                          {held.ttspl_id ? ` · ${held.ttspl_id}` : ''}
                        </p>
                      )}
                      {held.kind === 'support_spr' && (
                        <p className="text-amber-800">
                          Support request
                          {held.ttspl_id ? ` · ${held.ttspl_id}` : ''}
                          {held.customer_name ? ` · ${held.customer_name}` : ''}
                        </p>
                      )}
                      {held.href && (
                        <Link
                          to={held.href}
                          className="inline-flex items-center gap-1 text-[#534AB7] font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open ticket <ExternalLink className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 px-1">
                      Reserved, but no open floor/support request is linked to this unit.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="px-4 py-3 border-t border-slate-100">
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 py-2 text-sm font-medium"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
