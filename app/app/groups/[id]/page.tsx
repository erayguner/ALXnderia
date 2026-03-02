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
  admin: 'bg-ons-ruby-red/15 text-ons-ruby-red border-ons-ruby-red/20',
  maintain: 'bg-ons-jaffa-orange/15 text-ons-jaffa-orange border-ons-jaffa-orange/20',
  push: 'bg-ons-sun-yellow/15 text-ons-sun-yellow border-ons-sun-yellow/20',
  triage: 'bg-ons-sky-blue/15 text-ons-sky-blue border-ons-sky-blue/20',
  pull: 'bg-ons-grey-100 text-ons-grey-35 border-ons-grey-100',
};

function PermissionBadge({ permission }: { permission: string }) {
  const cls = PERMISSION_COLOR[permission.toLowerCase()] || 'bg-ons-grey-100 text-ons-grey-35 border-ons-grey-100';
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
          <div className="h-8 bg-ons-grey-100 rounded w-1/4 mb-4"></div>
          <div className="h-4 bg-ons-grey-100 rounded w-1/2 mb-8"></div>
          <div className="space-y-3">
            <div className="h-4 bg-ons-grey-100 rounded w-full"></div>
            <div className="h-4 bg-ons-grey-100 rounded w-full"></div>
            <div className="h-4 bg-ons-grey-100 rounded w-full"></div>
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
          className="text-sm text-ons-grey-35 hover:text-ons-grey-5 mb-4 flex items-center gap-1"
        >
          &larr; Back
        </button>
        <div className="p-4 bg-ons-ruby-red/10 text-ons-ruby-red rounded-lg border border-ons-ruby-red/20">
          {error || 'Group not found'}
        </div>
      </div>
    );
  }

  const providerColor: Record<string, string> = {
    google: 'bg-ons-ruby-red/15 text-ons-ruby-red border-ons-ruby-red/20',
    aws: 'bg-ons-jaffa-orange/15 text-ons-jaffa-orange border-ons-jaffa-orange/20',
    github: 'bg-ons-grey-100 text-ons-grey-15 border-ons-grey-100',
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <button
        onClick={() => router.back()}
        className="text-sm text-ons-grey-35 hover:text-ons-grey-5 flex items-center gap-1 transition-colors"
      >
        &larr; Back to Groups
      </button>

      {/* Header */}
      <div className="bg-ons-grey-100/50 shadow-sm border border-ons-grey-100 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-ons-grey-100/50">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-ons-grey-5 mb-2">{group.name}</h1>
              {group.description && (
                <p className="text-ons-grey-35 mb-4">{group.description}</p>
              )}
              <div className="flex flex-wrap gap-4 text-sm text-ons-grey-35">
                {group.email && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Email:</span>
                    <span className="font-mono bg-ons-grey-100 px-2 py-0.5 rounded">{group.email}</span>
                  </div>
                )}
                {group.slug && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Slug:</span>
                    <span className="font-mono bg-ons-grey-100 px-2 py-0.5 rounded">{group.slug}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="font-medium">Provider:</span>
                  <span className={`uppercase text-xs font-bold px-2 py-0.5 rounded border ${providerColor[group.provider] || 'bg-ons-grey-100 text-ons-grey-15 border-ons-grey-100'}`}>
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
            <div className="flex flex-col items-end gap-2 text-sm text-ons-grey-75">
              <span>{members.length} {members.length === 1 ? 'member' : 'members'}</span>
              {repositories.length > 0 && (
                <span>{repositories.length} {repositories.length === 1 ? 'repository' : 'repositories'}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Members */}
      <div className="bg-ons-grey-100/50 shadow-sm border border-ons-grey-100 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-ons-grey-100/50 bg-ons-night-blue/50">
          <h2 className="font-semibold text-ons-grey-5">Members ({members.length})</h2>
        </div>

        {members.length === 0 ? (
          <div className="p-8 text-center text-ons-grey-35 italic">
            No members found in this group.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-ons-night-blue/50 text-ons-grey-35 font-semibold border-b border-ons-grey-100 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">{group.provider === 'github' ? 'Login' : 'Email / ID'}</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ons-grey-100/50">
                {members.map((member) => {
                  const userHref = member.canonical_user_id ? `/users/${member.canonical_user_id}` : null;
                  return (
                    <tr
                      key={member.id}
                      onClick={() => userHref && router.push(userHref)}
                      onKeyDown={e => {
                        if (!userHref) return;
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(userHref); }
                      }}
                      role={userHref ? 'link' : undefined}
                      tabIndex={userHref ? 0 : undefined}
                      className={`transition-colors ${userHref ? 'cursor-pointer hover:bg-ons-ocean-blue/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ons-sky-blue' : 'hover:bg-ons-grey-100/30'}`}
                    >
                      <td className="px-6 py-3 font-medium text-ons-grey-5">
                        {userHref ? (
                          <a
                            href={userHref}
                            className="text-ons-sky-blue hover:text-ons-aqua-teal hover:underline"
                            onClick={e => e.stopPropagation()}
                          >
                            {member.name || <span className="italic font-normal text-ons-grey-75">Unknown</span>}
                          </a>
                        ) : (
                          member.name || <span className="text-ons-grey-75 italic">Unknown</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-ons-grey-35 font-mono text-xs">
                        {member.login || member.email || member.user_id || member.id}
                      </td>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-ons-grey-100 text-ons-grey-15">
                          {member.role}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        {(member.status || member.state) ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            (member.status || member.state) === 'ACTIVE' || (member.status || member.state) === 'active'
                              ? 'bg-ons-leaf-green/15 text-ons-spring-green border border-ons-leaf-green/20'
                              : 'bg-ons-jaffa-orange/15 text-ons-jaffa-orange border border-ons-jaffa-orange/20'
                          }`}>
                            {member.status || member.state}
                          </span>
                        ) : (
                          <span className="text-ons-grey-75">-</span>
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
        <div className="bg-ons-grey-100/50 shadow-sm border border-ons-grey-100 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-ons-grey-100/50 bg-ons-night-blue/50">
            <h2 className="font-semibold text-ons-grey-5">Repository Access ({repositories.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-ons-night-blue/50 text-ons-grey-35 font-semibold border-b border-ons-grey-100 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Repository</th>
                  <th className="px-6 py-3">Visibility</th>
                  <th className="px-6 py-3">Archived</th>
                  <th className="px-6 py-3">Permission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ons-grey-100/50">
                {repositories.map((repo) => (
                  <tr key={repo.repo_id} className="hover:bg-ons-grey-100/30 transition-colors">
                    <td className="px-6 py-3 font-mono text-xs text-ons-grey-15">
                      {repo.full_name}
                    </td>
                    <td className="px-6 py-3">
                      {repo.visibility ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                          repo.visibility === 'private'
                            ? 'bg-ons-grey-100 text-ons-grey-35 border-ons-grey-100'
                            : 'bg-ons-leaf-green/15 text-ons-spring-green border-ons-leaf-green/20'
                        }`}>
                          {repo.visibility}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-3">
                      {repo.archived ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-ons-jaffa-orange/15 text-ons-jaffa-orange border-ons-jaffa-orange/20">
                          Archived
                        </span>
                      ) : (
                        <span className="text-ons-grey-75 text-xs">Active</span>
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
