import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    role: 'analyst' as const,
  };
}

export async function handleAuditList(req: NextRequest): Promise<NextResponse> {
  const session = getSession();
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const action = url.searchParams.get('action');
  const offset = (page - 1) * limit;

  try {
    const params: unknown[] = [];
    let paramIdx = 1;
    const conditions: string[] = [];

    if (action) {
      conditions.push(`action = $${paramIdx++}`);
      params.push(action);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM audit_log ${whereClause}`;
    const countResult = await executeWithTenant<{ total: string }>(session.tenantId, countSql, params);
    const total = parseInt(countResult.rows[0]?.total || '0');

    const dataSql = `
      SELECT id, event_time, actor, action, target_table, source_system,
             detail->>'question' AS question,
             detail->>'status' AS query_status,
             (detail->>'rowCount')::int AS row_count,
             (detail->>'executionTimeMs')::int AS duration_ms
      FROM audit_log
      ${whereClause}
      ORDER BY event_time DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    const dataResult = await executeWithTenant(session.tenantId, dataSql, [...params, limit, offset]);

    return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Audit list error:', error);
    return NextResponse.json({ error: 'Failed to load audit log' }, { status: 500 });
  }
}
