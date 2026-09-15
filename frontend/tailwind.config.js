/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors')

module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // v2 design-system palette — softer green, flatter dark-navy surfaces.
        brand: {
          50:  "#eafbf2",
          100: "#d3f5e3",
          500: "#35d07f",
          600: "#2ab967",
          700: "#1f9e5c",
        },
        dark: {
          900: "#090d15",
          800: "#111826",
          700: "#1c2436",
          600: "#28334a",
        },
        bad:  { 500: "#ef6a6a" },
        warn: { 500: "#e8b84b" },
        // Remap dim slate shades to more readable values for this dark-theme app.
        // On dark-800 background, contrast ratios:
        //   slate-400 (#94a3b8) = 4.7:1  ✓ passes AA
        //   slate-500 (#64748b) = 3.1:1  ✗ borderline (was too dim)
        //   slate-600 (#475569) = 2.3:1  ✗ fails (was invisible)
        // After remap:
        //   text-slate-500 → #94a3b8 (was slate-400) — readable label text
        //   text-slate-600 → #64748b (was slate-500) — readable secondary text
        slate: {
          ...colors.slate,
          500: colors.slate[400],  // #94a3b8  (bumped up one step)
          600: colors.slate[500],  // #64748b  (bumped up one step)
        },
      },
      backgroundImage: {
        "hero-glow": "radial-gradient(1200px 600px at 80% -10%, rgba(53,208,127,0.06), transparent 60%)",
      },
    },
  },
  plugins: [],
}

