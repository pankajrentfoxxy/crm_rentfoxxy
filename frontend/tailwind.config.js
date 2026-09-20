/** @type {import('tailwindcss').Config} */
// This file MAPS tokens; it does not define them. Every value is var(--token)
// from src/styles/carret.css, so themes and densities keep working through
// Tailwind classes. Adding a literal colour here defeats both.
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground:'var(--ground)',
        surface:{ DEFAULT:'var(--surface)', 2:'var(--surface-2)', 3:'var(--surface-3)', sunk:'var(--surface-sunk)' },
        ink:{ DEFAULT:'var(--ink)', 2:'var(--ink-2)', 3:'var(--ink-3)', inverse:'var(--ink-inverse)' },
        rule:{ DEFAULT:'var(--rule)', 2:'var(--rule-2)', strong:'var(--rule-strong)' },
        accent:{ DEFAULT:'var(--accent)', hover:'var(--accent-hover)', soft:'var(--accent-soft)', ink:'var(--accent-ink)' },
        entity:{ rental:'var(--entity-rental)', sale:'var(--entity-sale)' },
        lc:{
          idle:'var(--lc-idle)', earning:'var(--lc-earning)', moving:'var(--lc-moving)',
          offcycle:'var(--lc-offcycle)', closed:'var(--lc-closed)',
          'idle-soft':'var(--lc-idle-soft)', 'earning-soft':'var(--lc-earning-soft)',
          'moving-soft':'var(--lc-moving-soft)', 'offcycle-soft':'var(--lc-offcycle-soft)',
          'closed-soft':'var(--lc-closed-soft)',
        },
        alert:{ good:'var(--alert-good)', warn:'var(--alert-warn)', serious:'var(--alert-serious)', crit:'var(--alert-crit)' },
      },
      fontFamily:{ ui:'var(--font-ui)', mono:'var(--font-mono)' },
      fontSize:{ d:'var(--d-base)', 'd-sm':'var(--d-sm)', 'd-lg':'var(--d-lg)' },
      spacing:{ 'd':'var(--d-gap)', 'd-x':'var(--d-pad-x)', 'd-y':'var(--d-pad-y)' },
      height:{ row:'var(--d-row)', tap:'var(--d-tap)' },
      minHeight:{ tap:'var(--d-tap)' },
      borderRadius:{ d:'var(--d-radius)' },
    },
  },
  plugins: [],
};
