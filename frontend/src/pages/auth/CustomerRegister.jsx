import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';

const API_BASE = (process.env.REACT_APP_API_URL || process.env.VITE_API_URL || '').replace(/\/$/, '');

export default function CustomerRegister() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', mobile_no: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let timer;
    if (success) {
      timer = setTimeout(() => navigate('/login'), 2000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [navigate, success]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const validate = useMemo(() => {
    if (!form.name || !form.email || !form.mobile_no || !form.password || !form.confirmPassword) {
      return 'All fields are required';
    }
    if (form.password.length < 8) {
      return 'Password must be at least 8 characters';
    }
    if (form.password !== form.confirmPassword) {
      return 'Passwords do not match';
    }
    return '';
  }, [form]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (validate) {
      setError(validate);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await window.fetch(`${API_BASE}/api/auth/register/customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          mobile_no: form.mobile_no,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message || 'Registration failed');
        return;
      }

      setSuccess(true);
    } catch (err) {
      setError('Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        {success ? (
          <div className="text-center py-8">
            <div className="text-4xl text-green-600 mb-3">?</div>
            <h2 className="text-lg font-semibold text-gray-800">Account created successfully</h2>
            <p className="text-sm text-gray-500 mt-2">Redirecting to login...</p>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <p className="text-sm font-medium text-blue-600">Rentfoxxy</p>
              <h1 className="text-2xl font-semibold text-gray-800 mt-1">Create Account</h1>
              <p className="text-sm text-gray-500">Join us today</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {[
                { label: 'Name', name: 'name', type: 'text' },
                { label: 'Email', name: 'email', type: 'email' },
                { label: 'Mobile Number', name: 'mobile_no', type: 'tel' },
              ].map((field) => (
                <div key={field.name}>
                  <label className="block text-sm text-gray-700 mb-1">{field.label}</label>
                  <input
                    type={field.type}
                    name={field.name}
                    value={form[field.name]}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              ))}

              <div>
                <label className="block text-sm text-gray-700 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
                    required
                  />
                  <button type="button" className="absolute right-2 top-2 text-gray-500" onClick={() => setShowPassword((p) => !p)}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-700 mb-1">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    value={form.confirmPassword}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
                    required
                  />
                  <button type="button" className="absolute right-2 top-2 text-gray-500" onClick={() => setShowConfirmPassword((p) => !p)}>
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>

            <div className="text-sm text-center text-gray-500 mt-4 space-y-1">
              <p>
                Already have an account?{' '}
                <Link to="/login" className="text-blue-600 hover:underline">
                  Login
                </Link>
              </p>
              <p>
                Are you a vendor?{' '}
                <Link to="/register/vendor" className="text-blue-600 hover:underline">
                  Register here
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
