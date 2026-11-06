/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paypal: {
          blue: '#003087',
          lightBlue: '#0079C1',
          dark: '#001C3D',
        }
      }
    },
  },
  plugins: [],
}

