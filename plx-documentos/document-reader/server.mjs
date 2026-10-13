import http from 'node:http';
import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import docstoreModule from './lib/docstore.cjs';
import loggerModule from './lib/logger.cjs';
import metricsModule from './lib/metrics.cjs';

const execFileAsync = promisify(execFile);
const { defaultDocStore } = docstoreModule;
const { createLogger } = loggerModule;
const { defaultMetrics } = metricsModule;
const logger = createLogger('document-reader');

export const READER_VERSION = 'hybrid-v3.2.0';
const port = Number(process.env.PORT || 8080);
const apiKey = process.env.NVIDIA_API_KEY || '';
const maxBytes = Number(process.env.MAX_BODY_BYTES || 25 * 1024 * 1024);
const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 180000);
const maxPdfPages = Number(process.env.MAX_PDF_PAGES || 20);
const maxPdfImageDimension = Number(process.env.MAX_PDF_IMAGE_DIMENSION || 1800);
const localOcrMinScore = Number(process.env.MIN_LOCAL_OCR_SCORE_FOR_ACCEPT || process.env.LOCAL_OCR_MIN_SCORE || 8);
const minReinforcementConfidence = Number(process.env.MIN_REINFORCEMENT_CONFIDENCE || 0.6);
const strictMode = String(process.env.FEATURE_FLAG_STRICT_MODE || 'false').toLowerCase() === 'true';
const nvidiaOcrEnabled = String(process.env.NVIDIA_OCR_ENABLED || 'true').toLowerCase() !== 'false';
const reinforcementModel = process.env.REINFORCEMENT_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
const ocrEndpoint = 'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2';
let lastReinforcementMs = null;

const routes = new Map([
  ['/v1/chat/completions', 'https://integrate.api.nvidia.com/v1/chat/completions'],
  ['/v1/ocr', ocrEndpoint],
]);

const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const digits = (value) => String(value ?? '').replace(/\D/g, '');

function unique(values) {
  return [...new Set(values.map(compact).filter(Boolean))];
}

const FISCAL_DOCUMENT_TYPES = new Set(['nf-e', 'nfs-e', 'nfc-e', 'cupom-fiscal', 'ct-e', 'mdf-e']);
const REINFORCEMENT_REASONS = new Set([
  'MODEL_OUTPUT_INVALID_JSON',
  'DOCUMENT_TYPE_NOT_EVIDENCED',
  'LOW_CONFIDENCE',
  'UNKNOWN_OR_UNMAPPED_DOCUMENT_TYPE',
  'ISSUER_NOT_EVIDENCED',
  'ISSUER_NAME_NOT_EVIDENCED',
  'ISSUER_IDENTITY_NOT_EVIDENCED',
  'REFERENCE_DATE_FALLBACK_TO_RECEIVED',
  'REFERENCE_DATE_NOT_EVIDENCED',
  'REFERENCE_DATE_EVIDENCE_DIVERGENCE',
  'FISCAL_ISSUE_DATE_NOT_EVIDENCED',
  'FISCAL_ACCESS_KEY_INVALID',
  'FISCAL_ACCESS_KEY_NOT_EVIDENCED',
]);

function splitReasons(value) {
  return unique(String(value ?? '').split('|'));
}

function normalizeDate(value) {
  const raw = compact(value);
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let year;
  let month;
  let day;
  if (match) {
    [, year, month, day] = match;
  } else {
    match = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (!match) return '';
    [, day, month, year] = match;
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return '';
  return `${year}-${month}-${day}`;
}

function normalizeComparable(value) {
  return compact(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function textSupportsName(text, name) {
  const candidate = normalizeComparable(name);
  if (candidate.length < 4) return false;
  const haystack = normalizeComparable(text);
  if (haystack.includes(candidate)) return true;
  const meaningful = candidate.split(' ').filter((token) => token.length >= 4);
  return meaningful.length >= 2 && meaningful.filter((token) => haystack.includes(token)).length >= Math.min(3, meaningful.length);
}

export function applyDocumentReviewPolicy(document) {
  const next = { ...document };
  const warnings = unique(Array.isArray(next.warnings) ? next.warnings : []);
  let reasons = splitReasons(next.review_reason);
  if (!FISCAL_DOCUMENT_TYPES.has(String(next.document_type ?? '').toLowerCase())) {
    const before = reasons.length;
    reasons = reasons.filter((reason) => !['ISSUER_CNPJ_INVALID', 'ISSUER_CNPJ_NOT_EVIDENCED'].includes(reason));
    if (reasons.length !== before) warnings.push('ISSUER_CNPJ_OPTIONAL_FOR_NON_FISCAL_DOCUMENT');
  }
  next.warnings = unique(warnings);
  next.review_reason = unique(reasons).join('|');
  next.review_required = reasons.length > 0;
  next.reinforcement_required = reasons.some((reason) => REINFORCEMENT_REASONS.has(reason));
  return next;
}

export function isReferenceDateSourceAllowed(documentType, source) {
  const type = String(documentType ?? '').toLowerCase();
  const dateSource = String(source ?? '').toLowerCase();
  if (!dateSource || dateSource === 'unknown') return false;
  if (FISCAL_DOCUMENT_TYPES.has(type)) return dateSource === 'issue';
  if (['comprovante', 'recibo'].includes(type)) return ['transaction', 'issue'].includes(dateSource);
  if (['boleto', 'fatura', 'guia'].includes(type)) return ['due', 'issue', 'competence'].includes(dateSource);
  if (['folha', 'holerite', 'fgts', 'inss', 'ferias', 'rescisao', 'ponto'].includes(type)) return ['competence', 'issue', 'due'].includes(dateSource);
  if (['extrato', 'balancete', 'razao', 'diario', 'dre'].includes(type)) return ['competence', 'issue', 'transaction'].includes(dateSource);
  return ['issue', 'transaction', 'competence', 'due'].includes(dateSource);
}

export function validateFiscalAccessKey(value) {
  const key = digits(value);
  if (key.length !== 44) return false;
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(key[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const expected = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return Number(key[43]) === expected;
}

export function validateCnpj(value) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calculate = (length) => {
    let sum = 0;
    let weight = length - 7;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cnpj[index]) * weight;
      weight -= 1;
      if (weight === 1) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(cnpj[12]) && calculate(13) === Number(cnpj[13]);
}

export function fiscalDocumentTypeFromAccessKey(value) {
  const key = digits(value);
  if (!validateFiscalAccessKey(key)) return null;
  return ({ '55': 'nf-e', '65': 'nfc-e', '57': 'ct-e', '58': 'mdf-e' })[key.slice(20, 22)] || null;
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlTag(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml).match(new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\s*>`, 'i'));
  return match ? compact(decodeXml(match[1].replace(/<[^>]+>/g, ' '))) : null;
}

function xmlBlock(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml).match(new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\s*>`, 'i'));
  return match?.[1] || '';
}

export function parseFiscalXml(xml) {
  const source = String(xml ?? '').replace(/^\uFEFF/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw Object.assign(new Error('unsafe_xml_declaration'), { statusCode: 400 });
  }
  const emit = xmlBlock(source, 'emit');
  const dest = xmlBlock(source, 'dest');
  const total = xmlBlock(source, 'ICMSTot') || xmlBlock(source, 'total');
  const infNfeId = source.match(/<(?:[A-Za-z_][\w.-]*:)?infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i)?.[1] || null;
  const accessKey = digits(xmlTag(source, 'chNFe') || xmlTag(source, 'chCTe') || infNfeId) || null;
  const fields = {
    document_family: /<(?:(?:[A-Za-z_][\w.-]*):)?infNFe\b/i.test(source) ? 'NF-e/NFC-e' : null,
    issuer_name: xmlTag(emit, 'xNome') || xmlTag(emit, 'xFant'),
    issuer_cnpj: digits(xmlTag(emit, 'CNPJ') || xmlTag(emit, 'CPF')) || null,
    recipient_name: xmlTag(dest, 'xNome'),
    recipient_cnpj: digits(xmlTag(dest, 'CNPJ') || xmlTag(dest, 'CPF')) || null,
    document_number: xmlTag(source, 'nNF') || xmlTag(source, 'nCT') || xmlTag(source, 'nDF'),
    issued_at: xmlTag(source, 'dhEmi') || xmlTag(source, 'dEmi'),
    total_amount: xmlTag(total, 'vNF') || xmlTag(total, 'vTPrest') || xmlTag(total, 'vRec'),
    access_key: accessKey,
    access_key_valid: accessKey ? validateFiscalAccessKey(accessKey) : false,
    document_type: accessKey ? fiscalDocumentTypeFromAccessKey(accessKey) : null,
  };
  const populated = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== ''));
  const summary = Object.entries(populated).map(([key, value]) => `${key}: ${value}`).join('\n');
  return { fields: populated, summary };
}

export function extractDeterministicSignals(text, barcodes = []) {
  const source = String(text ?? '');
  const cnr = /(?<!\d)(\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[\/\s-]?\d{4}[-.\s]?\d{2})(?!\d)/g;
  const access = /(?<!\d)(\d(?:[ .]?\d){43})(?!\d)/g;
  const date = /\b(?:\d{2}[/-]\d{2}[/-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})\b/g;
  const money = /(?:R\$\s*)?\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g;
  const cnpjs = unique([...source.matchAll(cnr)].map((item) => digits(item[1])).filter((item) => item.length === 14));
  const accessKeys = unique([
    ...[...source.matchAll(access)].map((item) => digits(item[1])).filter((item) => item.length === 44),
    ...barcodes.map(digits).filter((item) => item.length === 44),
  ]);
  const validAccessKeys = accessKeys.filter(validateFiscalAccessKey);
  const invalidAccessKeys = accessKeys.filter((key) => !validateFiscalAccessKey(key));
  return {
    cnpjs,
    access_keys: accessKeys,
    valid_access_keys: validAccessKeys,
    invalid_access_keys: invalidAccessKeys,
    access_key_models: validAccessKeys.map((key) => ({
      key,
      model: key.slice(20, 22),
      document_type: fiscalDocumentTypeFromAccessKey(key),
    })),
    dates: unique(source.match(date) || []).slice(0, 30),
    monetary_values: unique(source.match(money) || []).slice(0, 50),
    barcodes: unique(barcodes).slice(0, 20),
  };
}

export function scoreLocalText(text, signals = extractDeterministicSignals(text)) {
  const source = String(text ?? '');
  const chars = source.replace(/\s/g, '').length;
  const lines = source.split(/\r?\n/).filter((line) => compact(line).length >= 3).length;
  const keywords = (source.match(/\b(?:nota fiscal|danfe|nf-e|nfs-e|nfce|cnpj|emitente|destinat[aá]rio|valor total|comprovante|boleto|recibo|extrato)\b/gi) || []).length;
  let score = 0;
  if (chars >= 250) score += 2;
  if (chars >= 800) score += 1;
  if (lines >= 8) score += 1;
  if (signals.cnpjs.length) score += 3;
  if ((signals.valid_access_keys || signals.access_keys).length) score += 4;
  if (signals.dates.length) score += 2;
  if (signals.monetary_values.length) score += 2;
  if (keywords >= 2) score += 2;
  return { score, chars, lines, keywords, sufficient: score >= localOcrMinScore };
}

export function sniffMime(buffer, declared = '') {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  const prefix = buffer.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (prefix.startsWith('<?xml') || /^<[A-Za-z_][\w:.-]*(?:\s|>)/.test(prefix)) return 'application/xml';
  return String(declared || 'application/octet-stream').toLowerCase();
}

function formatSignals(signals) {
  const rows = [];
  if (signals.cnpjs.length) rows.push(`CNPJs detectados: ${signals.cnpjs.join(', ')}`);
  if (signals.access_keys.length) rows.push(`Chaves de acesso detectadas: ${signals.access_keys.join(', ')}`);
  if (signals.access_key_models?.length) rows.push(`Tipos fiscais pela chave: ${signals.access_key_models.map((item) => `${item.model}=${item.document_type || 'desconhecido'}`).join(', ')}`);
  if (signals.dates.length) rows.push(`Datas detectadas: ${signals.dates.join(', ')}`);
  if (signals.monetary_values.length) rows.push(`Valores monetários detectados: ${signals.monetary_values.join(', ')}`);
  if (signals.barcodes.length) rows.push(`Códigos detectados: ${signals.barcodes.join(', ')}`);
  return rows.length ? `\n\nSINAIS DETERMINÍSTICOS (confirme no conteúdo):\n${rows.join('\n')}` : '';
}

async function postJson(url, payload) {
  if (!apiKey) throw Object.assign(new Error('nvidia_key_not_configured'), { statusCode: 503 });
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`nvidia_upstream_${response.status}`);
    error.statusCode = response.status;
    error.upstream = body;
    throw error;
  }
  return body;
}

function normalizeOcr(response) {
  const detections = (response.data || []).flatMap((page, pageIndex) =>
    (page.text_detections || []).map((entry) => ({
      page: pageIndex + 1,
      text: compact(entry.text_prediction?.text),
      confidence: Number(entry.text_prediction?.confidence),
    })),
  ).filter((entry) => entry.text);
  const confidence = detections.map((entry) => entry.confidence).filter(Number.isFinite);
  return {
    text: detections.map((entry) => entry.text).join(' '),
    detections_count: detections.length,
    mean_confidence: confidence.length
      ? Math.round((confidence.reduce((sum, value) => sum + value, 0) / confidence.length) * 10000) / 10000
      : 0,
  };
}

async function ocrImages(images) {
  const response = await postJson(ocrEndpoint, {
    input: images.map(({ mimeType, base64 }) => ({ type: 'image_url', url: `data:${mimeType};base64,${base64}` })),
    merge_levels: ['word'],
  });
  return normalizeOcr(response);
}

async function preprocessImage(source, destination) {
  await execFileAsync('magick', [
    source,
    '-auto-orient',
    '-resize', `${maxPdfImageDimension}x${maxPdfImageDimension}>`,
    '-colorspace', 'Gray',
    '-contrast-stretch', '0.5%x0.5%',
    '-sharpen', '0x0.7',
    destination,
  ], { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
}

function parseTsv(tsv) {
  const rows = String(tsv).split(/\r?\n/).slice(1);
  const lines = new Map();
  const confidences = [];
  for (const row of rows) {
    const cells = row.split('\t');
    if (cells.length < 12) continue;
    const word = compact(cells.slice(11).join('\t'));
    const confidence = Number(cells[10]);
    if (!word || !Number.isFinite(confidence) || confidence < 0) continue;
    const key = cells.slice(1, 5).join(':');
    const value = lines.get(key) || [];
    value.push(word);
    lines.set(key, value);
    confidences.push(confidence / 100);
  }
  return {
    text: [...lines.values()].map((words) => words.join(' ')).join('\n'),
    detections_count: confidences.length,
    mean_confidence: confidences.length
      ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 10000) / 10000
      : 0,
  };
}

async function localOcr(imagePath) {
  const { stdout } = await execFileAsync(
    'tesseract',
    [imagePath, 'stdout', '-l', 'por+eng', '--psm', '6', 'tsv'],
    { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
  );
  return parseTsv(stdout);
}

async function readBarcodes(imagePath) {
  try {
    const { stdout } = await execFileAsync('zbarimg', ['--quiet', '--raw', imagePath], { timeout: 30000, maxBuffer: 1024 * 1024 });
    return unique(stdout.split(/\r?\n/));
  } catch (error) {
    if ([1, 4].includes(Number(error?.code))) return [];
    return [];
  }
}

async function readRasterPages(pagePaths, warnings, { forceNvidiaOcr = false } = {}) {
  const prepared = [];
  const localParts = [];
  const barcodes = [];
  let localDetections = 0;
  const localConfidence = [];
  for (let index = 0; index < pagePaths.length; index += 1) {
    const preparedPath = `${pagePaths[index]}.prepared.png`;
    try {
      await preprocessImage(pagePaths[index], preparedPath);
      prepared.push(preparedPath);
    } catch {
      warnings.push(`IMAGE_PREPROCESSING_FAILED_PAGE_${index + 1}`);
      prepared.push(pagePaths[index]);
    }
    try {
      const local = await localOcr(prepared[index]);
      if (local.text) localParts.push(`PÁGINA ${index + 1}\n${local.text}`);
      localDetections += local.detections_count;
      if (local.mean_confidence) localConfidence.push(local.mean_confidence);
    } catch {
      warnings.push(`LOCAL_OCR_FAILED_PAGE_${index + 1}`);
    }
    barcodes.push(...await readBarcodes(prepared[index]));
  }

  const localText = localParts.join('\n\n');
  const localSignals = extractDeterministicSignals(localText, barcodes);
  const quality = scoreLocalText(localText, localSignals);
  if ((quality.sufficient && !forceNvidiaOcr) || !nvidiaOcrEnabled) {
    return {
      provider: 'local',
      model: 'tesseract-5-por+eng',
      text: localText + formatSignals(localSignals),
      detections_count: localDetections,
      mean_confidence: localConfidence.length
        ? Math.round((localConfidence.reduce((sum, value) => sum + value, 0) / localConfidence.length) * 10000) / 10000
        : 0,
      signals: localSignals,
      local_quality: quality,
      fallback_used: false,
    };
  }

  warnings.push(forceNvidiaOcr ? 'NVIDIA_OCR_FORCED_REINFORCEMENT' : 'LOCAL_EVIDENCE_INSUFFICIENT_NVIDIA_FALLBACK');
  const images = [];
  for (const imagePath of prepared) {
    images.push({ mimeType: 'image/png', base64: (await readFile(imagePath)).toString('base64') });
  }
  const remote = await ocrImages(images);
  const mergedSignals = extractDeterministicSignals(`${remote.text}\n${localText}`, barcodes);
  const auxiliary = localText && localText !== remote.text ? `\n\nLEITURA LOCAL AUXILIAR:\n${localText}` : '';
  return {
    provider: 'nvidia+local',
    model: 'nvidia/nemotron-ocr-v2+tesseract-5',
    text: remote.text + auxiliary + formatSignals(mergedSignals),
    detections_count: remote.detections_count + localDetections,
    mean_confidence: remote.mean_confidence,
    signals: mergedSignals,
    local_quality: quality,
    fallback_used: true,
  };
}

async function pdfPageCount(pdfPath) {
  try {
    const { stdout } = await execFileAsync('pdfinfo', [pdfPath], { timeout: 30000, maxBuffer: 1024 * 1024 });
    return Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1] || 0) || null;
  } catch {
    return null;
  }
}

async function extractDocumentCore(payload) {
  const declaredMime = String(payload.mime_type || '').toLowerCase();
  const encoded = String(payload.document_base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!encoded) throw Object.assign(new Error('missing_document_base64'), { statusCode: 400 });
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length) throw Object.assign(new Error('invalid_document_base64'), { statusCode: 400 });
  const mimeType = sniffMime(buffer, declaredMime);
  const forceNvidiaOcr = payload.force_nvidia_ocr === true;
  const warnings = mimeType !== declaredMime && declaredMime ? [`MIME_CORRECTED_${declaredMime}_TO_${mimeType}`] : [];

  if (mimeType === 'application/xml' || mimeType === 'text/xml') {
    const xml = buffer.toString('utf8');
    const parsed = parseFiscalXml(xml);
    const signals = extractDeterministicSignals(`${parsed.summary}\n${xml}`);
    const text = `${parsed.summary ? `DADOS FISCAIS EXTRAÍDOS DO XML:\n${parsed.summary}\n\n` : ''}XML ORIGINAL:\n${xml.slice(0, 100000)}${formatSignals(signals)}`;
    return {
      reader_version: READER_VERSION, route: 'xml_structured', provider: 'local', model: 'deterministic-fiscal-xml-v1',
      text, pages: 1, detections_count: Object.keys(parsed.fields).length, mean_confidence: 1, structured_fields: parsed.fields,
      signals, local_quality: scoreLocalText(text, signals), fallback_used: false, warnings,
    };
  }
  if (!['image/png', 'image/jpeg', 'application/pdf'].includes(mimeType)) {
    throw Object.assign(new Error('unsupported_mime_type'), { statusCode: 415 });
  }

  const workdir = await mkdtemp(join(tmpdir(), 'document-ai-'));
  try {
    const safeName = basename(String(payload.filename || 'document')).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
    if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
      const imagePath = join(workdir, safeName.endsWith('.png') || safeName.endsWith('.jpg') || safeName.endsWith('.jpeg') ? safeName : `document.${mimeType === 'image/png' ? 'png' : 'jpg'}`);
      await writeFile(imagePath, buffer, { mode: 0o600 });
      const result = await readRasterPages([imagePath], warnings, { forceNvidiaOcr });
      return { reader_version: READER_VERSION, route: result.fallback_used ? 'image_hybrid_ocr' : 'image_local_document_text', pages: 1, warnings, ...result };
    }

    const pdfPath = join(workdir, 'document.pdf');
    const textPath = join(workdir, 'document.txt');
    await writeFile(pdfPath, buffer, { mode: 0o600 });
    await execFileAsync('pdftotext', ['-layout', '-f', '1', '-l', String(maxPdfPages), pdfPath, textPath], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    const nativeText = (await readFile(textPath, 'utf8').catch(() => '')).trim();
    const pages = await pdfPageCount(pdfPath);
    const nativeSignals = extractDeterministicSignals(nativeText);
    const nativeQuality = scoreLocalText(nativeText, nativeSignals);
    if (!forceNvidiaOcr && nativeText.replace(/\s/g, '').length >= 120 && nativeQuality.score >= 4) {
      return {
        reader_version: READER_VERSION, route: 'pdf_native_text', provider: 'local', model: 'poppler-pdftotext',
        text: nativeText.slice(0, 100000) + formatSignals(nativeSignals), pages, detections_count: 0, mean_confidence: 1,
        signals: nativeSignals, local_quality: nativeQuality, fallback_used: false, warnings,
      };
    }

    const prefix = join(workdir, 'page');
    await execFileAsync('pdftoppm', ['-png', '-scale-to', String(maxPdfImageDimension), '-f', '1', '-l', String(maxPdfPages), pdfPath, prefix], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    const pageFiles = (await readdir(workdir)).filter((name) => /^page-\d+\.png$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((name) => join(workdir, name));
    if (!pageFiles.length) throw new Error('pdf_rasterization_produced_no_pages');
    if (nativeText) warnings.push('NATIVE_TEXT_INSUFFICIENT');
    const result = await readRasterPages(pageFiles, warnings, { forceNvidiaOcr });
    return { reader_version: READER_VERSION, route: result.fallback_used ? 'pdf_scanned_hybrid_ocr' : 'pdf_scanned_local_document_text', pages: pageFiles.length, warnings, ...result };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function extractDocument(payload, { docstore = defaultDocStore } = {}) {
  const correlationId = compact(payload?.correlation_id);
  let documentRecord = null;
  if (correlationId) {
    try {
      const existing = typeof docstore.getDocument === 'function' ? docstore.getDocument(correlationId) : null;
      docstore.ensureDocument(correlationId, {
        tenant_id: payload.tenant_id,
        operation_id: payload.operation_id,
        session_id: payload.session_id || payload.session,
        group_id: payload.group_id,
        message_id: payload.message_id,
        document_hash: payload.document_hash || payload.sha256,
        policy_version: payload.policy_version,
      });
      documentRecord = docstore.updateState(correlationId, 'SOURCE_STORED', {
        document_hash: compact(payload.document_hash || payload.sha256) || null,
      });
      if (!existing) defaultMetrics.increment('document_received_total');
    } catch (error) {
      logger.warn('docstore_update_failed', {
        correlation_id: correlationId,
        error: compact(error?.message || 'unknown_error'),
      });
      if (strictMode) throw error;
    }
  }

  let result;
  try {
    result = await extractDocumentCore(payload);
  } catch (error) {
    if (correlationId) {
      try {
        documentRecord = docstore.updateState(correlationId, 'FAILED', {
          metadata: { extraction_error: compact(error?.message || 'document_extraction_failed').slice(0, 160) },
        });
      } catch (stateError) {
        logger.warn('docstore_failure_state_failed', { correlation_id: correlationId, error: compact(stateError?.message) });
      }
    }
    throw error;
  }
  const confidence = Number.isFinite(Number(result.mean_confidence))
    ? Number(result.mean_confidence)
    : (Number(result.local_quality?.score || 0) >= localOcrMinScore ? 1 : 0);
  const accepted = ['xml_structured', 'pdf_native_text'].includes(result.route)
    || Number(result.local_quality?.score || 0) >= localOcrMinScore
    || (result.fallback_used === true && confidence >= minReinforcementConfidence);
  const decisionReason = accepted ? 'LOCAL_EXTRACTION_ACCEPTED' : 'LOCAL_EXTRACTION_REQUIRES_REVIEW';
  const enriched = { ...result, confidence, decision_reason: decisionReason };
  defaultMetrics.increment('document_extracted_total');
  if (!correlationId) return enriched;
  try {
    documentRecord = docstore.updateState(correlationId, 'EXTRACTED', {
      metadata: { extraction_route: result.route, extraction_confidence: confidence, extraction_decision: decisionReason },
    });
  } catch (error) {
    logger.warn('docstore_extracted_state_failed', { correlation_id: correlationId, error: compact(error?.message) });
    if (strictMode) throw error;
  }
  return {
    ...enriched,
    metadata: {
      ...(result.metadata || {}),
      correlation_id: correlationId,
      document_state: documentRecord?.state || 'EXTRACTED',
      decision_reason: decisionReason,
      evidence_used: [result.route, ...(result.signals?.valid_access_keys || []), ...(result.signals?.cnpjs || [])].filter(Boolean),
    },
  };
}

function reinforcementSchema() {
  const nullableString = { type: ['string', 'null'] };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      department: { type: 'string', enum: ['fiscal', 'contabil', 'pessoal', 'revisar'] },
      document_type: { type: 'string', enum: ['nf-e', 'nfs-e', 'nfc-e', 'cupom-fiscal', 'ct-e', 'mdf-e', 'extrato', 'comprovante', 'recibo', 'boleto', 'fatura', 'balancete', 'razao', 'diario', 'dre', 'folha', 'holerite', 'fgts', 'inss', 'atestado', 'admissao', 'ferias', 'rescisao', 'ponto', 'afastamento', 'guia', 'outro'] },
      issuer_name: nullableString,
      issuer_cnpj: nullableString,
      recipient_name: nullableString,
      recipient_cnpj: nullableString,
      document_number: nullableString,
      access_key: nullableString,
      reference_date: nullableString,
      reference_date_source: { type: 'string', enum: ['issue', 'transaction', 'competence', 'due', 'unknown'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      evidence: {
        type: 'object',
        additionalProperties: false,
        properties: { type: nullableString, company: nullableString, date: nullableString },
        required: ['type', 'company', 'date'],
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['department', 'document_type', 'issuer_name', 'issuer_cnpj', 'recipient_name', 'recipient_cnpj', 'document_number', 'access_key', 'reference_date', 'reference_date_source', 'confidence', 'evidence', 'warnings'],
  };
}

export function parseGuidedResponse(response) {
  const raw = compact(response?.choices?.[0]?.message?.content ?? response?.choices?.[0]?.message?.reasoning_content);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  try {
    if (start < 0 || end <= start) throw new Error('invalid_json_envelope');
    return JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    logger.warn('reinforcement_model_invalid_json', {
      provider_request_id: compact(response?.id) || null,
      error: compact(error?.message || 'unknown_error'),
    });
    const invalid = new Error('reinforcement_model_invalid_json');
    invalid.provider_request_id = compact(response?.id) || null;
    throw invalid;
  }
}

export async function reinforceDocument(payload, dependencies = {}) {
  const startedAt = Date.now();
  const docstore = dependencies.docstore || defaultDocStore;
  const extractDocumentFn = dependencies.extractDocumentFn || ((input) => extractDocument(input, { docstore }));
  const postJsonFn = dependencies.postJsonFn || postJson;
  const confidenceThreshold = Number(dependencies.minReinforcementConfidence ?? minReinforcementConfidence);
  const enforceConfidence = dependencies.enforceConfidence ?? strictMode;
  const correlationId = compact(payload?.correlation_id);
  const withMetadata = (document) => {
    if (!correlationId) return document;
    let documentState = typeof docstore.getDocument === 'function' ? docstore.getDocument(correlationId)?.state : null;
    const targetState = document.reinforcement_status === 'RESOLVED' ? 'CLASSIFIED'
      : (['FAILED', 'UNRESOLVED'].includes(document.reinforcement_status) ? 'REVIEW_REQUIRED' : null);
    try {
      docstore.ensureDocument(correlationId, {
        tenant_id: payload.tenant_id,
        operation_id: payload.operation_id,
        session_id: payload.session_id || payload.session,
        group_id: payload.group_id,
        message_id: payload.message_id,
        document_hash: payload.document_hash || payload.sha256,
        policy_version: payload.policy_version,
      });
      documentState = typeof docstore.getDocument === 'function' ? docstore.getDocument(correlationId)?.state : documentState;
      if (targetState === 'CLASSIFIED') {
        if (documentState === 'RECEIVED') documentState = docstore.updateState(correlationId, 'SOURCE_STORED').state;
        if (documentState === 'SOURCE_STORED') documentState = docstore.updateState(correlationId, 'EXTRACTED').state;
        if (documentState === 'EXTRACTED') documentState = docstore.updateState(correlationId, 'CLASSIFIED').state;
      } else if (targetState && documentState !== targetState) {
        documentState = docstore.updateState(correlationId, targetState).state;
      }
    } catch (error) {
      logger.warn('docstore_reinforcement_state_failed', { correlation_id: correlationId, error: compact(error?.message) });
      if (strictMode) throw error;
    }
    const evidenceUsed = unique([
      document.evidence?.type,
      document.evidence?.company,
      document.evidence?.date,
      document.access_key,
      document.issuer_cnpj,
    ]);
    return {
      ...document,
      metadata: {
        ...(document.metadata || {}),
        correlation_id: correlationId,
        document_state: documentState,
        reinforcement_accepted: Boolean(document.reinforcement_accepted),
        reinforcement_confidence: Number(document.reinforcement_confidence || 0),
        decision_reason: document.decision_reason || null,
        evidence_used: evidenceUsed,
      },
    };
  };
  const original = applyDocumentReviewPolicy(payload.current && typeof payload.current === 'object' ? payload.current : {});
  if (!original.reinforcement_required) {
    const elapsed = Date.now() - startedAt;
    lastReinforcementMs = elapsed;
    return withMetadata({
      ...original,
      confidence: Number(original.confidence || 0),
      decision_reason: 'REINFORCEMENT_NOT_REQUIRED',
      reinforcement_accepted: false,
      reinforcement_confidence: 0,
      reinforcement_status: 'NOT_REQUIRED',
      reinforcement_ms: elapsed,
    });
  }
  try {
    const extraction = await extractDocumentFn({
      document_base64: payload.document_base64,
      mime_type: payload.mime_type || original.mime_type,
      filename: payload.filename || original.source_filename || original.original_filename,
      force_nvidia_ocr: true,
      correlation_id: correlationId || undefined,
      tenant_id: payload.tenant_id,
      operation_id: payload.operation_id,
      session_id: payload.session_id || payload.session,
      group_id: payload.group_id,
      message_id: payload.message_id,
      document_hash: payload.document_hash || payload.sha256,
      policy_version: payload.policy_version,
    });
    const text = String(extraction.text ?? '').slice(0, 100000);
    if (!text.replace(/\s/g, '').length) throw new Error('reinforcement_extraction_empty');
    const schema = reinforcementSchema();
    const prompt = [
      'Faça uma segunda leitura de um documento contábil brasileiro que ficou pendente na primeira análise.',
      'Responda somente JSON válido segundo o schema.',
      'Nunca invente CNPJ, chave fiscal, empresa, número ou data. Use null quando não houver evidência literal.',
      'Diferencie data de emissão, transação, competência e vencimento pelo rótulo do documento.',
      'Para documento fiscal, copie a chave literal de 44 dígitos. Para comprovante ou boleto, CNPJ pode ser null.',
      `Empresa atendida: ${compact(payload.company_legal_name || original.company_legal_name || original.company_name)}.`,
      `Primeira classificação: ${JSON.stringify({ document_type: original.document_type, department: original.department, issuer_name: original.issuer_name, issuer_cnpj: original.issuer_cnpj, reference_date: original.reference_date, review_reason: original.review_reason })}`,
      `Pendências a resolver: ${original.review_reason}`,
      `CONTEÚDO REEXTRAÍDO:\n${text}`,
    ].join('\n');
    const response = await postJsonFn(routes.get('/v1/chat/completions'), {
      model: reinforcementModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 1000,
      seed: 42,
      guided_json: schema,
      chat_template_kwargs: { enable_thinking: false },
    });
    const parsed = parseGuidedResponse(response);
    const reinforcementConfidence = Number(parsed.confidence || 0);
    if (enforceConfidence && reinforcementConfidence < confidenceThreshold) {
      const elapsed = Date.now() - startedAt;
      lastReinforcementMs = elapsed;
      return withMetadata({
        ...original,
        confidence: Math.max(Number(original.confidence || 0), reinforcementConfidence),
        decision_reason: 'REINFORCEMENT_CONFIDENCE_BELOW_THRESHOLD',
        review_required: true,
        review_reason: unique([...splitReasons(original.review_reason), 'LOW_REINFORCEMENT_CONFIDENCE']).join('|'),
        warnings: unique([...(Array.isArray(original.warnings) ? original.warnings : []), 'AI_REINFORCEMENT_REJECTED_LOW_CONFIDENCE']),
        reinforcement_required: false,
        reinforcement_accepted: false,
        reinforcement_confidence: reinforcementConfidence,
        reinforcement_status: 'UNRESOLVED',
        reinforcement_model: reinforcementModel,
        reinforcement_provider_request_id: compact(response.id),
        reinforcement_ms: elapsed,
      });
    }
    const next = { ...original };
    const warnings = unique([...(Array.isArray(original.warnings) ? original.warnings : []), ...(Array.isArray(parsed.warnings) ? parsed.warnings : []), 'AI_REINFORCEMENT_APPLIED']);
    let reasons = splitReasons(original.review_reason);
    const signals = extraction.signals && typeof extraction.signals === 'object' ? extraction.signals : extractDeterministicSignals(text);
    const literalAccessKeys = unique((signals.valid_access_keys || []).filter(validateFiscalAccessKey));
    const literalCnpjs = unique((signals.cnpjs || []).filter(validateCnpj));
    const modelAccessKey = validateFiscalAccessKey(parsed.access_key) ? digits(parsed.access_key) : '';
    const modelIssuerCnpj = validateCnpj(parsed.issuer_cnpj) ? digits(parsed.issuer_cnpj) : '';
    const validAccessKey = enforceConfidence
      ? (modelAccessKey ? literalAccessKeys.find((candidate) => candidate === modelAccessKey) : literalAccessKeys[0]) || ''
      : unique([...literalAccessKeys, modelAccessKey].filter(Boolean))[0] || '';
    const validCnpjs = enforceConfidence
      ? literalCnpjs.filter((candidate) => candidate === modelIssuerCnpj || !modelIssuerCnpj)
      : unique([...literalCnpjs, modelIssuerCnpj].filter(Boolean));
    const companyCnpj = digits(payload.company_cnpj || original.company_cnpj);
    const issuerCnpj = validAccessKey.slice(6, 20) || validCnpjs.find((value) => value !== companyCnpj) || '';
    const proposedType = compact(parsed.document_type).toLowerCase();
    const proposedName = compact(parsed.issuer_name);
    const proposedDate = normalizeDate(parsed.reference_date);
    const signalDates = unique((signals.dates || []).map(normalizeDate));
    const evidence = parsed.evidence && typeof parsed.evidence === 'object' ? parsed.evidence : {};
    const evidenceDate = normalizeDate(String(evidence.date ?? '').match(/\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4}/)?.[0] || '');
    const dateSourceAllowed = isReferenceDateSourceAllowed(proposedType || next.document_type, parsed.reference_date_source);
    const dateSupported = proposedDate && dateSourceAllowed && signalDates.includes(proposedDate)
      && (!enforceConfidence || evidenceDate === proposedDate);
    const nameSupported = proposedName && textSupportsName(text, proposedName);
    const literalTypeEvidence = normalizeComparable(evidence.type);
    const typeSupported = proposedType && proposedType !== 'outro' && literalTypeEvidence
      && (!enforceConfidence || normalizeComparable(text).includes(literalTypeEvidence));

    if (typeSupported) {
      next.document_type = proposedType;
      next.department = ['fiscal', 'contabil', 'pessoal'].includes(parsed.department) ? parsed.department : next.department;
      next.confidence = Math.max(Number(next.confidence || 0), Number(parsed.confidence || 0));
      reasons = reasons.filter((reason) => !['MODEL_OUTPUT_INVALID_JSON', 'DOCUMENT_TYPE_NOT_EVIDENCED', 'LOW_CONFIDENCE', 'UNKNOWN_OR_UNMAPPED_DOCUMENT_TYPE'].includes(reason));
    }
    if (nameSupported) {
      next.issuer_name = proposedName;
      next.issuer_name_raw = proposedName;
      reasons = reasons.filter((reason) => !['ISSUER_NOT_EVIDENCED', 'ISSUER_NAME_NOT_EVIDENCED', 'ISSUER_IDENTITY_NOT_EVIDENCED'].includes(reason));
    }
    if (dateSupported) {
      next.reference_date = proposedDate;
      next.reference_date_source = parsed.reference_date_source || next.reference_date_source;
      reasons = reasons.filter((reason) => !['REFERENCE_DATE_FALLBACK_TO_RECEIVED', 'REFERENCE_DATE_NOT_EVIDENCED', 'REFERENCE_DATE_EVIDENCE_DIVERGENCE'].includes(reason));
      if (parsed.reference_date_source === 'issue') reasons = reasons.filter((reason) => reason !== 'FISCAL_ISSUE_DATE_NOT_EVIDENCED');
    }
    if (validAccessKey) {
      next.access_key = validAccessKey;
      next.access_key_model = validAccessKey.slice(20, 22);
      next.document_type = fiscalDocumentTypeFromAccessKey(validAccessKey) || next.document_type;
      next.department = 'fiscal';
      next.issuer_cnpj = issuerCnpj;
      reasons = reasons.filter((reason) => !['FISCAL_ACCESS_KEY_INVALID', 'FISCAL_ACCESS_KEY_NOT_EVIDENCED', 'ISSUER_CNPJ_INVALID', 'ISSUER_CNPJ_NOT_EVIDENCED'].includes(reason));
    } else if (issuerCnpj) {
      next.issuer_cnpj = issuerCnpj;
      reasons = reasons.filter((reason) => !['ISSUER_CNPJ_INVALID', 'ISSUER_CNPJ_NOT_EVIDENCED'].includes(reason));
    }
    next.evidence = {
      type: compact(evidence.type) || compact(original.evidence?.type),
      company: nameSupported ? compact(evidence.company) || proposedName : compact(original.evidence?.company),
      date: dateSupported ? compact(evidence.date) || proposedDate : compact(original.evidence?.date),
    };
    if (proposedDate && !dateSourceAllowed) warnings.push('REFERENCE_DATE_SOURCE_NOT_ALLOWED_FOR_DOCUMENT_TYPE');
    next.warnings = unique(reasons.length ? [...warnings, 'AI_REINFORCEMENT_UNRESOLVED'] : warnings);
    next.review_reason = unique(reasons).join('|');
    next.review_required = reasons.length > 0;
    next.reinforcement_required = false;
    next.reinforcement_accepted = reasons.length === 0;
    next.reinforcement_confidence = reinforcementConfidence;
    next.reinforcement_status = reasons.length ? 'UNRESOLVED' : 'RESOLVED';
    next.decision_reason = reasons.length ? 'REINFORCEMENT_UNRESOLVED' : 'REINFORCEMENT_ACCEPTED';
    next.reinforcement_model = reinforcementModel;
    next.reinforcement_extraction_route = extraction.route;
    next.reinforcement_provider_request_id = compact(response.id);
    next.reinforcement_ms = Date.now() - startedAt;
    lastReinforcementMs = next.reinforcement_ms;
    return withMetadata(next);
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    lastReinforcementMs = elapsed;
    defaultMetrics.increment('reinforcement_failures_total');
    return withMetadata({
      ...original,
      warnings: unique([...(Array.isArray(original.warnings) ? original.warnings : []), 'AI_REINFORCEMENT_FAILED']),
      confidence: Number(original.confidence || 0),
      decision_reason: 'REINFORCEMENT_FAILED',
      reinforcement_required: false,
      reinforcement_accepted: false,
      reinforcement_confidence: 0,
      reinforcement_status: 'FAILED',
      reinforcement_model: reinforcementModel,
      reinforcement_error: compact(error?.message || 'unknown_error').slice(0, 160),
      reinforcement_ms: elapsed,
    });
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
  res.end(payload);
}

function constantTimeEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function metricsAuthorized(req) {
  const configured = String(process.env.METRICS_SHARED_KEY || '').trim();
  if (!configured || configured === 'CHANGE_ME') return { configured: false, authorized: false };
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  const supplied = String(req.headers['x-metrics-key'] || bearer).trim();
  return { configured: true, authorized: constantTimeEquals(supplied, configured) };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('request_too_large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      const auth = metricsAuthorized(req);
      if (!auth.configured) return json(res, 503, { error: 'metrics_key_not_configured' });
      if (!auth.authorized) return json(res, 401, { error: 'metrics_unauthorized' });
      return json(res, 200, { reader_version: READER_VERSION, metrics: defaultMetrics.snapshot() });
    }
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, {
        ok: true,
        reader_version: READER_VERSION,
        nvidia_configured: Boolean(apiKey) && !['CHANGE_ME', 'PENDING_CONFIGURATION'].includes(apiKey),
        thresholds: {
          min_reinforcement_confidence: minReinforcementConfidence,
          min_local_ocr_score_for_accept: localOcrMinScore,
          strict_mode: strictMode,
        },
        last_reinforcement_ms: lastReinforcementMs,
        capabilities: ['xml_structured', 'pdf_native_text', 'image_preprocessing', 'local_ocr', 'barcode', 'nvidia_ocr_fallback', 'governed_ai_reinforcement'],
        routes: [...routes.keys(), '/v1/document/extract', '/v1/document/reinforce'],
      });
    }
    if (req.method === 'POST' && req.url === '/v1/document/extract') {
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        return json(res, 200, await extractDocument(body));
      } catch (error) {
        const status = Number(error?.statusCode || 502);
        return json(res, status, { error: String(error?.message || 'document_extraction_failed'), reader_version: READER_VERSION });
      }
    }
    if (req.method === 'POST' && req.url === '/v1/document/reinforce') {
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        return json(res, 200, await reinforceDocument(body));
      } catch (error) {
        const status = Number(error?.statusCode || 400);
        return json(res, status, { error: String(error?.message || 'document_reinforcement_failed'), reader_version: READER_VERSION });
      }
    }
    const upstream = routes.get(req.url || '');
    if (req.method !== 'POST' || !upstream) return json(res, 404, { error: 'route_not_found' });
    if (!apiKey) return json(res, 503, { error: 'nvidia_key_not_configured' });
    const startedAt = Date.now();
    try {
      const body = await readBody(req);
      JSON.parse(body.toString('utf8'));
      const response = await fetch(upstream, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseBody = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, {
        'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'content-length': responseBody.length,
        'cache-control': 'no-store',
        'x-document-ai-upstream-ms': String(Date.now() - startedAt),
      });
      res.end(responseBody);
    } catch (error) {
      const status = Number(error?.statusCode || 502);
      json(res, status, { error: status === 413 ? 'request_too_large' : 'upstream_request_failed', message: error?.name === 'TimeoutError' ? 'timeout' : String(error?.message || 'unknown_error') });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer().listen(port, '0.0.0.0', () => logger.info('document_ai_gateway_ready', { port, reader_version: READER_VERSION }));
}
