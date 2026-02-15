import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    role: 'analyst' as const,
  };
}

export async function handlePeopleList(req: NextRequest): Promise<NextResponse> {
  const session = getSession();
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const search = url.searchParams.get('search');
  const offset = (page - 1) * limit;

  const params: unknown[] = [];
  let paramIdx = 1;
  let searchClause = '';

  if (search) {
    searchClause = `AND (p.display_name ILIKE $${paramIdx} OR p.primary_email ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  const countSql = `SELECT COUNT(*) AS total FROM person p WHERE p.deleted_at IS NULL ${searchClause}`;
  const dataSql = `
    SELECT p.id, p.display_name, p.primary_email, p.status, p.hr_employee_id,
           p.created_at, p.updated_at,
           (SELECT COUNT(*) FROM person_link pl WHERE pl.person_id = p.id) AS identity_count,
           (SELECT COUNT(*) FROM mv_effective_access ea WHERE ea.person_id = p.id) AS entitlement_count
    FROM person p
    WHERE p.deleted_at IS NULL ${searchClause}
    ORDER BY p.display_name
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;

  try {
    const countResult = await executeWithTenant<{ total: string }>(session.tenantId, countSql, params);
    const total = parseInt(countResult.rows[0]?.total || '0');

    const dataResult = await executeWithTenant(session.tenantId, dataSql, [...params, limit, offset]);

    return NextResponse.json({
      data: dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('People list error:', error);
    return NextResponse.json({ error: 'Failed to load people' }, { status: 500 });
  }
}

export async function handlePersonDetail(req: NextRequest, id: string): Promise<NextResponse> {
  const session = getSession();

  try {
    // Person info
    const personResult = await executeWithTenant(session.tenantId,
      `SELECT p.*,
              (SELECT json_agg(json_build_object(
                'type', pl.identity_type, 'provider', pl.provider_code,
                'confidence', pl.confidence, 'strategy', pl.linkage_strategy
              )) FROM person_link pl WHERE pl.person_id = p.id) AS linked_identities,
              (SELECT json_agg(json_build_object(
                'id', iu.id, 'user_name', iu.user_name, 'email', iu.email,
                'display_name', iu.display_name, 'last_seen_at', iu.last_seen_at,
                'disabled_at', iu.disabled_at
              )) FROM aws_idc_user iu WHERE iu.person_id = p.id) AS aws_idc_identities,
              (SELECT json_agg(json_build_object(
                'id', wu.id, 'primary_email', wu.primary_email,
                'display_name', wu.display_name, 'suspended', wu.suspended,
                'last_seen_at', wu.last_seen_at
              )) FROM gcp_workspace_user wu WHERE wu.person_id = p.id) AS gcp_ws_identities,
              (SELECT json_agg(json_build_object(
                'id', iam.id, 'iam_user_name', iam.iam_user_name, 'arn', iam.arn,
                'last_seen_at', iam.last_seen_at
              )) FROM aws_iam_user iam WHERE iam.person_id = p.id) AS aws_iam_identities
       FROM person p WHERE p.id = $1`,
      [id],
    );

    if (personResult.rowCount === 0) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    }

    // Effective access
    const accessResult = await executeWithTenant(session.tenantId,
      `SELECT cloud_provider, account_or_project_id, account_or_project_name,
              role_or_permission_set, access_path, via_group_name
       FROM mv_effective_access WHERE person_id = $1
       ORDER BY cloud_provider, account_or_project_id`,
      [id],
    );

    return NextResponse.json({
      person: personResult.rows[0],
      access: accessResult.rows,
    });
  } catch (error) {
    console.error('Person detail error:', error);
    return NextResponse.json({ error: 'Failed to load person' }, { status: 500 });
  }
}
