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
      <body className="bg-ons-black antialiased" suppressHydrationWarning>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex flex-col min-w-0">
            <header className="flex-shrink-0 flex items-center justify-end px-6 py-3 bg-ons-grey-100/80 backdrop-blur-sm border-b border-ons-grey-100 z-10">
              <UserBadge />
            </header>
            <div className="flex-1 flex flex-col overflow-y-auto">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
