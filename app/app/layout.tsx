import type { Metadata } from 'next';
import { Sidebar } from '../src/client/components/Sidebar';
import { UserBadge } from '../src/client/components/UserBadge';
import { ThemeProvider } from '../src/client/components/ThemeProvider';
import { ThemeToggle } from '../src/client/components/ThemeToggle';
import './globals.css';

export const metadata: Metadata = {
  title: 'ALXnderia — Cloud Identity Intelligence',
  description: 'Natural language access intelligence for AWS and GCP',
};

/**
 * Blocking inline script that runs before first paint to set data-theme
 * and avoid a flash-of-unstyled-content (FOUC).
 */
const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('alx-theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'solarized-light' : 'solarized-dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch(e){}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-ons-bg antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 flex flex-col min-w-0">
              <header className="flex-shrink-0 flex items-center justify-end gap-2 px-6 py-3 bg-ons-bg-elevated/30 backdrop-blur-sm border-b border-ons-border/20 z-10">
                <ThemeToggle />
                <UserBadge />
              </header>
              <div className="flex-1 flex flex-col overflow-y-auto">{children}</div>
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
