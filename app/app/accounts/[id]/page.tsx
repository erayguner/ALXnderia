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
  'roles/owner': 'bg-red-50 text-red-700 border-red-100',
  'roles/editor': 'bg-orange-50 text-orange-700 border-orange-100',
  'roles/viewer': 'bg-slate-100 text-slate-600 border-slate-200',
};

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_COLOR[role] || 'bg-indigo-50 text-indigo-700 border-indigo-100';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls} max-w-[240px] truncate`} title={role}>
      {role}
    </span>
  );
}

function AccessPathBadge({ path }: { path: string }) {
  const cls = path === 'direct'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : 'bg-amber-50 text-amber-700 border-amber-100';
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
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
          <div className="space-y-3 mt-8">
            {[1, 2, 3].map(i => <div key={i} className="h-4 bg-slate-200 rounded w-full"></div>)}
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
          className="text-sm text-slate-500 hover:text-slate-900 mb-4 flex items-center gap-1"
        >
          &larr; Back
        </button>
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-100">
          {error || 'Account not found'}
        </div>
      </div>
    );
  }

  const isAws = account.provider === 'aws';
  const providerColor = isAws
    ? 'bg-amber-50 text-amber-700 border-amber-100'
    : 'bg-blue-50 text-blue-700 border-blue-100';

  const displayName = account.name || account.display_name || (isAws ? account.account_id : account.project_id);
  const resourceId = isAws ? account.account_id : account.project_id;
  const status = account.status || account.lifecycle_state;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <button
        onClick={() => router.back()}
        className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors"
      >
        &larr; Back to Accounts
      </button>

      {/* Header */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">{displayName}</h1>
              <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Provider:</span>
                  <span className={`uppercase text-xs font-bold px-2 py-0.5 rounded border ${providerColor}`}>
                    {account.provider}
                  </span>
                </div>
                {resourceId && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{isAws ? 'Account ID' : 'Project ID'}:</span>
                    <span className="font-mono bg-slate-50 px-2 py-0.5 rounded text-xs">{resourceId}</span>
                  </div>
                )}
                {!isAws && account.project_number && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Project Number:</span>
                    <span className="font-mono bg-slate-50 px-2 py-0.5 rounded text-xs">{account.project_number}</span>
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
                      status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'
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
            <div className="text-sm text-slate-400 text-right space-y-1">
              <div>{accessEntries.length} access {accessEntries.length === 1 ? 'entry' : 'entries'}</div>
              {groupAssignments.length > 0 && (
                <div>{groupAssignments.length} group {groupAssignments.length === 1 ? 'assignment' : 'assignments'}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Access Entries */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="font-semibold text-slate-900">
            Access Entries ({accessEntries.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Effective access — direct assignments and group-expanded memberships
          </p>
        </div>

        {accessEntries.length === 0 ? (
          <div className="p-8 text-center text-slate-500 italic">No access entries found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Subject</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Role / Permission</th>
                  <th className="px-6 py-3">Access Path</th>
                  <th className="px-6 py-3">Via Group</th>
                  {!isAws && <th className="px-6 py-3">Condition</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
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
                      className={`transition-colors ${personHref ? 'cursor-pointer hover:bg-indigo-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-6 py-3">
                        {personHref ? (
                          <a
                            href={personHref}
                            className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium"
                            onClick={e => e.stopPropagation()}
                          >
                            {entry.subject_name || entry.subject_email || '—'}
                          </a>
                        ) : (
                          <span className="font-medium text-slate-800">
                            {entry.subject_name || entry.subject_email || '—'}
                          </span>
                        )}
                        {entry.subject_email && entry.subject_name && entry.subject_email !== entry.subject_name && (
                          <div className="text-xs text-slate-400 font-mono mt-0.5">{entry.subject_email}</div>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          {entry.subject_type}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <RoleBadge role={entry.role_or_permission} />
                        {isAws && entry.permission_set_arn && (
                          <div className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-[200px]" title={entry.permission_set_arn}>
                            {entry.permission_set_arn}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <AccessPathBadge path={entry.access_path} />
                      </td>
                      <td className="px-6 py-3 text-slate-500">
                        {entry.via_group_name ? (
                          <a
                            href={`/groups?search=${encodeURIComponent(entry.via_group_name)}`}
                            className="text-indigo-600 hover:text-indigo-800 hover:underline text-xs"
                            onClick={e => e.stopPropagation()}
                          >
                            {entry.via_group_name}
                          </a>
                        ) : '—'}
                      </td>
                      {!isAws && (
                        <td className="px-6 py-3 text-xs text-slate-500">
                          {entry.condition_title || '—'}
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
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h2 className="font-semibold text-slate-900">
              Group Assignments ({groupAssignments.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Groups with direct role assignments on this {isAws ? 'account' : 'project'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Group</th>
                  <th className="px-6 py-3">Role / Permission</th>
                  {!isAws && <th className="px-6 py-3">Condition</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupAssignments.map((ga, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3">
                      <a
                        href={`/groups?search=${encodeURIComponent(ga.subject_name || ga.subject_email || '')}`}
                        className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium"
                      >
                        {ga.subject_name || ga.subject_email || '—'}
                      </a>
                      {ga.subject_email && ga.subject_name && (
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{ga.subject_email}</div>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <RoleBadge role={ga.role_or_permission} />
                      {isAws && ga.permission_set_arn && (
                        <div className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-[200px]" title={ga.permission_set_arn}>
                          {ga.permission_set_arn}
                        </div>
                      )}
                    </td>
                    {!isAws && (
                      <td className="px-6 py-3 text-xs text-slate-500">
                        {ga.condition_title || '—'}
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
