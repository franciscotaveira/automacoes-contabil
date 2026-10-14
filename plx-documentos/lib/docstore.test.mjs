import assert from 'node:assert/strict';
import test from 'node:test';
import docstoreModule from './docstore.js';

const { createInMemoryDocStore } = docstoreModule;

test('public docstore interface creates, reads and advances one document', () => {
  const store = createInMemoryDocStore({ clock: () => '2026-10-13T00:00:00.000Z' });
  const created = store.ensureDocument('tenant:group:message', { tenant_id: 'tenant' });
  const duplicate = store.ensureDocument('tenant:group:message', { tenant_id: 'ignored' });
  assert.equal(created.state, 'RECEIVED');
  assert.equal(duplicate.tenant_id, 'tenant');
  assert.equal(store.getDocument('tenant:group:message').correlation_id, 'tenant:group:message');
  assert.equal(store.updateState('tenant:group:message', 'SOURCE_STORED').state, 'SOURCE_STORED');
});
