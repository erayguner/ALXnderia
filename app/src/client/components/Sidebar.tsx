'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: 'Chat', icon: '\uD83D\uDCAC' },
  { href: '/analytics', label: 'Analytics', icon: '\uD83D\uDCCA' },
  { href: '/people', label: 'People', icon: '\uD83D\uDC64' },
  { href: '/resources', label: 'Resources', icon: '\u2601\uFE0F' },
  { href: '/accounts', label: 'Accounts', icon: '\uD83C\uDFE6' },
  { href: '/groups', label: 'Groups', icon: '\uD83D\uDC65' },
  { href: '/access', label: 'Access Explorer', icon: '\uD83D\uDD11' },
  { href: '/audit', label: 'Audit Log', icon: '\uD83D\uDCCB' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed(prev => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  };

  return (
    <aside
      className={`${
        collapsed ? 'w-16' : 'w-56'
      } bg-ons-night-blue text-ons-grey-35 flex flex-col h-screen flex-shrink-0 transition-all duration-200 ease-in-out`}
    >
      {/* Header */}
      <div className="px-3 py-5 border-b border-ons-ocean-blue/30 flex items-center justify-between">
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white tracking-tight truncate">ALXnderia</h1>
            <p className="text-xs text-ons-grey-75 mt-0.5">Cloud Identity Intelligence</p>
          </div>
        )}
        <button
          onClick={toggle}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-ons-ocean-blue/30 text-ons-grey-75 hover:text-ons-grey-35 transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`w-4 h-4 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
          >
            <path
              fillRule="evenodd"
              d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-ons-sky-blue/15 text-ons-sky-blue border-l-2 border-ons-sky-blue'
                  : 'hover:bg-ons-ocean-blue/20 hover:text-ons-grey-5 border-l-2 border-transparent'
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer status */}
      <div className={`px-4 py-4 border-t border-ons-ocean-blue/30 ${collapsed ? 'flex justify-center px-0' : ''}`}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-ons-spring-green animate-pulse flex-shrink-0" />
          {!collapsed && <span className="text-xs text-ons-grey-75">Connected</span>}
        </div>
      </div>
    </aside>
  );
}
