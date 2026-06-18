import { useEffect, useRef } from 'react';

/**
 * Re-runs `onRefresh` when the tab/app becomes active again.
 *
 * Mobile browsers freeze background tabs and restore them from a frozen state
 * (no re-render, no re-fetch) when the user switches back. After login users
 * would open a section, switch away, come back and still see stale/empty data
 * until a manual reload. Listening for visibility/focus/bfcache restore lets the
 * page pull fresh data automatically without a full page refresh.
 *
 * The mount fetch is still owned by each page's own effect; this only covers the
 * "came back to the tab" case. A short cooldown collapses the visibility +
 * focus events that browsers often fire together into a single refresh.
 */
export default function useAutoRefresh(onRefresh, { enabled = true, cooldownMs = 800 } = {}) {
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;
  const lastRunRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    const trigger = () => {
      const now = Date.now();
      if (now - lastRunRef.current < cooldownMs) return;
      lastRunRef.current = now;
      callbackRef.current?.();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') trigger();
    };

    const onPageShow = (e) => {
      // persisted === true means the page was restored from the bfcache
      // (mobile back/forward or tab restore) where effects never re-run.
      if (e.persisted) trigger();
    };

    window.addEventListener('focus', trigger);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      window.removeEventListener('focus', trigger);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [enabled, cooldownMs]);
}
