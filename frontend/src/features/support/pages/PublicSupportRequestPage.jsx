import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Headphones, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../../../utils/api';
import {
  formatIndianMobileInput,
  indianMobileError,
  normalizeIndianMobile,
} from '../../../utils/phoneValidation';

export default function PublicSupportRequestPage() {
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    customer_name: '',
    mobile_number: '',
    company_name: '',
    issue_description: '',
    device_serial: params.get('ttspl') || params.get('device') || params.get('serial') || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mobileHint, setMobileHint] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    document.title = 'Support Request · Rentfoxxy';
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onMobileChange = (value) => {
    const next = formatIndianMobileInput(value);
    set('mobile_number', next);
    if (mobileHint) {
      setMobileHint(indianMobileError(next, { required: true, label: 'Mobile number' }) || '');
    }
  };

  const onMobileBlur = () => {
    setMobileHint(indianMobileError(form.mobile_number, { required: true, label: 'Mobile number' }) || '');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.customer_name.trim()) {
      setError('Please enter your name');
      return;
    }
    const mobileErr = indianMobileError(form.mobile_number, { required: true, label: 'Mobile number' });
    if (mobileErr) {
      setMobileHint(mobileErr);
      setError(mobileErr);
      return;
    }
    if (String(form.issue_description || '').trim().length < 10) {
      setError('Please describe the issue (at least 10 characters)');
      return;
    }
    if (!String(form.device_serial || '').trim()) {
      setError('TTSPL / device ID is required');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/support-public/request', {
        customer_name: form.customer_name.trim(),
        mobile_number: normalizeIndianMobile(form.mobile_number),
        company_name: form.company_name.trim() || undefined,
        issue_description: form.issue_description.trim(),
        device_serial: form.device_serial.trim() || undefined,
      });
      setDone(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not submit. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-indigo-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#534AB7] text-white shadow-sm mb-3">
            <Headphones className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Rentfoxxy Support</h1>
          <p className="text-sm text-slate-500 mt-1">Tell us what&apos;s wrong — we&apos;ll get back to you shortly.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 sm:p-6">
          {done ? (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <h2 className="text-lg font-semibold text-slate-900">Request submitted</h2>
              <p className="text-sm text-slate-600">
                {done.message || 'Your request has been submitted. Our team will contact you shortly.'}
              </p>
              {done.request_id ? (
                <p className="text-xs text-slate-400">Reference #{done.request_id}</p>
              ) : null}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3.5" noValidate>
              <label className="block text-sm">
                <span className="text-xs font-semibold text-slate-600">Your name *</span>
                <input
                  className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  value={form.customer_name}
                  onChange={(e) => set('customer_name', e.target.value)}
                  autoComplete="name"
                  required
                />
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold text-slate-600">Mobile number *</span>
                <input
                  className={`mt-1 w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none ${
                    mobileHint ? 'border-rose-400 focus:border-rose-500' : 'border-slate-300 focus:border-indigo-500'
                  }`}
                  value={form.mobile_number}
                  onChange={(e) => onMobileChange(e.target.value)}
                  onBlur={onMobileBlur}
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="10-digit Indian mobile"
                  maxLength={10}
                  aria-invalid={Boolean(mobileHint)}
                  required
                />
                {mobileHint ? (
                  <span className="mt-1 block text-xs text-rose-600">{mobileHint}</span>
                ) : (
                  <span className="mt-1 block text-xs text-slate-400">Enter 10 digits (e.g. 9876543210)</span>
                )}
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold text-slate-600">Company name</span>
                <input
                  className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  value={form.company_name}
                  onChange={(e) => set('company_name', e.target.value)}
                  placeholder="Optional"
                  autoComplete="organization"
                />
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold text-slate-600">Device / TTSPL *</span>
                <input
                  className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none uppercase"
                  value={form.device_serial}
                  onChange={(e) => set('device_serial', e.target.value.toUpperCase())}
                  placeholder="e.g. TTSPL1234"
                  required
                />
                <span className="mt-1 block text-xs text-slate-400">Must match a laptop currently with a customer</span>
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold text-slate-600">Issue description *</span>
                <textarea
                  className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm min-h-[110px] focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  value={form.issue_description}
                  onChange={(e) => set('issue_description', e.target.value)}
                  placeholder="What is the problem?"
                  required
                />
              </label>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#534AB7] hover:bg-[#4539a0] text-white text-sm font-semibold px-4 py-3 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {busy ? 'Submitting…' : 'Submit request'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-4">No login required · Powered by Rentfoxxy</p>
      </div>
    </div>
  );
}
