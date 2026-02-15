import { NextRequest, NextResponse } from 'next/server';

/**
 * Audit log route handler.
 *
 * The current multi-tenant schema does not include an audit_log table.
 * This handler returns an empty result set. When an audit table is added
 * to the schema, this route should be updated to query it.
 */
export async function handleAuditList(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));

  return NextResponse.json({
    data: [],
    total: 0,
    page,
    limit,
    totalPages: 0,
    message: 'Audit logging table not yet provisioned in this schema version.',
  });
}
