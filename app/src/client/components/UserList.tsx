'use client';

import { useState, useEffect } from 'react';
import { ResultsTable } from './ResultsTable';

interface UserRow {
  id: string;
  display_name: string;
  primary_email: string;
  status: string;
  identity_count: number;
  entitlement_count: number;
  created_at: string;
}

export function UserList() {
  const [data, setData] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        if (search) params.set('search', search);

        const res = await fetch(`/api/users?${params}`);
        if (!res.ok) throw new Error('Failed to load users');
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
  }, [search, page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ons-grey-5">Users</h1>
        <p className="text-sm text-ons-grey-35 mt-1">
          Unified identity directory across all cloud providers
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-ons-grey-100 bg-ons-black rounded-lg text-sm w-72 text-ons-grey-15 placeholder:text-ons-grey-75 focus:outline-none focus:ring-2 focus:ring-ons-sky-blue focus:border-transparent"
        />
        <span className="self-center text-xs text-ons-grey-35">
          {total.toLocaleString()} {total === 1 ? 'user' : 'users'}
        </span>
      </div>

      {loading && <p className="text-sm text-ons-grey-35">Loading...</p>}
      {error && <p className="text-sm text-ons-ruby-red">{error}</p>}

      {!loading && !error && (
        <>
          <ResultsTable
            data={data as unknown as Record<string, unknown>[]}
            pageSize={limit}
            getRowLink={row => (row.id ? `/users/${row.id}` : null)}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-ons-grey-100 rounded-lg hover:bg-ons-grey-100 disabled:opacity-40 transition"
              >
                Previous
              </button>
              <span className="text-sm text-ons-grey-35">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-ons-grey-100 rounded-lg hover:bg-ons-grey-100 disabled:opacity-40 transition"
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
