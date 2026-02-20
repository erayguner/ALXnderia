'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface ResultsTableProps {
  data: Record<string, unknown>[];
  pageSize?: number;
  getRowLink?: (row: Record<string, unknown>) => string | null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '\u2014';
  if (value instanceof Date) return value.toLocaleDateString('en-GB');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatHeader(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Determine whether a column value should render as a drilldown link.
 * Returns the target URL or null if no drilldown applies.
 */
function getDrilldownLink(key: string, value: unknown, row: Record<string, unknown>): string | null {
  const stringValue = value === null || value === undefined ? '' : String(value);
  if (!stringValue) return null;

  // Person name -> person detail page
  if (key === 'display_name' && row.person_id) {
    return `/people/${row.person_id}`;
  }

  // Person name -> person detail page (people list rows only, not GitHub repo full_name)
  if (key === 'full_name' && row.id && 'primary_email' in row) {
    return `/people/${row.id}`;
  }

  // Identity count -> person detail page
  if (key === 'identity_count' && row.id) {
    return `/people/${row.id}`;
  }

  // Account ID -> accounts page (AWS)
  if (key === 'account_or_project_id' && row.cloud_provider === 'aws') {
    return `/accounts?provider=aws&search=${encodeURIComponent(stringValue)}`;
  }
  // Project ID -> accounts page (GCP)
  if (key === 'account_or_project_id' && row.cloud_provider === 'gcp') {
    return `/accounts?provider=gcp&search=${encodeURIComponent(stringValue)}`;
  }
  // Group name -> group page
  if (key === 'via_group_name' && stringValue) {
    return `/groups?search=${stringValue}`;
  }

  // Member count -> group details page
  if (key === 'member_count' && row.id) {
    const provider = row.provider ? `?provider=${row.provider}` : '';
    return `/groups/${row.id}${provider}`;
  }

  // Group/team name -> group detail (groups list rows have provider + id)
  if (key === 'name' && row.id && row.provider && 'member_count' in row) {
    const provider = row.provider ? `?provider=${row.provider}` : '';
    return `/groups/${row.id}${provider}`;
  }

  // Collaborator/team count on github repos -> resource detail
  if ((key === 'collaborator_count' || key === 'team_permission_count') && row.id) {
    return `/groups?provider=github&search=${encodeURIComponent(String(row.full_name ?? ''))}`;
  }

  return null;
}

export function ResultsTable({ data, pageSize = 20, getRowLink }: ResultsTableProps) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const router = useRouter();

  const columns = useMemo(() => {
    if (data.length === 0) return [];
    // Exclude internal ID columns from display, keeping account_or_project_id.
    // Also hide raw 'id' when row linking is active (id is used for navigation, not display).
    return Object.keys(data[0]).filter(k => {
      if (k === 'id' && getRowLink) return false;
      return !k.endsWith('_id') || k === 'account_or_project_id';
    });
  }, [data, getRowLink]);

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = String(a[sortKey] ?? '');
      const bVal = String(b[sortKey] ?? '');
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [data, sortKey, sortAsc]);

  const pageCount = Math.ceil(sortedData.length / pageSize);
  const pageData = sortedData.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  if (data.length === 0) {
    return <p className="text-sm text-slate-500 italic">No results to display.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {columns.map(col => (
              <th
                key={col}
                onClick={() => handleSort(col)}
                className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition select-none"
              >
                <span className="flex items-center gap-1">
                  {formatHeader(col)}
                  {sortKey === col && (
                    <span className="text-indigo-500">{sortAsc ? '\u2191' : '\u2193'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {pageData.map((row, rowIdx) => {
            const rowLink = getRowLink ? getRowLink(row) : null;
            return (
              <tr
                key={rowIdx}
                onClick={() => rowLink && router.push(rowLink)}
                onKeyDown={event => {
                  if (!rowLink) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    router.push(rowLink);
                  }
                }}
                role={rowLink ? 'link' : undefined}
                tabIndex={rowLink ? 0 : undefined}
                className={`transition-colors ${rowLink ? 'cursor-pointer hover:bg-indigo-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500' : 'hover:bg-slate-50'}`}
              >
                {columns.map(col => {
                  const link = getDrilldownLink(col, row[col], row);
                  return (
                    <td key={col} className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                      {link ? (
                        <a
                          href={link}
                          className="text-indigo-600 hover:text-indigo-800 hover:underline"
                          onClick={event => event.stopPropagation()}
                        >
                          {formatValue(row[col])}
                        </a>
                      ) : (
                        <span className={
                          col === 'access_path'
                            ? row[col] === 'direct'
                              ? 'text-emerald-600 font-medium'
                              : 'text-amber-600 font-medium'
                            : ''
                        }>
                          {formatValue(row[col])}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between px-3 py-2.5 text-xs text-slate-500 border-t border-slate-100">
          <span>
            Showing {page * pageSize + 1}\u2013{Math.min((page + 1) * pageSize, sortedData.length)} of {sortedData.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
