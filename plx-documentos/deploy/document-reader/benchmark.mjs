import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const gateway = process.env.GATEWAY_URL || 'http://127.0.0.1:8080';
const rawRoot = process.env.RAW_ROOT || '/tmp/plx-raw';
const inputPath = process.env.BENCHMARK_INPUTS || '/tmp/benchmark-inputs.json';
const outputPath = process.env.BENCHMARK_OUTPUT || '/tmp/hybrid-v3-results.jsonl';
const summaryPath = process.env.BENCHMARK_SUMMARY || '/tmp/hybrid-v3-summary.json';

const company = {
  name: 'Giacomelli Transportes',
  legalName: 'Gilson Antonio Giacomelli Transportes Ltda',
  cnpjs: ['09336455000157'],
  aliases: ['Giacomelli Transportes', 'Gilson Antonio Giacomelli Transportes'],
};

const allowedDepartments = new Set(['fiscal', 'financeiro', 'contabil', 'pessoal', 'revisar']);
const allowedTypes = new Set(['nf-e', 'nfs-e', 'nfc-e', 'cupom-fiscal', 'ct-e', 'mdf-e', 'extrato', 'comprovante', 'recibo', 'boleto', 'fatura', 'balancete', 'razao', 'diario', 'dre', 'folha', 'holerite', 'fgts', 'inss', 'guia', 'outro']);
const fiscalTypes = new Set(['nf-e', 'nfs-e', 'nfc-e', 'cupom-fiscal', 'ct-e', 'mdf-e']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digits = (value) => String(value ?? '').replace(/\D/g, '');
const words = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];

function mimeFor(path) {
  if (/\.pdf$/i.test(path)) return 'application/pdf';
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.xml$/i.test(path)) return 'application/xml';
  return 'application/octet-stream';
}

async function post(path, body, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${gateway}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      lastError = new Error(`${path}_HTTP_${response.status}_${payload.error || ''}`);
      if (![429, 502, 503, 504].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(attempt * 2500);
  }
  throw lastError;
}

function prompt() {
  return [
    'Classifique documentos contábeis brasileiros. Responda SOMENTE um objeto JSON válido, sem markdown.',
    `Empresa atendida confiável: ${company.name}. Razão social: ${company.legalName}.`,
    `CNPJ cadastrado da empresa atendida: ${company.cnpjs.join(', ')}. Apelidos cadastrais: ${company.aliases.join(', ')}.`,
    'Nunca invente. Use null quando não houver evidência.',
    'department: fiscal, financeiro, contabil, pessoal ou revisar.',
    'document_type: nf-e, nfs-e, nfc-e, cupom-fiscal, ct-e, mdf-e, extrato, comprovante, recibo, boleto, fatura, balancete, razao, diario, dre, folha, holerite, fgts, inss, guia ou outro.',
    'company_verification indica onde a empresa atendida aparece: recipient, issuer, both ou none. Compare também pelo CNPJ cadastrado.',
    'Para documento fiscal use a data de emissão. Para comprovante/recibo use transação. Para extrato use competência.',
    'Não trate tributo destacado como pago. Não calcule lucro líquido.',
    'Retorne exatamente estas chaves: department, document_type, company_verification, issuer_name, issuer_cnpj, recipient_name, recipient_cnpj, document_number, access_key, reference_date, reference_date_source, total_amount, tax_total, tax_status, confidence, evidence, warnings.',
    'Strings não podem conter quebras de linha literais. Use null para ausência. warnings deve ser array de strings.',
    'evidence deve ser objeto com as chaves type, company, date, amount e tax, cada valor como string literal do documento ou null.',
    'reference_date deve ser YYYY-MM-DD ou null. reference_date_source: issue, transaction, competence, received ou unknown.',
    'tax_status: explicit ou unavailable.',
  ].join('\n');
}

function parseModelJson(rawValue) {
  let raw = String(rawValue ?? '').trim();
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('MODEL_OUTPUT_INVALID_JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

function parseEvidenceDate(value) {
  const match = String(value ?? '').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!match) return null;
  return match[1] ? `${match[3]}-${match[2]}-${match[1]}` : `${match[4]}-${match[5]}-${match[6]}`;
}

function validate(parsed, extraction, invalidJson = false) {
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [];
  const department = allowedDepartments.has(String(parsed.department ?? '').toLowerCase()) ? String(parsed.department).toLowerCase() : 'revisar';
  const documentType = allowedTypes.has(String(parsed.document_type ?? '').toLowerCase()) ? String(parsed.document_type).toLowerCase() : 'outro';
  const issuerCnpj = digits(parsed.issuer_cnpj);
  const recipientCnpj = digits(parsed.recipient_cnpj);
  const registeredCnpj = company.cnpjs.some((cnpj) => [issuerCnpj, recipientCnpj].includes(cnpj));
  const candidateNames = [parsed.issuer_name, parsed.recipient_name].map(words);
  const nameMatch = candidateNames.some((candidate) => candidate.includes('giacomelli') && candidate.includes('transportes'));
  const companyVerification = registeredCnpj || nameMatch ? (
    company.cnpjs.includes(issuerCnpj) || (words(parsed.issuer_name).includes('giacomelli') && words(parsed.issuer_name).includes('transportes'))
      ? (company.cnpjs.includes(recipientCnpj) || (words(parsed.recipient_name).includes('giacomelli') && words(parsed.recipient_name).includes('transportes')) ? 'both' : 'issuer')
      : 'recipient'
  ) : 'none';
  let referenceDate = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.reference_date ?? '')) ? String(parsed.reference_date) : null;
  let referenceSource = ['issue', 'transaction', 'competence', 'received', 'unknown'].includes(String(parsed.reference_date_source ?? '').toLowerCase()) ? String(parsed.reference_date_source).toLowerCase() : 'unknown';
  const evidence = parsed.evidence && typeof parsed.evidence === 'object' ? parsed.evidence : {};
  const evidenceDate = parseEvidenceDate(evidence.date ?? JSON.stringify(evidence));
  if (fiscalTypes.has(documentType) && evidenceDate) {
    referenceDate = evidenceDate;
    referenceSource = 'issue';
  }
  const amount = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
  };
  const totalAmount = amount(parsed.total_amount);
  const confidence = Math.max(0, Math.min(Number(parsed.confidence ?? 0) || 0, 1));
  const reasons = [];
  if (invalidJson) reasons.push('MODEL_OUTPUT_INVALID_JSON');
  if (!String(extraction.text ?? '').replace(/\s/g, '').length) reasons.push('DOCUMENT_EXTRACTION_EMPTY');
  if (String(extraction.route ?? '').includes('ocr') && Number(extraction.mean_confidence ?? 0) < 0.55) reasons.push('OCR_LOW_CONFIDENCE');
  if (confidence < 0.8) reasons.push('LOW_CONFIDENCE');
  if (!referenceDate) reasons.push('MISSING_REFERENCE_DATE');
  if (documentType === 'outro') reasons.push('UNKNOWN_DOCUMENT_TYPE');
  if (companyVerification === 'none') reasons.push('CLIENT_COMPANY_NOT_EVIDENCED');
  if (department === 'revisar') reasons.push('DEPARTMENT_REQUIRES_REVIEW');
  if (fiscalTypes.has(documentType) && referenceSource !== 'issue') reasons.push('FISCAL_ISSUE_DATE_NOT_EVIDENCED');
  if (fiscalTypes.has(documentType) && totalAmount === null) reasons.push('FISCAL_TOTAL_AMOUNT_NOT_EVIDENCED');
  if (fiscalTypes.has(documentType) && !String(parsed.issuer_name ?? '').trim()) reasons.push('FISCAL_ISSUER_NOT_EVIDENCED');
  if (fiscalTypes.has(documentType) && !String(parsed.document_number ?? '').trim()) reasons.push('FISCAL_DOCUMENT_NUMBER_NOT_EVIDENCED');
  return {
    review_required: reasons.length > 0,
    review_reasons: reasons,
    normalized: {
      department, document_type: documentType, company_verification: companyVerification,
      issuer_name: parsed.issuer_name ?? null, issuer_cnpj: issuerCnpj.length === 14 ? issuerCnpj : null,
      recipient_name: parsed.recipient_name ?? null, recipient_cnpj: recipientCnpj.length === 14 ? recipientCnpj : null,
      document_number: parsed.document_number ?? null, access_key: digits(parsed.access_key).length === 44 ? digits(parsed.access_key) : null,
      reference_date: referenceDate, reference_date_source: referenceSource, total_amount: totalAmount,
      tax_total: amount(parsed.tax_total), confidence, evidence, warnings,
    },
  };
}

async function classify(extraction) {
  const response = await post('/v1/chat/completions', {
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    messages: [{ role: 'user', content: `${prompt()}\n\nCONTEÚDO EXTRAÍDO:\n${String(extraction.text ?? '').slice(0, 100000)}` }],
    temperature: 0,
    max_tokens: 1200,
    seed: 42,
    chat_template_kwargs: { enable_thinking: false },
  });
  const message = response.choices?.[0]?.message ?? {};
  try {
    const parsed = parseModelJson(message.content || message.reasoning_content || '');
    return { ...validate(parsed, extraction, false), provider_request_id: response.id ?? '', usage: response.usage ?? {} };
  } catch (error) {
    return { ...validate({}, extraction, true), provider_request_id: response.id ?? '', usage: response.usage ?? {}, parse_error: String(error.message || error) };
  }
}

const inputs = JSON.parse(await readFile(inputPath, 'utf8'));
const records = [];
for (let index = 0; index < inputs.matched.length; index += 1) {
  const item = inputs.matched[index];
  const file = basename(item.path);
  const localPath = join(rawRoot, /\.pdf$/i.test(file) ? 'pdfs' : 'photos', file);
  const binary = await readFile(localPath);
  const sha256 = createHash('sha256').update(binary).digest('hex');
  const started = Date.now();
  let record;
  try {
    const extractionStarted = Date.now();
    const extraction = await post('/v1/document/extract', {
      mime_type: mimeFor(file), filename: file, document_base64: binary.toString('base64'),
    });
    const extractionMs = Date.now() - extractionStarted;
    const classificationStarted = Date.now();
    const classification = await classify(extraction);
    const classificationMs = Date.now() - classificationStarted;
    record = {
      index: index + 1, source_file: file, sha256, baseline: item.baseline,
      processing_ms: Date.now() - started, extraction_ms: extractionMs, classification_ms: classificationMs,
      extraction: {
        reader_version: extraction.reader_version, route: extraction.route, provider: extraction.provider, model: extraction.model,
        pages: extraction.pages, detections_count: extraction.detections_count, mean_confidence: extraction.mean_confidence,
        signals: extraction.signals, local_quality: extraction.local_quality, fallback_used: extraction.fallback_used, warnings: extraction.warnings,
        text_chars: String(extraction.text ?? '').replace(/\s/g, '').length,
      },
      result: classification,
    };
  } catch (error) {
    record = {
      index: index + 1, source_file: file, sha256, baseline: item.baseline,
      processing_ms: Date.now() - started, error: String(error.message || error),
      result: { review_required: true, review_reasons: ['PROCESSING_ERROR'] },
    };
  }
  records.push(record);
  await writeFile(outputPath, records.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  console.log(JSON.stringify({
    progress: `${index + 1}/${inputs.matched.length}`, sha256: sha256.slice(0, 12), route: record.extraction?.route ?? null,
    baseline_status: item.baseline.status, review_required: record.result.review_required,
    reasons: record.result.review_reasons, ms: record.processing_ms, error: record.error ?? null,
  }));
}

const reasonCounts = {};
const routeCounts = {};
const transitions = {};
for (const record of records) {
  const route = record.extraction?.route ?? 'error';
  routeCounts[route] = (routeCounts[route] || 0) + 1;
  for (const reason of record.result.review_reasons || []) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  const transition = `${record.baseline.status}->${record.result.review_required ? 'REVIEW_REQUIRED' : 'VALIDATED'}`;
  transitions[transition] = (transitions[transition] || 0) + 1;
}
const summary = {
  reader_version: 'hybrid-v3.0.0', processed: records.length,
  successful: records.filter((record) => !record.error).length,
  validated: records.filter((record) => !record.result.review_required).length,
  review_required: records.filter((record) => record.result.review_required).length,
  total_ms: records.reduce((sum, record) => sum + record.processing_ms, 0),
  average_ms: Math.round(records.reduce((sum, record) => sum + record.processing_ms, 0) / Math.max(1, records.length)),
  extraction_routes: routeCounts, review_reasons: reasonCounts, transitions,
};
await writeFile(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ complete: true, summary }));
