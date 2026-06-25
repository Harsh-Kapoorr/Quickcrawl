import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Foundation — near-black, slight cool tint, never pure
        bg: {
          DEFAULT: "#08090A",
          subtle: "#0E0F11",
          inset: "#050608",
        },
        surface: {
          DEFAULT: "#0F1012",
          hi: "#141518",
          lo: "#0A0B0D",
        },
        // Borders — 1px hairlines, no shadows
        border: {
          DEFAULT: "rgba(255, 255, 255, 0.08)",
          strong: "rgba(255, 255, 255, 0.14)",
          focus: "rgba(124, 92, 240, 0.55)",
        },
        // Foreground — high-contrast white scale
        fg: {
          DEFAULT: "#E8E9EB",
          muted: "#8E939B",
          faint: "#5C6068",
          inverse: "#08090A",
        },
        // Accent — single violet, like Linear
        accent: {
          DEFAULT: "#7C5CF0",
          hi: "#9484F5",
          lo: "#5B41C2",
          glow: "rgba(124, 92, 240, 0.14)",
        },
        // Status — restrained, used sparingly
        ok: "#4CB782",
        warn: "#E2B341",
        err: "#E5484D",
        info: "#6E7AD3",
      },
      fontFamily: {
        sans: [
          "var(--font-geist)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        xs: ["0.6875rem", { lineHeight: "1.4" }],
        sm: ["0.8125rem", { lineHeight: "1.5" }],
        base: ["0.875rem", { lineHeight: "1.55" }],
        md: ["0.9375rem", { lineHeight: "1.55" }],
        lg: ["1.0625rem", { lineHeight: "1.45" }],
        xl: ["1.25rem", { lineHeight: "1.35" }],
        "2xl": ["1.5rem", { lineHeight: "1.25" }],
        "3xl": ["1.875rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        "4xl": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter: "-0.025em",
        tight: "-0.015em",
      },
      borderRadius: {
        sm: "0.25rem",
        DEFAULT: "0.375rem",
        md: "0.5rem",
        lg: "0.625rem",
        xl: "0.75rem",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out both",
        "pulse-soft": "pulse-soft 1.8s ease-in-out infinite",
        "spin-slow": "spin-slow 1.2s linear infinite",
      },
      backgroundImage: {
        "gradient-accent":
          "linear-gradient(180deg, rgba(124, 92, 240, 0.16) 0%, rgba(124, 92, 240, 0) 100%)",
        "gradient-edge":
          "linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0) 100%)",
      },
      transitionTimingFunction: {
        snappy: "cubic-bezier(0.2, 0.0, 0.0, 1.0)",
      },
    },
  },
  plugins: [],
};

export default config;