import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { extractDocument } from './server.mjs';

const rawRoot = process.env.RAW_ROOT || '/data/raw';
const inputPath = process.env.BENCHMARK_INPUTS || '/data/benchmark-inputs.json';
const outputPath = process.env.BENCHMARK_OUTPUT || '/out/local-extraction-results.jsonl';
const summaryPath = process.env.BENCHMARK_SUMMARY || '/out/local-extraction-summary.json';

function mimeFor(path) {
  if (/\.pdf$/i.test(path)) return 'application/pdf';
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.xml$/i.test(path)) return 'application/xml';
  return 'application/octet-stream';
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
    const extraction = await extractDocument({
      mime_type: mimeFor(file), filename: file, document_base64: binary.toString('base64'),
    });
    record = {
      index: index + 1, source_file: file, sha256, baseline: item.baseline,
      processing_ms: Date.now() - started,
      extraction: {
        reader_version: extraction.reader_version, route: extraction.route, provider: extraction.provider, model: extraction.model,
        pages: extraction.pages, detections_count: extraction.detections_count, mean_confidence: extraction.mean_confidence,
        signals: extraction.signals, local_quality: extraction.local_quality, fallback_used: extraction.fallback_used,
        warnings: extraction.warnings, text_chars: String(extraction.text ?? '').replace(/\s/g, '').length,
      },
    };
  } catch (error) {
    record = { index: index + 1, source_file: file, sha256, baseline: item.baseline, processing_ms: Date.now() - started, error: String(error.message || error) };
  }
  records.push(record);
  await writeFile(outputPath, records.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  console.log(JSON.stringify({ progress: `${index + 1}/${inputs.matched.length}`, sha256: sha256.slice(0, 12), route: record.extraction?.route ?? null, score: record.extraction?.local_quality?.score ?? null, chars: record.extraction?.text_chars ?? 0, ms: record.processing_ms, error: record.error ?? null }));
}

const routes = {};
const baseline = {};
for (const record of records) {
  const route = record.extraction?.route ?? 'error';
  routes[route] = (routes[route] || 0) + 1;
  const status = String(record.baseline?.status || 'UNKNOWN');
  baseline[status] = (baseline[status] || 0) + 1;
}
const successful = records.filter((record) => !record.error);
const summary = {
  mode: 'local-only-network-disabled', reader_version: 'hybrid-v3.0.0', processed: records.length,
  successful: successful.length, failed: records.length - successful.length,
  locally_sufficient: successful.filter((record) => record.extraction?.local_quality?.sufficient).length,
  locally_insufficient: successful.filter((record) => !record.extraction?.local_quality?.sufficient).length,
  total_ms: records.reduce((sum, record) => sum + record.processing_ms, 0),
  average_ms: Math.round(records.reduce((sum, record) => sum + record.processing_ms, 0) / Math.max(1, records.length)),
  routes, baseline,
};
await writeFile(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ complete: true, summary }));
