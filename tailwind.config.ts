import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Lipids scientific-neutral palette
        bone: "#F5F3EF",
        "off-white": "#F7F6F3",
        paper: "#EFEDE7",
        stone: {
          50: "#F7F6F3",
          100: "#EFEDE7",
          200: "#E2DED4",
          300: "#CBC5B6",
          400: "#A9A192",
          500: "#87806F",
          600: "#69624F",
          700: "#4E4839",
          800: "#332F26",
          900: "#1C1A15",
        },
        ink: "#0A0A08",
        carbon: "#141412",
        signal: "#5C6B4F",
      },
      fontFamily: {
        display: ["var(--font-display)", "Helvetica Neue", "Arial", "sans-serif"],
        body: ["var(--font-body)", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-xl": ["clamp(3.5rem, 10vw, 10rem)", { lineHeight: "0.92", letterSpacing: "-0.03em" }],
        "display-lg": ["clamp(2.75rem, 7vw, 6.5rem)", { lineHeight: "0.94", letterSpacing: "-0.02em" }],
        "display-md": ["clamp(2rem, 4vw, 3.5rem)", { lineHeight: "0.98", letterSpacing: "-0.02em" }],
        micro: ["0.6875rem", { lineHeight: "1.2", letterSpacing: "0.12em" }],
      },
      letterSpacing: {
        widest2: "0.2em",
      },
      spacing: {
        gutter: "clamp(1.25rem, 4vw, 3rem)",
        section: "clamp(5rem, 12vw, 10rem)",
      },
      transitionTimingFunction: {
        cinematic: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: {
        1200: "1200ms",
        900: "900ms",
        700: "700ms",
      },
      animation: {
        "fade-up": "fadeUp 1.1s cubic-bezier(0.22,1,0.36,1) forwards",
        marquee: "marquee 28s linear infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
