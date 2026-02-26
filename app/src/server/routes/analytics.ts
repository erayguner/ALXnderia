import { NextResponse } from 'next/server';
import { executeWithTenant } from '../db/pool';

function getSession() {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
    role: 'analyst' as const,
  };
}

/**
 * Returns aggregated analytics data for the identity estate.
 *
 * All queries run within a tenant-scoped transaction.
 * Results are assembled from multiple lightweight aggregate queries
 * and returned as a single JSON payload for the dashboard.
 */
export async function handleAnalytics(): Promise<NextResponse> {
  const session = getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    // Run all aggregate queries in parallel for speed
    const [
      totalUsers,
      providerBreakdown,
      accessByProvider,
      accessPathBreakdown,
      topRoles,
      topResources,
      identityCoverage,
      groupSizes,
      reconciliationStatus,
      recentIngestion,
    ] = await Promise.all([
      // 1. Total canonical users
      executeWithTenant(
        session.tenantId,
        `SELECT COUNT(*) AS count FROM canonical_users WHERE deleted_at IS NULL`,
      ),

      // 2. Users per identity provider
      executeWithTenant(
        session.tenantId,
        `SELECT provider_type, COUNT(DISTINCT canonical_user_id) AS user_count
         FROM canonical_user_provider_links
         GROUP BY provider_type
         ORDER BY user_count DESC`,
      ),

      // 3. Access grants per provider
      executeWithTenant(
        session.tenantId,
        `SELECT provider, COUNT(*) AS grant_count,
                COUNT(DISTINCT canonical_user_id) AS user_count,
                COUNT(DISTINCT resource_display_name) AS resource_count
         FROM resource_access_grants
         WHERE deleted_at IS NULL
         GROUP BY provider
         ORDER BY grant_count DESC`,
      ),

      // 4. Access path breakdown (direct vs group)
      executeWithTenant(
        session.tenantId,
        `SELECT access_path, COUNT(*) AS count
         FROM resource_access_grants
         WHERE deleted_at IS NULL
         GROUP BY access_path
         ORDER BY count DESC`,
      ),

      // 5. Top 10 roles/permissions by usage
      executeWithTenant(
        session.tenantId,
        `SELECT role_or_permission, provider, COUNT(*) AS grant_count
         FROM resource_access_grants
         WHERE deleted_at IS NULL
         GROUP BY role_or_permission, provider
         ORDER BY grant_count DESC
         LIMIT 10`,
      ),

      // 6. Top 10 most-accessed resources
      executeWithTenant(
        session.tenantId,
        `SELECT resource_display_name, provider, resource_type,
                COUNT(*) AS grant_count,
                COUNT(DISTINCT canonical_user_id) AS unique_users
         FROM resource_access_grants
         WHERE deleted_at IS NULL
         GROUP BY resource_display_name, provider, resource_type
         ORDER BY unique_users DESC
         LIMIT 10`,
      ),

      // 7. Identity coverage: how many users have 0, 1, 2, 3+ provider links
      executeWithTenant(
        session.tenantId,
        `SELECT link_count, COUNT(*) AS user_count FROM (
           SELECT cu.id, COUNT(pl.id) AS link_count
           FROM canonical_users cu
           LEFT JOIN canonical_user_provider_links pl
             ON pl.canonical_user_id = cu.id AND pl.tenant_id = cu.tenant_id
           WHERE cu.deleted_at IS NULL
           GROUP BY cu.id
         ) AS t
         GROUP BY link_count
         ORDER BY link_count`,
      ),

      // 8. Largest groups (top 10 across all providers)
      executeWithTenant(
        session.tenantId,
        `SELECT group_name, provider, member_count FROM (
           SELECT g.name AS group_name, 'google' AS provider, COUNT(gm.id) AS member_count
           FROM google_workspace_groups g
           LEFT JOIN google_workspace_memberships gm
             ON gm.group_id = g.google_id AND gm.tenant_id = g.tenant_id AND gm.deleted_at IS NULL
           WHERE g.deleted_at IS NULL
           GROUP BY g.name
           UNION ALL
           SELECT g.display_name AS group_name, 'aws' AS provider, COUNT(am.id) AS member_count
           FROM aws_identity_center_groups g
           LEFT JOIN aws_identity_center_memberships am
             ON am.group_id = g.group_id AND am.identity_store_id = g.identity_store_id
             AND am.tenant_id = g.tenant_id AND am.deleted_at IS NULL
           WHERE g.deleted_at IS NULL
           GROUP BY g.display_name
           UNION ALL
           SELECT gt.name AS group_name, 'github' AS provider, COUNT(tm.id) AS member_count
           FROM github_teams gt
           LEFT JOIN github_team_memberships tm
             ON tm.team_node_id = gt.node_id AND tm.tenant_id = gt.tenant_id AND tm.deleted_at IS NULL
           WHERE gt.deleted_at IS NULL
           GROUP BY gt.name
         ) AS all_groups
         ORDER BY member_count DESC
         LIMIT 10`,
      ),

      // 9. Identity reconciliation status
      executeWithTenant(
        session.tenantId,
        `SELECT status, COUNT(*) AS count
         FROM identity_reconciliation_queue
         GROUP BY status
         ORDER BY count DESC`,
      ),

      // 10. Recent ingestion runs
      executeWithTenant(
        session.tenantId,
        `SELECT provider, entity_type, status, records_upserted, records_deleted,
                started_at, finished_at
         FROM ingestion_runs
         ORDER BY started_at DESC
         LIMIT 10`,
      ),
    ]);

    return NextResponse.json({
      summary: {
        totalUsers: Number(totalUsers.rows[0]?.count ?? 0),
        totalAccessGrants: accessByProvider.rows.reduce(
          (sum: number, r: Record<string, unknown>) => sum + Number(r.grant_count),
          0,
        ),
        totalResources: accessByProvider.rows.reduce(
          (sum: number, r: Record<string, unknown>) => sum + Number(r.resource_count),
          0,
        ),
        providerCount: providerBreakdown.rows.length,
      },
      providerBreakdown: providerBreakdown.rows,
      accessByProvider: accessByProvider.rows,
      accessPathBreakdown: accessPathBreakdown.rows,
      topRoles: topRoles.rows,
      topResources: topResources.rows,
      identityCoverage: identityCoverage.rows,
      groupSizes: groupSizes.rows,
      reconciliationStatus: reconciliationStatus.rows,
      recentIngestion: recentIngestion.rows,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
