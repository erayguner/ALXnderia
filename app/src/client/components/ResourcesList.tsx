'use client';

import { useState, useEffect } from 'react';
import { ResultsTable } from './ResultsTable';

type Provider = 'aws' | 'google' | 'github';

const PROVIDER_CONFIG: Record<Provider, { label: string; subtitle: string; searchPlaceholder: string }> = {
  aws: {
    label: 'AWS Identity Center',
    subtitle: 'Identity Center groups and membership counts',
    searchPlaceholder: 'Search by group name...',
  },
  google: {
    label: 'Google Workspace',
    subtitle: 'Workspace groups and membership counts',
    searchPlaceholder: 'Search by group name or email...',
  },
  github: {
    label: 'GitHub',
    subtitle: 'Repositories with team and collaborator permissions',
    searchPlaceholder: 'Search by repository name...',
  },
};

export function ResourcesList() {
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>('github');
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
          provider,
          page: page.toString(),
          limit: limit.toString(),
        });
        if (search) params.set('search', search);

        const res = await fetch(`/api/resources?${params}`);
        if (!res.ok) throw new Error('Failed to load resources');
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
  const config = PROVIDER_CONFIG[provider];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Resources</h1>
        <p className="text-sm text-slate-500 mt-1">{config.subtitle}</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={provider}
          onChange={e => { setProvider(e.target.value as Provider); setPage(1); setSearch(''); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          <option value="aws">AWS Identity Center</option>
          <option value="google">Google Workspace</option>
          <option value="github">GitHub</option>
        </select>
        <input
          type="text"
          placeholder={config.searchPlaceholder}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-72 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <span className="self-center text-xs text-slate-500">
          {total.toLocaleString()} {total === 1 ? 'result' : 'results'}
        </span>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <>
          <ResultsTable data={data} pageSize={limit} />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition"
              >
                Previous
              </button>
              <span className="text-sm text-slate-600">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition"
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
