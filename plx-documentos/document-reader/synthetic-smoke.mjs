import { readFile } from 'node:fs/promises';

const gateway = 'http://127.0.0.1:8080';
const binary = await readFile('/tmp/nota-ficticia-giacomelli.png');
const extractionResponse = await fetch(`${gateway}/v1/document/extract`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mime_type: 'image/png', filename: 'nota-ficticia-giacomelli.png', document_base64: binary.toString('base64') }),
});
const extraction = await extractionResponse.json();
if (!extractionResponse.ok || !String(extraction.text || '').trim()) throw new Error(`EXTRACTION_FAILED_${extractionResponse.status}_${extraction.error || ''}`);

const prompt = `Classifique o documento fiscal fictício. Responda somente JSON válido com estas chaves exatas: department, document_type, company_verification, issuer_name, issuer_cnpj, recipient_name, recipient_cnpj, document_number, access_key, reference_date, reference_date_source, total_amount, tax_total, tax_status, confidence, evidence, warnings. Empresa atendida: Giacomelli Transportes. CNPJ cadastrado: 98765432000199. Use null quando ausente e não invente.`;
const nullableString = { type: ['string', 'null'] };
const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    department: { type: 'string', enum: ['fiscal', 'financeiro', 'contabil', 'pessoal', 'revisar'] },
    document_type: { type: 'string', enum: ['nf-e', 'nfs-e', 'nfc-e', 'cupom-fiscal', 'ct-e', 'mdf-e', 'extrato', 'comprovante', 'recibo', 'boleto', 'fatura', 'balancete', 'razao', 'diario', 'dre', 'folha', 'holerite', 'fgts', 'inss', 'guia', 'outro'] },
    company_verification: { type: 'string', enum: ['recipient', 'issuer', 'both', 'none'] },
    issuer_name: nullableString, issuer_cnpj: nullableString, recipient_name: nullableString, recipient_cnpj: nullableString,
    document_number: nullableString, access_key: nullableString, reference_date: nullableString,
    reference_date_source: { type: 'string', enum: ['issue', 'transaction', 'competence', 'received', 'unknown'] },
    total_amount: { type: ['number', 'null'] }, tax_total: { type: ['number', 'null'] },
    tax_status: { type: 'string', enum: ['explicit', 'unavailable'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'object', additionalProperties: false, properties: { type: nullableString, company: nullableString, date: nullableString, amount: nullableString, tax: nullableString }, required: ['type', 'company', 'date', 'amount', 'tax'] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['department', 'document_type', 'company_verification', 'issuer_name', 'issuer_cnpj', 'recipient_name', 'recipient_cnpj', 'document_number', 'access_key', 'reference_date', 'reference_date_source', 'total_amount', 'tax_total', 'tax_status', 'confidence', 'evidence', 'warnings'],
};
const modelResponse = await fetch(`${gateway}/v1/chat/completions`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'nvidia/nemotron-3.5-lightning-30b-a3b', messages: [{ role: 'user', content: `${prompt}\n\nCONTEÚDO EXTRAÍDO:\n${extraction.text}` }], temperature: 0, max_tokens: 1200, seed: 42, guided_json: schema, chat_template_kwargs: { enable_thinking: false } }),
});
const model = await modelResponse.json();
if (!modelResponse.ok) throw new Error(`CLASSIFICATION_FAILED_${modelResponse.status}_${model.error || ''}`);
let raw = String(model.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
const required = ['department', 'document_type', 'company_verification', 'issuer_name', 'recipient_name', 'document_number', 'reference_date', 'total_amount', 'confidence', 'evidence', 'warnings'];
const missing = required.filter((key) => !(key in parsed));
if (missing.length) throw new Error(`MISSING_KEYS_${missing.join('_')}`);
console.log(JSON.stringify({
  ok: true,
  reader_version: extraction.reader_version,
  route: extraction.route,
  provider: extraction.provider,
  local_score: extraction.local_quality?.score,
  fallback_used: extraction.fallback_used,
  extracted_chars: String(extraction.text).replace(/\s/g, '').length,
  model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  document_type: parsed.document_type,
  company_verification: parsed.company_verification,
  confidence: parsed.confidence,
  missing_keys: missing,
}));
