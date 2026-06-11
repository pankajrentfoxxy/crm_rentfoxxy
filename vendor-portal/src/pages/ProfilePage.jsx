import React, { useEffect, useState } from 'react';
import api from '../utils/api';

export default function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/vendor-portal/me')
      .then(({ data }) => {
        if (data.success) setProfile(data.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate-500">Loading profile…</p>;
  if (!profile) return <p className="text-slate-500">Profile unavailable.</p>;

  const fields = [
    ['Business name', profile.business_name],
    ['Email', profile.email],
    ['Phone', profile.phone],
    ['GSTIN', profile.gst_number],
    ['PAN', profile.pan_number],
    ['City', profile.city],
    ['State', profile.state],
    ['Address', profile.address],
    ['PO payment terms', profile.po_payment_terms],
    ['Credit days', profile.credit_days],
    ['Last portal login', profile.vendor_portal_last_login?.slice?.(0, 19) || '—']
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Profile</h1>
        <p className="text-sm text-slate-500 mt-1">Your registered vendor details</p>
      </div>
      <div className="bg-white rounded-xl border shadow-sm divide-y">
        {fields.map(([label, value]) => (
          <div key={label} className="px-5 py-3 flex flex-col sm:flex-row sm:gap-4">
            <span className="text-xs font-semibold uppercase text-slate-500 sm:w-40 shrink-0">{label}</span>
            <span className="text-sm text-slate-800">{value || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
