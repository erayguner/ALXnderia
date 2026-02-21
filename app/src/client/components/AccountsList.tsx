'use client';

import { useState, useEffect } from 'react';
import { ResultsTable } from './ResultsTable';

type AccountProvider = 'all' | 'aws' | 'gcp';

export function AccountsList() {
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<AccountProvider>('all');
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

        const res = await fetch(`/api/accounts?${params}`);
        if (!res.ok) throw new Error('Failed to load accounts');
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
        <h1 className="text-2xl font-bold text-slate-900">Cloud Accounts</h1>
        <p className="text-sm text-slate-500 mt-1">
          AWS accounts and GCP projects with access counts
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name or ID..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-72 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <select
          value={provider}
          onChange={e => { setProvider(e.target.value as AccountProvider); setPage(1); setSearch(''); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          <option value="all">All Providers</option>
          <option value="aws">AWS</option>
          <option value="gcp">GCP</option>
        </select>
        <span className="self-center text-xs text-slate-500">
          {total.toLocaleString()} {total === 1 ? 'account' : 'accounts'}
        </span>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <>
          <ResultsTable
            data={data}
            pageSize={limit}
            getRowLink={row => {
              if (!row.id) return null;
              const p = row.provider ? `?provider=${row.provider}` : '';
              return `/accounts/${row.id}${p}`;
            }}
          />

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
