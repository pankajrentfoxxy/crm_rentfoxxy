/** Decode CRM JWT (no verify) for UI gating — mirrors Laravel `is_superadmin` + admin role. */
function decodeJwtPayload() {
  try {
    const t = localStorage.getItem('token');
    if (!t) return null;
    const parts = t.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function useVendorMgmtCapabilities() {
  const p = decodeJwtPayload();
  return {
    canLoginAsVendor: p?.role === 'admin' || p?.is_superadmin === true
  };
}
