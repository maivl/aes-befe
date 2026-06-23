/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f5fdf6",
          100: "#e6faec",
          200: "#c9f3d6",
          300: "#9be7b4",
          400: "#63d388",
          500: "#38b867",
          600: "#269a51",
          700: "#1f7a43",
          800: "#1e6138",
          900: "#1b5030",
          950: "#0a2c19",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
