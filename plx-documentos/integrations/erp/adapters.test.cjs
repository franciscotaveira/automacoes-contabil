'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mapDocumentToERPFormat, sendToERP } = require('./protheus-adapter.js');
const { mapDocumentToContaAzul, sendToContaAzul } = require('./contaazul-adapter.js');

const document = { correlation_id: 'tenant:group:message', document_type: 'nf-e', document_number: '42', issuer_name: 'Fornecedor', issuer_cnpj: '12345678000195', drive_file_id: 'drive-1' };

test('Protheus mapping preserves correlation as external id', async () => {
  const payload = mapDocumentToERPFormat(document);
  assert.equal(payload.externalId, document.correlation_id);
  let request;
  const result = await sendToERP(payload, { env: { PROTHEUS_BASE_URL: 'https://erp.example.test', PROTHEUS_API_TOKEN: 'fixture' }, fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, status: 201, json: async () => ({ id: 'erp-1' }) };
  } });
  assert.equal(request.options.headers['idempotency-key'], document.correlation_id);
  assert.equal(result.erp_id, 'erp-1');
});

test('Conta Azul connector is configured only through env values', async () => {
  const payload = mapDocumentToContaAzul(document);
  const result = await sendToContaAzul(payload, { env: { CONTAAZUL_DOCUMENT_ENDPOINT: 'https://api.example.test/documents', CONTAAZUL_ACCESS_TOKEN: 'fixture' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: 'ca-1' }) }) });
  assert.equal(result.remote_id, 'ca-1');
  await assert.rejects(() => sendToContaAzul(payload, { env: {}, fetchImpl: async () => ({}) }), /endpoint_required/);
});
