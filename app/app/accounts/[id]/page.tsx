'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface AccessEntry {
  role_or_permission: string;
  permission_set_arn?: string | null;
  access_path: string;
  via_group_name: string | null;
  subject_email: string | null;
  subject_name: string | null;
  subject_type: string;
  canonical_user_id: string | null;
  condition_title?: string | null;
  condition_expression?: string | null;
}

interface GroupAssignment {
  role_or_permission: string;
  permission_set_arn?: string | null;
  access_path: string;
  via_group_name: string | null;
  subject_name: string | null;
  subject_email: string | null;
  subject_type: string;
  condition_title?: string | null;
  condition_expression?: string | null;
}

interface AccountRecord {
  id: string;
  name?: string | null;
  display_name?: string | null;
  account_id?: string | null;
  project_id?: string | null;
  project_number?: string | null;
  email?: string | null;
  status?: string | null;
  lifecycle_state?: string | null;
  org_id?: string | null;
  last_synced_at?: string | null;
  provider: string;
}

const ROLE_COLOR: Record<string, string> = {
  'roles/owner': 'bg-ons-ruby-red/15 text-ons-ruby-red border-ons-ruby-red/20',
  'roles/editor': 'bg-ons-jaffa-orange/15 text-ons-jaffa-orange border-ons-jaffa-orange/20',
  'roles/viewer': 'bg-ons-grey-100 text-ons-grey-35 border-ons-grey-100',
};

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_COLOR[role] || 'bg-ons-ocean-blue/20 text-ons-sky-blue border-ons-ocean-blue/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls} max-w-[240px] truncate`} title={role}>
      {role}
    </span>
  );
}

function AccessPathBadge({ path }: { path: string }) {
  const cls = path === 'direct'
    ? 'bg-ons-leaf-green/15 text-ons-spring-green border-ons-leaf-green/20'
    : 'bg-ons-jaffa-orange/15 text-ons-jaffa-orange border-ons-jaffa-orange/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {path}
    </span>
  );
}

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const provider = searchParams.get('provider');
  const router = useRouter();

  const [account, setAccount] = useState<AccountRecord | null>(null);
  const [accessEntries, setAccessEntries] = useState<AccessEntry[]>([]);
  const [groupAssignments, setGroupAssignments] = useState<GroupAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = provider ? `?provider=${provider}` : '';
        const res = await fetch(`/api/accounts/${id}${query}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('Account or project not found');
          throw new Error('Failed to load account details');
        }
        const json = await res.json();
        setAccount(json.account);
        setAccessEntries(json.access_entries ?? []);
        setGroupAssignments(json.group_assignments ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, provider]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-ons-grey-100 rounded w-1/4"></div>
          <div className="h-4 bg-ons-grey-100 rounded w-1/2"></div>
          <div className="space-y-3 mt-8">
            {[1, 2, 3].map(i => <div key={i} className="h-4 bg-ons-grey-100 rounded w-full"></div>)}
          </div>
        </div>
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="p-6">
        <button
          onClick={() => router.back()}
          className="text-sm text-ons-grey-35 hover:text-ons-grey-5 mb-4 flex items-center gap-1"
        >
          &larr; Back
        </button>
        <div className="p-4 bg-ons-ruby-red/10 text-ons-ruby-red rounded-lg border border-ons-ruby-red/20">
          {error || 'Account not found'}
        </div>
      </div>
    );
  }

  const isAws = account.provider === 'aws';
  const providerColor = isAws
    ? 'bg-ons-jaffa-orange/15 text-ons-jaffa-orange border-ons-jaffa-orange/20'
    : 'bg-ons-sky-blue/15 text-ons-sky-blue border-ons-sky-blue/20';

  const displayName = account.name || account.display_name || (isAws ? account.account_id : account.project_id);
  const resourceId = isAws ? account.account_id : account.project_id;
  const status = account.status || account.lifecycle_state;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <button
        onClick={() => router.back()}
        className="text-sm text-ons-grey-35 hover:text-ons-grey-5 flex items-center gap-1 transition-colors"
      >
        &larr; Back to Accounts & Projects
      </button>

      {/* Header */}
      <div className="bg-ons-grey-100/50 shadow-sm border border-ons-grey-100 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-ons-grey-100/50">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-ons-grey-5 mb-2">{displayName}</h1>
              <div className="flex flex-wrap gap-4 text-sm text-ons-grey-35">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Provider:</span>
                  <span className={`uppercase text-xs font-bold px-2 py-0.5 rounded border ${providerColor}`}>
                    {account.provider}
                  </span>
                </div>
                {resourceId && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{isAws ? 'Account ID' : 'Project ID'}:</span>
                    <span className="font-mono bg-ons-grey-100 px-2 py-0.5 rounded text-xs">{resourceId}</span>
                  </div>
                )}
                {!isAws && account.project_number && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Project Number:</span>
                    <span className="font-mono bg-ons-grey-100 px-2 py-0.5 rounded text-xs">{account.project_number}</span>
                  </div>
                )}
                {isAws && account.email && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Root Email:</span>
                    <span>{account.email}</span>
                  </div>
                )}
                {status && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Status:</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                      status === 'ACTIVE' ? 'bg-ons-leaf-green/15 text-ons-spring-green border-ons-leaf-green/20' : 'bg-ons-jaffa-orange/15 text-ons-jaffa-orange border-ons-jaffa-orange/20'
                    }`}>
                      {status}
                    </span>
                  </div>
                )}
                {account.org_id && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Org:</span>
                    <span className="font-mono text-xs">{account.org_id}</span>
                  </div>
                )}
                {account.last_synced_at && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Last Synced:</span>
                    <span>{new Date(account.last_synced_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="text-sm text-ons-grey-75 text-right space-y-1">
              <div>{accessEntries.length} access {accessEntries.length === 1 ? 'entry' : 'entries'}</div>
              {groupAssignments.length > 0 && (
                <div>{groupAssignments.length} group {groupAssignments.length === 1 ? 'assignment' : 'assignments'}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Access Entries */}
      <div className="bg-ons-grey-100/50 shadow-sm border border-ons-grey-100 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-ons-grey-100/50 bg-ons-night-blue/50">
          <h2 className="font-semibold text-ons-grey-5">
            Access Entries ({accessEntries.length})
          </h2>
          <p className="text-xs text-ons-grey-35 mt-0.5">
            Effective access — direct assignments and group-expanded memberships
          </p>
        </div>

        {accessEntries.length === 0 ? (
          <div className="p-8 text-center text-ons-grey-35 italic">No access entries found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-ons-night-blue/50 text-ons-grey-35 font-semibold border-b border-ons-grey-100 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Subject</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Role / Permission</th>
                  <th className="px-6 py-3">Access Path</th>
                  <th className="px-6 py-3">Via Group</th>
                  {!isAws && <th className="px-6 py-3">Condition</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ons-grey-100/50">
                {accessEntries.map((entry, i) => {
                  const personHref = entry.canonical_user_id ? `/people/${entry.canonical_user_id}` : null;
                  return (
                    <tr
                      key={i}
                      onClick={() => personHref && router.push(personHref)}
                      onKeyDown={e => {
                        if (!personHref) return;
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(personHref); }
                      }}
                      role={personHref ? 'link' : undefined}
                      tabIndex={personHref ? 0 : undefined}
                      className={`transition-colors ${personHref ? 'cursor-pointer hover:bg-ons-ocean-blue/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ons-sky-blue' : 'hover:bg-ons-grey-100/30'}`}
                    >
                      <td className="px-6 py-3">
                        {personHref ? (
                          <a
                            href={personHref}
                            className="text-ons-sky-blue hover:text-ons-aqua-teal hover:underline font-medium"
                            onClick={e => e.stopPropagation()}
                          >
                            {entry.subject_name || entry.subject_email || '\u2014'}
                          </a>
                        ) : (
                          <span className="font-medium text-ons-grey-15">
                            {entry.subject_name || entry.subject_email || '\u2014'}
                          </span>
                        )}
                        {entry.subject_email && entry.subject_name && entry.subject_email !== entry.subject_name && (
                          <div className="text-xs text-ons-grey-75 font-mono mt-0.5">{entry.subject_email}</div>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-ons-grey-100 text-ons-grey-35 border border-ons-grey-100">
                          {entry.subject_type}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <RoleBadge role={entry.role_or_permission} />
                        {isAws && entry.permission_set_arn && (
                          <div className="text-xs text-ons-grey-75 font-mono mt-0.5 truncate max-w-[200px]" title={entry.permission_set_arn}>
                            {entry.permission_set_arn}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <AccessPathBadge path={entry.access_path} />
                      </td>
                      <td className="px-6 py-3 text-ons-grey-35">
                        {entry.via_group_name ? (
                          <a
                            href={`/groups?search=${encodeURIComponent(entry.via_group_name)}`}
                            className="text-ons-sky-blue hover:text-ons-aqua-teal hover:underline text-xs"
                            onClick={e => e.stopPropagation()}
                          >
                            {entry.via_group_name}
                          </a>
                        ) : '\u2014'}
                      </td>
                      {!isAws && (
                        <td className="px-6 py-3 text-xs text-ons-grey-35">
                          {entry.condition_title || '\u2014'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Group Assignments */}
      {groupAssignments.length > 0 && (
        <div className="bg-ons-grey-100/50 shadow-sm border border-ons-grey-100 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-ons-grey-100/50 bg-ons-night-blue/50">
            <h2 className="font-semibold text-ons-grey-5">
              Group Assignments ({groupAssignments.length})
            </h2>
            <p className="text-xs text-ons-grey-35 mt-0.5">
              Groups with direct role assignments on this {isAws ? 'account' : 'project'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-ons-night-blue/50 text-ons-grey-35 font-semibold border-b border-ons-grey-100 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Group</th>
                  <th className="px-6 py-3">Role / Permission</th>
                  {!isAws && <th className="px-6 py-3">Condition</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ons-grey-100/50">
                {groupAssignments.map((ga, i) => (
                  <tr key={i} className="hover:bg-ons-grey-100/30 transition-colors">
                    <td className="px-6 py-3">
                      <a
                        href={`/groups?search=${encodeURIComponent(ga.subject_name || ga.subject_email || '')}`}
                        className="text-ons-sky-blue hover:text-ons-aqua-teal hover:underline font-medium"
                      >
                        {ga.subject_name || ga.subject_email || '\u2014'}
                      </a>
                      {ga.subject_email && ga.subject_name && (
                        <div className="text-xs text-ons-grey-75 font-mono mt-0.5">{ga.subject_email}</div>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <RoleBadge role={ga.role_or_permission} />
                      {isAws && ga.permission_set_arn && (
                        <div className="text-xs text-ons-grey-75 font-mono mt-0.5 truncate max-w-[200px]" title={ga.permission_set_arn}>
                          {ga.permission_set_arn}
                        </div>
                      )}
                    </td>
                    {!isAws && (
                      <td className="px-6 py-3 text-xs text-ons-grey-35">
                        {ga.condition_title || '\u2014'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
