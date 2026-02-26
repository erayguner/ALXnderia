'use client';

import { useState, useEffect } from 'react';

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
}

// --- Colour helpers ---

const PROVIDER_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  aws: { bg: 'bg-ons-jaffa-orange/15', text: 'text-ons-jaffa-orange', bar: 'bg-ons-jaffa-orange' },
  AWS_IDENTITY_CENTER: { bg: 'bg-ons-jaffa-orange/15', text: 'text-ons-jaffa-orange', bar: 'bg-ons-jaffa-orange' },
  gcp: { bg: 'bg-ons-sky-blue/15', text: 'text-ons-sky-blue', bar: 'bg-ons-sky-blue' },
  GCP: { bg: 'bg-ons-sky-blue/15', text: 'text-ons-sky-blue', bar: 'bg-ons-sky-blue' },
  google: { bg: 'bg-ons-ruby-red/15', text: 'text-ons-ruby-red', bar: 'bg-ons-ruby-red' },
  GOOGLE_WORKSPACE: { bg: 'bg-ons-ruby-red/15', text: 'text-ons-ruby-red', bar: 'bg-ons-ruby-red' },
  github: { bg: 'bg-ons-grey-100', text: 'text-ons-grey-15', bar: 'bg-ons-grey-35' },
  GITHUB: { bg: 'bg-ons-grey-100', text: 'text-ons-grey-15', bar: 'bg-ons-grey-35' },
};

function providerStyle(p: string) {
  return PROVIDER_COLORS[p] ?? { bg: 'bg-ons-grey-100', text: 'text-ons-grey-35', bar: 'bg-ons-grey-75' };
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

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-ons-grey-100/50 rounded-xl border border-ons-grey-100 p-5 shadow-sm">
      <p className="text-xs font-medium text-ons-grey-35 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-ons-grey-5 mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub && <p className="text-xs text-ons-grey-75 mt-1">{sub}</p>}
    </div>
  );
}

function HorizontalBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 truncate text-ons-grey-35" title={label}>{label}</span>
      <div className="flex-1 h-5 bg-ons-grey-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 text-right text-ons-grey-15 font-medium tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const s = providerStyle(provider);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
      {providerLabel(provider)}
    </span>
  );
}

function DonutChart({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <p className="text-sm text-ons-grey-75">No data</p>;

  const size = 120;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Pre-compute offsets to avoid mutable state during render
  const arcs = segments.reduce<{ pct: number; offset: number; color: string }[]>((acc, seg, i) => {
    const cumulative = i === 0 ? 0 : segments.slice(0, i).reduce((s, prev) => s + prev.value, 0);
    const pct = seg.value / total;
    const offset = circumference * (1 - cumulative / total);
    acc.push({ pct, offset, color: seg.color });
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
        {arcs.map((arc, i) => (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeDasharray={`${circumference * arc.pct} ${circumference * (1 - arc.pct)}`}
              strokeDashoffset={arc.offset}
              className={arc.color}
            />
          ))}
      </svg>
      <div className="space-y-1.5">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className={`w-2.5 h-2.5 rounded-full ${seg.color.replace('text-', 'bg-')}`} />
            <span className="text-ons-grey-35">{seg.label}</span>
            <span className="font-medium text-ons-grey-15">{seg.value.toLocaleString()}</span>
            <span className="text-ons-grey-75">({Math.round((seg.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-ons-grey-100/50 rounded-xl border border-ons-grey-100 shadow-sm ${className}`}>
      <div className="px-5 py-4 border-b border-ons-grey-100/50">
        <h3 className="text-sm font-semibold text-ons-grey-5">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
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
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-ons-sky-blue border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-ons-grey-35 mt-3">Loading analytics...</p>
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

  // Compute derived values
  const totalCoverageUsers = data.identityCoverage.reduce((s, r) => s + Number(r.user_count), 0);
  const usersWithAllProviders = data.identityCoverage
    .filter(r => Number(r.link_count) >= 3)
    .reduce((s, r) => s + Number(r.user_count), 0);
  const coveragePct = totalCoverageUsers > 0 ? Math.round((usersWithAllProviders / totalCoverageUsers) * 100) : 0;

  const reconciliationPending = data.reconciliationStatus
    .filter(r => r.status === 'PENDING')
    .reduce((s, r) => s + Number(r.count), 0);

  const maxRole = Math.max(...data.topRoles.map(r => Number(r.grant_count)), 1);
  const maxResource = Math.max(...data.topResources.map(r => Number(r.unique_users)), 1);
  const maxGroup = Math.max(...data.groupSizes.map(r => Number(r.member_count)), 1);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Page header */}
        <div>
          <h2 className="text-xl font-bold text-ons-grey-5">Identity Estate Analytics</h2>
          <p className="text-sm text-ons-grey-35 mt-1">
            Overview of your cloud identity posture across all providers
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Canonical Users" value={summary.totalUsers} sub="Unified identities" />
          <StatCard label="Access Grants" value={summary.totalAccessGrants} sub="Cross-provider" />
          <StatCard label="Cloud Resources" value={summary.totalResources} sub="Accounts & projects" />
          <StatCard
            label="Full Coverage"
            value={`${coveragePct}%`}
            sub={`${usersWithAllProviders.toLocaleString()} users linked to 3+ providers`}
          />
        </div>

        {/* Row: Provider breakdown + Access path */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Identity Provider Distribution">
            <DonutChart
              segments={data.providerBreakdown.map(r => ({
                label: providerLabel(r.provider_type ?? ''),
                value: Number(r.user_count),
                color: providerStyle(r.provider_type ?? '').bar.replace('bg-', 'text-'),
              }))}
            />
          </Card>

          <Card title="Access Grants by Provider">
            <div className="space-y-3">
              {data.accessByProvider.map(r => {
                const p = r.provider ?? '';
                return (
                  <div key={p} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ProviderBadge provider={p} />
                      <span className="text-sm text-ons-grey-35">
                        {Number(r.grant_count).toLocaleString()} grants
                      </span>
                    </div>
                    <div className="text-right text-xs text-ons-grey-75">
                      {Number(r.user_count).toLocaleString()} users &middot;{' '}
                      {Number(r.resource_count).toLocaleString()} resources
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-ons-grey-100/50">
              <h4 className="text-xs font-medium text-ons-grey-35 mb-2 uppercase">Access Path</h4>
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

        {/* Row: Identity coverage + Reconciliation */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Identity Coverage (Provider Links per User)">
            <div className="space-y-3">
              {data.identityCoverage.map(r => {
                const linkCount = Number(r.link_count);
                const labels: Record<number, string> = { 0: 'No providers', 1: '1 provider', 2: '2 providers', 3: '3 providers' };
                const label = labels[linkCount] ?? `${linkCount} providers`;
                const colors: Record<number, string> = { 0: 'bg-ons-ruby-red', 1: 'bg-ons-jaffa-orange', 2: 'bg-ons-sky-blue', 3: 'bg-ons-spring-green' };
                const color = colors[linkCount] ?? 'bg-ons-ocean-blue';
                return (
                  <HorizontalBar
                    key={linkCount}
                    label={label}
                    value={Number(r.user_count)}
                    max={totalCoverageUsers}
                    color={color}
                  />
                );
              })}
            </div>
          </Card>

          <Card title="Identity Reconciliation">
            {data.reconciliationStatus.length === 0 ? (
              <p className="text-sm text-ons-grey-75">No reconciliation items</p>
            ) : (
              <div className="space-y-3">
                {data.reconciliationStatus.map(r => (
                  <div key={r.status} className="flex items-center justify-between">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium ${
                        r.status === 'PENDING'
                          ? 'bg-ons-jaffa-orange/15 text-ons-jaffa-orange'
                          : r.status === 'RESOLVED'
                            ? 'bg-ons-leaf-green/15 text-ons-spring-green'
                            : 'bg-ons-grey-100 text-ons-grey-35'
                      }`}
                    >
                      {r.status}
                    </span>
                    <span className="text-lg font-semibold text-ons-grey-5">{Number(r.count).toLocaleString()}</span>
                  </div>
                ))}
                {reconciliationPending > 0 && (
                  <p className="text-xs text-ons-jaffa-orange mt-2">
                    {reconciliationPending} identities need manual review
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Row: Top roles + Top resources */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Top Roles / Permission Sets">
            <div className="space-y-2.5">
              {data.topRoles.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <ProviderBadge provider={r.provider} />
                  <HorizontalBar
                    label={r.role_or_permission}
                    value={Number(r.grant_count)}
                    max={maxRole}
                    color={providerStyle(r.provider).bar}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Most-Accessed Resources">
            <div className="space-y-2.5">
              {data.topResources.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <ProviderBadge provider={r.provider} />
                  <HorizontalBar
                    label={r.resource_display_name}
                    value={Number(r.unique_users)}
                    max={maxResource}
                    color={providerStyle(r.provider).bar}
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Row: Largest groups */}
        <Card title="Largest Groups (All Providers)">
          <div className="space-y-2.5">
            {data.groupSizes.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <ProviderBadge provider={r.provider} />
                <HorizontalBar
                  label={r.group_name}
                  value={Number(r.member_count)}
                  max={maxGroup}
                  color={providerStyle(r.provider).bar}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* Row: Recent ingestion */}
        {data.recentIngestion.length > 0 && (
          <Card title="Recent Ingestion Runs">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ons-grey-35 uppercase">
                    <th className="pb-2 pr-4">Provider</th>
                    <th className="pb-2 pr-4">Entity</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4 text-right">Upserted</th>
                    <th className="pb-2 pr-4 text-right">Deleted</th>
                    <th className="pb-2">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ons-grey-100/30">
                  {data.recentIngestion.map((r, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-4"><ProviderBadge provider={r.provider} /></td>
                      <td className="py-1.5 pr-4 text-ons-grey-35">{r.entity_type}</td>
                      <td className="py-1.5 pr-4">
                        <span
                          className={`text-xs font-medium ${
                            r.status === 'completed'
                              ? 'text-ons-spring-green'
                              : r.status === 'failed'
                                ? 'text-ons-ruby-red'
                                : 'text-ons-jaffa-orange'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-ons-grey-15">
                        {Number(r.records_upserted).toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-ons-grey-15">
                        {Number(r.records_deleted).toLocaleString()}
                      </td>
                      <td className="py-1.5 text-ons-grey-35">
                        {new Date(r.started_at).toLocaleString()}
                      </td>
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
