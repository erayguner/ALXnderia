import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

/**
 * Tracks parameterised query parameters with auto-incrementing indices.
 * Eliminates manual `paramIdx++` bookkeeping across route files.
 */
export class ParamBuilder {
  readonly params: unknown[] = [];
  private idx = 1;

  /** Add a parameter and return its `$N` placeholder. */
  add(value: unknown): string {
    this.params.push(value);
    return `$${this.idx++}`;
  }

  /** Current next index (for LIMIT/OFFSET appended outside the builder). */
  get nextIndex(): number {
    return this.idx;
  }
}

/**
 * Build an ILIKE search filter across multiple columns.
 * Returns an empty string if `search` is falsy.
 */
export function buildSearchFilter(
  pb: ParamBuilder,
  columns: string[],
  search: string | null | undefined,
  prefix = 'AND',
): string {
  if (!search) return '';
  const placeholder = pb.add(`%${search}%`);
  const conditions = columns.map((c) => `${c} ILIKE ${placeholder}`).join(' OR ');
  return `${prefix} (${conditions})`;
}

/** Standard pagination envelope returned by all list endpoints. */
export interface PaginatedResponse<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Parse page / limit from a request URL.
 * Clamps limit to [1, 100] and page to >= 1.
 */
export function parsePagination(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;
  return { url, page, limit, offset };
}

/**
 * Execute a paginated query pair (count + data) and return a JSON response.
 *
 * @param tenantId  - tenant ID for row-level isolation
 * @param countSql  - SQL returning `{ total: string }`
 * @param dataSql   - SQL returning data rows (must include LIMIT/OFFSET placeholders)
 * @param params    - params for the count query
 * @param page      - current page number
 * @param limit     - page size
 * @param offset    - row offset
 */
export async function executePaginatedQuery(
  tenantId: string,
  countSql: string,
  dataSql: string,
  params: unknown[],
  page: number,
  limit: number,
  offset: number,
): Promise<NextResponse> {
  const countResult = await executeWithTenant<{ total: string }>(tenantId, countSql, params);
  const total = parseInt(countResult.rows[0]?.total || '0');
  const dataResult = await executeWithTenant(tenantId, dataSql, [...params, limit, offset]);
  return NextResponse.json({
    data: dataResult.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  } satisfies PaginatedResponse);
}
