'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('./build-daily-close-v35.cjs');
const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows', 'plx-daily-close-v35-candidate.json'), 'utf8'))[0];
const node = (name) => workflow.nodes.find((item) => item.name === name);

assert.equal(workflow.active, false);
assert.equal(node('Ler manifesto').parameters.dataTableId.value, '{{N8N_DATA_TABLE_ID}}');
assert.equal(node('Enviar fechamento ao grupo').disabled, true);
assert.equal(node('Fechar dia às 18h').parameters.rule.interval[0].expression, '0 18 * * *');
assert.equal(workflow.settings.timezone, 'America/Sao_Paulo');
assert.doesNotMatch(node('Consolidar documentos do dia').parameters.jsCode, /total_amount|tax_total|lucro|imposto|R\$/i);

const code = node('Consolidar documentos do dia').parameters.jsCode;
const oldNote = {
  idempotency_key: 'old-note', group_id: '{{WHATSAPP_GROUP_ID}}@g.us',
  reference_date: '2025-01-10', organized_at: '2026-10-03T14:00:00-03:00',
  status: 'ORGANIZED', document_type: 'nf-e', department: 'fiscal',
  original_filename: 'nota-antiga.pdf', review_required: false,
};
const attention = {
  idempotency_key: 'attention', group_id: '{{WHATSAPP_GROUP_ID}}@g.us',
  reference_date: '2026-10-03', organized_at: '2026-10-03T15:00:00-03:00',
  status: 'ORGANIZED_ATTENTION', document_type: 'boleto', department: 'contabil',
  original_filename: 'boleto.pdf', review_required: true,
  review_reason: 'PAYMENT_DUE_DATE_NOT_EVIDENCED',
};
const context = {
  $input: { all: () => [oldNote, attention, { ...oldNote }].map((json) => ({ json })) },
  Intl,
  Date: class extends Date {
    constructor(value) { super(value === undefined ? '2026-10-03T21:00:00Z' : value); }
    static now() { return new Date('2026-10-03T21:00:00Z').valueOf(); }
  },
};
const result = vm.runInNewContext(`(async()=>{${code}})()`, context);
result.then((items) => {
  assert.equal(items.length, 2, 'deduplica e mantém os dois documentos do dia');
  assert.equal(items[0].json.total_day, 2);
  assert.equal(items[0].json.pending_count, 1);
  assert.match(items[0].json.summary_text, /Documentos armazenados: 2/);
  assert.match(items[0].json.summary_text, /data de vencimento não identificada/);
  assert.doesNotMatch(items[0].json.summary_text, /valor|imposto|lucro|R\$/i);
  console.log('PASS workflow V3.5 estrutural e execução determinística');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
