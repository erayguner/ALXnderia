import type { Metadata } from 'next';
import { Sidebar } from '../src/client/components/Sidebar';
import { UserBadge } from '../src/client/components/UserBadge';
import './globals.css';

export const metadata: Metadata = {
  title: 'ALXnderia — Cloud Identity Intelligence',
  description: 'Natural language access intelligence for AWS and GCP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 flex flex-col">
            <header className="flex items-center justify-end px-6 py-3 bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10">
              <UserBadge />
            </header>
            <div className="flex-1 flex flex-col">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
