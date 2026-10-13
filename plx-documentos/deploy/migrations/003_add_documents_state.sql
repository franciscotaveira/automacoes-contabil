-- Definition only. Apply manually during a controlled cutover after backup.
CREATE TABLE IF NOT EXISTS plx_documents (
    id BIGSERIAL PRIMARY KEY,
    correlation_id VARCHAR(255) UNIQUE NOT NULL,
    tenant_id VARCHAR(128),
    operation_id VARCHAR(128),
    session_id VARCHAR(128),
    group_id VARCHAR(255),
    message_id VARCHAR(255),
    document_hash VARCHAR(128),
    state VARCHAR(64) NOT NULL DEFAULT 'RECEIVED',
    policy_version VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT plx_documents_state_valid CHECK (state IN (
        'RECEIVED',
        'SOURCE_STORED',
        'EXTRACTED',
        'CLASSIFIED',
        'ARCHIVE_AUTHORIZED',
        'ARCHIVED',
        'CONFIRMED',
        'REVIEW_REQUIRED',
        'FAILED'
    ))
);

CREATE INDEX IF NOT EXISTS plx_documents_scope_idx
    ON plx_documents (tenant_id, operation_id, group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS plx_documents_state_idx
    ON plx_documents (state, updated_at DESC);

COMMENT ON TABLE plx_documents IS
    'Canonical document state used to reconcile queue, manifest, Drive and notification.';
