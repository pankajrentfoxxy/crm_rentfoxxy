import React from 'react';
import { useTechnicianAuth } from '../../context/TechnicianAuthContext';
import { getBackendOrigin } from '../../utils/api';

function profileImageUrl(filename) {
  if (!filename) return null;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}/uploads/delivery-man/${filename.replace(/^\//, '')}`;
}

export default function TechnicianProfilePage() {
  const { technician } = useTechnicianAuth();
  if (!technician) return null;

  const avatar = profileImageUrl(technician.image);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Profile</h1>
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-4">
          {avatar ? (
            <img src={avatar} alt="Profile" className="w-20 h-20 rounded-full object-cover border" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-slate-200" />
          )}
          <div>
            <p className="text-lg font-semibold text-slate-900">
              {[technician.first_name, technician.last_name].filter(Boolean).join(' ')}
            </p>
            <p className="text-sm text-slate-500">{technician.email}</p>
          </div>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Phone</dt>
            <dd className="font-medium">+{technician.country_code || '91'} {technician.phone || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Identity Type</dt>
            <dd className="font-medium capitalize">{technician.identity_type?.replace('_', ' ') || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Identity Number</dt>
            <dd className="font-medium">{technician.identity_number || '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Address</dt>
            <dd className="font-medium">{technician.address || '—'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
