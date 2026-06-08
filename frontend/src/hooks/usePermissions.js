import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

export const usePermissions = (userId) => {
  const { user, effectivePermissions, hasPermission, refreshPermissions } = useAuth();
  const [permissions, setPermissions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const targetUserId = userId || user?.user_id;

  const fetchPermissions = useCallback(async () => {
    if (!targetUserId) return;

    setLoading(true);
    setError(null);

    try {
      const { data } = await api.get(`/user-permissions/${targetUserId}`);
      setPermissions(data);
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  }, [targetUserId]);

  useEffect(() => {
    if (userId) {
      fetchPermissions();
    } else if (user) {
      setPermissions({ effective: effectivePermissions, user });
    }
  }, [userId, user, effectivePermissions, fetchPermissions]);

  return {
    permissions,
    loading,
    error,
    refetch: fetchPermissions,
    hasPermission,
    refreshPermissions,
  };
};

export { usePermission } from './usePermission';
