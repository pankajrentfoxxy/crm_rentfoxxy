import { useAuth } from '../context/AuthContext';

/** Laravel parity: only super admin can login as technician */
export function useCanLoginAsTechnician() {
  const { user } = useAuth();
  return user?.role === 'super_admin';
}
