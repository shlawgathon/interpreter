import type { Config } from "tailwindcss";

const preset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        brand: {
          primary: {
            DEFAULT: "#4F46E5",
            light: "#818CF8",
            dark: "#3730A3",
          },
          accent: {
            DEFAULT: "#F59E0B",
            warm: "#FB7185",
          },
        },
        surface: {
          light: {
            DEFAULT: "#FFFFFF",
            raised: "#F1F5F9",
            bg: "#F8FAFC",
          },
          dark: {
            DEFAULT: "#0F172A",
            raised: "#1E293B",
            bg: "#020617",
          },
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "ui-monospace",
          "monospace",
        ],
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": {
            boxShadow: "0 0 4px rgba(245, 158, 11, 0.3)",
          },
          "50%": {
            boxShadow: "0 0 16px rgba(245, 158, 11, 0.6)",
          },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "eq-bar": {
          "0%, 100%": { height: "4px" },
          "50%": { height: "16px" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.3s ease-out",
        "eq-bar": "eq-bar 0.6s ease-in-out infinite",
      },
    },
  },
};

export default preset;
