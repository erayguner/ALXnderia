'use client';

import { useState, useEffect } from 'react';
import { ResultsTable } from './ResultsTable';

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  member_count: number;
  last_synced_at: string | null;
}

export function GroupsList() {
  const [data, setData] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<'all' | 'aws' | 'google' | 'github'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
        if (provider !== 'all') params.set('provider', provider);
        if (search) params.set('search', search);

        const res = await fetch(`/api/groups?${params}`);
        if (!res.ok) throw new Error('Failed to load groups');
        const json = await res.json();
        setData(json.data);
        setTotal(json.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [provider, search, page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Groups</h1>
        <p className="text-sm text-gray-500 mt-1">
          Identity groups across all cloud providers with membership counts
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by group name..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={provider}
          onChange={e => { setProvider(e.target.value as typeof provider); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Providers</option>
          <option value="google">Google Workspace</option>
          <option value="aws">AWS Identity Center</option>
          <option value="github">GitHub</option>
        </select>
        <span className="self-center text-xs text-gray-500">
          {total.toLocaleString()} {total === 1 ? 'group' : 'groups'}
        </span>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <>
          <ResultsTable
            data={data as unknown as Record<string, unknown>[]}
            pageSize={limit}
            getRowLink={row => {
              if (!row.id) return null;
              const p = row.provider ? `?provider=${row.provider}` : '';
              return `/groups/${row.id}${p}`;
            }}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
