import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // Valores vêm de CSS vars (src/index.css) p/ suportar tema claro/escuro.
      colors: {
        bg: {
          primary: "rgb(var(--c-bg-primary) / <alpha-value>)",
          surface: "rgb(var(--c-bg-surface) / <alpha-value>)",
          elevated: "rgb(var(--c-bg-elevated) / <alpha-value>)",
        },
        border: {
          subtle: "rgb(var(--c-border-subtle) / <alpha-value>)",
          DEFAULT: "rgb(var(--c-border) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          hover: "rgb(var(--c-accent-hover) / <alpha-value>)",
          muted: "rgb(var(--c-accent) / 0.125)",
        },
        /** Roxo do gradiente de ondas — o que está "ligado" (ver .btn-primary,
         *  [aria-pressed], .neon). */
        selected: {
          DEFAULT: "rgb(var(--c-selected) / <alpha-value>)",
          deep: "rgb(var(--c-selected-deep) / <alpha-value>)",
        },
        text: {
          primary: "rgb(var(--c-text-primary) / <alpha-value>)",
          secondary: "rgb(var(--c-text-secondary) / <alpha-value>)",
          muted: "rgb(var(--c-text-muted) / <alpha-value>)",
        },
        /** Realce neutro de hover — clareia no tema escuro, escurece no claro. */
        overlay: "rgb(var(--c-overlay) / <alpha-value>)",
        success: "rgb(var(--c-success) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
        warning: "rgb(var(--c-warning) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "-apple-system", "sans-serif"],
        mono: ["Cascadia Code", "Consolas", "monospace"],
      },
      borderRadius: {
        glass: "1rem",
      },
      boxShadow: {
        glass: "var(--glass-shadow)",
        "glass-lg": "var(--glass-shadow-lg)",
        glow: "0 0 0 1px rgb(var(--c-accent) / 0.35), 0 8px 28px rgb(var(--c-accent) / 0.28)",
      },
      keyframes: {
        "fade-rise": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        "fade-rise": "fade-rise 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        float: "float 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
