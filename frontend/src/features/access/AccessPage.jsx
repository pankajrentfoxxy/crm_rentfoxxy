import React, { useState } from 'react';
import { KeyRound, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../utils/api';

export default function AccessPage() {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e?.preventDefault?.();
    const trimmed = String(value).trim();
    if (!trimmed) {
      setError('Enter an access number');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/grn-access-public/resolve', { access_number: trimmed });
      if (data.success && data.data?.capture_url) {
        // Validation passed — go straight to the mapped capture URL.
        window.location.href = data.data.capture_url;
        return; // keep the spinner showing during navigation
      }
      setError(data.message || 'Invalid Access Number');
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid Access Number');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-white to-teal-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-600 text-white shadow-sm mb-3">
            <KeyRound className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Rentfoxxy Access</h1>
          <p className="text-sm text-slate-500 mt-1">
            Enter the access number shown on the GRN receive screen.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="access-number" className="block text-xs font-semibold text-slate-600 mb-1.5">
                Enter Access Number
              </label>
              <input
                id="access-number"
                type="text"
                inputMode="numeric"
                autoFocus
                autoComplete="off"
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-center text-2xl font-bold tracking-widest tabular-nums focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                placeholder="e.g. 17"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
                disabled={loading}
              />
            </div>

            {error ? (
              <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading || !value.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-4 py-3 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Redirecting…' : 'Verify Access Number'}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-4">
          The access number expires after use or after its time limit.
        </p>
      </div>
    </div>
  );
}
