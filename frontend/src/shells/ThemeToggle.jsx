import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useDensity } from './DensityProvider';

/** Three states, not two: light, dark, and follow the OS. */
export default function ThemeToggle() {
  const { theme, setTheme } = useDensity();
  const next = theme === null ? 'light' : theme === 'light' ? 'dark' : null;
  const label = theme === null ? 'System' : theme === 'light' ? 'Light' : 'Dark';
  const Icon = theme === null ? Monitor : theme === 'light' ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${label}. Click for ${next === null ? 'system' : next}.`}
      title={`Theme: ${label}`}
      className="c-icon-btn"
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
