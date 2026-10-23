/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        pass: "rgb(var(--pass) / <alpha-value>)",
        fail: "rgb(var(--fail) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        nano: "rgb(var(--nano) / <alpha-value>)",
        super: "rgb(var(--super) / <alpha-value>)",
        ultra: "rgb(var(--ultra) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "JetBrains Mono", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        glow: {
          "0%,100%": { boxShadow: "0 0 0 0 rgb(var(--pass) / 0.0)" },
          "50%": { boxShadow: "0 0 24px 2px rgb(var(--pass) / 0.35)" },
        },
        flip: { from: { transform: "rotateX(90deg)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: {
        rise: "rise 300ms ease-out both",
        glow: "glow 2.4s ease-in-out 2",
        flip: "flip 350ms ease-out both",
        pulseDot: "pulseDot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
