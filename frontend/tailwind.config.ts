import type { Config } from "tailwindcss";

// Neutral, brand-agnostic palette per DESIGN.md — swap `accent` for Koya
// Talent's brand color once it's provided (see BUSINESS-QUESTIONS.md).
//
// Extended 2026-09-18 (UI polish pass, user-requested: "better ui. Buttons,
// colors, checkboxes, dropdowns, date picker, etc") — the accent scale
// previously stopped at 700 with no 400/800/900, which meant every
// hover/active/focus-ring state on a button or control had to reach for an
// off-scale value or reuse 700 for everything. Filled in the full 50-900
// ramp so components (src/components/ui/*) have a real scale to draw
// hover/active/disabled states from instead of guessing. Values are a
// standard indigo ramp — same hue family the app already used, just
// completed — so this is additive, not a re-theme; every existing
// `accent-*` class in the app still resolves to the same colors as before.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
      },
    },
  },
  plugins: [],
};

export default config;
