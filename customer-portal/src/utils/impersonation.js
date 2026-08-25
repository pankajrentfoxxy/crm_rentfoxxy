/**
 * Receives a read-only portal session handed over by a super admin from the CRM.
 *
 * The CRM opens `/dashboard#token=<session token>`. The token travels in the URL
 * fragment rather than the query string so browsers never put it in a `Referer`
 * header or send it to the server in a request line. It is consumed before React
 * renders and the fragment is stripped immediately, so the token does not
 * survive in the address bar, in browser history, or in a link the admin might
 * copy out of it.
 *
 * The handoff deliberately reuses the existing /dashboard route instead of a
 * dedicated one, so it needs no extra web-server rewrite rule to work.
 */

const HANDOFF_PATH = '/dashboard';

export function consumeImpersonationHandoff() {
  if (typeof window === 'undefined') return false;
  if (window.location.pathname !== HANDOFF_PATH) return false;
  if (!window.location.hash) return false;

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('token');

  // Strip the fragment either way, so a stale or malformed link does not leave a
  // dead token sitting in the address bar.
  window.history.replaceState(null, '', HANDOFF_PATH);
  if (!token) return false;

  localStorage.setItem('cp_token', token);
  // Drop any cached profile from a previous session so the app re-fetches /me
  // and picks up the impersonated customer instead of showing the old one.
  localStorage.removeItem('cp_customer');
  return true;
}
