'use client';

export function UserBadge() {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium text-slate-700">Northwind Holdings</p>
        <p className="text-xs text-slate-500">analyst@demo-example.co.uk</p>
      </div>
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-sm font-medium shadow-sm">
        A
      </div>
    </div>
  );
}
