'use strict';

function mapDocumentToContaAzul(document) {
  if (!document?.correlation_id) throw new Error('correlation_id_required');
  return {
    external_reference: String(document.correlation_id),
    number: document.document_number ?? null,
    issue_date: document.reference_date ?? null,
    description: `${document.document_type ?? 'documento'} recebido pela automação documental`,
    supplier: { name: document.issuer_name ?? null, federal_tax_id: document.issuer_cnpj ?? null },
    attachment_reference: document.drive_file_id ?? null,
  };
}

async function sendToContaAzul(payload, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const endpoint = String(env.CONTAAZUL_DOCUMENT_ENDPOINT ?? '').trim();
  const token = String(env.CONTAAZUL_ACCESS_TOKEN ?? '').trim();
  if (!endpoint) throw new Error('contaazul_document_endpoint_required');
  if (!token) throw new Error('contaazul_access_token_required');
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': payload.external_reference },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`contaazul_http_error:${response.status}`);
  const body = await response.json();
  return { ok: true, status: response.status, remote_id: body.id ?? null };
}

module.exports = { mapDocumentToContaAzul, sendToContaAzul };
