import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    role: 'analyst' as const,
  };
}

export async function handleAccessList(req: NextRequest): Promise<NextResponse> {
  const session = getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const provider = url.searchParams.get('provider');
  const accessPath = url.searchParams.get('accessPath');
  const search = url.searchParams.get('search');

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (provider && ['aws', 'gcp'].includes(provider)) {
    conditions.push(`ea.cloud_provider = $${paramIdx++}`);
    params.push(provider);
  }

  if (accessPath && ['direct', 'group'].includes(accessPath)) {
    conditions.push(`ea.access_path = $${paramIdx++}`);
    params.push(accessPath);
  }

  if (search) {
    conditions.push(`(
      p.display_name ILIKE $${paramIdx} OR
      p.primary_email ILIKE $${paramIdx} OR
      ea.account_or_project_id ILIKE $${paramIdx} OR
      ea.account_or_project_name ILIKE $${paramIdx} OR
      ea.role_or_permission_set ILIKE $${paramIdx}
    )`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count query
  const countSql = `
    SELECT COUNT(*) AS total
    FROM mv_effective_access ea
    JOIN person p ON p.id = ea.person_id
    ${whereClause}
  `;

  // Data query
  const offset = (page - 1) * limit;
  const dataSql = `
    SELECT
      p.display_name,
      p.primary_email,
      ea.cloud_provider,
      ea.account_or_project_id,
      ea.account_or_project_name,
      ea.role_or_permission_set,
      ea.access_path,
      ea.via_group_name
    FROM mv_effective_access ea
    JOIN person p ON p.id = ea.person_id
    ${whereClause}
    ORDER BY p.display_name, ea.cloud_provider, ea.account_or_project_id
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;

  try {
    const countResult = await executeWithTenant<{ total: string }>(
      session.tenantId,
      countSql,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total || '0');

    const dataResult = await executeWithTenant(
      session.tenantId,
      dataSql,
      [...params, limit, offset],
    );

    return NextResponse.json({
      data: dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Access list error:', error);
    return NextResponse.json({ error: 'Failed to load access data' }, { status: 500 });
  }
}
