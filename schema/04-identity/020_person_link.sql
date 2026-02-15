-- 04-identity · Person ↔ Provider Identity Linkage
CREATE TABLE IF NOT EXISTS person_link (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenant(id),
    person_id              UUID NOT NULL REFERENCES person(id),

    provider_code          TEXT NOT NULL REFERENCES cloud_provider(provider_code),
    provider_identity_id   UUID NOT NULL,
    identity_type          TEXT NOT NULL,

    linkage_strategy       TEXT NOT NULL,
    confidence             NUMERIC(3,2) DEFAULT 1.00
                               CHECK (confidence BETWEEN 0 AND 1),
    linked_by              TEXT,
    linked_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes                  TEXT,

    CONSTRAINT uq_person_link UNIQUE (tenant_id, identity_type, provider_identity_id),
    CONSTRAINT ck_identity_type CHECK (identity_type ~ '^[a-z][a-z0-9_]+$')
);
