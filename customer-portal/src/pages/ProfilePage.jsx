import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../utils/api';

export default function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/me').then(({ data }) => setProfile(data));
  }, []);

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
      await api.post('/change-password', { current_password: currentPassword, new_password: newPassword });
      toast.success('Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update password');
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return <p className="text-slate-500">Loading profile…</p>;

  const billing = typeof profile.billing_address === 'object'
    ? profile.billing_address?.address || JSON.stringify(profile.billing_address)
    : profile.billing_address;

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-xl font-bold">My Profile</h1>
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
            <p className="font-medium">{val || '—'}</p>
          </div>
        ))}
      </div>

      <form onSubmit={changePassword} className="bg-white border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold">Change Password</h2>
        <label className="block text-sm">
          Current Password
          <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2" />
        </label>
        <label className="block text-sm">
          New Password
          <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2" />
        </label>
        <label className="block text-sm">
          Confirm Password
          <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2" />
        </label>
        <button type="submit" disabled={busy} className="px-4 py-2 bg-brand text-white rounded-lg font-semibold disabled:opacity-50">
          Update Password
        </button>
      </form>
    </div>
  );
}
