import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { loginAsVendor } from '../vendorManagementApi';

export default function LoginAsVendorModal({ modal, onClose }) {
  const [busy, setBusy] = useState(false);
  const [vendor_id, setVendorId] = useState(String(modal.vendor_id || ''));
  const [vendor_email, setEmail] = useState(modal.vendor_email || '');

  React.useEffect(() => {
    setVendorId(String(modal.vendor_id || ''));
    setEmail(modal.vendor_email || '');
  }, [modal.open, modal.vendor_id, modal.vendor_email]);

  if (!modal.open) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await loginAsVendor({
        vendor_id: Number(vendor_id),
        vendor_email
      });
      if (!data.success) throw new Error(data.message || 'Failed');
      if (data.vendorToken) {
        sessionStorage.setItem('vendor_impersonation_token', data.vendorToken);
        sessionStorage.setItem(
          'vendor_impersonation_info',
          JSON.stringify({ ...(data.vendor || {}), impersonated_by_note: true })
        );
      }
      toast.success(`${data.vendor?.name || 'Vendor'} — impersonation JWT stored (vendor_impersonation_token).`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative">
        <button type="button" className="absolute top-4 right-4 text-slate-400 hover:text-slate-700" onClick={onClose}>
          <X className="w-5 h-5" />
        </button>
        <h3 className="text-lg font-bold text-slate-900 mb-2">Login as vendor</h3>
        <p className="text-xs text-slate-500 mb-4">
          Issues a scoped JWT (<code className="bg-slate-100 px-1 rounded">vendor_impersonation</code>) matching Laravel &
          Rentfoxxy flow. Frontend stores token in{' '}
          <code className="bg-slate-100 px-1 rounded">sessionStorage</code> for downstream vendor portals.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">Vendor ID</label>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              required
              value={vendor_id}
              onChange={(e) => setVendorId(e.target.value)}
              type="number"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Vendor email</label>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              required
              type="email"
              value={vendor_email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button disabled={busy} type="submit" className="w-full py-2 rounded-lg bg-slate-900 text-white font-semibold text-sm">
            {busy ? 'Working…' : 'Issue impersonation JWT'}
          </button>
        </form>
      </div>
    </div>
  );
}
