-- ============================================================
-- 09-history · Hash Chain Verification Function
-- ============================================================
-- Verifies the integrity chain for a specific entity.
-- Returns rows where the chain is broken (hash mismatch).
-- An empty result set means the chain is intact.
-- ============================================================

CREATE OR REPLACE FUNCTION verify_entity_integrity_chain(
    p_tenant_id   UUID,
    p_entity_type TEXT,
    p_entity_id   UUID
)
RETURNS TABLE (
    history_id      BIGINT,
    event_time      TIMESTAMPTZ,
    expected_hash   TEXT,
    actual_hash     TEXT,
    status          TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH ordered AS (
        SELECT
            eh.id,
            eh.event_time,
            eh.previous_hash,
            eh.integrity_hash,
            eh.state_payload,
            LAG(eh.integrity_hash) OVER (ORDER BY eh.event_time, eh.id) AS lag_hash
        FROM entity_history eh
        WHERE eh.tenant_id   = p_tenant_id
          AND eh.entity_type = p_entity_type
          AND eh.entity_id   = p_entity_id
        ORDER BY eh.event_time, eh.id
    ),
    verified AS (
        SELECT
            o.id,
            o.event_time,
            -- Recompute what the hash should be
            encode(
                digest(
                    COALESCE(o.lag_hash, 'GENESIS') || o.state_payload::TEXT,
                    'sha256'
                ),
                'hex'
            ) AS expected,
            o.integrity_hash AS actual,
            -- Check previous_hash pointer
            o.previous_hash,
            o.lag_hash
        FROM ordered o
    )
    SELECT
        v.id,
        v.event_time,
        v.expected,
        v.actual,
        CASE
            WHEN v.expected <> v.actual THEN 'HASH_MISMATCH'
            WHEN v.previous_hash IS DISTINCT FROM v.lag_hash THEN 'CHAIN_POINTER_MISMATCH'
            ELSE 'OK'
        END
    FROM verified v
    WHERE v.expected <> v.actual
       OR v.previous_hash IS DISTINCT FROM v.lag_hash;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant to audit role
GRANT EXECUTE ON FUNCTION verify_entity_integrity_chain(UUID, TEXT, UUID) TO cloudintel_audit;
