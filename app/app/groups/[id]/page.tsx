'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Member {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  status?: string;
  member_type?: string;
  user_id?: string;
}

interface GroupDetails {
  id: string;
  name: string;
  description: string | null;
  email?: string;
  provider: string;
  last_synced_at: string | null;
}

export default function GroupDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const provider = searchParams.get('provider');
  const router = useRouter();

  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
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
    <div className="p-6 max-w-7xl mx-auto">
      <button
        onClick={() => router.back()}
        className="text-sm text-slate-500 hover:text-slate-900 mb-6 flex items-center gap-1 transition-colors"
      >
        &larr; Back to Groups
      </button>

      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden mb-8">
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
          </div>
        </div>
      </div>

      <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <h2 className="font-semibold text-slate-900">Members ({members.length})</h2>
          <div className="text-xs text-slate-500">
            {members.length === 1 ? '1 member' : `${members.length} members`}
          </div>
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
                  <th className="px-6 py-3">Email / ID</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      {member.name || <span className="text-slate-400 italic">Unknown</span>}
                    </td>
                    <td className="px-6 py-3 text-slate-600 font-mono text-xs">
                      {member.email || member.user_id || member.id}
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                        {member.role}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                       {member.status ? (
                           <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                               member.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
                           }`}>
                               {member.status}
                           </span>
                       ) : (
                           <span className="text-slate-400">-</span>
                       )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
