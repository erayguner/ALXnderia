-- 01 · Reference: cloud_provider
CREATE TABLE IF NOT EXISTS cloud_provider (
    provider_code   TEXT PRIMARY KEY,
    provider_name   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cloud_provider (provider_code, provider_name) VALUES
    ('aws', 'Amazon Web Services'),
    ('gcp', 'Google Cloud Platform'),
    ('azure', 'Microsoft Azure'),
    ('github', 'GitHub')
ON CONFLICT (provider_code) DO NOTHING;
