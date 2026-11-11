/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        page: '#F6F4EE',
        surface: '#FFFFFF',
        border: '#E4E0D6',
        ink: {
          DEFAULT: '#1C2430',
          muted: '#6B7280',
          subtle: '#9CA3AF'
        },
        accent: {
          DEFAULT: '#14532D',
          hover: '#0F4023',
          light: '#EAF5EE'
        },
        saffron: {
          DEFAULT: '#C98A1B',
          light: '#FEF7EB'
        },
        success: {
          DEFAULT: '#2F7D4F',
          light: '#EAF5EE'
        },
        danger: {
          DEFAULT: '#B4412F',
          light: '#FBEBE8'
        },
        slate: {
          info: '#3D5A80',
          light: '#EDF2F7'
        }
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '10px'
      },
      boxShadow: {
        soft: '0 1px 3px rgba(28, 36, 48, 0.05)',
        floating: '0 8px 30px rgba(28, 36, 48, 0.08)'
      }
    },
  },
  plugins: [],
}
