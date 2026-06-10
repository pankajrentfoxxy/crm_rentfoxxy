import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { hasPermission as checkPermission } from '../utils/permissionHelper';

export const AuthContext = React.createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const effectivePermissions = user?.effective_permissions || {};

  const loadUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
    } catch (error) {
      localStorage.removeItem('token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) loadUser();
    else setLoading(false);
  }, [loadUser]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const refreshPermissions = useCallback(async () => {
    if (!user?.user_id) return;
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
    } catch {
      /* ignore */
    }
  }, [user?.user_id]);

  const hasPermission = useCallback(
    (section, action = 'view') => checkPermission(user, effectivePermissions, section, action),
    [user, effectivePermissions]
  );

  const value = useMemo(
    () => ({
      user,
      login,
      logout,
      loading,
      isAuthenticated: !!user,
      effectivePermissions,
      hasPermission,
      refreshPermissions,
    }),
    [user, loading, effectivePermissions, hasPermission, refreshPermissions]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
