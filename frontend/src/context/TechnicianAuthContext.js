import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchTechnicianMe, setTechnicianToken, technicianLogin } from '../utils/technicianApi';

export const TechnicianAuthContext = React.createContext();

export function TechnicianAuthProvider({ children }) {
  const [technician, setTechnician] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadTechnician = useCallback(async () => {
    try {
      const data = await fetchTechnicianMe();
      setTechnician(data.technician);
    } catch {
      setTechnicianToken(null);
      setTechnician(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('technician_token');
    if (token) loadTechnician();
    else setLoading(false);
  }, [loadTechnician]);

  const login = async (email, password) => {
    const data = await technicianLogin(email, password);
    setTechnicianToken(data.token);
    setTechnician(data.technician);
    return data;
  };

  const acceptToken = async (token) => {
    setTechnicianToken(token);
    const data = await fetchTechnicianMe();
    setTechnician(data.technician);
    return data;
  };

  const logout = () => {
    setTechnicianToken(null);
    setTechnician(null);
  };

  const value = useMemo(
    () => ({
      technician,
      loading,
      isAuthenticated: !!technician,
      login,
      acceptToken,
      logout,
      loadTechnician,
    }),
    [technician, loading, loadTechnician]
  );

  return (
    <TechnicianAuthContext.Provider value={value}>
      {children}
    </TechnicianAuthContext.Provider>
  );
}

export function useTechnicianAuth() {
  return useContext(TechnicianAuthContext);
}
