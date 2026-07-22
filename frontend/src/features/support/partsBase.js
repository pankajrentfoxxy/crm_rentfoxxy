import { useLocation } from 'react-router-dom';

/**
 * The parts pages render under two route trees:
 *   - /support/*        (inside the support shell, for support staff)
 *   - /support-parts/*  (global layout, for warehouse staff)
 * This hook returns the correct base prefix so internal links stay in-context.
 */
export function usePartsBase() {
  const { pathname } = useLocation();
  return pathname.startsWith('/support-parts') ? '/support-parts' : '/support';
}
