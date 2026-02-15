'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: 'Chat', icon: '\uD83D\uDCAC' },
  { href: '/people', label: 'People', icon: '\uD83D\uDC64' },
  { href: '/resources', label: 'Resources', icon: '\u2601\uFE0F' },
  { href: '/groups', label: 'Groups', icon: '\uD83D\uDC65' },
  { href: '/access', label: 'Access Explorer', icon: '\uD83D\uDD11' },
  { href: '/audit', label: 'Audit Log', icon: '\uD83D\uDCCB' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-gray-900 text-gray-300 flex flex-col min-h-screen">
      <div className="px-4 py-5 border-b border-gray-700">
        <h1 className="text-lg font-bold text-white">Alxderia</h1>
        <p className="text-xs text-gray-500 mt-0.5">Cloud Identity Intelligence</p>
      </div>
      <nav className="flex-1 py-3">
        {NAV_ITEMS.map(item => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition ${
                isActive
                  ? 'bg-gray-800 text-white border-l-2 border-blue-500'
                  : 'hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
