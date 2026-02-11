import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts}",
  ],
  safelist: [
    // Ensure semantic color classes are always generated
    "bg-success",
    "bg-warning",
    "bg-caution",
    "bg-destructive",
    "text-success",
    "text-warning",
    "text-caution",
    "text-destructive",
    "text-link",
    "bg-success/10",
    "bg-warning/10",
    "bg-caution/10",
    "bg-destructive/10",
    "border-caution/30",
    // Surface tints
    "bg-info-tint",
    "bg-success-tint",
    "bg-warning-tint",
    "bg-danger-tint",
    "bg-ai-tint",
    "bg-risk-tint",
    "bg-data-tint",
    "bg-policy-tint",
  ],
  theme: {
    extend: {
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
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        caution: {
          DEFAULT: "hsl(var(--caution))",
          foreground: "hsl(var(--caution-foreground))",
        },
        link: "hsl(var(--link))",
        // Surface tints for semantic states
        "info-tint": "hsl(var(--info-tint))",
        "success-tint": "hsl(var(--success-tint))",
        "warning-tint": "hsl(var(--warning-tint))",
        "danger-tint": "hsl(var(--danger-tint))",
        "ai-tint": "hsl(var(--ai-tint))",
        "risk-tint": "hsl(var(--risk-tint))",
        "data-tint": "hsl(var(--data-tint))",
        "policy-tint": "hsl(var(--policy-tint))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
