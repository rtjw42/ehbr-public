import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  prefix: "",
  future: {
    // Wraps EVERY `hover:` utility in `@media (hover: hover)`.
    //
    // On a touch device `:hover` is STICKY — it latches on tap and stays until you
    // tap elsewhere. Since this app's hover state is `--interactive-bg` (near-black
    // with inverted text), a tapped button sat there looking black afterwards. Most
    // visible on the controls people tap most: the form's footer Cancel/Back
    // (`ghost`) and the nav/dialog/FormShell icon buttons.
    //
    // Tailwind's own flag rather than a bespoke variant: it covers every utility at
    // once (buttons, day cells, field rows, wheel rows) with no per-class churn, and
    // it is the DEFAULT in Tailwind v4 — so this is the upgrade path, not a detour.
    // Hand-written CSS is NOT covered; `.btn-interactive:hover` is guarded directly
    // in globals.css.
    //
    // Tailwind emits `@media (hover: hover) and (pointer: fine)` — the same query
    // `slider.tsx` / `time-wheel.tsx` already hand-rolled, so those stay consistent
    // rather than being redundant-but-different.
    //
    // Known limit: a hybrid laptop with a touchscreen reports a fine pointer (a mouse
    // exists), so a finger tap there can still latch. No CSS-only fix for that.
    hoverOnlyWhenSupported: true,
  },
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // Motion design system — token classes (duration-base, ease-standard, …)
      // backed by the CSS variables in tokens.css. Use these instead of
      // duration-150/200/300 and ad-hoc ease values.
      transitionDuration: {
        tap: "var(--duration-tap)",
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        exit: "var(--ease-exit)",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        interactive: {
          DEFAULT: "var(--interactive-bg)",
          hover: "var(--interactive-bg-hover)",
          text: "var(--interactive-text)",
          border: "var(--interactive-border)",
        },
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      fontFamily: {
        sans: ["OutfitVariable", "Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["FrauncesVariable", "Fraunces", "ui-serif", "Georgia", "serif"],
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
