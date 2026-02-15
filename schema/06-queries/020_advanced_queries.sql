-- ============================================================
-- Advanced Queries (10 required + extras)
-- Replace {{TENANT_UUID}}, {{PERSON_UUID}}, {{ACCOUNT_UUID}},
-- {{PROJECT_ID}}, {{GROUP_UUID}} with actual values.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- Q1: Effective access (direct + via group) for a person
-- ──────────────────────────────────────────────────────────────
SELECT
    cloud_provider,
    account_or_project_id,
    account_or_project_name,
    role_or_permission_set,
    access_path,
    via_group_name
FROM mv_effective_access
WHERE person_id = '{{PERSON_UUID}}'
ORDER BY cloud_provider, account_or_project_id, role_or_permission_set;

-- ──────────────────────────────────────────────────────────────
-- Q2: Who can access a given AWS account?
-- ──────────────────────────────────────────────────────────────
SELECT
    p.display_name,
    p.primary_email,
    ea.role_or_permission_set,
    ea.access_path,
    ea.via_group_name
FROM mv_effective_access ea
JOIN person p ON p.id = ea.person_id
WHERE ea.cloud_provider = 'aws'
  AND ea.account_or_project_id = '123456789012'
ORDER BY ea.role_or_permission_set, p.display_name;

-- ──────────────────────────────────────────────────────────────
-- Q3: Who can access a given GCP project?
-- ──────────────────────────────────────────────────────────────
SELECT
    p.display_name,
    p.primary_email,
    ea.role_or_permission_set,
    ea.access_path,
    ea.via_group_name
FROM mv_effective_access ea
JOIN person p ON p.id = ea.person_id
WHERE ea.cloud_provider = 'gcp'
  AND ea.account_or_project_id = '{{PROJECT_ID}}'
ORDER BY ea.role_or_permission_set, p.display_name;

-- ──────────────────────────────────────────────────────────────
-- Q4: Access review — dormant users with high privilege
--     (not seen in 60 days, with admin/poweruser permission sets)
-- ──────────────────────────────────────────────────────────────
WITH high_priv_patterns AS (
    SELECT unnest(ARRAY[
        '%Admin%', '%PowerUser%', '%FullAccess%',
        'roles/owner', 'roles/editor', 'roles/iam.admin'
    ]) AS pattern
)
SELECT
    p.display_name,
    p.primary_email,
    ea.cloud_provider,
    ea.account_or_project_id,
    ea.role_or_permission_set,
    ea.access_path,
    -- Find the most recent last_seen across all identities
    GREATEST(
        (SELECT MAX(last_seen_at) FROM aws_idc_user WHERE person_id = p.id),
        (SELECT MAX(last_seen_at) FROM aws_iam_user WHERE person_id = p.id),
        (SELECT MAX(last_seen_at) FROM gcp_workspace_user WHERE person_id = p.id)
    ) AS latest_seen_at
FROM mv_effective_access ea
JOIN person p ON p.id = ea.person_id
WHERE EXISTS (
    SELECT 1 FROM high_priv_patterns hp
    WHERE ea.role_or_permission_set ILIKE hp.pattern
)
AND GREATEST(
    (SELECT MAX(last_seen_at) FROM aws_idc_user WHERE person_id = p.id),
    (SELECT MAX(last_seen_at) FROM aws_iam_user WHERE person_id = p.id),
    (SELECT MAX(last_seen_at) FROM gcp_workspace_user WHERE person_id = p.id)
) < now() - INTERVAL '60 days'
ORDER BY latest_seen_at ASC;

-- ──────────────────────────────────────────────────────────────
-- Q5: Anomaly — privilege drift (compare yesterday to today)
--     Shows entitlements that exist today but did NOT exist yesterday.
-- ──────────────────────────────────────────────────────────────
WITH today AS (
    SELECT person_id, cloud_provider, account_or_project_id,
           role_or_permission_set, access_path, via_group_name
    FROM mv_effective_access
    WHERE tenant_id = '{{TENANT_UUID}}'
),
yesterday AS (
    SELECT person_entity_id AS person_id, cloud_provider,
           account_or_project_id, role_or_permission_set,
           access_path, via_group_name
    FROM fn_effective_access_as_of('{{TENANT_UUID}}', now() - INTERVAL '1 day')
)
-- New entitlements (privilege escalation)
SELECT
    'ADDED' AS drift_type,
    t.person_id,
    p.display_name,
    t.cloud_provider,
    t.account_or_project_id,
    t.role_or_permission_set,
    t.access_path
FROM today t
JOIN person p ON p.id = t.person_id
LEFT JOIN yesterday y ON y.person_id = t.person_id
    AND y.cloud_provider = t.cloud_provider
    AND y.account_or_project_id = t.account_or_project_id
    AND y.role_or_permission_set = t.role_or_permission_set
    AND y.access_path = t.access_path
WHERE y.person_id IS NULL

UNION ALL

-- Removed entitlements (privilege reduction)
SELECT
    'REMOVED',
    y.person_id,
    p.display_name,
    y.cloud_provider,
    y.account_or_project_id,
    y.role_or_permission_set,
    y.access_path
FROM yesterday y
JOIN person p ON p.id = y.person_id
LEFT JOIN today t ON t.person_id = y.person_id
    AND t.cloud_provider = y.cloud_provider
    AND t.account_or_project_id = y.account_or_project_id
    AND t.role_or_permission_set = y.role_or_permission_set
    AND t.access_path = y.access_path
WHERE t.person_id IS NULL

ORDER BY drift_type, person_id;

-- ──────────────────────────────────────────────────────────────
-- Q6: Snapshot generation — record current state of all AWS IDC
--     users for a tenant into entity_history
--     (Typically called by the sync pipeline, not ad-hoc)
-- ──────────────────────────────────────────────────────────────
-- Step 1: Register the snapshot run
INSERT INTO snapshot_registry (tenant_id, provider_code, scope, sync_run_id, started_at)
VALUES ('{{TENANT_UUID}}', 'aws', 'users', 'snap-' || gen_random_uuid()::TEXT, now())
RETURNING id, sync_run_id;

-- Step 2: Insert history rows (using sync_run_id from step 1)
-- This would be done in application code; the SQL pattern is:
/*
INSERT INTO entity_history
    (tenant_id, entity_type, entity_id, provider_code, event_action,
     state_payload, source_system, sync_run_id, previous_hash, integrity_hash)
SELECT
    u.tenant_id,
    'aws_idc_user',
    u.id,
    'aws',
    'SNAPSHOT',
    to_jsonb(u) - 'raw_payload',   -- exclude raw_payload for size
    'sync_pipeline',
    '{{SYNC_RUN_ID}}',
    -- previous_hash and integrity_hash computed by application
    NULL,
    encode(digest('GENESIS' || (to_jsonb(u) - 'raw_payload')::TEXT, 'sha256'), 'hex')
FROM aws_idc_user u
WHERE u.tenant_id = '{{TENANT_UUID}}'
  AND u.disabled_at IS NULL;
*/

-- ──────────────────────────────────────────────────────────────
-- Q7: Reconstruct provider state as-of a timestamp
--     "What did all AWS IDC users look like on 2026-01-15?"
-- ──────────────────────────────────────────────────────────────
SELECT DISTINCT ON (entity_id)
    entity_id,
    event_action,
    event_time,
    state_payload->>'user_name'    AS user_name,
    state_payload->>'email'        AS email,
    state_payload->>'display_name' AS display_name,
    state_payload->>'disabled_at'  AS disabled_at,
    state_payload
FROM entity_history
WHERE tenant_id   = '{{TENANT_UUID}}'
  AND entity_type = 'aws_idc_user'
  AND event_time <= '2026-01-15 23:59:59+00'
ORDER BY entity_id, event_time DESC, id DESC;

-- ──────────────────────────────────────────────────────────────
-- Q8: List deletions in last N days
--     Entities that were removed from the provider
-- ──────────────────────────────────────────────────────────────
SELECT
    entity_type,
    entity_id,
    event_time,
    state_payload->>'display_name' AS display_name,
    state_payload->>'email'        AS email,
    state_payload->>'user_name'    AS user_name,
    source_system,
    sync_run_id
FROM entity_history
WHERE tenant_id    = '{{TENANT_UUID}}'
  AND event_action = 'DELETED'
  AND event_time  >= now() - INTERVAL '30 days'
ORDER BY event_time DESC;

-- ──────────────────────────────────────────────────────────────
-- Q9: Legal-hold export scope
--     Show all data covered by a specific legal hold
-- ──────────────────────────────────────────────────────────────
SELECT
    lh.hold_name,
    lh.description,
    eh.entity_type,
    eh.entity_id,
    eh.event_time,
    eh.event_action,
    eh.state_payload
FROM legal_hold lh
JOIN entity_history eh
    ON eh.tenant_id = lh.tenant_id
   AND (lh.scope_entity_type IS NULL OR eh.entity_type = lh.scope_entity_type)
   AND (lh.scope_entity_id   IS NULL OR eh.entity_id   = lh.scope_entity_id)
   AND eh.event_time BETWEEN lh.hold_from AND COALESCE(lh.hold_until, 'infinity')
WHERE lh.id = '{{LEGAL_HOLD_UUID}}'
ORDER BY eh.entity_type, eh.entity_id, eh.event_time;

-- ──────────────────────────────────────────────────────────────
-- Q10: Verify integrity chain for a specific entity
-- ──────────────────────────────────────────────────────────────
SELECT * FROM verify_entity_integrity_chain(
    '{{TENANT_UUID}}',
    'aws_idc_user',
    '{{ENTITY_UUID}}'
);
-- Empty result = chain is intact.
-- Any rows returned indicate tampering or corruption.

-- ──────────────────────────────────────────────────────────────
-- BONUS Q11: Orphan detection — identities without a linked person
-- ──────────────────────────────────────────────────────────────
SELECT 'aws_iam_user' AS type, id, iam_user_name AS identifier, last_seen_at
FROM aws_iam_user WHERE person_id IS NULL AND deleted_at IS NULL
UNION ALL
SELECT 'aws_idc_user', id, COALESCE(email, user_name), last_seen_at
FROM aws_idc_user WHERE person_id IS NULL AND disabled_at IS NULL
UNION ALL
SELECT 'gcp_workspace_user', id, primary_email, last_seen_at
FROM gcp_workspace_user WHERE person_id IS NULL AND deleted_at IS NULL
ORDER BY type, last_seen_at;

-- ──────────────────────────────────────────────────────────────
-- BONUS Q12: Reconciliation — count diff vs expected source count
--     (expected counts injected by the sync pipeline as metadata)
-- ──────────────────────────────────────────────────────────────
SELECT
    sr.sync_run_id,
    sr.provider_code,
    sr.scope,
    sr.entity_count AS expected_count,
    (SELECT COUNT(*) FROM entity_history eh
     WHERE eh.sync_run_id = sr.sync_run_id) AS actual_count,
    sr.entity_count - (SELECT COUNT(*) FROM entity_history eh
     WHERE eh.sync_run_id = sr.sync_run_id) AS diff
FROM snapshot_registry sr
WHERE sr.tenant_id = '{{TENANT_UUID}}'
  AND sr.status = 'completed'
ORDER BY sr.completed_at DESC
LIMIT 10;
