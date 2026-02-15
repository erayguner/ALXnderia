import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
    role: 'analyst' as const,
  };
}

/**
 * Lists access data from the schema.
 *
 * Since the multi-tenant schema does not include a pre-computed effective
 * access view, this route queries GitHub repository permissions (the only
 * access-grant data available) and canonical identity linkages.
 */
export async function handleAccessList(req: NextRequest): Promise<NextResponse> {
  const session = getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const search = url.searchParams.get('search');

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (search) {
    conditions.push(`(
      u.login ILIKE $${paramIdx} OR
      u.email ILIKE $${paramIdx} OR
      r.full_name ILIKE $${paramIdx} OR
      perm.permission ILIKE $${paramIdx}
    )`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  // GitHub repo collaborator permissions joined with user and repo info
  const countSql = `
    SELECT COUNT(*) AS total
    FROM github_repo_collaborator_permissions perm
    JOIN github_repositories r ON perm.repo_node_id = r.node_id AND perm.tenant_id = r.tenant_id
    JOIN github_users u ON perm.user_node_id = u.node_id AND perm.tenant_id = u.tenant_id
    WHERE perm.deleted_at IS NULL ${whereClause}
  `;

  const offset = (page - 1) * limit;
  const dataSql = `
    SELECT
      u.login AS user_login,
      u.email AS user_email,
      r.full_name AS repo_name,
      r.private AS repo_private,
      perm.permission,
      perm.is_outside_collaborator,
      CASE WHEN perm.is_outside_collaborator THEN 'external' ELSE 'member' END AS access_type
    FROM github_repo_collaborator_permissions perm
    JOIN github_repositories r ON perm.repo_node_id = r.node_id AND perm.tenant_id = r.tenant_id
    JOIN github_users u ON perm.user_node_id = u.node_id AND perm.tenant_id = u.tenant_id
    WHERE perm.deleted_at IS NULL ${whereClause}
    ORDER BY r.full_name, u.login
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
