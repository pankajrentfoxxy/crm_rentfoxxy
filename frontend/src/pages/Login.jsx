import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { postLoginPath } from '../utils/supportAccess';
import api from '../utils/api';
import { Laptop, Scan } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner';

export default function Login() {
    const [mode, setMode] = useState('email'); // 'email' or 'barcode'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [barcode, setBarcode] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();
  
    const handleEmailLogin = async (e) => {
      e.preventDefault();
      setError('');
      setLoading(true);
      try {
        const data = await login(email, password);
        navigate(postLoginPath(data.user));
      } catch (err) {
        const msg = err.response?.data?.message || err.message || 'Login failed';
        setError(msg === 'Network Error' ? 'Cannot reach server. Check if backend is running.' : msg);
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
        localStorage.setItem('token', data.token);
        window.location.href = '/dashboard'; // Hard reload to refresh context or use context login setter
      } catch (err) {
        setError(err.response?.data?.message || 'Invalid barcode');
        setBarcode('');
      } finally {
        setLoading(false);
      }
    };
  
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="grid min-h-screen lg:grid-cols-2">
          <div className="flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-md">
              <div className="mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-orange-100 rounded-xl">
                    <Laptop className="w-8 h-8 text-orange-600" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold text-slate-900">Rentfoxxy</h1>
                    <p className="text-slate-500 text-sm">Refurbishment Operations Suite</p>
                  </div>
                </div>
                <p className="text-slate-600 mt-4">
                  Sign in to manage refurbishment flow, QC, inventory, and dispatch in one place.
                </p>
              </div>
  
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}
  
              <div className="flex border-b border-gray-200 mb-6">
                <button
                  onClick={() => setMode('email')}
                  className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${mode === 'email' ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  Email Login
                </button>
                <button
                  onClick={() => setMode('barcode')}
                  className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${mode === 'barcode' ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  Barcode Login
                </button>
              </div>
  
              {mode === 'email' ? (
                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Work Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      placeholder="Enter your email"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-slate-900 text-white py-3 rounded-lg font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Logging in...' : 'Sign In'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleBarcodeLogin} className="space-y-4">
                  <div className="text-left mb-2">
                    <p className="text-sm text-slate-500">Scan your ID badge or enter code</p>
                  </div>
                  <div>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        value={barcode}
                        onChange={(e) => setBarcode(e.target.value)}
                        className="flex-1 px-4 py-3 border-2 border-orange-400 rounded-lg focus:ring-2 focus:ring-orange-500 text-center font-mono text-xl tracking-widest"
                        placeholder="SCAN CODE HERE"
                        autoFocus
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowScanner(!showScanner)}
                        className="bg-gray-100 px-3 rounded-lg hover:bg-gray-200"
                        title="Toggle Camera"
                      >
                        <Scan className="w-6 h-6 text-gray-700" />
                      </button>
                    </div>
  
                    {showScanner && (
                      <div className="mb-4 border rounded p-2">
                        <BarcodeScanner
                          onScanSuccess={(code) => {
                            setBarcode(code);
                            setShowScanner(false);
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-slate-900 text-white py-3 rounded-lg font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Verifying...' : 'Login with Barcode'}
                  </button>
                </form>
              )}
  
            </div>
          </div>
  
          <div className="hidden lg:block relative">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-orange-600"></div>
            <div className="absolute inset-0 opacity-20">
              <div className="w-full h-full bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.25),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.2),transparent_35%),radial-gradient(circle_at_50%_80%,rgba(255,255,255,0.15),transparent_40%)]"></div>
            </div>
            <div className="relative h-full flex items-end p-12">
              <div className="text-white max-w-md">
                <p className="text-sm uppercase tracking-widest text-orange-200 mb-3">Rentfoxxy Operations</p>
                <h2 className="text-4xl font-bold leading-tight mb-4">
                  Professional laptop rental & refurbishment workflow.
                </h2>
                <p className="text-orange-100">
                  Track every device from intake to inventory with QC-driven quality and clear accountability.
                </p>
                <div className="mt-8 grid grid-cols-3 gap-4 text-xs text-orange-100">
                  <div className="bg-white/10 rounded-lg p-3">QC1/QC2 Controls</div>
                  <div className="bg-white/10 rounded-lg p-3">Inventory Ready</div>
                  <div className="bg-white/10 rounded-lg p-3">Sales Dispatch</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }