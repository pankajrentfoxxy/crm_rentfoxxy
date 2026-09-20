import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import '../styles/carret.css';

/**
 * Density is a property of WHO is using a screen, not of what it shows — so a
 * screen never sets its own. The three shells set it on their root and every
 * component reads it through CSS variables.
 *
 * carret.css is imported here rather than at app level on purpose. Loading it
 * globally would put `color-scheme: dark` on :root for anyone on a dark OS,
 * which turns the legacy app's native inputs and scrollbars dark while its own
 * CSS stays light. Importing it from the shells keeps the two apps genuinely
 * coexisting, which is hard rule 7.
 */
const DensityContext = createContext({ density: 'desk', theme: null, setTheme: () => {} });

export const useDensity = () => useContext(DensityContext);

const THEME_KEY = 'carret.theme';

export default function DensityProvider({ density = 'desk', children }) {
  // null means "follow the OS", which is the case the token system is built to
  // survive and the one most likely to be skipped in testing.
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || null; } catch { return null; }
  });

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      if (next) localStorage.setItem(THEME_KEY, next);
      else localStorage.removeItem(THEME_KEY);
    } catch { /* a remembered theme is a convenience, never a failure path */ }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    return () => root.removeAttribute('data-theme');
  }, [theme]);

  const value = useMemo(() => ({ density, theme, setTheme }), [density, theme, setTheme]);

  return (
    <DensityContext.Provider value={value}>
      <div
        className="carret-root font-ui bg-ground text-ink min-h-screen"
        data-density={density}
        style={{ fontSize: 'var(--d-base)' }}
      >
        {children}
      </div>
    </DensityContext.Provider>
  );
}
