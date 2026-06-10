import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Mail, Truck } from 'lucide-react';
import { useTechnicianAuth } from '../../context/TechnicianAuthContext';

export default function TechnicianLoginPage() {
  const { login, isAuthenticated, loading } = useTechnicianAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && isAuthenticated) {
    return <Navigate to="/technician/dashboard" replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/technician/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-cyan-500/20 border border-cyan-400/30 mb-4">
            <Truck className="w-7 h-7 text-cyan-300" />
          </div>
          <h1 className="text-2xl font-bold text-white">Technician Portal</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to manage deliveries & field tasks</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          {error ? (
            <div className="text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          ) : null}

          <div>
            <label className="text-xs font-medium text-slate-600">Email</label>
            <div className="relative mt-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                required
                className="w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="technician@example.com"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Password</label>
            <input
              type="password"
              required
              className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-medium rounded-lg text-sm disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>

          <p className="text-center text-xs text-slate-500 pt-2">
            CRM staff?{' '}
            <Link to="/login" className="text-cyan-700 hover:underline">Admin login</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
