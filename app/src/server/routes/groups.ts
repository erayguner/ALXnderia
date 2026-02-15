import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: 'a0000000-0000-0000-0000-000000000001',
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
      conditions.push(`display_name ILIKE $${paramIdx}`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // AWS IDC groups
    const awsCountSql = `SELECT COUNT(*) AS total FROM aws_idc_group ${whereClause} ${whereClause ? 'AND' : 'WHERE'} deleted_at IS NULL`;
    const awsDataSql = `
      SELECT g.id, g.display_name, g.description, g.identity_store_group_id,
             g.last_seen_at, 'aws' AS provider,
             (SELECT COUNT(*) FROM aws_idc_group_membership gm WHERE gm.group_id = g.id) AS member_count
      FROM aws_idc_group g
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} g.deleted_at IS NULL
      ORDER BY g.display_name
    `;

    // GCP workspace groups
    const gcpCountSql = `SELECT COUNT(*) AS total FROM gcp_workspace_group ${whereClause} ${whereClause ? 'AND' : 'WHERE'} deleted_at IS NULL`;
    const gcpDataSql = `
      SELECT g.id, g.display_name, g.description, g.group_email,
             g.last_seen_at, 'gcp' AS provider,
             (SELECT COUNT(*) FROM gcp_workspace_group_membership gm WHERE gm.group_id = g.id) AS member_count
      FROM gcp_workspace_group g
      ${whereClause} ${whereClause ? 'AND' : 'WHERE'} g.deleted_at IS NULL
      ORDER BY g.display_name
    `;

    if (provider === 'aws') {
      const countResult = await executeWithTenant<{ total: string }>(session.tenantId, awsCountSql, params);
      const total = parseInt(countResult.rows[0]?.total || '0');
      const dataResult = await executeWithTenant(session.tenantId, awsDataSql + ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);
      return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }

    if (provider === 'gcp') {
      const countResult = await executeWithTenant<{ total: string }>(session.tenantId, gcpCountSql, params);
      const total = parseInt(countResult.rows[0]?.total || '0');
      const dataResult = await executeWithTenant(session.tenantId, gcpDataSql + ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);
      return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }

    // Both providers — use UNION ALL
    const unionSql = `
      SELECT id, display_name, description, last_seen_at, 'aws' AS provider,
             (SELECT COUNT(*) FROM aws_idc_group_membership gm WHERE gm.group_id = aws_idc_group.id) AS member_count
      FROM aws_idc_group ${whereClause} ${whereClause ? 'AND' : 'WHERE'} deleted_at IS NULL
      UNION ALL
      SELECT id, display_name, description, last_seen_at, 'gcp' AS provider,
             (SELECT COUNT(*) FROM gcp_workspace_group_membership gm WHERE gm.group_id = gcp_workspace_group.id) AS member_count
      FROM gcp_workspace_group ${whereClause} ${whereClause ? 'AND' : 'WHERE'} deleted_at IS NULL
    `;

    const countSql = `SELECT COUNT(*) AS total FROM (${unionSql}) AS combined`;
    const countResult = await executeWithTenant<{ total: string }>(session.tenantId, countSql, [...params, ...params]);
    const total = parseInt(countResult.rows[0]?.total || '0');

    const dataSql = `${unionSql.replace('UNION ALL', `UNION ALL`)} ORDER BY display_name LIMIT $${params.length * 2 + 1} OFFSET $${params.length * 2 + 2}`;
    const dataResult = await executeWithTenant(session.tenantId, dataSql, [...params, ...params, limit, offset]);

    return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Groups list error:', error);
    return NextResponse.json({ error: 'Failed to load groups' }, { status: 500 });
  }
}
