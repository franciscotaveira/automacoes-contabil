'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createInMemoryDocStore } = require('./docstore.js');

test('ensureDocument is idempotent for a correlation id', () => {
  let tick = 0;
  const store = createInMemoryDocStore({ clock: () => `2026-10-13T00:00:0${tick++}.000Z` });
  const first = store.ensureDocument('tenant:group:message', { tenant_id: 'tenant-a' });
  const second = store.ensureDocument('tenant:group:message', { tenant_id: 'tenant-b' });
  assert.equal(first.state, 'RECEIVED');
  assert.equal(second.tenant_id, 'tenant-a');
  assert.equal(first.created_at, second.created_at);
});

test('updateState enforces the canonical transition graph', () => {
  const store = createInMemoryDocStore();
  store.ensureDocument('corr-1');
  const stored = store.updateState('corr-1', 'SOURCE_STORED', { document_hash: 'abc' });
  assert.equal(stored.state, 'SOURCE_STORED');
  assert.equal(stored.document_hash, 'abc');
  assert.throws(() => store.updateState('corr-1', 'CONFIRMED'), /document_state_transition_invalid/);
});

test('review can resume through a controlled transition', () => {
  const store = createInMemoryDocStore();
  store.ensureDocument('corr-2');
  store.updateState('corr-2', 'REVIEW_REQUIRED', { metadata: { reason: 'LOW_CONFIDENCE' } });
  const resumed = store.updateState('corr-2', 'SOURCE_STORED', { metadata: { reviewed_by: 'operator' } });
  assert.equal(resumed.metadata.reason, 'LOW_CONFIDENCE');
  assert.equal(resumed.metadata.reviewed_by, 'operator');
});
