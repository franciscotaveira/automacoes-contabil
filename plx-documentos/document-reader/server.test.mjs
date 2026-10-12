import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDocumentReviewPolicy,
  extractDeterministicSignals,
  fiscalDocumentTypeFromAccessKey,
  isReferenceDateSourceAllowed,
  parseFiscalXml,
  scoreLocalText,
  sniffMime,
  validateCnpj,
  validateFiscalAccessKey,
} from './server.mjs';

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
