/** Normal login uses localStorage; impersonation tabs use sessionStorage so the admin tab stays signed in. */

export function getAuthToken() {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('token') || localStorage.getItem('token');
}

export function setNormalAuthToken(token) {
  localStorage.setItem('token', token);
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user_impersonation');
  sessionStorage.removeItem('impersonated_by');
}

export function setImpersonationAuthToken(token, { impersonatedBy } = {}) {
  sessionStorage.setItem('token', token);
  sessionStorage.setItem('user_impersonation', '1');
  if (impersonatedBy) sessionStorage.setItem('impersonated_by', impersonatedBy);
}

export function isImpersonationSession() {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem('user_impersonation') === '1';
}

export function getImpersonatedByLabel() {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('impersonated_by') || '';
}

export function clearAuthToken() {
  if (isImpersonationSession()) {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user_impersonation');
    sessionStorage.removeItem('impersonated_by');
    return;
  }
  localStorage.removeItem('token');
}
