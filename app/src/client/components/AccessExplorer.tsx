'use client';

import { useState, useEffect } from 'react';
import { ResultsTable } from './ResultsTable';

interface AccessRow {
  display_name: string;
  primary_email: string;
  cloud_provider: string;
  account_or_project_id: string;
  account_or_project_name: string;
  role_or_permission_set: string;
  access_path: string;
  via_group_name: string | null;
}

export function AccessExplorer() {
  const [data, setData] = useState<AccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<'all' | 'aws' | 'gcp'>('all');
  const [accessPath, setAccessPath] = useState<'all' | 'direct' | 'group'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
        });
        if (provider !== 'all') params.set('provider', provider);
        if (accessPath !== 'all') params.set('accessPath', accessPath);
        if (search) params.set('search', search);

        const res = await fetch(`/api/access?${params}`);
        if (!res.ok) throw new Error('Failed to load access data');
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
  }, [provider, accessPath, search, page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Access Explorer</h1>
          <p className="text-sm text-gray-500 mt-1">
            Explore effective access across all cloud providers
          </p>
        </div>
        <button
          onClick={() => {
            const csv = [
              Object.keys(data[0] || {}).join(','),
              ...data.map(row => Object.values(row).map(v => `"${v ?? ''}"`).join(',')),
            ].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'access-export.csv';
            a.click();
          }}
          className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          disabled={data.length === 0}
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name, email, or resource..."
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
          <option value="aws">AWS</option>
          <option value="gcp">GCP</option>
        </select>
        <select
          value={accessPath}
          onChange={e => { setAccessPath(e.target.value as typeof accessPath); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Access Paths</option>
          <option value="direct">Direct Only</option>
          <option value="group">Group-Derived Only</option>
        </select>
      </div>

      {/* Status */}
      {loading && <p className="text-sm text-gray-500">Loading...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Results */}
      {!loading && !error && (
        <>
          <div className="text-xs text-gray-500 mb-2">
            {total.toLocaleString()} total entitlement{total === 1 ? '' : 's'}
          </div>
          <ResultsTable data={data as unknown as Record<string, unknown>[]} pageSize={limit} />

          {/* Server-side pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
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
