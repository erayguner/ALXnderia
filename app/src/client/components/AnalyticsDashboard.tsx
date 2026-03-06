'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

// --- Types ---

interface Summary {
  totalUsers: number;
  totalAccessGrants: number;
  totalResources: number;
  providerCount: number;
}

interface ProviderRow {
  provider_type?: string;
  provider?: string;
  user_count: number;
  grant_count?: number;
  resource_count?: number;
}

interface AccessPathRow {
  access_path: string;
  count: number;
}

interface RoleRow {
  role_or_permission: string;
  provider: string;
  grant_count: number;
}

interface ResourceRow {
  resource_display_name: string;
  provider: string;
  resource_type: string;
  grant_count: number;
  unique_users: number;
}

interface CoverageRow {
  link_count: number;
  user_count: number;
}

interface GroupRow {
  group_name: string;
  provider: string;
  member_count: number;
}

interface ReconciliationRow {
  status: string;
  count: number;
}

interface IngestionRow {
  provider: string;
  entity_type: string;
  status: string;
  records_upserted: number;
  records_deleted: number;
  started_at: string;
  finished_at: string | null;
}

interface SuspendedRow {
  provider: string;
  status_label: string;
  user_count: number;
  total_users: number;
}

interface GithubOrgMemberRow {
  org_login: string;
  org_name: string | null;
  role: string;
  member_count: string | number;
}

interface GithubExternalCollabRow {
  login: string;
  user_name: string | null;
  repo_name: string;
  permission: string;
  visibility: string;
}

interface SuspendedAccessRow {
  canonical_user_id: string;
  full_name: string | null;
  primary_email: string | null;
  provider: string;
  status_label: string;
  active_grants: number;
}

interface AnalyticsData {
  summary: Summary;
  providerBreakdown: ProviderRow[];
  accessByProvider: ProviderRow[];
  accessPathBreakdown: AccessPathRow[];
  topRoles: RoleRow[];
  topResources: ResourceRow[];
  identityCoverage: CoverageRow[];
  groupSizes: GroupRow[];
  reconciliationStatus: ReconciliationRow[];
  recentIngestion: IngestionRow[];
  githubOrgMembers: GithubOrgMemberRow[];
  githubExternalCollabs: GithubExternalCollabRow[];
  suspendedUsers: SuspendedRow[];
  suspendedWithAccess: SuspendedAccessRow[];
}

// --- Colour helpers ---

const PROVIDER_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  aws: { bg: 'bg-ons-jaffa-orange/10', text: 'text-ons-jaffa-orange', bar: 'bg-ons-jaffa-orange' },
  AWS_IDENTITY_CENTER: { bg: 'bg-ons-jaffa-orange/10', text: 'text-ons-jaffa-orange', bar: 'bg-ons-jaffa-orange' },
  gcp: { bg: 'bg-ons-sky-blue/10', text: 'text-ons-sky-blue', bar: 'bg-ons-sky-blue' },
  GCP: { bg: 'bg-ons-sky-blue/10', text: 'text-ons-sky-blue', bar: 'bg-ons-sky-blue' },
  google: { bg: 'bg-ons-ruby-red/10', text: 'text-ons-ruby-red', bar: 'bg-ons-ruby-red' },
  GOOGLE_WORKSPACE: { bg: 'bg-ons-ruby-red/10', text: 'text-ons-ruby-red', bar: 'bg-ons-ruby-red' },
  github: { bg: 'bg-ons-grey-100/60', text: 'text-ons-grey-15', bar: 'bg-ons-grey-35' },
  GITHUB: { bg: 'bg-ons-grey-100/60', text: 'text-ons-grey-15', bar: 'bg-ons-grey-35' },
};

function providerStyle(p: string) {
  return PROVIDER_COLORS[p] ?? { bg: 'bg-ons-grey-100/60', text: 'text-ons-grey-35', bar: 'bg-ons-grey-75' };
}

function providerLabel(p: string): string {
  const map: Record<string, string> = {
    AWS_IDENTITY_CENTER: 'AWS IDC',
    GOOGLE_WORKSPACE: 'Google',
    GITHUB: 'GitHub',
    aws: 'AWS',
    gcp: 'GCP',
    google: 'Google',
    github: 'GitHub',
  };
  return map[p] ?? p;
}

// --- Sub-components ---

function StatCard({ label, value, sub, delay = 0, href }: { label: string; value: string | number; sub?: string; delay?: number; href?: string }) {
  const content = (
    <>
      <p className="text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.1em]">{label}</p>
      <p className="text-[1.75rem] font-bold text-ons-grey-5 mt-1.5 tabular-nums leading-none tracking-tight">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-xs text-ons-grey-75 mt-2 leading-relaxed">{sub}</p>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="card-glass p-5 animate-fade-up hover:ring-1 hover:ring-ons-sky-blue/40 transition-all duration-150 cursor-pointer"
        style={{ animationDelay: `${delay}ms` }}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      className="card-glass p-5 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      {content}
    </div>
  );
}

function HorizontalBar({ label, value, max, color, href }: { label: string; value: number; max: number; color: string; href?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;

  const labelEl = href ? (
    <Link
      href={href}
      className="w-36 truncate text-ons-sky-blue text-xs hover:text-ons-aqua-teal hover:underline transition-colors duration-150"
      title={label}
      onClick={e => e.stopPropagation()}
    >
      {label}
    </Link>
  ) : (
    <span className="w-36 truncate text-ons-grey-35 text-xs group-hover:text-ons-grey-15 transition-colors duration-150" title={label}>
      {label}
    </span>
  );

  return (
    <div className="flex items-center gap-3 text-sm group">
      {labelEl}
      <div className="flex-1 h-1.5 bg-ons-bar-track/20 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{
            width: `${pct}%`,
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
      <span className="w-12 text-right text-ons-grey-15 font-semibold tabular-nums text-xs">{value.toLocaleString()}</span>
    </div>
  );
}

function ProviderLogo({ provider, size = 20 }: { provider: string; size?: number }) {
  const key = (provider ?? '').toLowerCase().replace('_identity_center', '').replace('_workspace', '');
  switch (key) {
    case 'aws':
      return (
        <svg width={size} height={size} viewBox="0 0 256 153" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
          <path d="M72.4 90.4c0 3.4.4 6.2 1 8.2.7 2 1.6 4.2 2.8 6.6.5.8.6 1.6.6 2.3 0 1-.6 2-1.9 3l-6.3 4.2c-.9.6-1.8.9-2.6.9-1 0-2-.5-3-1.4-1.4-1.5-2.6-3-3.6-4.6-1-1.7-2-3.6-3.1-5.9-7.8 9.2-17.6 13.8-29.4 13.8-8.4 0-15.1-2.4-20-7.2-4.9-4.8-7.4-11.2-7.4-19.2 0-8.5 3-15.4 9.1-20.6 6.1-5.2 14.2-7.8 24.5-7.8 3.4 0 6.9.3 10.6.8 3.7.5 7.5 1.3 11.5 2.2v-7.3c0-7.6-1.6-12.9-4.7-16-3.2-3.1-8.6-4.6-16.3-4.6-3.5 0-7.1.4-10.8 1.3-3.7.9-7.3 2-10.8 3.4-1.6.7-2.8 1.1-3.5 1.3-.7.2-1.2.3-1.6.3-1.4 0-2.1-1-2.1-3.1v-4.9c0-1.6.2-2.8.7-3.5.5-.7 1.4-1.4 2.8-2.1 3.5-1.8 7.7-3.3 12.6-4.5 4.9-1.3 10.1-1.9 15.6-1.9 11.9 0 20.6 2.7 26.2 8.1 5.5 5.4 8.3 13.6 8.3 24.6v32.4h.1zm-40.6 15.2c3.3 0 6.7-.6 10.3-1.8 3.6-1.2 6.8-3.4 9.5-6.4 1.6-1.9 2.8-4 3.4-6.4.6-2.4 1-5.3 1-8.7v-4.2c-2.9-.7-6-1.3-9.2-1.7-3.2-.4-6.3-.6-9.4-.6-6.7 0-11.6 1.3-14.9 4-3.3 2.7-4.9 6.5-4.9 11.5 0 4.7 1.2 8.2 3.7 10.6 2.4 2.5 5.9 3.7 10.5 3.7zm80.3 10.8c-1.8 0-3-.3-3.8-1-.8-.6-1.5-2-2.1-3.9L87.8 41.3c-.6-2-.9-3.3-.9-4 0-1.6.8-2.5 2.4-2.5h9.8c1.9 0 3.2.3 3.9 1 .8.6 1.4 2 2 3.9l12.4 48.8 11.5-48.8c.5-2 1.1-3.3 1.9-3.9.8-.6 2.2-1 4-1h8c1.9 0 3.2.3 4 1 .8.6 1.5 2 1.9 3.9l11.6 49.4 12.8-49.4c.6-2 1.3-3.3 2-3.9.8-.6 2.1-1 3.9-1h9.3c1.6 0 2.5.8 2.5 2.5 0 .5-.1 1-.2 1.6-.1.6-.3 1.4-.7 2.5l-18.6 70.3c-.6 2-1.3 3.3-2.1 3.9-.8.6-2.1 1-3.8 1h-8.6c-1.9 0-3.2-.3-4-1-.8-.7-1.5-2-1.9-4l-11.4-47.6-11.3 47.5c-.5 2-1.1 3.3-1.9 4-.8.7-2.2 1-4 1h-8.6zm128.5 2.7c-5.2 0-10.4-.6-15.4-1.8-5-1.2-8.9-2.5-11.5-4-1.6-.9-2.7-1.9-3.1-2.8-.4-.9-.6-1.9-.6-2.8v-5.1c0-2.1.8-3.1 2.3-3.1.6 0 1.2.1 1.8.3.6.2 1.5.5 2.5 1 3.4 1.5 7.1 2.7 11 3.5 4 .8 7.9 1.2 11.9 1.2 6.3 0 11.2-1.1 14.6-3.3 3.4-2.2 5.2-5.4 5.2-9.5 0-2.8-.9-5.1-2.7-7-1.8-1.9-5.2-3.6-10.1-5.2l-14.5-4.5c-7.3-2.3-12.7-5.7-16-10.2-3.3-4.4-5-9.3-5-14.5 0-4.2.9-7.9 2.7-11.1 1.8-3.2 4.2-6 7.2-8.2 3-2.3 6.4-4 10.4-5.2 4-1.2 8.2-1.7 12.6-1.7 2.2 0 4.5.1 6.7.4 2.3.3 4.4.7 6.5 1.1 2 .5 3.9 1 5.7 1.6 1.8.6 3.2 1.2 4.2 1.8 1.4.8 2.4 1.6 3 2.5.6.8.9 1.8.9 3.1v4.7c0 2.1-.8 3.2-2.3 3.2-.8 0-2.1-.4-3.8-1.2-5.7-2.6-12.1-3.9-19.2-3.9-5.7 0-10.2.9-13.3 2.8-3.1 1.9-4.7 4.8-4.7 8.9 0 2.8 1 5.2 3 7.1 2 1.9 5.7 3.8 11 5.5l14.2 4.5c7.2 2.3 12.4 5.5 15.5 9.6 3.1 4.1 4.6 8.8 4.6 14 0 4.3-.9 8.2-2.6 11.6-1.8 3.4-4.2 6.4-7.3 8.8-3.1 2.5-6.8 4.3-11.1 5.6-4.5 1.4-9.2 2.1-14.3 2.1z" fill="currentColor" className="text-ons-text-primary"/>
          <path d="M230.9 120.9c-27.1 20-66.3 30.7-100.1 30.7-47.3 0-90-17.5-122.2-46.6-2.5-2.3-.3-5.4 2.8-3.6 34.8 20.2 77.8 32.4 122.3 32.4 30 0 63-6.2 93.3-19.1 4.6-2 8.4 3 3.9 6.2zM242 108.3c-3.5-4.5-23-2.1-31.8-1.1-2.7.3-3.1-2-0.7-3.7 15.6-11 41.1-7.8 44.1-4.1 3 3.7-.8 29.3-15.4 41.6-2.2 1.9-4.4.9-3.4-1.6 3.3-8.2 10.7-26.6 7.2-31.1z" fill="#FF9900"/>
        </svg>
      );
    case 'google':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09A6.97 6.97 0 015.47 12c0-.72.13-1.43.37-2.09V7.07H2.18A11.96 11.96 0 001 12c0 1.94.46 3.77 1.18 5.07l3.66-2.98z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
      );
    case 'github':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 text-ons-grey-15">
          <path d="M12 1.27a11 11 0 00-3.48 21.46c.55.09.73-.28.73-.55v-1.84c-3.03.64-3.67-1.46-3.67-1.46-.55-1.29-1.28-1.65-1.28-1.65-.92-.65.1-.65.1-.65 1.1.09 1.65 1.1 1.65 1.1.92 1.65 2.57 1.2 3.21.92a2.16 2.16 0 01.64-1.47c-2.47-.27-5.04-1.19-5.04-5.5 0-1.1.46-2.1 1.1-2.76a3.55 3.55 0 01.1-2.64s.84-.27 2.75 1.02a9.58 9.58 0 015 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.4.1 2.64.73.73 1.1 1.65 1.1 2.76 0 4.32-2.57 5.23-5.04 5.5.46.37.73 1.01.73 2.1v3.3c0 .27.18.64.73.55A11 11 0 0012 1.27"/>
        </svg>
      );
    default:
      return <span className="w-5 h-5 rounded-full bg-current opacity-70 flex-shrink-0" />;
  }
}

function ProviderBadge({ provider }: { provider: string }) {
  const s = providerStyle(provider);
  return (
    <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-[13px] font-semibold border border-ons-border/20 ${s.bg} ${s.text}`}>
      <ProviderLogo provider={provider} size={18} />
      {providerLabel(provider)}
    </span>
  );
}

function getResourceHref(resource: ResourceRow): string {
  const name = resource.resource_display_name;
  const p = resource.provider?.toLowerCase();
  if (p === 'aws') return `/accounts?provider=aws&search=${encodeURIComponent(name)}`;
  if (p === 'gcp') return `/accounts?provider=gcp&search=${encodeURIComponent(name)}`;
  if (p === 'github') return `/identity-resources?search=${encodeURIComponent(name)}`;
  return `/identity-resources?search=${encodeURIComponent(name)}`;
}

function getGroupHref(group: GroupRow): string {
  return `/groups?search=${encodeURIComponent(group.group_name)}`;
}

function getAccessProviderHref(provider: string): string {
  return `/access?provider=${encodeURIComponent(provider)}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { classes: string; dot: string }> = {
    PENDING: { classes: 'bg-ons-jaffa-orange/10 text-ons-jaffa-orange border-ons-jaffa-orange/20', dot: 'bg-ons-jaffa-orange animate-pulse' },
    RESOLVED: { classes: 'bg-ons-leaf-green/10 text-ons-spring-green border-ons-spring-green/20', dot: 'bg-ons-spring-green' },
    REJECTED: { classes: 'bg-ons-grey-100/40 text-ons-grey-35 border-ons-grey-75/20', dot: 'bg-ons-grey-75' },
    completed: { classes: 'bg-ons-leaf-green/10 text-ons-spring-green border-ons-spring-green/20', dot: 'bg-ons-spring-green' },
    failed: { classes: 'bg-ons-ruby-red/10 text-ons-ruby-red border-ons-ruby-red/20', dot: 'bg-ons-ruby-red' },
    Suspended: { classes: 'bg-ons-ruby-red/10 text-ons-ruby-red border-ons-ruby-red/20', dot: 'bg-ons-ruby-red' },
    Disabled: { classes: 'bg-ons-ruby-red/10 text-ons-ruby-red border-ons-ruby-red/20', dot: 'bg-ons-ruby-red' },
  };
  const s = map[status] ?? { classes: 'bg-ons-jaffa-orange/10 text-ons-jaffa-orange border-ons-jaffa-orange/20', dot: 'bg-ons-jaffa-orange animate-pulse' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${s.classes}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {status}
    </span>
  );
}

function DonutChart({ segments }: { segments: { label: string; value: number; color: string; provider?: string }[] }) {
  const [animated, setAnimated] = useState(false);
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (total === 0) return <p className="text-sm text-ons-grey-75">No data</p>;

  const size = 120;
  const strokeWidth = 16;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const GAP = 3;

  const arcs = segments.reduce<{ pct: number; offset: number; color: string; dashLen: number }[]>((acc, seg, i) => {
    const cumulative = i === 0 ? 0 : segments.slice(0, i).reduce((s, prev) => s + prev.value, 0);
    const pct = seg.value / total;
    const dashLen = Math.max(circumference * pct - GAP, 0);
    const offset = circumference * (1 - cumulative / total);
    acc.push({ pct, offset, color: seg.color, dashLen });
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-ons-bar-track/10" strokeWidth={strokeWidth} />
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${animated ? arc.dashLen : 0} ${circumference - (animated ? arc.dashLen : 0)}`}
            strokeDashoffset={arc.offset}
            className={arc.color}
            style={{
              transition: `stroke-dasharray 900ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 120}ms`,
              filter: 'drop-shadow(0 0 3px currentColor)',
            }}
          />
        ))}
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-ons-grey-5 text-lg font-bold"
          style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}
        >
          {total.toLocaleString()}
        </text>
      </svg>
      <div className="space-y-2">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {seg.provider ? (
              <ProviderLogo provider={seg.provider} size={16} />
            ) : (
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${seg.color.replace('text-', 'bg-')}`} />
            )}
            <span className="text-ons-grey-35 truncate max-w-[100px]">{seg.label}</span>
            <span className="font-semibold text-ons-grey-15 tabular-nums ml-auto">{seg.value.toLocaleString()}</span>
            <span className="text-ons-grey-75 tabular-nums">({Math.round((seg.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuspendedUsersCard({ data: rows, delay }: { data: SuspendedRow[]; delay: number }) {
  const [showNumbers, setShowNumbers] = useState(false);

  if (rows.length === 0) {
    return (
      <Card title="Suspended / Disabled Users" delay={delay}>
        <p className="text-sm text-ons-grey-75">No suspended users found</p>
      </Card>
    );
  }

  const segments: { label: string; value: number; total: number; color: string; provider: string; statusLabel: string }[] = [];
  for (const r of rows) {
    const total = Number(r.total_users) || 0;
    const suspended = Number(r.user_count) || 0;
    const p = (r.provider ?? '').toLowerCase();
    const color = p === 'google' ? 'text-ons-ruby-red' : p === 'aws' ? 'text-ons-jaffa-orange' : 'text-ons-sky-blue';
    segments.push({ label: r.status_label ?? r.provider, value: suspended, total, color, provider: r.provider, statusLabel: r.status_label });
  }

  const totalSuspended = segments.reduce((s, seg) => s + seg.value, 0);
  const totalUsers = segments.reduce((s, seg) => s + seg.total, 0);

  return (
    <Card title="Suspended / Disabled Users" delay={delay}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <DonutChart
            segments={segments.map(s => ({
              label: providerLabel(s.provider),
              value: s.value,
              color: s.color,
              provider: s.provider,
            }))}
          />
          <button
            onClick={() => setShowNumbers(prev => !prev)}
            className="ml-4 flex-shrink-0 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] px-2.5 py-1.5 rounded-md border border-ons-border/20 hover:bg-ons-ocean-blue/15 hover:text-ons-text-primary transition-colors duration-100"
          >
            {showNumbers ? 'Hide' : 'Details'}
          </button>
        </div>
        {showNumbers && (
          <div className="space-y-3 pt-2 border-t border-ons-border/10">
            {segments.map((s, i) => {
              const pct = s.total > 0 ? Math.round((s.value / s.total) * 100) : 0;
              return (
                <div key={`${s.provider}-${i}`} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ProviderBadge provider={s.provider} />
                      <StatusBadge status={s.statusLabel} />
                    </div>
                    <span className="text-sm font-bold text-ons-grey-5 tabular-nums">
                      {s.value.toLocaleString()}
                      <span className="text-xs text-ons-grey-75 font-normal ml-1">/ {s.total.toLocaleString()} ({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-ons-bar-track/20 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-ons-ruby-red"
                      style={{ width: `${pct}%`, transition: 'width 700ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between pt-2 border-t border-ons-border/10">
              <span className="text-xs text-ons-grey-75">Total suspended / disabled</span>
              <span className="text-sm font-bold text-ons-grey-5 tabular-nums">
                {totalSuspended.toLocaleString()}
                <span className="text-xs text-ons-grey-75 font-normal ml-1">/ {totalUsers.toLocaleString()}</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Card({ title, children, className = '', delay = 0 }: { title: string; children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <div
      className={`card-glass animate-fade-up ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="px-5 py-3.5 border-b border-ons-border/10 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-ons-grey-35 uppercase tracking-[0.1em]">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// --- Skeletons ---

function StatCardSkeleton() {
  return (
    <div className="card-glass p-5">
      <div className="skeleton h-2.5 w-20 mb-3" />
      <div className="skeleton h-7 w-16 mb-2" />
      <div className="skeleton h-2.5 w-28" />
    </div>
  );
}

function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card-glass">
      <div className="px-5 py-3.5 border-b border-ons-border/10">
        <div className="skeleton h-2.5 w-32" />
      </div>
      <div className="p-5 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton flex-1 h-1.5" />
            <div className="skeleton h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main component ---

export function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/analytics')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load analytics');
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
          <div>
            <div className="skeleton h-3 w-16 mb-2" />
            <div className="skeleton h-7 w-48" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CardSkeleton rows={4} />
            <CardSkeleton rows={5} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CardSkeleton rows={4} />
            <CardSkeleton rows={3} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-ons-ruby-red">{error ?? 'No data available'}</p>
        </div>
      </div>
    );
  }

  const { summary } = data;

  const totalCoverageUsers = data.identityCoverage.reduce((s, r) => s + Number(r.user_count), 0);
  const usersWithAllProviders = data.identityCoverage
    .filter(r => Number(r.link_count) >= 3)
    .reduce((s, r) => s + Number(r.user_count), 0);
  const coveragePct = totalCoverageUsers > 0 ? Math.round((usersWithAllProviders / totalCoverageUsers) * 100) : 0;

  const reconciliationPending = data.reconciliationStatus
    .filter(r => r.status === 'PENDING')
    .reduce((s, r) => s + Number(r.count), 0);

  const totalSuspended = data.suspendedUsers.reduce((s, r) => s + Number(r.user_count), 0);
  const suspendedWithAccessCount = data.suspendedWithAccess.length;

  // Pre-compute GitHub org member breakdown
  const githubOrgBreakdown = (() => {
    const m = new Map<string, { name: string; admins: number; members: number }>();
    for (const r of data.githubOrgMembers) {
      const key = r.org_login;
      if (!m.has(key)) m.set(key, { name: r.org_name ?? r.org_login, admins: 0, members: 0 });
      const entry = m.get(key)!;
      const n = Number(r.member_count) || 0;
      if (r.role === 'admin') entry.admins += n;
      else entry.members += n;
    }
    return Array.from(m, ([login, v]) => ({ login, ...v, total: v.admins + v.members }));
  })();

  const maxRole = Math.max(...data.topRoles.map(r => Number(r.grant_count)), 1);
  const maxResource = Math.max(...data.topResources.map(r => Number(r.unique_users)), 1);
  const maxGroup = Math.max(...data.groupSizes.map(r => Number(r.member_count)), 1);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Page header */}
        <div className="animate-fade-up">
          <p className="text-[10px] font-semibold text-ons-sky-blue uppercase tracking-[0.15em] mb-1.5">Analytics</p>
          <h2 className="text-2xl font-bold text-ons-grey-5 tracking-tight leading-none">Identity Estate</h2>
          <p className="text-sm text-ons-grey-75 mt-2">Cloud identity posture across all providers</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Canonical Users" value={summary.totalUsers} sub="Unified identities" delay={40} href="/users" />
          <StatCard label="Access Grants" value={summary.totalAccessGrants} sub="Cross-provider" delay={80} href="/access" />
          <StatCard label="Cloud Resources" value={summary.totalResources} sub="Accounts & projects" delay={120} href="/accounts" />
          <StatCard label="Full Coverage" value={`${coveragePct}%`} sub={`${usersWithAllProviders.toLocaleString()} users linked to 3+ providers`} delay={160} href="/users" />
          <StatCard
            label="Suspended Users"
            value={totalSuspended}
            sub={suspendedWithAccessCount > 0 ? `${suspendedWithAccessCount} still have access` : 'No active access'}
            delay={200}
            href="/users"
          />
        </div>

        {/* Row: Provider breakdown + Access path */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Identity Provider Distribution" delay={240}>
            <DonutChart
              segments={data.providerBreakdown.map(r => ({
                label: providerLabel(r.provider_type ?? ''),
                value: Number(r.user_count),
                color: providerStyle(r.provider_type ?? '').bar.replace('bg-', 'text-'),
                provider: r.provider_type ?? '',
              }))}
            />
          </Card>

          <Card title="Access Grants by Provider" delay={280}>
            <div className="space-y-3">
              {data.accessByProvider.map((r, i) => {
                const p = r.provider ?? '';
                return (
                  <Link
                    key={`${p}-${i}`}
                    href={getAccessProviderHref(p)}
                    className="flex items-center justify-between group hover:bg-ons-ocean-blue/15 -mx-2 px-2 py-1.5 rounded-lg transition-colors duration-100 cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <ProviderBadge provider={p} />
                      <span className="text-xs text-ons-grey-35 tabular-nums">
                        {Number(r.grant_count).toLocaleString()} grants
                      </span>
                    </div>
                    <div className="text-right text-xs text-ons-grey-75 tabular-nums">
                      {Number(r.user_count).toLocaleString()} users &middot;{' '}
                      {Number(r.resource_count).toLocaleString()} resources
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-ons-border/10">
              <h4 className="text-[10px] font-semibold text-ons-grey-75 mb-3 uppercase tracking-[0.1em]">Access Path</h4>
              <DonutChart
                segments={data.accessPathBreakdown.map(r => ({
                  label: r.access_path === 'group' ? 'Group-based' : 'Direct',
                  value: Number(r.count),
                  color: r.access_path === 'group' ? 'text-ons-ocean-blue' : 'text-ons-spring-green',
                }))}
              />
            </div>
          </Card>
        </div>

        {/* Row: GitHub Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="GitHub Organisation Members" delay={320}>
            {githubOrgBreakdown.length === 0 ? (
              <p className="text-sm text-ons-grey-75">No GitHub org membership data</p>
            ) : (
              <div className="space-y-4">
                {githubOrgBreakdown.map((org, i) => (
                  <div key={org.login ?? i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <ProviderLogo provider="github" size={18} />
                      <span className="text-sm font-semibold text-ons-grey-5">{org.name}</span>
                      <span className="text-xs text-ons-grey-75 ml-auto tabular-nums">{org.total} total</span>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1 bg-ons-surface/20 rounded-lg p-3 border border-ons-border/10">
                        <p className="text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em]">Admins</p>
                        <p className="text-xl font-bold text-ons-ruby-red tabular-nums mt-1">{org.admins}</p>
                      </div>
                      <div className="flex-1 bg-ons-surface/20 rounded-lg p-3 border border-ons-border/10">
                        <p className="text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em]">Members</p>
                        <p className="text-xl font-bold text-ons-grey-15 tabular-nums mt-1">{org.members}</p>
                      </div>
                    </div>
                    {org.total > 0 && (
                      <div className="h-2 bg-ons-bar-track/20 rounded-full overflow-hidden flex">
                        {org.admins > 0 && (
                          <div
                            className="h-full bg-ons-ruby-red rounded-l-full"
                            style={{ width: `${(org.admins / org.total) * 100}%` }}
                            title={`${org.admins} admins`}
                          />
                        )}
                        <div
                          className="h-full bg-ons-grey-35"
                          style={{ width: `${(org.members / org.total) * 100}%` }}
                          title={`${org.members} members`}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="GitHub External Collaborators" delay={360}>
            {data.githubExternalCollabs.length === 0 ? (
              <div className="flex items-center gap-2">
                <StatusBadge status="completed" />
                <span className="text-sm text-ons-grey-75">No outside collaborators found</span>
              </div>
            ) : (
              <>
                <p className="text-xs text-ons-jaffa-orange mb-3">
                  {new Set(data.githubExternalCollabs.map(c => c.login)).size} external {new Set(data.githubExternalCollabs.map(c => c.login)).size === 1 ? 'collaborator has' : 'collaborators have'} direct
                  access to repositories
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="text-left pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">User</th>
                        <th className="text-left pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Repository</th>
                        <th className="text-left pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Permission</th>
                        <th className="text-left pb-2.5 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Visibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.githubExternalCollabs.map((r, i) => (
                        <tr key={i} className="border-b border-ons-border/8 last:border-0 transition-colors duration-100 hover:bg-ons-ocean-blue/15">
                          <td className="py-2 pr-4">
                            <span className="text-sm font-medium text-ons-grey-5">{r.login}</span>
                            {r.user_name && <p className="text-[11px] text-ons-grey-75">{r.user_name}</p>}
                          </td>
                          <td className="py-2 pr-4 text-xs text-ons-grey-35">{r.repo_name}</td>
                          <td className="py-2 pr-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                              r.permission === 'admin' ? 'bg-ons-ruby-red/10 text-ons-ruby-red border-ons-ruby-red/20' :
                              r.permission === 'push' || r.permission === 'write' ? 'bg-ons-jaffa-orange/10 text-ons-jaffa-orange border-ons-jaffa-orange/20' :
                              'bg-ons-grey-100/40 text-ons-grey-35 border-ons-grey-75/20'
                            }`}>
                              {r.permission}
                            </span>
                          </td>
                          <td className="py-2 text-xs text-ons-grey-75">{r.visibility}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Row: Identity coverage + Reconciliation */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Identity Coverage" delay={400}>
            <div className="space-y-3">
              {data.identityCoverage.map((r, i) => {
                const linkCount = Number(r.link_count);
                const labels: Record<number, string> = { 0: 'No providers', 1: '1 provider', 2: '2 providers', 3: '3 providers' };
                const label = labels[linkCount] ?? `${linkCount} providers`;
                const colors: Record<number, string> = { 0: 'bg-ons-ruby-red', 1: 'bg-ons-jaffa-orange', 2: 'bg-ons-sky-blue', 3: 'bg-ons-spring-green' };
                const color = colors[linkCount] ?? 'bg-ons-ocean-blue';
                return (
                  <HorizontalBar key={`${linkCount}-${i}`} label={label} value={Number(r.user_count)} max={totalCoverageUsers} color={color} />
                );
              })}
            </div>
          </Card>

          <Card title="Identity Reconciliation" delay={440}>
            {data.reconciliationStatus.length === 0 ? (
              <p className="text-sm text-ons-grey-75">No reconciliation items</p>
            ) : (
              <div className="space-y-3">
                {data.reconciliationStatus.map((r, i) => (
                  <Link
                    key={`${r.status}-${i}`}
                    href={`/users?reconciliation=${encodeURIComponent(r.status.toLowerCase())}`}
                    className="flex items-center justify-between hover:bg-ons-ocean-blue/15 -mx-2 px-2 py-1.5 rounded-lg transition-colors duration-100 cursor-pointer"
                  >
                    <StatusBadge status={r.status} />
                    <span className="text-lg font-bold text-ons-grey-5 tabular-nums">{Number(r.count).toLocaleString()}</span>
                  </Link>
                ))}
                {reconciliationPending > 0 && (
                  <Link href="/users?reconciliation=pending" className="flex items-center gap-1 text-xs text-ons-jaffa-orange mt-2 hover:text-ons-sun-yellow transition-colors duration-150">
                    <span>{reconciliationPending} identities need manual review</span>
                    <span aria-hidden="true">&rarr;</span>
                  </Link>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Row: Suspended users */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SuspendedUsersCard data={data.suspendedUsers} delay={480} />

          <Card title="Suspended Users with Active Access" delay={520}>
            {data.suspendedWithAccess.length === 0 ? (
              <div className="flex items-center gap-2">
                <StatusBadge status="completed" />
                <span className="text-sm text-ons-grey-75">No suspended users have active access grants</span>
              </div>
            ) : (
              <>
                <p className="text-xs text-ons-ruby-red mb-3">
                  {data.suspendedWithAccess.length} suspended {data.suspendedWithAccess.length === 1 ? 'user has' : 'users have'} active
                  access grants that should be reviewed
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="text-left pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">User</th>
                        <th className="text-left pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Provider</th>
                        <th className="text-left pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Status</th>
                        <th className="text-right pb-2.5 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Grants</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.suspendedWithAccess.map((r, i) => (
                        <tr key={i} className="border-b border-ons-border/8 last:border-0 transition-colors duration-100 hover:bg-ons-ocean-blue/15 cursor-pointer">
                          <td className="py-2.5 pr-4">
                            <Link href={`/users/${r.canonical_user_id}`} className="text-ons-sky-blue hover:text-ons-aqua-teal hover:underline text-sm font-medium">
                              {r.full_name ?? 'Unknown'}
                            </Link>
                            <p className="text-[11px] text-ons-grey-75">{r.primary_email}</p>
                          </td>
                          <td className="py-2.5 pr-4"><ProviderBadge provider={r.provider} /></td>
                          <td className="py-2.5 pr-4"><StatusBadge status={r.status_label} /></td>
                          <td className="py-2.5 text-right tabular-nums font-bold text-ons-grey-5 text-sm">{Number(r.active_grants).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Row: Top roles + Top resources */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Top Roles / Permission Sets" delay={560}>
            <div className="space-y-2.5">
              {data.topRoles.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <ProviderBadge provider={r.provider} />
                  <HorizontalBar label={r.role_or_permission} value={Number(r.grant_count)} max={maxRole} color={providerStyle(r.provider).bar} href={`/access?provider=${encodeURIComponent(r.provider)}&search=${encodeURIComponent(r.role_or_permission)}`} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Most-Accessed Resources" delay={600}>
            <div className="space-y-2.5">
              {data.topResources.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <ProviderBadge provider={r.provider} />
                  <HorizontalBar label={r.resource_display_name} value={Number(r.unique_users)} max={maxResource} color={providerStyle(r.provider).bar} href={getResourceHref(r)} />
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Row: Largest groups */}
        <Card title="Largest Groups" delay={640}>
          <div className="space-y-2.5">
            {data.groupSizes.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <ProviderBadge provider={r.provider} />
                <HorizontalBar label={r.group_name} value={Number(r.member_count)} max={maxGroup} color={providerStyle(r.provider).bar} href={getGroupHref(r)} />
              </div>
            ))}
          </div>
        </Card>

        {/* Row: Recent ingestion */}
        {data.recentIngestion.length > 0 && (
          <Card title="Recent Ingestion Runs" delay={680}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Provider</th>
                    <th className="text-left pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Entity</th>
                    <th className="text-left pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Status</th>
                    <th className="text-right pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Upserted</th>
                    <th className="text-right pb-2.5 pr-4 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Deleted</th>
                    <th className="text-left pb-2.5 text-[10px] font-semibold text-ons-grey-75 uppercase tracking-[0.08em] border-b border-ons-border/10">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentIngestion.map((r, i) => (
                    <tr key={i} className="border-b border-ons-border/8 last:border-0 transition-colors duration-100 hover:bg-ons-surface/10">
                      <td className="py-2 pr-4"><ProviderBadge provider={r.provider} /></td>
                      <td className="py-2 pr-4 text-xs text-ons-grey-35">{r.entity_type}</td>
                      <td className="py-2 pr-4"><StatusBadge status={r.status} /></td>
                      <td className="py-2 pr-4 text-right tabular-nums text-xs font-semibold text-ons-grey-15">{Number(r.records_upserted).toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-xs font-semibold text-ons-grey-15">{Number(r.records_deleted).toLocaleString()}</td>
                      <td className="py-2 text-xs text-ons-grey-75 tabular-nums">{new Date(r.started_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
