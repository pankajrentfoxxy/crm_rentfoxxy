import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

const VendorAuthContext = createContext(null);

export function VendorAuthProvider({ children }) {
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('vendor_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/vendor-portal/me')
      .then(({ data }) => {
        if (data.success) setVendor(data.data);
        else localStorage.removeItem('vendor_token');
      })
      .catch(() => localStorage.removeItem('vendor_token'))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(
    () => ({
      vendor,
      loading,
      isAuthenticated: !!vendor,
      async login(email, password) {
        const { data } = await api.post('/vendor-portal/login', { email, password });
        if (!data.success) throw new Error(data.message || 'Login failed');
        localStorage.setItem('vendor_token', data.data.token);
        setVendor(data.data.vendor);
        return data.data;
      },
      async logout() {
        try {
          await api.post('/vendor-portal/logout');
        } catch {
          /* ignore */
        }
        localStorage.removeItem('vendor_token');
        setVendor(null);
      }
    }),
    [vendor, loading]
  );

  return <VendorAuthContext.Provider value={value}>{children}</VendorAuthContext.Provider>;
}

export function useVendorAuth() {
  const ctx = useContext(VendorAuthContext);
  if (!ctx) throw new Error('useVendorAuth must be used within VendorAuthProvider');
  return ctx;
}
