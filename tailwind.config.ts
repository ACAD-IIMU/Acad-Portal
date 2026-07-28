import type { Config } from 'tailwindcss';

// Color tokens match the finalized demo HTML (Change Log #10) — extracted from the real ACAD logo.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#221a1c',
        inkSoft: '#5c5254',
        inkFaint: '#948a8c',
        line: '#ece0e1',
        cream: '#faf6f5',
        brand: {
          950: '#2a0f16',
          900: '#4d1721',
          800: '#7a2331',
          700: '#c33249',
          100: '#f7e0e4',
          50: '#fcf0f1'
        },
        gold: {
          600: '#b9762e',
          500: '#e8a94c',
          100: '#fbe8d2'
        },
        plum: '#702c4e',
        danger: {
          DEFAULT: '#c1502e',
          100: '#f9e6dc'
        }
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Public Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      },
      borderRadius: {
        card: '14px'
      }
    }
  },
  plugins: []
};
export default config;
