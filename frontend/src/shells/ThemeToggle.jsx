import React from 'react';
import { useDensity } from './DensityProvider';

/** Three states, not two: light, dark, and follow the OS. */
export default function ThemeToggle() {
  const { theme, setTheme } = useDensity();
  const next = theme === null ? 'light' : theme === 'light' ? 'dark' : null;
  const label = theme === null ? 'System' : theme === 'light' ? 'Light' : 'Dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${label}. Click for ${next === null ? 'system' : next}.`}
      className="font-ui bg-surface-2 border border-rule text-ink-2 cursor-pointer"
      style={{
        padding: 'var(--d-pad-y) var(--d-pad-x)', minHeight: 'var(--d-tap)',
        borderRadius: 'var(--d-radius)', fontSize: 'var(--d-sm)',
      }}
    >
      {label}
    </button>
  );
}
