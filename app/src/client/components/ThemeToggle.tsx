'use client';

import { useState, useEffect } from 'react';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isLight = theme === 'solarized-light';

  return (
    <button
      onClick={toggle}
      className="relative w-8 h-8 flex items-center justify-center rounded-lg text-ons-text-secondary hover:text-ons-text-primary hover:bg-ons-surface-hover transition-colors duration-150"
      aria-label={mounted ? `Switch to ${isLight ? 'dark' : 'light'} theme` : 'Toggle theme'}
      title={mounted ? `Switch to ${isLight ? 'Solarized Dark' : 'Solarized Light'}` : 'Toggle theme'}
    >
      {/* Sun icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`w-[18px] h-[18px] absolute transition-all duration-300 ${
          mounted
            ? isLight ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-75'
            : 'opacity-0'
        }`}
      >
        <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.061l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.061l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0118 10zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06L5.403 4.343a.75.75 0 00-1.06 1.06l1.06 1.06z" />
      </svg>
      {/* Moon icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`w-[18px] h-[18px] absolute transition-all duration-300 ${
          mounted
            ? isLight ? 'opacity-0 -rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100'
            : 'opacity-0'
        }`}
      >
        <path fillRule="evenodd" d="M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z" clipRule="evenodd" />
      </svg>
    </button>
  );
}
