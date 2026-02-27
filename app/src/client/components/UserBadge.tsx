'use client';

export function UserBadge() {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium text-ons-text-headline">Northwind Holdings</p>
        <p className="text-xs text-ons-text-secondary">analyst@demo-example.co.uk</p>
      </div>
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ons-blue to-ons-cyan text-ons-text-primary flex items-center justify-center text-sm font-medium shadow-sm">
        A
      </div>
    </div>
  );
}
