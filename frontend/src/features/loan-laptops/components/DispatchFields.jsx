import React, { useEffect, useState } from 'react';
import api from '../../../utils/api';
import { DISPATCH_MODES } from '../loanConstants';

export const EMPTY_DISPATCH = {
  dispatch_mode: '', technician_user_id: '', courier_name: '', awb_number: '', porter_tracking_id: '', porter_order_id: '',
};

export function dispatchIsComplete(d) {
  if (!d?.dispatch_mode) return false;
  if (d.dispatch_mode === 'technician') return Boolean(d.technician_user_id);
  return true;
}

/** Technician / courier / porter assignment, same fields the support pickup and SDC use. */
export default function DispatchFields({ value, onChange, label = 'How will it travel?' }) {
  const [technicians, setTechnicians] = useState(null);
  const d = value || EMPTY_DISPATCH;
  const set = (patch) => onChange({ ...d, ...patch });

  useEffect(() => {
    api.get('/support/technicians')
      .then((r) => setTechnicians(r.data.technicians || []))
      .catch(() => setTechnicians([]));
  }, []);

  const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px]';
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-1.5">{label}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {DISPATCH_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => set({ dispatch_mode: m.value })}
              className={`min-h-[44px] rounded-lg border text-sm font-medium px-3 ${
                d.dispatch_mode === m.value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {d.dispatch_mode === 'technician' && (
        <select className={input} value={d.technician_user_id} onChange={(e) => set({ technician_user_id: e.target.value })}>
          <option value="">{technicians ? 'Select technician…' : 'Loading technicians…'}</option>
          {(technicians || []).filter((t) => !t.assignee_kind || t.assignee_kind === 'technician').map((t) => (
            <option key={t.user_id} value={t.user_id}>{t.name}</option>
          ))}
        </select>
      )}
      {d.dispatch_mode === 'courier' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className={input} placeholder="Courier name" value={d.courier_name} onChange={(e) => set({ courier_name: e.target.value })} />
          <input className={input} placeholder="AWB number (optional)" value={d.awb_number} onChange={(e) => set({ awb_number: e.target.value })} />
        </div>
      )}
      {d.dispatch_mode === 'porter' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className={input} placeholder="Porter tracking ID" value={d.porter_tracking_id} onChange={(e) => set({ porter_tracking_id: e.target.value })} />
          <input className={input} placeholder="Porter order ID" value={d.porter_order_id} onChange={(e) => set({ porter_order_id: e.target.value })} />
        </div>
      )}
    </div>
  );
}
