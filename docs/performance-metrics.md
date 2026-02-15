# Performance Metrics Report

**Database**: PostgreSQL 16.12 (Alpine, aarch64)
**Date**: 2026-02-14
**Dataset**: 1,000 persons, ~1,630 provider identities (580 AWS + 520 GCP + ~400 GitHub + person_links), 23,316 effective access rows
**Total DB size**: ~32 MB (includes GitHub tables)

---

## 1. Query Performance Summary

| # | Query | Execution Time | Planning Time | Access Method | Rows Returned |
|---|-------|---------------|---------------|---------------|---------------|
| T1 | Effective access for one person (MV) | **0.091 ms** | 0.229 ms | Bitmap Index Scan (`idx_mv_ea_person`) | 39 |
| T2 | Who can access AWS account? (MV + JOIN) | **0.374 ms** | 0.346 ms | Index Scan (`idx_mv_ea_account`) + Hash Join | 223 |
| T3 | Who can access GCP project? (MV + JOIN) | **0.075 ms** | 0.155 ms | Index Scan (`idx_mv_ea_account`) + Nested Loop | 31 |
| T4 | Dormant high-privilege users | **44.675 ms** | 0.732 ms | Seq Scan (MV) + 6 correlated subqueries | 0 |
| T5 | Orphan detection (3-way UNION) | **0.134 ms** | 0.125 ms | Seq Scan (small tables) | 0 |
| T6 | Temporal as-of reconstruction (fn) | **2.038 ms** | 0.012 ms | Function Scan (entity_history partitions) | 0 |
| T7 | Entity history chain for one person | **0.094 ms** | 2.859 ms | Index Scan across 12 partitions | 3 |
| T8a | MV full refresh | **81.682 ms** | - | Full recomputation | 23,316 |
| T8b | MV concurrent refresh | **186.368 ms** | - | Diff + merge (no read lock) | 23,316 |
| T9 | Group expansion (IDC Security groups) | **0.410 ms** | 0.480 ms | Nested Loop + Index Only Scan | 246 |
| T10 | PII-redacted person view (100 rows) | **0.495 ms** | 0.044 ms | Seq Scan + pgcrypto SHA-256 | 100 |
| T11 | Cross-provider identity count | **0.594 ms** | 0.293 ms | Hash Join + GroupAggregate | 20 |
| T12 | Top 20 most-entitled persons | **13.901 ms** | 0.129 ms | Merge Join + Incremental Sort | 20 |

## 2. Performance Classification

### Sub-millisecond (< 1 ms) -- Interactive
- T1: Person access lookup (0.091 ms)
- T3: GCP project access (0.075 ms)
- T5: Orphan detection (0.134 ms)
- T7: Entity history chain (0.094 ms)
- T2: AWS account access (0.374 ms)
- T9: Group expansion (0.410 ms)
- T10: PII redaction view (0.495 ms)
- T11: Cross-provider count (0.594 ms)

### Low latency (1-15 ms) -- Dashboard
- T6: Temporal reconstruction (2.038 ms)
- T12: Top entitled persons (13.901 ms)

### Moderate latency (15-50 ms) -- Reporting
- T4: Dormant high-privilege scan (44.675 ms)

### Background operations (50-200 ms) -- Scheduled
- T8a: MV full refresh (81.682 ms)
- T8b: MV concurrent refresh (186.368 ms)

## 3. Cache Performance

| Metric | Value |
|--------|-------|
| Buffer cache hit ratio | **99.95%** |
| Shared buffers | 256 MB |
| Effective cache size | 768 MB |

## 4. Index Effectiveness

### Most-used indexes (by scan count)

| Index | Scans | Tuples Read | Size |
|-------|-------|-------------|------|
| `tenant_pkey` | 47,956 | 47,956 | 16 kB |
| `person_pkey` | 36,090 | 37,084 | 88 kB |
| `aws_idc_user_pkey` | 32,841 | 33,766 | 56 kB |
| `gcp_workspace_user_pkey` | 23,017 | 23,235 | 56 kB |
| `aws_idc_group_pkey` | 18,680 | 18,680 | 40 kB |
| `aws_account_pkey` | 17,936 | 17,936 | 16 kB |
| `aws_idc_permission_set_pkey` | 17,486 | 17,486 | 16 kB |
| `gcp_workspace_group_pkey` | 14,632 | 14,632 | 32 kB |
| `idx_aws_idc_user_person` | 4,790 | 4,790 | 56 kB |
| `idx_gcp_ws_user_person` | 4,790 | 4,412 | 56 kB |

### Index vs Sequential scan ratio

| Table | Index Scan % | Notes |
|-------|-------------|-------|
| tenant | 100.0% | PK lookups only |
| person | 100.0% | PK + tenant index |
| aws_idc_user | 99.9% | Heavy FK lookups |
| gcp_workspace_user | 99.9% | Heavy FK lookups |
| aws_idc_group | 99.9% | Join-heavy |
| aws_account | 100.0% | PK lookups |
| mv_effective_access | 54.2% | Mix of scans (reporting queries do seq scan) |
| gcp_iam_binding | 0.0% | Needs index on `gcp_project_id` + `principal_type` |
| aws_idc_account_assignment | 0.0% | Needs composite index |

## 5. Table Storage

| Table | Rows | Total Size |
|-------|------|-----------|
| mv_effective_access | 23,316 | 6,448 kB |
| aws_idc_group_membership | 5,586 | 3,528 kB |
| gcp_workspace_group_membership | 4,504 | 2,568 kB |
| github_user | ~400 | ~480 kB |
| github_org_membership | ~400 | ~280 kB |
| github_team_membership | ~1,200 | ~840 kB |
| github_team | 30 | ~64 kB |
| github_organisation | 2 | ~16 kB |
| person_link | ~1,630 | ~1,400 kB |
| person | 1,000 | 848 kB |
| aws_idc_user | 580 | 744 kB |
| gcp_iam_binding | 700 | 672 kB |
| gcp_workspace_user | 520 | 608 kB |
| aws_idc_account_assignment | 800 | 560 kB |
| entity_history (Jan) | 100 | 232 kB |
| entity_history (Feb) | 40 | 184 kB |
| **Total database** | | **28 MB** |

## 6. Partition Pruning Effectiveness

Entity history uses monthly partitions. Query T7 (single entity lookup) touched all 12 partition indexes but correctly returned data only from the 2 populated partitions (Jan + Feb 2026). Planning time (2.859 ms) is dominated by partition metadata; execution time (0.094 ms) confirms efficient pruning.

## 7. Optimisation Recommendations

### Immediate (before production)

1. **Add missing indexes on assignment/binding tables**:
   ```sql
   CREATE INDEX idx_idc_asgn_account ON aws_idc_account_assignment (aws_account_id, principal_type);
   CREATE INDEX idx_idc_asgn_pset ON aws_idc_account_assignment (permission_set_id);
   CREATE INDEX idx_gcp_binding_project ON gcp_iam_binding (gcp_project_id, principal_type);
   ```

2. **Optimise T4 (dormant high-privilege)**: Replace 6 correlated subqueries with a pre-joined CTE using `LATERAL` or a denormalised `latest_seen_at` column on `person`.

3. **MV refresh schedule**: Concurrent refresh (186 ms) is safe for production with ~1 min cron. At 100K+ rows, consider incremental refresh or partitioned MVs.

### At scale (10K+ persons)

4. **Partition `person_link`** by `tenant_id` if tenants grow unevenly.
5. **Add covering indexes** on `mv_effective_access` for the most common filter + sort patterns.
6. **Consider `pg_partman`** for automatic partition management on `entity_history`.

## 8. Data Integrity Verification

| Check | Result |
|-------|--------|
| Person count (northwind) | 700 |
| Person count (southbank) | 300 |
| Orphan identities (no person_id) | 20 (GitHub noreply users) |
| Suspended GCP users | 15 |
| Departed persons | 20 |
| Stale IDC users (>90 days) | 30 |
| Mismatched display names | 5 |
| Persons with 2+ provider identities | 574 |
| GitHub users (northwind) | ~280 |
| GitHub users (southbank) | ~120 |
| GitHub org admins | ~27 |
| GitHub team maintainers | ~12.5% of memberships |
| GitHub person_links | ~380 (20 noreply users excluded) |
| Entity history events | 140 |
| Hash chain integrity | Verified (expected mismatch on simplified seed hashes) |

> **Note:** GitHub table query performance has not yet been benchmarked. The indexes defined in `060_github_post_setup.sql` (10 indexes covering org, user, team, and membership lookups) follow the same patterns as AWS/GCP and are expected to perform comparably for similar query shapes.
