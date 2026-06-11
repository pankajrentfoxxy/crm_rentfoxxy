/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0D9488',
          dark: '#0F766E',
          light: '#14B8A6'
        }
      }
    }
  },
  plugins: []
};
