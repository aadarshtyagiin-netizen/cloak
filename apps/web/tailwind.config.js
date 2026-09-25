/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand accent = Discord "blurple", tuned across the ramp.
        brand: {
          50: '#eef0fe',
          100: '#e0e3fd',
          200: '#c4c9fb',
          300: '#a3abf8',
          400: '#818cf8',
          500: '#5865f2',
          600: '#4752c4',
          700: '#3c45a5',
          800: '#333a86',
          900: '#2c316d',
        },
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        'surface-3': 'rgb(var(--surface-3) / <alpha-value>)',
        'surface-4': 'rgb(var(--surface-4) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-soft': 'rgb(var(--ink-soft) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        positive: 'rgb(var(--positive) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        pop: '0 12px 32px -8px hsl(var(--shadow-color) / 0.45), 0 2px 8px -2px hsl(var(--shadow-color) / 0.3)',
        'pop-lg': '0 24px 64px -12px hsl(var(--shadow-color) / 0.5), 0 4px 12px -4px hsl(var(--shadow-color) / 0.35)',
      },
      keyframes: {
        'pop-in': {
          '0%': { transform: 'scale(0.96) translateY(4px)', opacity: '0' },
          '100%': { transform: 'scale(1) translateY(0)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'speaking-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(var(--positive) / 0.55)' },
          '50%': { boxShadow: '0 0 0 5px rgb(var(--positive) / 0)' },
        },
      },
      animation: {
        'pop-in': 'pop-in 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slide-up 0.2s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'speaking-ring': 'speaking-ring 1.4s ease-out infinite',
      },
    },
  },
  plugins: [],
};
