import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Navigate, useNavigate } from 'react-router-dom';
import { useVendorAuth } from '../context/VendorAuthContext';

export default function LoginPage() {
  const { login, isAuthenticated, loading } = useVendorAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && isAuthenticated) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast.success('Welcome back');
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-emerald-50 to-slate-100">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-100 p-8">
        <h1 className="text-2xl font-bold text-slate-900">Vendor Portal</h1>
        <p className="text-sm text-slate-500 mt-1">Sign in to view purchase orders and laptop inventory</p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-600">Email</label>
            <input
              type="email"
              required
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Password</label>
            <input
              type="password"
              required
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white font-semibold text-sm disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
