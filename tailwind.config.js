/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#202622",
        muted: "#68716b",
        paper: "#f4f6f2",
        surface: "#fbfcf8",
        "surface-strong": "#ffffff",
        tomato: "#c44a3f",
        moss: "#2f6f5e",
        fern: "#dce8df",
        amber: "#b36b2c",
        line: "#d9ded6",
        "line-strong": "#c7cec5",
      },
      fontFamily: {
        sans: ["Aptos", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["Cascadia Mono", "Consolas", "monospace"],
      },
      boxShadow: {
        panel: "0 14px 34px rgba(32, 38, 34, 0.08)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.82)",
      },
    },
  },
  plugins: [],
};
