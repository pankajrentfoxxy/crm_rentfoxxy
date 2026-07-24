import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { postLoginPath } from '../utils/supportAccess';
import api from '../utils/api';
import { setNormalAuthToken } from '../utils/authToken';
import { ArrowLeft, Laptop, Mail, Scan } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner';

const OTP_COOLDOWN_SECONDS = 60;

export default function Login() {
  const [mode, setMode] = useState('email');
  const [emailView, setEmailView] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [barcode, setBarcode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showScanner, setShowScanner] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setResendCooldown((value) => (value > 1 ? value - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const resetForgotState = () => {
    setEmailView('login');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setResendCooldown(0);
    setSuccess('');
    setError('');
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await login(email, password);
      navigate(postLoginPath());
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Login failed';
      setError(msg === 'Network Error' ? 'Cannot reach server. Check if backend is running.' : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password/request', { email });
      setEmailView('reset');
      setResendCooldown(OTP_COOLDOWN_SECONDS);
      setSuccess(data.message || 'Verification code sent to your email.');
    } catch (err) {
      const retryAfter = err.response?.data?.retryAfterSeconds;
      if (retryAfter) setResendCooldown(retryAfter);
      setError(err.response?.data?.message || 'Unable to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password/reset', {
        email,
        otp,
        new_password: newPassword,
      });
      setSuccess(data.message || 'Password updated. You can sign in now.');
      setPassword('');
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
      setEmailView('login');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reset password');
    } finally {
      setLoading(false);
    }
  };

  const handleBarcodeLogin = async (e) => {
    e.preventDefault();
    if (!barcode) return;
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login-barcode', { barcode });
      setNormalAuthToken(data.token);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid barcode');
      setBarcode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid lg:grid-cols-2 bg-white rounded-2xl overflow-hidden border border-slate-200">

        {/* ── Left: Auth panel ── */}
        <div className="px-10 py-10 flex flex-col justify-center">

          {/* Brand */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-9 h-9 bg-orange-50 rounded-xl flex items-center justify-center shrink-0">
              <Laptop className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900 leading-tight">Rentfoxxy</p>
              <p className="text-[11px] text-slate-400 leading-tight">Operations Suite</p>
            </div>
          </div>

          {/* Heading */}
          <h1 className="text-xl font-semibold text-slate-900 mb-1">
            {emailView === 'login' ? 'Welcome back' : emailView === 'forgot' ? 'Reset your password' : 'Enter verification code'}
          </h1>
          <p className="text-sm text-slate-500 mb-6">
            {emailView === 'login' && 'Sign in to your workspace'}
            {emailView === 'forgot' && 'We will email you a 6-digit verification code'}
            {emailView === 'reset' && `Code sent to ${email}`}
          </p>

          {/* Error */}
          {error && (
            <div className="mb-5 px-3.5 py-2.5 bg-red-50 border border-red-100 rounded-lg text-red-600 text-xs">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-5 px-3.5 py-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-700 text-xs">
              {success}
            </div>
          )}

          {/* Mode tabs */}
          {emailView === 'login' && (
            <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-1 gap-1 mb-6">
              <button
                onClick={() => { setMode('email'); setError(''); setSuccess(''); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                  mode === 'email'
                    ? 'bg-white text-slate-900 border border-slate-200 shadow-none'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                Email
              </button>
              <button
                onClick={() => { setMode('barcode'); setError(''); setSuccess(''); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                  mode === 'barcode'
                    ? 'bg-white text-slate-900 border border-slate-200 shadow-none'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Scan className="w-3.5 h-3.5" />
                Barcode
              </button>
            </div>
          )}

          {/* Email login form */}
          {mode === 'email' && emailView === 'login' && (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Work email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@rentfoxxy.com"
                  required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-600">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setEmailView('forgot');
                      setError('');
                      setSuccess('');
                    }}
                    className="text-xs text-orange-600 hover:text-orange-700 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          )}

          {/* Forgot password — request OTP */}
          {mode === 'email' && emailView === 'forgot' && (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Work email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@rentfoxxy.com"
                  required
                  autoFocus
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending code...' : 'Send verification code'}
              </button>
              <button
                type="button"
                onClick={resetForgotState}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to sign in
              </button>
            </form>
          )}

          {/* Forgot password — OTP + new password */}
          {mode === 'email' && emailView === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Verification code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  required
                  autoFocus
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-300 tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[11px] text-slate-400">Code expires in 10 minutes</p>
                  <button
                    type="button"
                    disabled={loading || resendCooldown > 0}
                    onClick={handleRequestOtp}
                    className="text-[11px] text-orange-600 hover:text-orange-700 disabled:text-slate-400 disabled:no-underline hover:underline"
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">New password</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    {showNewPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Confirm new password</label>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  minLength={8}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Updating password...' : 'Reset password'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmailView('forgot');
                  setOtp('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setError('');
                  setSuccess('');
                }}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Use a different email
              </button>
            </form>
          )}

          {/* Barcode form */}
          {mode === 'barcode' && emailView === 'login' && (
            <form onSubmit={handleBarcodeLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Barcode / badge ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Scan or enter code"
                    autoFocus
                    required
                    className="flex-1 px-3 py-2.5 border-2 border-orange-300 rounded-lg text-sm font-mono tracking-widest text-center text-slate-900 placeholder-slate-300 focus:outline-none focus:border-orange-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowScanner(!showScanner)}
                    className="px-3 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                    title="Toggle camera scanner"
                  >
                    <Scan className="w-4 h-4 text-slate-600" />
                  </button>
                </div>
                {showScanner && (
                  <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                    <BarcodeScanner
                      onScanSuccess={(code) => { setBarcode(code); setShowScanner(false); }}
                    />
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Verifying...' : 'Login with barcode'}
              </button>
            </form>
          )}

          {/* Register section */}
          {emailView === 'login' && (
            <div className="mt-7 pt-6 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-700 mb-1">New to Rentfoxxy?</p>
              <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                Internal staff use the login above — credentials are issued by your admin.
              </p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <Link
                  to="/register/customer"
                  className="rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-3 hover:bg-amber-100 transition-colors group"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
                    <p className="text-xs font-medium text-amber-900">Customer</p>
                  </div>
                  <p className="text-[11px] text-amber-700 leading-snug">Raise tickets and view invoices</p>
                </Link>
                <Link
                  to="/register/vendor"
                  className="rounded-xl border border-orange-100 bg-orange-50 px-3.5 py-3 hover:bg-orange-100 transition-colors group"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0"></span>
                    <p className="text-xs font-medium text-orange-900">Vendor</p>
                  </div>
                  <p className="text-[11px] text-orange-700 leading-snug">Partner — pending admin approval</p>
                </Link>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3">
                <p className="text-[11px] font-medium text-slate-500 mb-1.5">Internal roles</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Technician, admin, sales, QC, dispatch, warehouse, procurement, and support — accounts are issued by your organization.{' '}
                  <Link to="/settings/user-permissions" className="text-orange-600 hover:underline">
                    Roles &amp; permissions
                  </Link>{' '}
                  (sign in first).
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Brand panel ── */}
        <div className="hidden lg:flex flex-col justify-between bg-slate-900 px-10 py-10">
          <div>
            <span className="inline-block text-[10px] font-medium text-orange-400 tracking-widest bg-orange-400/10 px-2.5 py-1 rounded-full mb-5">
              RENTFOXXY OPERATIONS
            </span>
            <h2 className="text-2xl font-semibold text-white leading-snug mb-3">
              Professional laptop rental &amp; refurbishment workflow
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Track every device from intake to dispatch with QC-driven quality and full accountability across your team.
            </p>
            <div className="grid grid-cols-3 gap-3 mt-7">
              {[
                { value: 'QC1 / QC2', label: 'Quality controls' },
                { value: 'Inventory', label: 'Live tracking' },
                { value: 'Dispatch', label: 'Sales flow' },
              ].map((s) => (
                <div key={s.label} className="bg-white/5 border border-white/8 rounded-xl px-3 py-3">
                  <p className="text-sm font-medium text-white mb-0.5">{s.value}</p>
                  <p className="text-[11px] text-slate-500">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-600">
            Rentfoxxy · Refurbishment Operations Suite
          </p>
        </div>

      </div>
    </div>
  );
}
