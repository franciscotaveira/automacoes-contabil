'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, 'fixtures', 'daily-close-base-v3.json');
const outputPath = path.join(__dirname, 'workflows', 'plx-daily-close-v35-candidate.json');
const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))[0];

workflow.id = 'plxDailyCloseV35Draft';
workflow.name = 'PLX LAB · Fechamento diário V3.5 · Candidato';
workflow.description = 'Candidato isolado para fechar às 18h os documentos organizados no dia pela V3.5. Resume categorias, departamentos e atenções; não calcula valores. Envio WAHA permanece desabilitado até o cutover controlado.';
workflow.active = false;
workflow.isArchived = false;
workflow.settings = {
  ...workflow.settings,
  timezone: 'America/Sao_Paulo',
  saveDataSuccessExecution: 'all',
  saveDataErrorExecution: 'all',
};

for (const key of ['updatedAt', 'createdAt', 'versionId', 'activeVersionId', 'versionCounter', 'triggerCount', 'shared', 'versionMetadata']) {
  delete workflow[key];
}

const table = workflow.nodes.find((node) => node.name === 'Ler manifesto');
table.parameters.dataTableId = {
  __rl: true,
  mode: 'id',
  value: '{{N8N_DATA_TABLE_ID}}',
  cachedResultName: 'plx_v3_documentos',
};

const consolidate = workflow.nodes.find((node) => node.name === 'Consolidar documentos do dia');
consolidate.parameters.mode = 'runOnceForAllItems';
consolidate.parameters.language = 'javaScript';
consolidate.parameters.jsCode = String.raw`const labels = {
  MODEL_OUTPUT_INVALID_JSON: 'a leitura da IA não retornou dados válidos',
  DOCUMENT_EXTRACTION_EMPTY: 'não foi possível ler o conteúdo do arquivo',
  OCR_LOW_CONFIDENCE: 'a imagem está pouco legível',
  LOW_CONFIDENCE: 'a classificação precisa de conferência',
  REFERENCE_DATE_FALLBACK_TO_RECEIVED: 'data do documento não identificada; foi usada a data de recebimento para arquivar',
  MISSING_REFERENCE_DATE: 'data do documento não identificada',
  UNKNOWN_DOCUMENT_TYPE: 'tipo do documento não identificado',
  FISCAL_ACCESS_KEY_INVALID: 'chave de acesso fiscal ausente ou inválida',
  ISSUER_NOT_EVIDENCED: 'emitente/beneficiário não identificado',
  RECIPIENT_NOT_EVIDENCED: 'destinatário/pagador não identificado',
  PAYMENT_DUE_DATE_NOT_EVIDENCED: 'data de vencimento não identificada',
  PAYMENT_AMOUNT_NOT_EVIDENCED: 'valor do documento de pagamento não identificado',
  PAYMENT_BENEFICIARY_NOT_EVIDENCED: 'beneficiário não identificado',
  PAYMENT_CODE_NOT_EVIDENCED: 'linha digitável ou código de barras não identificado'
};
const rows = $input.all().map((item) => item.json);
const groupId = '{{WHATSAPP_GROUP_ID}}@g.us';
const fmtDate = (value) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(value));
const day = fmtDate(new Date());
const operationDate = (row) => row.organized_at || row.finished_at || row.updated_at || row.received_at || '';
const unique = new Map();
for (const row of rows) {
  const key = String(row.idempotency_key || row.drive_file_id || row.benchmark_id || '').trim();
  if (key && !unique.has(key)) unique.set(key, row);
}
const today = [...unique.values()].filter((row) => {
  if (!['ORGANIZED', 'ORGANIZED_ATTENTION'].includes(String(row.status || '').toUpperCase())) return false;
  if (row.group_id && row.group_id !== groupId) return false;
  const value = operationDate(row);
  return value && fmtDate(value) === day;
});
const typeLabels = {
  'nf-e':'NF-e','nfs-e':'NFS-e','nfc-e':'NFC-e','cupom-fiscal':'Cupom fiscal','ct-e':'CT-e','mdf-e':'MDF-e',
  extrato:'Extrato',comprovante:'Comprovante',recibo:'Recibo',boleto:'Boleto',fatura:'Fatura',balancete:'Balancete',
  razao:'Razão',diario:'Diário',dre:'DRE',folha:'Folha',holerite:'Holerite',fgts:'FGTS',inss:'INSS',guia:'Guia',outro:'Outro'
};
const departmentLabels = { fiscal:'Fiscal', financeiro:'Financeiro', contabil:'Contábil', pessoal:'Pessoal', revisar:'Revisar' };
const countBy = (key, labelsMap) => today.reduce((acc, row) => {
  const raw = String(row[key] || (key === 'document_type' ? 'outro' : 'revisar')).toLowerCase();
  const label = labelsMap[raw] || raw;
  acc[label] = (acc[label] || 0) + 1;
  return acc;
}, {});
const byType = countBy('document_type', typeLabels);
const byDepartment = countBy('department', departmentLabels);
const pending = today.filter((row) => Boolean(row.review_required) || String(row.status).toUpperCase() === 'ORGANIZED_ATTENTION');
const lines = (record) => Object.entries(record).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([name,count]) => '• ' + name + ': ' + count).join('\n');
const observations = pending.slice(0, 20).map((row) => {
  const reasons = String(row.review_reason || '').split('|').filter(Boolean).map((reason) => labels[reason] || reason);
  const name = row.organized_filename || row.final_filename || row.original_filename || 'arquivo sem nome';
  return '• ' + name + ': ' + (reasons.join('; ') || 'conferência humana solicitada');
}).join('\n');
const report = [
  '📋 Fechamento diário da triagem — ' + day.split('-').reverse().join('/'),
  '',
  '• Documentos armazenados: ' + today.length,
  '• Sem pendência: ' + (today.length - pending.length),
  '• Precisam de atenção: ' + pending.length,
  '',
  today.length ? 'Categorias:\n' + lines(byType) : 'Nenhum documento foi organizado hoje.',
  today.length ? '\nDepartamentos:\n' + lines(byDepartment) : '',
  observations ? '\nObservações:\n' + observations : '\nObservações: nenhuma pendência registrada.',
  pending.length > 20 ? '• Há mais ' + (pending.length - 20) + ' pendência(s) no manifesto.' : '',
  '',
  'Arquivos permanecem no Drive e prontos para lançamento no sistema contábil.'
].filter(Boolean).join('\n');
const base = {
  report_date: day,
  total_day: today.length,
  pending_count: pending.length,
  group_id: groupId,
  summary_text: report,
  generated_at: new Date().toISOString()
};
if (!today.length) return [{ json: { ...base, status: 'NO_DOCUMENTS', review_required: false } }];
return today.map((row) => ({ json: {
  ...base,
  status: 'CLOSED',
  received_at: row.received_at || '',
  organized_at: row.organized_at || '',
  reference_date: row.reference_date || '',
  document_type: row.document_type || '',
  department: row.department || '',
  issuer_name: row.issuer_name || '',
  recipient_name: row.recipient_name || '',
  organized_filename: row.organized_filename || row.final_filename || row.original_filename || '',
  organized_path: row.organized_path || row.drive_path || '',
  drive_url: row.drive_web_url || '',
  review_required: Boolean(row.review_required),
  review_reason: row.review_reason || '',
  processing_status: row.status
} }));`;

const upload = workflow.nodes.find((node) => node.name === 'Arquivar fechamento no Drive');
upload.parameters.folderId = {
  __rl: true,
  mode: 'id',
  value: '{{GOOGLE_DRIVE_INBOX_FOLDER_ID}}',
  cachedResultName: 'PLX - LAB NOVA ARQUITETURA - 2026-10-02',
};

const send = workflow.nodes.find((node) => node.name === 'Enviar fechamento ao grupo');
send.disabled = true;
send.notes = 'Habilitar somente no cutover, depois de desativar o fechamento antigo e validar o grupo configurado.';

const sticky = workflow.nodes.find((node) => node.name === 'Fechamento diário');
sticky.parameters.content = '## Fechamento V3.5 às 18h\nConta documentos efetivamente organizados no dia, mesmo quando a data do documento é antiga. Resume categorias, departamentos e atenções; não calcula valores. O envio WAHA fica desabilitado até o cutover.';

fs.writeFileSync(outputPath, JSON.stringify([workflow], null, 2));
console.log(JSON.stringify({ output: outputPath, id: workflow.id, active: workflow.active, nodes: workflow.nodes.length }));
