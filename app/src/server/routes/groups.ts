import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
    role: 'analyst' as const,
  };
}

export async function handleGroupsList(req: NextRequest): Promise<NextResponse> {
  const session = getSession();
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const search = url.searchParams.get('search');
  const provider = url.searchParams.get('provider');
  const offset = (page - 1) * limit;

  try {
    const params: unknown[] = [];
    let paramIdx = 1;
    const conditions: string[] = [];

    if (search) {
      conditions.push(`name ILIKE $${paramIdx}`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereBase = conditions.length > 0 ? conditions.join(' AND ') : '';

    // Google Workspace groups
    const gwWhere = [whereBase, 'deleted_at IS NULL'].filter(Boolean).join(' AND ');
    const gwCountSql = `SELECT COUNT(*) AS total FROM google_workspace_groups WHERE ${gwWhere}`;
    const gwDataSql = `
      SELECT g.id, g.name, g.description, g.email,
             g.last_synced_at, 'google' AS provider,
             (SELECT COUNT(*) FROM google_workspace_memberships gm
              WHERE gm.group_id = g.google_id AND gm.tenant_id = g.tenant_id) AS member_count
      FROM google_workspace_groups g
      WHERE ${gwWhere}
      ORDER BY g.name
    `;

    // AWS Identity Center groups
    const awsWhere = [whereBase ? whereBase.replace(/\bname\b/g, 'display_name') : '', 'deleted_at IS NULL'].filter(Boolean).join(' AND ');
    const awsCountSql = `SELECT COUNT(*) AS total FROM aws_identity_center_groups WHERE ${awsWhere}`;
    const awsDataSql = `
      SELECT g.id, g.display_name AS name, g.description, g.identity_store_id,
             g.last_synced_at, 'aws' AS provider,
             (SELECT COUNT(*) FROM aws_identity_center_memberships gm
              WHERE gm.group_id = g.group_id AND gm.identity_store_id = g.identity_store_id
              AND gm.tenant_id = g.tenant_id) AS member_count
      FROM aws_identity_center_groups g
      WHERE ${awsWhere}
      ORDER BY g.display_name
    `;

    // GitHub teams
    const ghWhere = [whereBase, 'deleted_at IS NULL'].filter(Boolean).join(' AND ');
    const ghCountSql = `SELECT COUNT(*) AS total FROM github_teams WHERE ${ghWhere}`;
    const ghDataSql = `
      SELECT g.id, g.name, g.description, g.slug,
             g.last_synced_at, 'github' AS provider,
             (SELECT COUNT(*) FROM github_team_memberships gm
              WHERE gm.team_node_id = g.node_id AND gm.tenant_id = g.tenant_id) AS member_count
      FROM github_teams g
      WHERE ${ghWhere}
      ORDER BY g.name
    `;

    if (provider === 'google') {
      const countResult = await executeWithTenant<{ total: string }>(session.tenantId, gwCountSql, params);
      const total = parseInt(countResult.rows[0]?.total || '0');
      const dataResult = await executeWithTenant(session.tenantId, gwDataSql + ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);
      return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }

    if (provider === 'aws') {
      const awsParams = search ? [`%${search}%`] : [];
      let awsParamIdx = awsParams.length + 1;
      const countResult = await executeWithTenant<{ total: string }>(session.tenantId, awsCountSql, awsParams);
      const total = parseInt(countResult.rows[0]?.total || '0');
      const dataResult = await executeWithTenant(session.tenantId, awsDataSql + ` LIMIT $${awsParamIdx++} OFFSET $${awsParamIdx++}`, [...awsParams, limit, offset]);
      return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }

    if (provider === 'github') {
      const countResult = await executeWithTenant<{ total: string }>(session.tenantId, ghCountSql, params);
      const total = parseInt(countResult.rows[0]?.total || '0');
      const dataResult = await executeWithTenant(session.tenantId, ghDataSql + ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);
      return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }

    // All providers — UNION ALL
    const unionSql = `
      SELECT id, name, description, last_synced_at, 'google' AS provider,
             (SELECT COUNT(*) FROM google_workspace_memberships gm
              WHERE gm.group_id = google_workspace_groups.google_id
              AND gm.tenant_id = google_workspace_groups.tenant_id) AS member_count
      FROM google_workspace_groups WHERE ${gwWhere}
      UNION ALL
      SELECT id, display_name AS name, description, last_synced_at, 'aws' AS provider,
             (SELECT COUNT(*) FROM aws_identity_center_memberships gm
              WHERE gm.group_id = aws_identity_center_groups.group_id
              AND gm.identity_store_id = aws_identity_center_groups.identity_store_id
              AND gm.tenant_id = aws_identity_center_groups.tenant_id) AS member_count
      FROM aws_identity_center_groups WHERE ${awsWhere}
      UNION ALL
      SELECT id, name, description, last_synced_at, 'github' AS provider,
             (SELECT COUNT(*) FROM github_team_memberships gm
              WHERE gm.team_node_id = github_teams.node_id
              AND gm.tenant_id = github_teams.tenant_id) AS member_count
      FROM github_teams WHERE ${ghWhere}
    `;

    // For the union, Google and GitHub use 'name' search param, AWS uses 'display_name'
    // Build the combined params: google params + aws params + github params
    const awsSearchParams = search ? [`%${search}%`] : [];
    const allParams = [...params, ...awsSearchParams, ...params];

    const countSql = `SELECT COUNT(*) AS total FROM (${unionSql}) AS combined`;
    const countResult = await executeWithTenant<{ total: string }>(session.tenantId, countSql, allParams);
    const total = parseInt(countResult.rows[0]?.total || '0');

    const limitIdx = allParams.length + 1;
    const offsetIdx = allParams.length + 2;
    const dataSql = `${unionSql} ORDER BY name LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const dataResult = await executeWithTenant(session.tenantId, dataSql, [...allParams, limit, offset]);

    return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Groups list error:', error);
    return NextResponse.json({ error: 'Failed to load groups' }, { status: 500 });
  }
}
