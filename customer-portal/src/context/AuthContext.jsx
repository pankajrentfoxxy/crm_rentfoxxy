import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import api, { getApiUrl } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [customer, setCustomer] = useState(() => {
    try {
      const raw = localStorage.getItem('cp_customer');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cp_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/me')
      .then(({ data }) => {
        if (data.success !== false && data.customer_id) {
          const profile = { ...data, customer_id: data.customer_id };
          setCustomer(profile);
          localStorage.setItem('cp_customer', JSON.stringify(profile));
        } else {
          localStorage.removeItem('cp_token');
          localStorage.removeItem('cp_customer');
          setCustomer(null);
        }
      })
      .catch(() => {
        localStorage.removeItem('cp_token');
        localStorage.removeItem('cp_customer');
        setCustomer(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(
    () => ({
      customer,
      loading,
      isAuthenticated: !!customer && !!localStorage.getItem('cp_token'),
      async login(email, password) {
        const { data } = await axios.post(
          `${getApiUrl()}/auth/login`,
          { email, password },
          { headers: { 'Content-Type': 'application/json' } }
        );
        if (!data.success) throw new Error(data.message || 'Login failed');

        if (data.portal === 'crm' || data.portal === 'vendor') {
          if (data.redirect_url && typeof window !== 'undefined') {
            window.location.href = data.redirect_url;
            return data;
          }
          throw new Error(`This account belongs to the ${data.portal} portal`);
        }

        localStorage.setItem('cp_token', data.token);
        localStorage.setItem('cp_customer', JSON.stringify(data.customer));
        setCustomer(data.customer);
        return data;
      },
      async logout() {
        try {
          await api.post('/logout');
        } catch {
          /* ignore */
        }
        localStorage.removeItem('cp_token');
        localStorage.removeItem('cp_customer');
        setCustomer(null);
      },
    }),
    [customer, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
