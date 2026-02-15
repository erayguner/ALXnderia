import type { Metadata } from 'next';
import { Sidebar } from '../src/client/components/Sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alxderia — Cloud Identity Intelligence',
  description: 'Natural language access intelligence for AWS and GCP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-100 antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 flex flex-col">{children}</main>
        </div>
      </body>
    </html>
  );
}
