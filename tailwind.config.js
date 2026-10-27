/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg))',
        panel: 'hsl(var(--panel))',
        raised: 'hsl(var(--raised))',
        widget: 'hsl(var(--widget))',
        line: 'hsl(var(--line))',
        fg: 'hsl(var(--fg))',
        dim: 'hsl(var(--dim))',
        faint: 'hsl(var(--faint))',
        accent: 'hsl(var(--accent))',
        danger: 'hsl(var(--danger))',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
