import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { hasPermission as checkPermission, isAssignedDataOnly as checkAssignedScope } from '../utils/permissionHelper';
import {
  clearAuthToken,
  getAuthToken,
  isImpersonationSession,
  setNormalAuthToken,
} from '../utils/authToken';

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
      clearAuthToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    if (token) loadUser();
    else setLoading(false);
  }, [loadUser]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setNormalAuthToken(data.token);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    clearAuthToken();
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

  const isAssignedDataOnly = useCallback(
    (section) => checkAssignedScope(user, effectivePermissions, section),
    [user, effectivePermissions]
  );

  const value = useMemo(
    () => ({
      user,
      login,
      logout,
      loading,
      isAuthenticated: !!user,
      isImpersonationSession: isImpersonationSession(),
      effectivePermissions,
      hasPermission,
      isAssignedDataOnly,
      refreshPermissions,
    }),
    [user, loading, effectivePermissions, hasPermission, isAssignedDataOnly, refreshPermissions]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
