import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { formatIndianMobileInput, indianMobileError, normalizeIndianMobile } from '../../utils/phoneValidation';

const API_BASE = (process.env.REACT_APP_API_URL || process.env.VITE_API_URL || '').replace(/\/$/, '');

export default function VendorRegister() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    mobile_no: '',
    company_name: '',
    gst_number: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: name === 'mobile_no' ? formatIndianMobileInput(value) : value,
    }));
    setError('');
  };

  const validate = useMemo(() => {
    if (!form.name || !form.email || !form.mobile_no || !form.company_name || !form.password || !form.confirmPassword) {
      return 'Please fill all required fields';
    }
    const mobileErr = indianMobileError(form.mobile_no, { required: true, label: 'Mobile number' });
    if (mobileErr) return mobileErr;
    if (form.password.length < 8) return 'Password must be at least 8 characters';
    if (form.password !== form.confirmPassword) return 'Passwords do not match';
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
      const res = await window.fetch(`${API_BASE}/api/auth/register/vendor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          mobile_no: normalizeIndianMobile(form.mobile_no),
          company_name: form.company_name,
          gst_number: form.gst_number,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Registration failed');
        return;
      }

      setSubmitted(true);
    } catch (err) {
      setError('Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        {submitted ? (
          <div className="text-center py-6">
            <div className="text-5xl mb-4">?</div>
            <h2 className="text-xl font-semibold text-gray-800">Registration Submitted!</h2>
            <p className="text-sm text-gray-500 text-center max-w-xs mx-auto mt-3">
              Your vendor account is under review. Our admin team will verify your details and notify you once approved.
            </p>
            <Link
              to="/"
              className="inline-flex mt-5 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              Go to Homepage
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <p className="text-sm font-medium text-blue-600">Rentfoxxy</p>
              <h1 className="text-2xl font-semibold text-gray-800 mt-1">Vendor Registration</h1>
              <p className="text-sm text-gray-500">Partner with us</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {[
                { label: 'Name', name: 'name', type: 'text', required: true },
                { label: 'Email', name: 'email', type: 'email', required: true },
                { label: 'Mobile Number', name: 'mobile_no', type: 'tel', required: true },
                { label: 'Company Name', name: 'company_name', type: 'text', required: true },
                { label: 'GST Number (optional)', name: 'gst_number', type: 'text', required: false },
              ].map((field) => (
                <div key={field.name}>
                  <label className="block text-sm text-gray-700 mb-1">{field.label}</label>
                  <input
                    type={field.type}
                    name={field.name}
                    value={form[field.name]}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required={field.required}
                    maxLength={field.name === 'mobile_no' ? 10 : undefined}
                    inputMode={field.name === 'mobile_no' ? 'numeric' : undefined}
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
                  <button
                    type="button"
                    className="absolute right-2 top-2 text-gray-500"
                    onClick={() => setShowConfirmPassword((p) => !p)}
                  >
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
                {loading ? 'Submitting...' : 'Submit Registration'}
              </button>
            </form>

            <div className="text-sm text-center text-gray-500 mt-4">
              Already have an account?{' '}
              <Link to="/login" className="text-blue-600 hover:underline">
                Login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
