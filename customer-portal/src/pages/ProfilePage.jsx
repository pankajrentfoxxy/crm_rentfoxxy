import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { formatAddress } from '../utils/format';

const INPUT = 'mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none';

function PasswordField({ label, value, onChange, autoComplete, required = true }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className={`${INPUT} pr-10`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </label>
  );
}

export default function ProfilePage() {
  const { readOnly, customer } = useAuth();
  const [profile, setProfile] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/me')
      .then(({ data }) => setProfile(data))
      .catch(() => setProfile(customer || {}));
  }, [customer]);

  const hasPassword = profile?.has_portal_password !== false;

  async function changePassword(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      await api.post('/change-password', {
        current_password: hasPassword ? currentPassword : undefined,
        new_password: newPassword,
      });
      toast.success(hasPassword ? 'Password updated' : 'Password set');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setProfile((p) => (p ? { ...p, has_portal_password: true } : p));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update password');
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return <p className="text-slate-500">Loading profile…</p>;

  const billing = formatAddress(profile.billing_address)
    || (typeof profile.billing_address === 'string' ? profile.billing_address : null);

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-bold">My Profile</h1>
        <p className="text-sm text-slate-500 mt-1">Account details and password</p>
      </div>

      <div className="bg-white border rounded-xl p-6 grid sm:grid-cols-2 gap-4 text-sm">
        {[
          ['Company Name', profile.company_name],
          ['Contact Name', profile.name],
          ['Email', profile.email],
          ['Phone', profile.phone],
          ['WhatsApp', profile.whatsapp_number],
          ['GST Number', profile.gst_number],
          ['PAN Number', profile.pan_number],
          ['Billing Address', billing],
          ['City', profile.billing_city],
          ['State', profile.billing_state],
          ['Pincode', profile.billing_pincode],
        ].map(([label, val]) => (
          <div key={label}>
            <p className="text-slate-500">{label}</p>
            <p className="font-medium whitespace-pre-line">{val || '—'}</p>
          </div>
        ))}
      </div>

      {readOnly ? (
        <div className="bg-white border rounded-xl p-6 text-sm text-slate-500">
          <h2 className="font-semibold text-slate-700">Change Password</h2>
          <p className="mt-2">
            Not available in an admin preview. Use Reset Password on the customer record in the CRM instead.
          </p>
        </div>
      ) : (
        <form onSubmit={changePassword} className="bg-white border rounded-xl p-6 space-y-4">
          <div>
            <h2 className="font-semibold">{hasPassword ? 'Change Password' : 'Set Password'}</h2>
            <p className="text-sm text-slate-500 mt-1">
              {hasPassword
                ? 'Enter your current password, then choose a new one for this portal.'
                : 'Set a password so you can sign in to the customer portal.'}
            </p>
          </div>
          {hasPassword && (
            <PasswordField
              label="Current Password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
            />
          )}
          <PasswordField
            label="New Password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirm New Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
          <p className="text-xs text-slate-400">At least 6 characters</p>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-brand text-white rounded-lg font-semibold disabled:opacity-50"
          >
            {busy ? 'Saving…' : hasPassword ? 'Update Password' : 'Set Password'}
          </button>
        </form>
      )}
    </div>
  );
}
