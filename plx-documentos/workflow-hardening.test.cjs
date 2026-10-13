'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const workflow = require('./workflows/document-waha-ingest-v1.json');

const node = (name) => workflow.nodes.find((item) => item.name === name);
const edges = (name, branch = 0) => workflow.connections[name]?.main?.[branch] || [];

test('WAHA ingress creates and persists a deterministic correlation id', () => {
  assert.match(node('Validar evento WAHA').parameters.jsCode, /hasMessageId = Boolean/);
  assert.match(node('Validar evento WAHA').parameters.jsCode, /configurationReady && groupId && hasMessageId/);
  assert.match(node('Validar evento WAHA').parameters.jsCode, /reason = 'missing_message_id'/);
  assert.match(node('Validar evento WAHA').parameters.jsCode, /correlation_id: correlationId/);
  assert.equal(node('Registrar manifesto local').parameters.columns.value.correlation_id, '={{ $json.correlation_id ?? "" }}');
  const correlationColumn = node('Registrar manifesto local').parameters.columns.schema.find((column) => column.id === 'correlation_id');
  assert.equal(correlationColumn.required, true);
});

test('accepted documents are persisted before the technical ACK', () => {
  assert.ok(edges('Confirmar arquivo persistido').some((edge) => edge.node === 'Confirmar recebimento técnico'));
  assert.ok(edges('Confirmar recebimento técnico').some((edge) => edge.node === 'Enfileirar análise documental'));
  assert.ok(!edges('Validar evento WAHA').some((edge) => edge.node === 'Confirmar recebimento técnico'));
});

test('ignored events receive a distinct non-persisted ACK', () => {
  assert.ok(edges('Documento autorizado?', 1).some((edge) => edge.node === 'Responder evento ignorado'));
  assert.match(node('Responder evento ignorado').parameters.responseBody, /persisted: false/);
});
