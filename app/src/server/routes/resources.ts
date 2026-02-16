import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
    role: 'analyst' as const,
  };
}

type Provider = 'aws' | 'google' | 'github';

function buildAwsQuery(search: string | null, params: unknown[], paramIdx: number) {
  const conditions: string[] = ['g.deleted_at IS NULL'];
  if (search) {
    conditions.push(`(g.display_name ILIKE $${paramIdx} OR g.description ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }
  const where = conditions.join(' AND ');
  const countSql = `SELECT COUNT(*) AS total FROM aws_identity_center_groups g WHERE ${where}`;
  const dataSql = `
    SELECT g.id, g.group_id, g.display_name, g.description, g.identity_store_id,
           g.last_synced_at,
           (SELECT COUNT(*) FROM aws_identity_center_memberships m
            WHERE m.group_id = g.group_id AND m.identity_store_id = g.identity_store_id
              AND m.tenant_id = g.tenant_id AND m.deleted_at IS NULL) AS member_count
    FROM aws_identity_center_groups g
    WHERE ${where}
    ORDER BY g.display_name
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  return { countSql, dataSql, paramIdx };
}

function buildGoogleQuery(search: string | null, params: unknown[], paramIdx: number) {
  const conditions: string[] = ['g.deleted_at IS NULL'];
  if (search) {
    conditions.push(`(g.name ILIKE $${paramIdx} OR g.email ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }
  const where = conditions.join(' AND ');
  const countSql = `SELECT COUNT(*) AS total FROM google_workspace_groups g WHERE ${where}`;
  const dataSql = `
    SELECT g.id, g.google_id, g.name, g.email, g.description, g.admin_created,
           g.last_synced_at,
           (SELECT COUNT(*) FROM google_workspace_memberships m
            WHERE m.group_id = g.google_id AND m.tenant_id = g.tenant_id
              AND m.deleted_at IS NULL) AS member_count
    FROM google_workspace_groups g
    WHERE ${where}
    ORDER BY g.name
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  return { countSql, dataSql, paramIdx };
}

function buildGithubQuery(search: string | null, params: unknown[], paramIdx: number) {
  const conditions: string[] = ['r.deleted_at IS NULL'];
  if (search) {
    conditions.push(`(r.name ILIKE $${paramIdx} OR r.full_name ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }
  const where = conditions.join(' AND ');
  const countSql = `SELECT COUNT(*) AS total FROM github_repositories r WHERE ${where}`;
  const dataSql = `
    SELECT r.id, r.github_id, r.name, r.full_name,
           r.visibility, r.archived, r.default_branch,
           o.login AS org_login,
           r.last_synced_at,
           (SELECT COUNT(*) FROM github_repo_collaborator_permissions cp
            WHERE cp.repo_node_id = r.node_id AND cp.tenant_id = r.tenant_id) AS collaborator_count,
           (SELECT COUNT(*) FROM github_repo_team_permissions tp
            WHERE tp.repo_node_id = r.node_id AND tp.tenant_id = r.tenant_id) AS team_permission_count
    FROM github_repositories r
    LEFT JOIN github_organisations o ON r.org_node_id = o.node_id AND r.tenant_id = o.tenant_id
    WHERE ${where}
    ORDER BY r.full_name
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  return { countSql, dataSql, paramIdx };
}

const QUERY_BUILDERS: Record<Provider, typeof buildAwsQuery> = {
  aws: buildAwsQuery,
  google: buildGoogleQuery,
  github: buildGithubQuery,
};

/**
 * Lists resources by provider: AWS Identity Center groups, Google Workspace groups, or GitHub repositories.
 */
export async function handleResourcesList(req: NextRequest): Promise<NextResponse> {
  const session = getSession();
  const url = new URL(req.url);
  const provider = (url.searchParams.get('provider') || 'github') as Provider;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const search = url.searchParams.get('search');
  const offset = (page - 1) * limit;

  if (!QUERY_BUILDERS[provider]) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  try {
    const params: unknown[] = [];
    const { countSql, dataSql } = QUERY_BUILDERS[provider](search, params, 1);

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
