import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { setImpersonationAuthToken } from '../../utils/authToken';

export default function UserImpersonateCallbackPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    const impersonatedBy = searchParams.get('by') || '';
    if (!token) {
      setError('Missing login token');
      return;
    }

    setImpersonationAuthToken(token, { impersonatedBy: decodeURIComponent(impersonatedBy) });
    window.location.replace('/');
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="text-center px-4">
        {error ? (
          <p className="text-red-600 text-sm">{error}</p>
        ) : (
          <p className="text-slate-600 text-sm">Signing in…</p>
        )}
      </div>
    </div>
  );
}
