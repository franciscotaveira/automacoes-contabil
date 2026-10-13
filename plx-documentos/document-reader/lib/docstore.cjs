'use strict';

const STATES = Object.freeze([
  'RECEIVED',
  'SOURCE_STORED',
  'EXTRACTED',
  'CLASSIFIED',
  'ARCHIVE_AUTHORIZED',
  'ARCHIVED',
  'CONFIRMED',
  'REVIEW_REQUIRED',
  'FAILED',
]);

const TRANSITIONS = Object.freeze({
  RECEIVED: new Set(['SOURCE_STORED', 'REVIEW_REQUIRED', 'FAILED']),
  SOURCE_STORED: new Set(['EXTRACTED', 'REVIEW_REQUIRED', 'FAILED']),
  EXTRACTED: new Set(['CLASSIFIED', 'REVIEW_REQUIRED', 'FAILED']),
  CLASSIFIED: new Set(['ARCHIVE_AUTHORIZED', 'REVIEW_REQUIRED', 'FAILED']),
  ARCHIVE_AUTHORIZED: new Set(['ARCHIVED', 'REVIEW_REQUIRED', 'FAILED']),
  ARCHIVED: new Set(['CONFIRMED', 'REVIEW_REQUIRED', 'FAILED']),
  CONFIRMED: new Set([]),
  REVIEW_REQUIRED: new Set(['SOURCE_STORED', 'EXTRACTED', 'CLASSIFIED', 'ARCHIVE_AUTHORIZED', 'ARCHIVED', 'FAILED']),
  FAILED: new Set(['RECEIVED', 'SOURCE_STORED', 'REVIEW_REQUIRED']),
});

const cleanId = (value) => String(value ?? '').trim();

function clone(record) {
  return record ? structuredClone(record) : null;
}

function createInMemoryDocStore({ clock = () => new Date().toISOString() } = {}) {
  const records = new Map();

  function ensureDocument(correlationId, props = {}) {
    const id = cleanId(correlationId);
    if (!id) throw new Error('correlation_id_required');
    const existing = records.get(id);
    if (existing) return clone(existing);
    const now = clock();
    const record = {
      correlation_id: id,
      tenant_id: cleanId(props.tenant_id) || null,
      operation_id: cleanId(props.operation_id) || null,
      session_id: cleanId(props.session_id) || null,
      group_id: cleanId(props.group_id) || null,
      message_id: cleanId(props.message_id) || null,
      document_hash: cleanId(props.document_hash) || null,
      state: 'RECEIVED',
      policy_version: cleanId(props.policy_version) || null,
      created_at: now,
      updated_at: now,
      metadata: { ...(props.metadata || {}) },
    };
    records.set(id, record);
    return clone(record);
  }

  function updateState(correlationId, nextState, extra = {}) {
    const id = cleanId(correlationId);
    const target = cleanId(nextState).toUpperCase();
    if (!STATES.includes(target)) throw new Error(`document_state_invalid:${target}`);
    const record = records.get(id);
    if (!record) throw new Error('document_not_found');
    if (record.state !== target && !TRANSITIONS[record.state]?.has(target)) {
      throw new Error(`document_state_transition_invalid:${record.state}:${target}`);
    }
    const updated = {
      ...record,
      ...extra,
      correlation_id: id,
      state: target,
      updated_at: clock(),
      metadata: { ...record.metadata, ...(extra.metadata || {}) },
    };
    records.set(id, updated);
    return clone(updated);
  }

  return {
    ensureDocument,
    updateState,
    getDocument: (correlationId) => clone(records.get(cleanId(correlationId))),
    clear: () => records.clear(),
  };
}

const defaultDocStore = createInMemoryDocStore();

module.exports = {
  STATES,
  TRANSITIONS,
  createInMemoryDocStore,
  defaultDocStore,
  ensureDocument: defaultDocStore.ensureDocument,
  getDocument: defaultDocStore.getDocument,
  updateState: defaultDocStore.updateState,
  // TODO(production): replace the in-memory adapter with PostgreSQL using
  // deploy/migrations/003_add_documents_state.sql behind the same interface.
};
