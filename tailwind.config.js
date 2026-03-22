/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        elevated: 'var(--elevated)',
        accent: 'var(--accent)',
        'accent-dim': 'var(--accent-dim)',
        't1': 'var(--text-1)',
        't2': 'var(--text-2)',
        't3': 'var(--text-3)',
        border: 'var(--border)',
      },
      borderRadius: {
        theme: 'var(--radius)',
      },
      fontFamily: {
        display: ['Clash Display', 'system-ui', 'sans-serif'],
        body: ['Satoshi', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
