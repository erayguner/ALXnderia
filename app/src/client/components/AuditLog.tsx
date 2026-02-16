'use client';

import { useState, useEffect } from 'react';
import { ResultsTable } from './ResultsTable';

interface AuditRow {
  id: number;
  event_time: string;
  actor: string;
  action: string;
  target_table: string | null;
  question: string | null;
  query_status: string | null;
  row_count: number | null;
  duration_ms: number | null;
}

export function AuditLog() {
  const [data, setData] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'all' | 'NL2SQL_QUERY'>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
        if (action !== 'all') params.set('action', action);

        const res = await fetch(`/api/audit?${params}`);
        if (!res.ok) throw new Error('Failed to load audit log');
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
  }, [action, page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-500 mt-1">
          Query history and system events
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={action}
          onChange={e => { setAction(e.target.value as typeof action); setPage(1); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          <option value="all">All Events</option>
          <option value="NL2SQL_QUERY">NL2SQL Queries</option>
        </select>
        <span className="self-center text-xs text-slate-500">
          {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <>
          {data.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              No audit entries yet. Submit a chat query to generate your first entry.
            </p>
          ) : (
            <ResultsTable data={data as unknown as Record<string, unknown>[]} pageSize={limit} />
          )}

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
