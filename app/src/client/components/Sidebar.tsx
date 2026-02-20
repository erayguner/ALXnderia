'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: 'Chat', icon: '\uD83D\uDCAC' },
  { href: '/people', label: 'People', icon: '\uD83D\uDC64' },
  { href: '/resources', label: 'Resources', icon: '\u2601\uFE0F' },
  { href: '/accounts', label: 'Accounts', icon: '\uD83C\uDFE6' },
  { href: '/groups', label: 'Groups', icon: '\uD83D\uDC65' },
  { href: '/access', label: 'Access Explorer', icon: '\uD83D\uDD11' },
  { href: '/audit', label: 'Audit Log', icon: '\uD83D\uDCCB' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-slate-950 text-slate-400 flex flex-col min-h-screen">
      <div className="px-4 py-5 border-b border-slate-800">
        <h1 className="text-lg font-bold text-white tracking-tight">ALXnderia</h1>
        <p className="text-xs text-slate-600 mt-0.5">Cloud Identity Intelligence</p>
      </div>
      <nav className="flex-1 py-3 space-y-0.5">
        {NAV_ITEMS.map(item => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-indigo-600/15 text-indigo-300 border-l-2 border-indigo-400'
                  : 'hover:bg-slate-800/60 hover:text-slate-200 border-l-2 border-transparent'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-slate-600">Connected</span>
        </div>
      </div>
    </aside>
  );
}
