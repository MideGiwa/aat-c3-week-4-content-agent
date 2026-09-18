import type { Config } from "tailwindcss";

// Neutral, brand-agnostic palette per DESIGN.md — swap `accent` for Koya
// Talent's brand color once it's provided (see BUSINESS-QUESTIONS.md).
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          50: "#eef2ff",
          100: "#e0e7ff",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
        },
      },
    },
  },
  plugins: [],
};

export default config;
