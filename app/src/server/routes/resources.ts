import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
    role: 'analyst' as const,
  };
}

/**
 * Lists resources (GitHub repositories) available in the schema.
 */
export async function handleResourcesList(req: NextRequest): Promise<NextResponse> {
  const session = getSession();
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const search = url.searchParams.get('search');
  const offset = (page - 1) * limit;

  try {
    const params: unknown[] = [];
    let paramIdx = 1;
    const conditions: string[] = ['r.deleted_at IS NULL'];

    if (search) {
      conditions.push(`(r.name ILIKE $${paramIdx} OR r.full_name ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `SELECT COUNT(*) AS total FROM github_repositories r WHERE ${whereClause}`;
    const dataSql = `
      SELECT r.id, r.github_id, r.node_id, r.name, r.full_name,
             r.private, r.visibility, r.archived, r.default_branch,
             o.login AS org_login,
             r.last_synced_at,
             (SELECT COUNT(*) FROM github_repo_collaborator_permissions cp
              WHERE cp.repo_node_id = r.node_id AND cp.tenant_id = r.tenant_id) AS collaborator_count,
             (SELECT COUNT(*) FROM github_repo_team_permissions tp
              WHERE tp.repo_node_id = r.node_id AND tp.tenant_id = r.tenant_id) AS team_permission_count
      FROM github_repositories r
      LEFT JOIN github_organisations o ON r.org_node_id = o.node_id AND r.tenant_id = o.tenant_id
      WHERE ${whereClause}
      ORDER BY r.full_name
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    const countResult = await executeWithTenant<{ total: string }>(
      session.tenantId,
      countSql,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total || '0');

    const dataResult = await executeWithTenant(session.tenantId, dataSql, [...params, limit, offset]);

    return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Resources list error:', error);
    return NextResponse.json({ error: 'Failed to load resources' }, { status: 500 });
  }
}
