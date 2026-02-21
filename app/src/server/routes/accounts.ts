import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
    role: 'analyst' as const,
  };
}

type AccountProvider = 'aws' | 'gcp';

// ---------------------------------------------------------------------------
// List: AWS accounts + GCP projects
// ---------------------------------------------------------------------------

export async function handleAccountList(req: NextRequest): Promise<NextResponse> {
  const session = getSession();
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const search = url.searchParams.get('search');
  const provider = url.searchParams.get('provider') as AccountProvider | null;
  const offset = (page - 1) * limit;

  const params: unknown[] = [];
  let paramIdx = 1;

  let searchClause = '';
  if (search) {
    searchClause = `AND (name ILIKE $${paramIdx} OR account_id ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  const gcpSearchClause = search
    ? `AND (display_name ILIKE $1 OR project_id ILIKE $1)`
    : '';

  try {
    if (provider === 'aws') {
      const countSql = `SELECT COUNT(*) AS total FROM aws_accounts WHERE deleted_at IS NULL ${searchClause}`;
      const dataSql = `
        SELECT a.id, a.account_id, a.name, a.email, a.status, a.org_id, a.last_synced_at,
               'aws' AS provider,
               (SELECT COUNT(*) FROM aws_account_assignments aa
                WHERE aa.account_id = a.account_id AND aa.tenant_id = a.tenant_id
                  AND aa.deleted_at IS NULL) AS access_count
        FROM aws_accounts a
        WHERE a.deleted_at IS NULL ${searchClause}
        ORDER BY a.name
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `;
      const countResult = await executeWithTenant<{ total: string }>(session.tenantId, countSql, params);
      const total = parseInt(countResult.rows[0]?.total || '0');
      const dataResult = await executeWithTenant(session.tenantId, dataSql, [...params, limit, offset]);
      return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }

    if (provider === 'gcp') {
      const gcpParams = search ? [`%${search}%`] : [];
      let gcpIdx = gcpParams.length + 1;
      const countSql = `SELECT COUNT(*) AS total FROM gcp_projects WHERE deleted_at IS NULL ${gcpSearchClause}`;
      const dataSql = `
        SELECT p.id, p.project_id, p.project_number, p.display_name AS name, p.lifecycle_state AS status,
               p.org_id, p.last_synced_at, 'gcp' AS provider,
               (SELECT COUNT(*) FROM gcp_project_iam_bindings ib
                WHERE ib.project_id = p.project_id AND ib.tenant_id = p.tenant_id
                  AND ib.deleted_at IS NULL) AS access_count
        FROM gcp_projects p
        WHERE p.deleted_at IS NULL ${gcpSearchClause}
        ORDER BY p.display_name
        LIMIT $${gcpIdx} OFFSET $${gcpIdx + 1}
      `;
      const countResult = await executeWithTenant<{ total: string }>(session.tenantId, countSql, gcpParams);
      const total = parseInt(countResult.rows[0]?.total || '0');
      const dataResult = await executeWithTenant(session.tenantId, dataSql, [...gcpParams, limit, offset]);
      return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }

    // Both providers — UNION ALL with consistent shape
    const awsParams = search ? [`%${search}%`] : [];
    const gcpParams2 = search ? [`%${search}%`] : [];
    const combinedParams = [...awsParams, ...gcpParams2];

    const awsSearchRaw  = search ? `AND (a.name ILIKE $1 OR a.account_id ILIKE $1)` : '';
    const gcpSearchRaw  = search ? `AND (p.display_name ILIKE $${awsParams.length + 1 || 1} OR p.project_id ILIKE $${awsParams.length + 1 || 1})` : '';

    const unionSql = `
      SELECT a.id::text, a.account_id AS resource_id, a.name AS display_name,
             a.status, a.org_id, a.last_synced_at, 'aws' AS provider,
             (SELECT COUNT(*) FROM aws_account_assignments aa
              WHERE aa.account_id = a.account_id AND aa.tenant_id = a.tenant_id
                AND aa.deleted_at IS NULL) AS access_count
      FROM aws_accounts a
      WHERE a.deleted_at IS NULL ${awsSearchRaw}
      UNION ALL
      SELECT p.id::text, p.project_id AS resource_id, COALESCE(p.display_name, p.project_id) AS display_name,
             p.lifecycle_state AS status, p.org_id, p.last_synced_at, 'gcp' AS provider,
             (SELECT COUNT(*) FROM gcp_project_iam_bindings ib
              WHERE ib.project_id = p.project_id AND ib.tenant_id = p.tenant_id
                AND ib.deleted_at IS NULL) AS access_count
      FROM gcp_projects p
      WHERE p.deleted_at IS NULL ${gcpSearchRaw}
    `;

    const countSql = `SELECT COUNT(*) AS total FROM (${unionSql}) AS combined`;
    const countResult = await executeWithTenant<{ total: string }>(session.tenantId, countSql, combinedParams);
    const total = parseInt(countResult.rows[0]?.total || '0');

    const limitIdx = combinedParams.length + 1;
    const offsetIdx = combinedParams.length + 2;
    const dataSql = `${unionSql} ORDER BY provider, display_name LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const dataResult = await executeWithTenant(session.tenantId, dataSql, [...combinedParams, limit, offset]);

    return NextResponse.json({ data: dataResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Account list error:', error);
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Detail: AWS account or GCP project
// ---------------------------------------------------------------------------

export async function handleAccountDetail(req: NextRequest, id: string): Promise<NextResponse> {
  const session = getSession();
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider') as AccountProvider | null;

  try {
    // ── AWS Account ──
    if (!provider || provider === 'aws') {
      const awsAcctSql = `
        SELECT id, account_id, name, email, status, joined_method, joined_at, org_id, parent_id,
               last_synced_at, 'aws' AS provider
        FROM aws_accounts
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
      `;
      const acctResult = await executeWithTenant(session.tenantId, awsAcctSql, [id, session.tenantId]);

      if (acctResult.rows.length > 0) {
        const account = acctResult.rows[0] as Record<string, unknown>;

        // Direct user assignments
        const directSql = `
          SELECT aa.permission_set_name AS role_or_permission, aa.permission_set_arn,
                 'direct' AS access_path, NULL::text AS via_group_name,
                 awu.user_name AS subject_email, awu.display_name AS subject_name,
                 'USER' AS subject_type,
                 cu_link.canonical_user_id
          FROM aws_account_assignments aa
          JOIN aws_identity_center_users awu
            ON aa.principal_id = awu.user_id
           AND aa.identity_store_id = awu.identity_store_id
           AND aa.tenant_id = awu.tenant_id
          LEFT JOIN canonical_user_provider_links cu_link
            ON cu_link.provider_type = 'AWS_IDENTITY_CENTER'
           AND cu_link.provider_user_id = awu.user_id
           AND cu_link.tenant_id = awu.tenant_id
          WHERE aa.account_id = $1 AND aa.principal_type = 'USER'
            AND aa.tenant_id = $2 AND aa.deleted_at IS NULL
        `;

        // Group-expanded assignments
        const groupSql = `
          SELECT aa.permission_set_name AS role_or_permission, aa.permission_set_arn,
                 'group' AS access_path, g.display_name AS via_group_name,
                 awu.user_name AS subject_email, awu.display_name AS subject_name,
                 'USER' AS subject_type,
                 cu_link.canonical_user_id
          FROM aws_account_assignments aa
          JOIN aws_identity_center_groups g
            ON aa.principal_id = g.group_id
           AND aa.identity_store_id = g.identity_store_id
           AND aa.tenant_id = g.tenant_id
          JOIN aws_identity_center_memberships m
            ON m.group_id = g.group_id
           AND m.identity_store_id = g.identity_store_id
           AND m.tenant_id = g.tenant_id
           AND m.deleted_at IS NULL
          JOIN aws_identity_center_users awu
            ON m.member_user_id = awu.user_id
           AND m.identity_store_id = awu.identity_store_id
           AND m.tenant_id = awu.tenant_id
          LEFT JOIN canonical_user_provider_links cu_link
            ON cu_link.provider_type = 'AWS_IDENTITY_CENTER'
           AND cu_link.provider_user_id = awu.user_id
           AND cu_link.tenant_id = awu.tenant_id
          WHERE aa.account_id = $1 AND aa.principal_type = 'GROUP'
            AND aa.tenant_id = $2 AND aa.deleted_at IS NULL
        `;

        // Group-level assignments (without expanding to individual members)
        const groupDirectSql = `
          SELECT aa.permission_set_name AS role_or_permission, aa.permission_set_arn,
                 'group' AS access_path, g.display_name AS via_group_name,
                 g.display_name AS subject_name, NULL::text AS subject_email,
                 'GROUP' AS subject_type, NULL::uuid AS canonical_user_id
          FROM aws_account_assignments aa
          JOIN aws_identity_center_groups g
            ON aa.principal_id = g.group_id
           AND aa.identity_store_id = g.identity_store_id
           AND aa.tenant_id = g.tenant_id
          WHERE aa.account_id = $1 AND aa.principal_type = 'GROUP'
            AND aa.tenant_id = $2 AND aa.deleted_at IS NULL
        `;

        const [directResult, groupResult, groupDirectResult] = await Promise.all([
          executeWithTenant(session.tenantId, directSql, [account.account_id, session.tenantId]),
          executeWithTenant(session.tenantId, groupSql, [account.account_id, session.tenantId]),
          executeWithTenant(session.tenantId, groupDirectSql, [account.account_id, session.tenantId]),
        ]);

        return NextResponse.json({
          account,
          access_entries: [
            ...directResult.rows,
            ...groupResult.rows,
          ],
          group_assignments: groupDirectResult.rows,
        });
      }
    }

    // ── GCP Project ──
    if (!provider || provider === 'gcp') {
      const gcpProjSql = `
        SELECT id, project_id, project_number, display_name AS name, lifecycle_state AS status,
               org_id, folder_id, labels, last_synced_at, 'gcp' AS provider
        FROM gcp_projects
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
      `;
      const projResult = await executeWithTenant(session.tenantId, gcpProjSql, [id, session.tenantId]);

      if (projResult.rows.length > 0) {
        const project = projResult.rows[0] as Record<string, unknown>;

        // Direct IAM bindings (user + serviceAccount)
        const directIamSql = `
          SELECT b.role AS role_or_permission, b.member_type AS subject_type,
                 b.member_id AS subject_email,
                 COALESCE(gwu.name_full, b.member_id) AS subject_name,
                 'direct' AS access_path, NULL::text AS via_group_name,
                 b.condition_title, b.condition_expression,
                 cu_link.canonical_user_id
          FROM gcp_project_iam_bindings b
          LEFT JOIN google_workspace_users gwu
            ON gwu.primary_email = b.member_id AND gwu.tenant_id = b.tenant_id
          LEFT JOIN canonical_user_provider_links cu_link
            ON cu_link.provider_type = 'GOOGLE_WORKSPACE'
           AND cu_link.provider_user_id = gwu.google_id
           AND cu_link.tenant_id = gwu.tenant_id
          WHERE b.project_id = $1 AND b.member_type IN ('user', 'serviceAccount', 'allUsers', 'allAuthenticatedUsers', 'domain')
            AND b.tenant_id = $2 AND b.deleted_at IS NULL
          ORDER BY b.role, b.member_id
        `;

        // Group IAM bindings (expanded to members via Google Workspace)
        const groupIamSql = `
          SELECT b.role AS role_or_permission, 'user' AS subject_type,
                 gwu.primary_email AS subject_email,
                 COALESCE(gwu.name_full, gwu.primary_email) AS subject_name,
                 'group' AS access_path, gwg.name AS via_group_name,
                 NULL::text AS condition_title, NULL::text AS condition_expression,
                 cu_link.canonical_user_id
          FROM gcp_project_iam_bindings b
          JOIN google_workspace_groups gwg
            ON gwg.email = b.member_id AND gwg.tenant_id = b.tenant_id
          JOIN google_workspace_memberships m
            ON m.group_id = gwg.google_id AND m.tenant_id = gwg.tenant_id AND m.deleted_at IS NULL
          JOIN google_workspace_users gwu
            ON gwu.google_id = m.member_id AND gwu.tenant_id = m.tenant_id
          LEFT JOIN canonical_user_provider_links cu_link
            ON cu_link.provider_type = 'GOOGLE_WORKSPACE'
           AND cu_link.provider_user_id = gwu.google_id
           AND cu_link.tenant_id = gwu.tenant_id
          WHERE b.project_id = $1 AND b.member_type = 'group'
            AND b.tenant_id = $2 AND b.deleted_at IS NULL
        `;

        // Group-level summary (without expanding)
        const groupSummarySql = `
          SELECT b.role AS role_or_permission, 'group' AS subject_type,
                 b.member_id AS subject_email,
                 COALESCE(gwg.name, b.member_id) AS subject_name,
                 'group' AS access_path, NULL::text AS via_group_name,
                 b.condition_title, b.condition_expression,
                 NULL::uuid AS canonical_user_id
          FROM gcp_project_iam_bindings b
          LEFT JOIN google_workspace_groups gwg
            ON gwg.email = b.member_id AND gwg.tenant_id = b.tenant_id
          WHERE b.project_id = $1 AND b.member_type = 'group'
            AND b.tenant_id = $2 AND b.deleted_at IS NULL
          ORDER BY b.role, b.member_id
        `;

        const [directResult, groupResult, groupSummaryResult] = await Promise.all([
          executeWithTenant(session.tenantId, directIamSql, [project.project_id, session.tenantId]),
          executeWithTenant(session.tenantId, groupIamSql, [project.project_id, session.tenantId]),
          executeWithTenant(session.tenantId, groupSummarySql, [project.project_id, session.tenantId]),
        ]);

        return NextResponse.json({
          account: project,
          access_entries: [
            ...directResult.rows,
            ...groupResult.rows,
          ],
          group_assignments: groupSummaryResult.rows,
        });
      }
    }

    return NextResponse.json({ error: 'Account or project not found' }, { status: 404 });
  } catch (error) {
    console.error('Account detail error:', error);
    return NextResponse.json({ error: 'Failed to load account details' }, { status: 500 });
  }
}
