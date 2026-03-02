'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'solarized-dark' | 'solarized-light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'solarized-dark',
  setTheme: () => {},
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'solarized-dark';
  // Read what the blocking <head> script already resolved — avoids hydration mismatch
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'solarized-light' || attr === 'solarized-dark') return attr;
  const stored = localStorage.getItem('alx-theme');
  if (stored === 'solarized-light' || stored === 'solarized-dark') return stored;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'solarized-light';
  return 'solarized-dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const applyTheme = useCallback((t: Theme) => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('alx-theme', t);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
  }, [applyTheme]);

  const toggle = useCallback(() => {
    setTheme(theme === 'solarized-dark' ? 'solarized-light' : 'solarized-dark');
  }, [theme, setTheme]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('alx-theme')) {
        setTheme(e.matches ? 'solarized-light' : 'solarized-dark');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
