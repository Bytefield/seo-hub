/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono:    ['Geist Mono', 'monospace'],
        display: ['DM Serif Display', 'serif'],
        ui:      ['DM Sans', 'sans-serif'],
      },
      colors: {
        accent:  '#f97316',
        green:   '#10d9a0',
        red:     '#f43f5e',
        yellow:  '#f59e0b',
        blue:    '#38bdf8',
        purple:  '#a78bfa',
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'blink':     'blink 2s infinite',
      },
    },
  },
  plugins: [],
}
