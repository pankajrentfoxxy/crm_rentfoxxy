import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast.success('Welcome back');
      navigate('/dashboard');
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Login failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-100 p-8">
        <div className="text-center mb-8">
          <p className="text-2xl font-bold text-brand">Rentfoxxy</p>
          <h1 className="text-xl font-semibold mt-2">Customer Portal</h1>
          <p className="text-sm text-slate-500 mt-1">Access your rental details, invoices, and support</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="text-slate-600">Email address *</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand/30 focus:border-brand" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Password *</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand/30 focus:border-brand" />
          </label>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error.includes('disabled') ? 'Contact Rentfoxxy to enable portal access.' : error}
            </p>
          )}
          <button type="submit" disabled={busy}
            className="w-full py-2.5 rounded-lg bg-brand text-white font-semibold hover:bg-brand-dark disabled:opacity-50">
            {busy ? 'Signing in…' : 'Login'}
          </button>
        </form>
        <p className="text-center text-xs text-slate-400 mt-8">Powered by Rentfoxxy</p>
      </div>
    </div>
  );
}
