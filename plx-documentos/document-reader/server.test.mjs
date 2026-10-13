import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDocumentReviewPolicy,
  createServer,
  extractDocument,
  extractDeterministicSignals,
  fiscalDocumentTypeFromAccessKey,
  isReferenceDateSourceAllowed,
  parseFiscalXml,
  parseGuidedResponse,
  reinforceDocument,
  scoreLocalText,
  sniffMime,
  validateCnpj,
  validateFiscalAccessKey,
} from './server.mjs';
import docstoreModule from './lib/docstore.cjs';

const { createInMemoryDocStore } = docstoreModule;

test('parseFiscalXml extracts canonical NF-e fields without a model', () => {
  const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe42260912345678000195550010000012341000012345"><ide><nNF>1234</nNF><dhEmi>2026-09-30T14:29:16-03:00</dhEmi></ide><emit><CNPJ>12345678000195</CNPJ><xNome>EMITENTE LTDA</xNome></emit><dest><CNPJ>98765432000110</CNPJ><xNome>GIACOMELLI TRANSPORTES</xNome></dest><total><ICMSTot><vNF>1250.90</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const result = parseFiscalXml(xml);
  assert.equal(result.fields.issuer_name, 'EMITENTE LTDA');
  assert.equal(result.fields.issuer_cnpj, '12345678000195');
  assert.equal(result.fields.recipient_cnpj, '98765432000110');
  assert.equal(result.fields.document_number, '1234');
  assert.equal(result.fields.total_amount, '1250.90');
  assert.equal(result.fields.access_key, '42260912345678000195550010000012341000012345');
});

test('parseFiscalXml rejects entity declarations', () => {
  assert.throws(() => parseFiscalXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'), /unsafe_xml_declaration/);
});

test('deterministic signals normalize CNPJ, access key, dates and values', () => {
  const key = '42260912345678000195550010000012341000012345';
  const result = extractDeterministicSignals(`CNPJ 12.345.678/0001-95 emissão 30/09/2026 valor R$ 1.250,90 chave ${key}`);
  assert.deepEqual(result.cnpjs, ['12345678000195']);
  assert.deepEqual(result.access_keys, [key]);
  assert.deepEqual(result.dates, ['30/09/2026']);
  assert.ok(result.monetary_values.includes('R$ 1.250,90'));
});

test('validated access key model overrides probabilistic fiscal subtype', () => {
  const key = '43260989347330000161550060000126691795175040';
  assert.equal(validateFiscalAccessKey(key), true);
  assert.equal(fiscalDocumentTypeFromAccessKey(key), 'nf-e');
  const signals = extractDeterministicSignals(`DANFE NF-e chave ${key}`);
  assert.deepEqual(signals.valid_access_keys, [key]);
  assert.deepEqual(signals.invalid_access_keys, []);
  assert.deepEqual(signals.access_key_models, [{ key, model: '55', document_type: 'nf-e' }]);
});

test('invalid access key is observable and cannot govern the document type', () => {
  const key = '43260989347330000161550060000126691795175041';
  assert.equal(validateFiscalAccessKey(key), false);
  assert.equal(fiscalDocumentTypeFromAccessKey(key), null);
  const signals = extractDeterministicSignals(`chave ${key}`);
  assert.deepEqual(signals.valid_access_keys, []);
  assert.deepEqual(signals.invalid_access_keys, [key]);
});

test('local evidence score requires useful document signals', () => {
  assert.equal(scoreLocalText('texto curto').sufficient, false);
  const text = `NOTA FISCAL DANFE\nEmitente 12.345.678/0001-95\nDestinatário GIACOMELLI TRANSPORTES\nEmissão 30/09/2026\nValor total R$ 1.250,90\n${'produto serviço '.repeat(60)}`;
  assert.equal(scoreLocalText(text).sufficient, true);
});

test('sniffMime corrects a false declared type from file signature', () => {
  assert.equal(sniffMime(Buffer.from('%PDF-1.7\n'), 'image/jpeg'), 'application/pdf');
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'application/pdf'), 'image/jpeg');
});

test('non-fiscal documents do not require issuer CNPJ when other evidence exists', () => {
  const result = applyDocumentReviewPolicy({
    document_type: 'comprovante',
    review_required: true,
    review_reason: 'ISSUER_CNPJ_INVALID|ISSUER_CNPJ_NOT_EVIDENCED',
    warnings: [],
  });
  assert.equal(result.review_required, false);
  assert.equal(result.review_reason, '');
  assert.ok(result.warnings.includes('ISSUER_CNPJ_OPTIONAL_FOR_NON_FISCAL_DOCUMENT'));
});

test('fiscal evidence gaps still require governed reinforcement', () => {
  const result = applyDocumentReviewPolicy({
    document_type: 'nf-e',
    review_required: true,
    review_reason: 'FISCAL_ACCESS_KEY_NOT_EVIDENCED|ISSUER_CNPJ_NOT_EVIDENCED',
    warnings: [],
  });
  assert.equal(result.review_required, true);
  assert.equal(result.reinforcement_required, true);
});

test('CNPJ validation rejects malformed identifiers and accepts valid check digits', () => {
  assert.equal(validateCnpj('12.345.678/0001-95'), true);
  assert.equal(validateCnpj('12.345.678/0001-96'), false);
});

test('reference date semantics match the document type', () => {
  assert.equal(isReferenceDateSourceAllowed('comprovante', 'transaction'), true);
  assert.equal(isReferenceDateSourceAllowed('comprovante', 'due'), false);
  assert.equal(isReferenceDateSourceAllowed('nf-e', 'issue'), true);
  assert.equal(isReferenceDateSourceAllowed('nf-e', 'transaction'), false);
  assert.equal(isReferenceDateSourceAllowed('boleto', 'due'), true);
});

test('extractDocument preserves compatibility and exposes correlation metadata when supplied', async () => {
  const xml = '<nfeProc><NFe><infNFe><ide><nNF>1</nNF></ide></infNFe></NFe></nfeProc>';
  const base = { mime_type: 'application/xml', document_base64: Buffer.from(xml).toString('base64') };
  const legacy = await extractDocument(base);
  assert.equal(legacy.metadata, undefined);
  const store = createInMemoryDocStore();
  const correlated = await extractDocument({ ...base, correlation_id: 'tenant:group:message', tenant_id: 'tenant-a' }, { docstore: store });
  assert.equal(correlated.metadata.correlation_id, 'tenant:group:message');
  assert.equal(correlated.metadata.document_state, 'EXTRACTED');
  assert.equal(store.getDocument('tenant:group:message').tenant_id, 'tenant-a');
  assert.equal(correlated.decision_reason, 'LOCAL_EXTRACTION_ACCEPTED');
});

const reinforcementExtraction = {
  text: 'NOTA FISCAL EMITENTE LTDA emissão 30/09/2026',
  route: 'fixture',
  signals: { cnpjs: ['12345678000195'], valid_access_keys: [], dates: ['30/09/2026'] },
};

const guidedResponse = (confidence, id = 'request-test') => ({
  id,
  choices: [{ message: { content: JSON.stringify({
    department: 'fiscal', document_type: 'nfs-e', issuer_name: 'EMITENTE LTDA',
    issuer_cnpj: '12345678000195', recipient_name: null, recipient_cnpj: null,
    document_number: '1', access_key: null, reference_date: '2026-09-30',
    reference_date_source: 'issue', confidence,
    evidence: { type: 'NOTA FISCAL', company: 'EMITENTE LTDA', date: '30/09/2026' }, warnings: [],
  }) } }],
});

test('reinforceDocument accepts a high-confidence governed result', async () => {
  const result = await reinforceDocument({
    correlation_id: 'corr-high',
    current: { document_type: 'outro', review_required: true, review_reason: 'LOW_CONFIDENCE' },
  }, {
    extractDocumentFn: async () => reinforcementExtraction,
    postJsonFn: async () => guidedResponse(0.91),
    enforceConfidence: true,
    minReinforcementConfidence: 0.6,
  });
  assert.equal(result.reinforcement_accepted, true);
  assert.equal(result.reinforcement_confidence, 0.91);
  assert.equal(result.reinforcement_status, 'RESOLVED');
  assert.equal(result.decision_reason, 'REINFORCEMENT_ACCEPTED');
  assert.equal(result.metadata.correlation_id, 'corr-high');
  assert.equal(result.metadata.document_state, 'CLASSIFIED');
  assert.equal(result.metadata.reinforcement_accepted, true);
  assert.ok(result.metadata.evidence_used.includes('NOTA FISCAL'));
});

test('reinforceDocument sends a low-confidence result to human review', async () => {
  const result = await reinforceDocument({
    current: { document_type: 'outro', review_required: true, review_reason: 'LOW_CONFIDENCE' },
  }, {
    extractDocumentFn: async () => reinforcementExtraction,
    postJsonFn: async () => guidedResponse(0.4),
    enforceConfidence: true,
    minReinforcementConfidence: 0.6,
  });
  assert.equal(result.reinforcement_accepted, false);
  assert.equal(result.reinforcement_status, 'UNRESOLVED');
  assert.equal(result.review_required, true);
  assert.match(result.review_reason, /LOW_REINFORCEMENT_CONFIDENCE/);
  assert.equal(result.decision_reason, 'REINFORCEMENT_CONFIDENCE_BELOW_THRESHOLD');
});

test('strict reinforcement rejects valid-looking fields without literal evidence', async () => {
  const result = await reinforceDocument({
    current: { document_type: 'outro', review_required: true, review_reason: 'LOW_CONFIDENCE' },
  }, {
    extractDocumentFn: async () => ({
      text: 'DOCUMENTO SEM IDENTIFICACAO FISCAL LITERAL',
      route: 'fixture',
      signals: { cnpjs: [], valid_access_keys: [], dates: [] },
    }),
    postJsonFn: async () => guidedResponse(0.95, 'request-fabricated-evidence'),
    enforceConfidence: true,
    minReinforcementConfidence: 0.6,
  });
  assert.equal(result.reinforcement_accepted, false);
  assert.equal(result.reinforcement_status, 'UNRESOLVED');
  assert.equal(result.review_required, true);
  assert.equal(result.issuer_cnpj, undefined);
  assert.notEqual(result.document_type, 'nfs-e');
  assert.equal(result.decision_reason, 'REINFORCEMENT_UNRESOLVED');
});

test('parseGuidedResponse returns a specific error for invalid model JSON', () => {
  assert.throws(
    () => parseGuidedResponse({ id: 'request-invalid', choices: [{ message: { content: 'not-json' } }] }),
    /reinforcement_model_invalid_json/,
  );
});

test('metrics endpoint fails closed and accepts the configured shared key', async () => {
  const previous = process.env.METRICS_SHARED_KEY;
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    delete process.env.METRICS_SHARED_KEY;
    assert.equal((await fetch(`${base}/metrics`)).status, 503);
    process.env.METRICS_SHARED_KEY = 'fixture-metrics-key';
    assert.equal((await fetch(`${base}/metrics`)).status, 401);
    const response = await fetch(`${base}/metrics`, { headers: { 'x-metrics-key': 'fixture-metrics-key' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reader_version, 'hybrid-v3.2.0');
    assert.equal(typeof body.metrics.document_extracted_total, 'number');
  } finally {
    if (previous === undefined) delete process.env.METRICS_SHARED_KEY;
    else process.env.METRICS_SHARED_KEY = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});
