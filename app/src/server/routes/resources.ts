import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    role: 'analyst' as const,
  };
}

export async function handleResourcesList(req: NextRequest): Promise<NextResponse> {
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
      conditions.push(`(name ILIKE $${paramIdx} OR external_id ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereBase = conditions.length > 0 ? conditions.join(' AND ') : '';

    const awsWhere = [whereBase, 'deleted_at IS NULL'].filter(Boolean).join(' AND ');
    const awsSql = `
      SELECT id, account_id AS external_id, account_name AS name,
             status, last_seen_at, 'aws' AS provider
      FROM aws_account
      WHERE ${awsWhere}
    `;

    const gcpWhere = [whereBase ? whereBase.replace(/name/g, 'project_name').replace(/external_id/g, 'project_id') : '', 'deleted_at IS NULL'].filter(Boolean).join(' AND ');
    const gcpSql = `
      SELECT id, project_id AS external_id, project_name AS name,
             lifecycle_state AS status, last_seen_at, 'gcp' AS provider
      FROM gcp_project
      WHERE ${gcpWhere || 'deleted_at IS NULL'}
    `;

    let dataSql: string;
    let countSql: string;
    let queryParams: unknown[];

    if (provider === 'aws') {
      countSql = `SELECT COUNT(*) AS total FROM aws_account WHERE ${awsWhere}`;
      dataSql = `${awsSql} ORDER BY name LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
      queryParams = [...params, limit, offset];
    } else if (provider === 'gcp') {
      countSql = `SELECT COUNT(*) AS total FROM gcp_project WHERE ${gcpWhere || 'deleted_at IS NULL'}`;
      dataSql = `${gcpSql} ORDER BY name LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
      queryParams = [...params, limit, offset];
    } else {
      const unionSql = `${awsSql} UNION ALL ${gcpSql}`;
      countSql = `SELECT COUNT(*) AS total FROM (${unionSql}) AS combined`;
      dataSql = `${unionSql} ORDER BY name LIMIT $${params.length * 2 + 1} OFFSET $${params.length * 2 + 2}`;
      queryParams = [...params, ...params, limit, offset];
    }

    const countResult = await executeWithTenant<{ total: string }>(
      session.tenantId,
      countSql,
      provider ? params : [...params, ...params],
    );
    const total = parseInt(countResult.rows[0]?.total || '0');

    const dataResult = await executeWithTenant(session.tenantId, dataSql, queryParams);

    return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Resources list error:', error);
    return NextResponse.json({ error: 'Failed to load resources' }, { status: 500 });
  }
}
