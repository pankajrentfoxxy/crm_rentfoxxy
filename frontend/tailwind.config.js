/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Priority ramp — used ONLY for priority. Never for buttons, links or status.
        pri1: { DEFAULT: '#B32A45', bg: '#FCEBEE', ring: '#F0C9D1' },
        pri2: { DEFAULT: '#C2660F', bg: '#FDF0E3', ring: '#F0D9BB' },
        pri3: { DEFAULT: '#8F6D0A', bg: '#FBF4DE', ring: '#EDDFAE' },
        pri4: { DEFAULT: '#5A6472', bg: '#EEF0F3', ring: '#DFE3E9' },
        // Interactive chrome — petrol/teal so it cannot be read as a priority
        sup: {
          ink: '#0E1116',
          ink2: '#39414F',
          muted: '#6B7382',
          faint: '#98A0AE',
          canvas: '#F4F6F8',
          canvas2: '#EDF0F3',
          line: '#DFE3E9',
          lineSoft: '#EAEDF1',
          accent: '#134B60',
          accent2: '#0D7C86',
          accentSoft: '#E4F1F3',
          ok: '#1B7A4D',
          okBg: '#E5F3EC',
          warn: '#B4780C',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      boxShadow: {
        sup: '0 1px 2px rgba(14,17,22,.06), 0 4px 12px rgba(14,17,22,.05)',
        supLg: '0 8px 32px rgba(14,17,22,.14)',
      },
    },
  },
  plugins: [],
};
