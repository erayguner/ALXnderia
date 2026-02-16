import { NextRequest, NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
    role: 'analyst' as const,
  };
}

/**
 * Lists effective access data across all providers.
 *
 * Combines:
 * - GitHub direct collaborator permissions (access_path = 'direct')
 * - GitHub team-derived repo permissions (access_path = 'group')
 * - Google Workspace group memberships as access grants
 * - AWS Identity Center group memberships as access grants
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
  const provider = url.searchParams.get('provider');
  const accessPath = url.searchParams.get('accessPath');
  const offset = (page - 1) * limit;

  // Build per-provider sub-selects, then UNION ALL.
  // Each returns a uniform shape:
  //   display_name, primary_email, cloud_provider, account_or_project_id,
  //   account_or_project_name, role_or_permission_set, access_path, via_group_name, person_id

  const parts: string[] = [];
  const allParams: unknown[] = [];
  let paramIdx = 1;

  // We might need a search placeholder index
  let searchIdx: number | null = null;
  if (search) {
    allParams.push(`%${search}%`);
    searchIdx = paramIdx++;
  }

  const searchFilter = (cols: string[]) => {
    if (!searchIdx) return '';
    return `AND (${cols.map(c => `${c} ILIKE $${searchIdx}`).join(' OR ')})`;
  };

  // ── GitHub Direct Collaborator Access ──
  if (!provider || provider === 'github') {
    if (!accessPath || accessPath === 'direct') {
      parts.push(`
        SELECT
          COALESCE(u.name, u.login) AS display_name,
          COALESCE(u.email, u.login) AS primary_email,
          'github' AS cloud_provider,
          r.full_name AS account_or_project_id,
          r.name AS account_or_project_name,
          perm.permission AS role_or_permission_set,
          'direct' AS access_path,
          NULL::text AS via_group_name,
          cu.id AS person_id
        FROM github_repo_collaborator_permissions perm
        JOIN github_repositories r ON perm.repo_node_id = r.node_id AND perm.tenant_id = r.tenant_id
        JOIN github_users u ON perm.user_node_id = u.node_id AND perm.tenant_id = u.tenant_id
        LEFT JOIN canonical_user_provider_links pl ON pl.provider_type = 'GITHUB' AND pl.provider_user_id = u.node_id AND pl.tenant_id = u.tenant_id
        LEFT JOIN canonical_users cu ON cu.id = pl.canonical_user_id AND cu.tenant_id = pl.tenant_id
        WHERE perm.deleted_at IS NULL
        ${searchFilter(['u.login', 'u.email', 'r.full_name', 'perm.permission'])}
      `);
    }

    // ── GitHub Team-Derived Access ──
    if (!accessPath || accessPath === 'group') {
      parts.push(`
        SELECT
          COALESCE(u.name, u.login) AS display_name,
          COALESCE(u.email, u.login) AS primary_email,
          'github' AS cloud_provider,
          r.full_name AS account_or_project_id,
          r.name AS account_or_project_name,
          tp.permission AS role_or_permission_set,
          'group' AS access_path,
          t.name AS via_group_name,
          cu.id AS person_id
        FROM github_repo_team_permissions tp
        JOIN github_teams t ON tp.team_node_id = t.node_id AND tp.tenant_id = t.tenant_id
        JOIN github_team_memberships tm ON tm.team_node_id = t.node_id AND tm.tenant_id = t.tenant_id
        JOIN github_users u ON tm.user_node_id = u.node_id AND tm.tenant_id = u.tenant_id
        JOIN github_repositories r ON tp.repo_node_id = r.node_id AND tp.tenant_id = r.tenant_id
        LEFT JOIN canonical_user_provider_links pl ON pl.provider_type = 'GITHUB' AND pl.provider_user_id = u.node_id AND pl.tenant_id = u.tenant_id
        LEFT JOIN canonical_users cu ON cu.id = pl.canonical_user_id AND cu.tenant_id = pl.tenant_id
        WHERE tp.deleted_at IS NULL AND tm.deleted_at IS NULL
        ${searchFilter(['u.login', 'u.email', 'r.full_name', 't.name'])}
      `);
    }
  }

  // ── Google Workspace Group Memberships ──
  if (!provider || provider === 'google') {
    if (!accessPath || accessPath === 'group') {
      parts.push(`
        SELECT
          COALESCE(gwu.name_full, gwu.primary_email) AS display_name,
          gwu.primary_email AS primary_email,
          'google' AS cloud_provider,
          g.email AS account_or_project_id,
          g.name AS account_or_project_name,
          m.role AS role_or_permission_set,
          'group' AS access_path,
          g.name AS via_group_name,
          cu.id AS person_id
        FROM google_workspace_memberships m
        JOIN google_workspace_groups g ON m.group_id = g.google_id AND m.tenant_id = g.tenant_id
        JOIN google_workspace_users gwu ON m.member_id = gwu.google_id AND m.tenant_id = gwu.tenant_id
        LEFT JOIN canonical_user_provider_links pl ON pl.provider_type = 'GOOGLE_WORKSPACE' AND pl.provider_user_id = gwu.google_id AND pl.tenant_id = gwu.tenant_id
        LEFT JOIN canonical_users cu ON cu.id = pl.canonical_user_id AND cu.tenant_id = pl.tenant_id
        WHERE m.deleted_at IS NULL AND g.deleted_at IS NULL
        ${searchFilter(['gwu.name_full', 'gwu.primary_email', 'g.name', 'g.email'])}
      `);
    }
  }

  // ── AWS Identity Center Group Memberships ──
  if (!provider || provider === 'aws') {
    if (!accessPath || accessPath === 'group') {
      parts.push(`
        SELECT
          COALESCE(awu.display_name, awu.user_name) AS display_name,
          awu.user_name AS primary_email,
          'aws' AS cloud_provider,
          g.identity_store_id AS account_or_project_id,
          g.display_name AS account_or_project_name,
          'MEMBER' AS role_or_permission_set,
          'group' AS access_path,
          g.display_name AS via_group_name,
          cu.id AS person_id
        FROM aws_identity_center_memberships m
        JOIN aws_identity_center_groups g ON m.group_id = g.group_id AND m.identity_store_id = g.identity_store_id AND m.tenant_id = g.tenant_id
        JOIN aws_identity_center_users awu ON m.member_user_id = awu.user_id AND m.identity_store_id = awu.identity_store_id AND m.tenant_id = awu.tenant_id
        LEFT JOIN canonical_user_provider_links pl ON pl.provider_type = 'AWS_IDENTITY_CENTER' AND pl.provider_user_id = awu.user_id AND pl.tenant_id = awu.tenant_id
        LEFT JOIN canonical_users cu ON cu.id = pl.canonical_user_id AND cu.tenant_id = pl.tenant_id
        WHERE m.deleted_at IS NULL AND g.deleted_at IS NULL
        ${searchFilter(['awu.display_name', 'awu.user_name', 'g.display_name'])}
      `);
    }
  }

  if (parts.length === 0) {
    return NextResponse.json({ data: [], total: 0, page, limit, totalPages: 0 });
  }

  const unionSql = parts.join('\nUNION ALL\n');

  const countSql = `SELECT COUNT(*) AS total FROM (${unionSql}) AS combined`;
  const limitIdx = paramIdx++;
  const offsetIdx = paramIdx++;
  const dataSql = `SELECT display_name, primary_email, cloud_provider, account_or_project_id,
    account_or_project_name, role_or_permission_set, access_path, via_group_name, person_id
    FROM (${unionSql}) AS combined
    ORDER BY cloud_provider, display_name
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  try {
    const countResult = await executeWithTenant<{ total: string }>(
      session.tenantId,
      countSql,
      allParams,
    );
    const total = parseInt(countResult.rows[0]?.total || '0');

    const dataResult = await executeWithTenant(
      session.tenantId,
      dataSql,
      [...allParams, limit, offset],
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
