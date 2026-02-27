import type { Config } from 'tailwindcss';

/**
 * Helper: produce a Tailwind colour value that reads a CSS custom property
 * and supports the  /opacity  modifier.
 *   e.g.  bg-ons-bg/50  →  background-color: rgb(var(--ons-bg) / 0.5)
 */
function v(name: string) {
  return `rgb(var(--ons-${name}) / <alpha-value>)`;
}

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ons: {
          /* --- base tones (theme-aware) --- */
          'bg':             v('bg'),
          'bg-elevated':    v('bg-elevated'),
          'surface':        v('surface'),
          'surface-hover':  v('surface-hover'),

          'text-primary':   v('text-primary'),
          'text-headline':  v('text-headline'),
          'text-secondary': v('text-secondary'),
          'text-muted':     v('text-muted'),

          'border':         v('border'),
          'border-subtle':  v('border-subtle'),

          /* --- Solarized accent colours --- */
          'yellow':   v('yellow'),
          'orange':   v('orange'),
          'red':      v('red'),
          'magenta':  v('magenta'),
          'violet':   v('violet'),
          'blue':     v('blue'),
          'cyan':     v('cyan'),
          'green':    v('green'),

          /* --- semantic sidebar --- */
          'sidebar-bg':     v('sidebar-bg'),
          'sidebar-border': v('sidebar-border'),
          'sidebar-active': v('sidebar-active'),

          /* --- card --- */
          'card-bg':        v('card-bg'),
          'card-border':    v('card-border'),

          /* --- bar / chart --- */
          'bar-track':      v('bar-track'),

          /* --- provider branded --- */
          'provider-aws':    v('provider-aws'),
          'provider-google': v('provider-google'),
          'provider-github': v('provider-github'),

          /* ===================================================
           * Legacy ons-* aliases kept for backward-compat.
           * These map to the nearest Solarized equivalent.
           * =================================================== */
          'night-blue':   v('sidebar-bg'),
          'ocean-blue':   v('blue'),
          'sky-blue':     v('cyan'),
          'spring-green': v('green'),
          'aqua-teal':    v('cyan'),
          'leaf-green':   v('green'),
          'ruby-red':     v('red'),
          'jaffa-orange': v('orange'),
          'sun-yellow':   v('yellow'),
          'neon-yellow':  v('yellow'),
          'black':        v('bg'),
          'grey-100':     v('surface'),
          'grey-75':      v('text-muted'),
          'grey-35':      v('text-secondary'),
          'grey-15':      v('text-headline'),
          'grey-5':       v('text-primary'),
        },
      },
    },
  },
  plugins: [],
};

export default config;
