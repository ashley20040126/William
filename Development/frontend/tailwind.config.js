/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#ECEAF6', 2: '#E4E1F2', 3: '#D8D4EE' },
        ink: { DEFAULT: '#1C1830', 2: '#3A3560', 3: '#7A74A8', 4: '#B0AACE' },
        warm: { DEFAULT: '#8B7FCC', 2: '#C0B8E8', light: '#EAE4F8' },
        rose: { DEFAULT: '#C4527A', light: '#F5E8EF' },
        teal: { DEFAULT: '#3A8880', light: '#D8F0EE' },
        gold: { DEFAULT: '#B89020', light: '#F8F0D8' },
        cream: '#FDFBF8',
      },
      fontFamily: {
        heading: ['PeetU', 'Fraunces', 'Georgia', 'serif'],
        body: ['DM Sans', 'system-ui', 'sans-serif'],
        hand: ['Caveat', 'cursive'],
      },
      borderRadius: {
        '2xl': '18px',
        '3xl': '22px',
        '4xl': '26px',
      },
      boxShadow: {
        card: '0 2px 16px rgba(28,24,48,0.06)',
        elevated: '0 4px 28px rgba(28,24,48,0.10)',
      },
      // Mobile safe area
      spacing: {
        safe: 'env(safe-area-inset-bottom, 16px)',
      },
    },
  },
  plugins: [],
};
