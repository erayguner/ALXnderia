'use client';

import { useState, useMemo } from 'react';

interface ResultsTableProps {
  data: Record<string, unknown>[];
  pageSize?: number;
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
  if (!value || typeof value !== 'string') return null;

  // Person name -> person detail page
  if (key === 'display_name' && row.person_id) {
    return `/people/${row.person_id}`;
  }
  // Account ID -> resource page (AWS)
  if (key === 'account_or_project_id' && row.cloud_provider === 'aws') {
    return `/resources/aws-accounts?search=${value}`;
  }
  // Account ID -> resource page (GCP)
  if (key === 'account_or_project_id' && row.cloud_provider === 'gcp') {
    return `/resources/gcp-projects?search=${value}`;
  }
  // Group name -> group page
  if (key === 'via_group_name' && value) {
    return `/groups?search=${value}`;
  }
  return null;
}

export function ResultsTable({ data, pageSize = 20 }: ResultsTableProps) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const columns = useMemo(() => {
    if (data.length === 0) return [];
    // Exclude internal ID columns from display, keeping account_or_project_id
    return Object.keys(data[0]).filter(k => !k.endsWith('_id') || k === 'account_or_project_id');
  }, [data]);

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
    return <p className="text-sm text-gray-500 italic">No results to display.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {columns.map(col => (
              <th
                key={col}
                onClick={() => handleSort(col)}
                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition select-none"
              >
                <span className="flex items-center gap-1">
                  {formatHeader(col)}
                  {sortKey === col && (
                    <span className="text-blue-500">{sortAsc ? '\u2191' : '\u2193'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {pageData.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-gray-50 transition">
              {columns.map(col => {
                const link = getDrilldownLink(col, row[col], row);
                return (
                  <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                    {link ? (
                      <a href={link} className="text-blue-600 hover:underline">
                        {formatValue(row[col])}
                      </a>
                    ) : (
                      <span className={
                        col === 'access_path'
                          ? row[col] === 'direct'
                            ? 'text-green-600 font-medium'
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
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-2 px-3 py-2 text-xs text-gray-500">
          <span>
            Showing {page * pageSize + 1}\u2013{Math.min((page + 1) * pageSize, sortedData.length)} of {sortedData.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-50 transition"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-50 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
