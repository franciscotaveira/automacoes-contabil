'use strict';

const assert = require('node:assert/strict');
const { buildDailyReport, splitMessage, uniqueDocuments } = require('./daily-report-v35.cjs');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('consolida lote sintético de 51 documentos sem valores financeiros', () => {
  const makeRows = (count, department, documentType, attention = false) => Array.from({ length: count }, (_, index) => ({
    idempotency_key: `${department}-${documentType}-${attention ? 'attention' : 'organized'}-${index}`,
    drive_file_id: `synthetic-${department}-${documentType}-${attention ? 'attention' : 'organized'}-${index}`,
    organized_at: '2026-10-03T14:00:00-03:00',
    status: attention ? 'ORGANIZED_ATTENTION' : 'ORGANIZED',
    document_type: documentType,
    department,
    review_required: attention,
    source_filename: `arquivo-${department}-${index}.pdf`,
    review_reason: attention ? 'conferência dos campos destacados' : '',
  }));
  const rows = [
    ...makeRows(9, 'fiscal', 'comprovante'),
    ...makeRows(4, 'fiscal', 'nf-e'),
    ...makeRows(17, 'fiscal', 'nf-e', true),
    ...makeRows(18, 'contabil', 'boleto'),
    ...makeRows(1, 'revisar', 'outro'),
    ...makeRows(2, 'pessoal', 'atestado'),
  ];
  const report = buildDailyReport(rows, '2026-10-03');
  assert.equal(report.total, 51);
  assert.equal(report.organized, 34);
  assert.equal(report.attention, 17);
  assert.deepEqual(report.departments, { fiscal: 30, contabil: 18, revisar: 1, pessoal: 2 });
  assert.equal(report.document_types['comprovante'], 9);
  assert.doesNotMatch(report.text, /valor|imposto|lucro|R\$/i);
});

test('remove duplicatas antes de contar', () => {
  const row = { idempotency_key: 'same', organized_at: '2026-10-03T14:00:00-03:00', status: 'ORGANIZED', document_type: 'nf-e', department: 'fiscal' };
  assert.equal(uniqueDocuments([row, { ...row }]).length, 1);
  assert.equal(buildDailyReport([row, { ...row }], '2026-10-03').total, 1);
});

test('ignora documentos de outro dia e falhas', () => {
  const rows = [
    { idempotency_key: 'a', organized_at: '2026-10-02T10:00:00-03:00', status: 'ORGANIZED', document_type: 'nf-e', department: 'fiscal' },
    { idempotency_key: 'b', organized_at: '2026-10-03T10:00:00-03:00', status: 'FAILED', document_type: 'outro', department: 'revisar' },
  ];
  const report = buildDailyReport(rows, '2026-10-03');
  assert.equal(report.total, 0);
  assert.match(report.text, /Nenhum documento organizado/);
});

test('lista observação explícita para documento com atenção', () => {
  const report = buildDailyReport([{
    idempotency_key: 'a', organized_at: '2026-10-03T10:00:00-03:00', status: 'ORGANIZED_ATTENTION',
    document_type: 'boleto', department: 'contabil', source_filename: 'boleto.pdf',
    review_required: true, review_reason: 'DATA_VENCIMENTO_AUSENTE',
  }], '2026-10-03');
  assert.match(report.text, /boleto\.pdf — DATA_VENCIMENTO_AUSENTE/);
});

test('inclui documento antigo no dia em que foi organizado', () => {
  const report = buildDailyReport([{
    idempotency_key: 'late-note',
    reference_date: '2025-01-10',
    organized_at: '2026-10-03T17:59:00-03:00',
    status: 'ORGANIZED',
    document_type: 'nf-e',
    department: 'fiscal',
  }], '2026-10-03');
  assert.equal(report.total, 1);
});

test('divide relatório longo sem ultrapassar limite', () => {
  const parts = splitMessage(Array.from({ length: 50 }, (_, i) => `linha-${i}-${'x'.repeat(30)}`).join('\n'), 200);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 200));
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} tests passed`);
process.exitCode = failed ? 1 : 0;
