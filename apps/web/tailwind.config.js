/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'open-sauce': ['Open Sauce One', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        ginto:        ['ABC Ginto Rounded', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        'brand-black': '#111827',
        'brand-grey': '#6B7280',
        'brand-white': '#F9FAFB',
        'brand-light-bg': '#eaf9ec',
        'brand-green': '#78d870',
        'brand-dark-green': '#2f7a3e',
        'brand-bg': '#ffffff',
        // The built-in Owner alias — the one thing in People & access you cannot change.
        'brand-gold': '#b4881b',
        'brand-gold-soft': '#fdf6e3',
      },
      boxShadow: {
        'soft': '0 8px 24px rgba(0,0,0,0.06)',
        'float': '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
};
