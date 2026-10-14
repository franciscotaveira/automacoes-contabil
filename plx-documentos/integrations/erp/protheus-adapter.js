'use strict';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name}_required`);
  return normalized;
}

function mapDocumentToERPFormat(document) {
  return {
    externalId: required(document.correlation_id, 'correlation_id'),
    documentType: required(document.document_type, 'document_type'),
    documentNumber: document.document_number ?? null,
    issueDate: document.reference_date ?? null,
    issuer: { name: document.issuer_name ?? null, taxId: document.issuer_cnpj ?? null },
    recipient: { name: document.recipient_name ?? null, taxId: document.recipient_cnpj ?? null },
    source: { driveFileId: document.drive_file_id ?? null, hash: document.document_hash ?? document.sha256 ?? null },
    policyVersion: document.policy_version ?? null,
  };
}

async function sendToERP(payload, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const baseUrl = required(env.PROTHEUS_BASE_URL, 'protheus_base_url').replace(/\/$/, '');
  const token = required(env.PROTHEUS_API_TOKEN, 'protheus_api_token');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_implementation_required');
  const response = await fetchImpl(`${baseUrl}/documents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': required(payload.externalId, 'external_id') },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`protheus_http_error:${response.status}`);
  const body = await response.json();
  return { ok: true, status: response.status, erp_id: body.id ?? body.documentId ?? null };
}

module.exports = { mapDocumentToERPFormat, sendToERP };
