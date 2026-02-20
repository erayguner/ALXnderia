'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Member {
  id: string;
  name: string | null;
  login?: string | null;
  email: string | null;
  role: string;
  state?: string | null;
  status?: string;
  member_type?: string;
  user_id?: string;
  canonical_user_id?: string | null;
}

interface RepoPermission {
  repo_id: string;
  full_name: string;
  repo_name: string;
  visibility: string | null;
  archived: boolean;
  permission: string;
}

interface GroupDetails {
  id: string;
  name: string;
  description: string | null;
  email?: string;
  provider: string;
  last_synced_at: string | null;
  slug?: string | null;
}

const PERMISSION_COLOR: Record<string, string> = {
  admin: 'bg-red-50 text-red-700 border-red-100',
  maintain: 'bg-orange-50 text-orange-700 border-orange-100',
  push: 'bg-amber-50 text-amber-700 border-amber-100',
  triage: 'bg-blue-50 text-blue-700 border-blue-100',
  pull: 'bg-slate-100 text-slate-600 border-slate-200',
};

function PermissionBadge({ permission }: { permission: string }) {
  const cls = PERMISSION_COLOR[permission.toLowerCase()] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {permission}
    </span>
  );
}

export default function GroupDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const provider = searchParams.get('provider');
  const router = useRouter();

  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [repositories, setRepositories] = useState<RepoPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = provider ? `?provider=${provider}` : '';
        const res = await fetch(`/api/groups/${id}${query}`);
        if (!res.ok) {
           if (res.status === 404) throw new Error('Group not found');
           throw new Error('Failed to load group details');
        }
        const json = await res.json();
        setGroup(json.group);
        setMembers(json.members);
        setRepositories(json.repositories ?? []);
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
        <div className="animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-1/4 mb-4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2 mb-8"></div>
          <div className="space-y-3">
            <div className="h-4 bg-slate-200 rounded w-full"></div>
            <div className="h-4 bg-slate-200 rounded w-full"></div>
            <div className="h-4 bg-slate-200 rounded w-full"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="p-6">
        <button
          onClick={() => router.back()}
          className="text-sm text-slate-500 hover:text-slate-900 mb-4 flex items-center gap-1"
        >
          &larr; Back
        </button>
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-100">
          {error || 'Group not found'}
        </div>
      </div>
    );
  }

  const providerColor: Record<string, string> = {
    google: 'bg-blue-50 text-blue-700 border-blue-100',
    aws: 'bg-amber-50 text-amber-700 border-amber-100',
    github: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <button
        onClick={() => router.back()}
        className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors"
      >
        &larr; Back to Groups
      </button>

      {/* Header */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">{group.name}</h1>
              {group.description && (
                <p className="text-slate-600 mb-4">{group.description}</p>
              )}
              <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                {group.email && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Email:</span>
                    <span className="font-mono bg-slate-50 px-2 py-0.5 rounded">{group.email}</span>
                  </div>
                )}
                {group.slug && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Slug:</span>
                    <span className="font-mono bg-slate-50 px-2 py-0.5 rounded">{group.slug}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="font-medium">Provider:</span>
                  <span className={`uppercase text-xs font-bold px-2 py-0.5 rounded border ${providerColor[group.provider] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                    {group.provider}
                  </span>
                </div>
                {group.last_synced_at && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Last Synced:</span>
                    <span>{new Date(group.last_synced_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 text-sm text-slate-400">
              <span>{members.length} {members.length === 1 ? 'member' : 'members'}</span>
              {repositories.length > 0 && (
                <span>{repositories.length} {repositories.length === 1 ? 'repository' : 'repositories'}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Members */}
      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="font-semibold text-slate-900">Members ({members.length})</h2>
        </div>

        {members.length === 0 ? (
          <div className="p-8 text-center text-slate-500 italic">
            No members found in this group.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">{group.provider === 'github' ? 'Login' : 'Email / ID'}</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((member) => {
                  const personHref = member.canonical_user_id ? `/people/${member.canonical_user_id}` : null;
                  return (
                    <tr
                      key={member.id}
                      onClick={() => personHref && router.push(personHref)}
                      onKeyDown={e => {
                        if (!personHref) return;
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(personHref); }
                      }}
                      role={personHref ? 'link' : undefined}
                      tabIndex={personHref ? 0 : undefined}
                      className={`transition-colors ${personHref ? 'cursor-pointer hover:bg-indigo-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-6 py-3 font-medium text-slate-900">
                        {personHref ? (
                          <a
                            href={personHref}
                            className="text-indigo-600 hover:text-indigo-800 hover:underline"
                            onClick={e => e.stopPropagation()}
                          >
                            {member.name || <span className="italic font-normal text-slate-400">Unknown</span>}
                          </a>
                        ) : (
                          member.name || <span className="text-slate-400 italic">Unknown</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-slate-600 font-mono text-xs">
                        {member.login || member.email || member.user_id || member.id}
                      </td>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                          {member.role}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        {(member.status || member.state) ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            (member.status || member.state) === 'ACTIVE' || (member.status || member.state) === 'active'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                              : 'bg-amber-50 text-amber-700 border border-amber-100'
                          }`}>
                            {member.status || member.state}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Repository permissions — GitHub teams only */}
      {repositories.length > 0 && (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h2 className="font-semibold text-slate-900">Repository Access ({repositories.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Repository</th>
                  <th className="px-6 py-3">Visibility</th>
                  <th className="px-6 py-3">Archived</th>
                  <th className="px-6 py-3">Permission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {repositories.map((repo) => (
                  <tr key={repo.repo_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 font-mono text-xs text-slate-700">
                      {repo.full_name}
                    </td>
                    <td className="px-6 py-3">
                      {repo.visibility ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                          repo.visibility === 'private'
                            ? 'bg-slate-100 text-slate-600 border-slate-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                        }`}>
                          {repo.visibility}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-3">
                      {repo.archived ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-amber-50 text-amber-700 border-amber-100">
                          Archived
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">Active</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <PermissionBadge permission={repo.permission} />
                    </td>
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
