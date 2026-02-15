import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
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
    searchClause = `AND (cu.full_name ILIKE $${paramIdx} OR cu.primary_email ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  const countSql = `SELECT COUNT(*) AS total FROM canonical_users cu WHERE cu.deleted_at IS NULL ${searchClause}`;
  const dataSql = `
    SELECT cu.id, cu.full_name, cu.primary_email,
           cu.created_at, cu.updated_at,
           (SELECT COUNT(*) FROM canonical_user_provider_links pl
            WHERE pl.canonical_user_id = cu.id AND pl.tenant_id = cu.tenant_id) AS identity_count
    FROM canonical_users cu
    WHERE cu.deleted_at IS NULL ${searchClause}
    ORDER BY cu.full_name
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
    // Canonical user info with linked identities
    const personResult = await executeWithTenant(session.tenantId,
      `SELECT cu.*,
              (SELECT json_agg(json_build_object(
                'provider_type', pl.provider_type, 'provider_user_id', pl.provider_user_id,
                'confidence_score', pl.confidence_score, 'match_method', pl.match_method
              )) FROM canonical_user_provider_links pl
              WHERE pl.canonical_user_id = cu.id AND pl.tenant_id = cu.tenant_id) AS linked_identities,
              (SELECT json_agg(json_build_object(
                'email', ce.email, 'is_primary', ce.is_primary, 'verified_at', ce.verified_at
              )) FROM canonical_emails ce
              WHERE ce.canonical_user_id = cu.id AND ce.tenant_id = cu.tenant_id) AS emails,
              (SELECT json_agg(json_build_object(
                'id', gwu.id, 'google_id', gwu.google_id, 'primary_email', gwu.primary_email,
                'name_full', gwu.name_full, 'is_admin', gwu.is_admin,
                'suspended', gwu.suspended, 'last_login_time', gwu.last_login_time
              )) FROM google_workspace_users gwu
              JOIN canonical_user_provider_links pl2
                ON pl2.provider_type = 'GOOGLE_WORKSPACE'
                AND pl2.provider_user_id = gwu.google_id
                AND pl2.tenant_id = gwu.tenant_id
              WHERE pl2.canonical_user_id = cu.id AND pl2.tenant_id = cu.tenant_id) AS google_identities,
              (SELECT json_agg(json_build_object(
                'id', awu.id, 'user_name', awu.user_name,
                'display_name', awu.display_name, 'active', awu.active
              )) FROM aws_identity_center_users awu
              JOIN canonical_user_provider_links pl3
                ON pl3.provider_type = 'AWS_IDENTITY_CENTER'
                AND pl3.provider_user_id = awu.user_id
                AND pl3.tenant_id = awu.tenant_id
              WHERE pl3.canonical_user_id = cu.id AND pl3.tenant_id = cu.tenant_id) AS aws_idc_identities,
              (SELECT json_agg(json_build_object(
                'id', gu.id, 'login', gu.login, 'email', gu.email,
                'name', gu.name, 'type', gu.type
              )) FROM github_users gu
              JOIN canonical_user_provider_links pl4
                ON pl4.provider_type = 'GITHUB'
                AND pl4.provider_user_id = gu.node_id
                AND pl4.tenant_id = gu.tenant_id
              WHERE pl4.canonical_user_id = cu.id AND pl4.tenant_id = cu.tenant_id) AS github_identities
       FROM canonical_users cu WHERE cu.id = $1`,
      [id],
    );

    if (personResult.rowCount === 0) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    }

    return NextResponse.json({
      person: personResult.rows[0],
    });
  } catch (error) {
    console.error('Person detail error:', error);
    return NextResponse.json({ error: 'Failed to load person' }, { status: 500 });
  }
}
