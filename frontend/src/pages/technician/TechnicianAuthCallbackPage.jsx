import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTechnicianAuth } from '../../context/TechnicianAuthContext';

export default function TechnicianAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { acceptToken } = useTechnicianAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('Missing login token');
      return;
    }

    acceptToken(token)
      .then(() => navigate('/technician/dashboard', { replace: true }))
      .catch(() => {
        setError('Failed to start technician session');
      });
  }, [searchParams, acceptToken, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="text-center">
        {error ? (
          <p className="text-red-600 text-sm">{error}</p>
        ) : (
          <p className="text-slate-600 text-sm">Signing you in as technician...</p>
        )}
      </div>
    </div>
  );
}
