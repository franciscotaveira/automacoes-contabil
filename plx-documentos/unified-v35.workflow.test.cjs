'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./build-unified-v35.cjs');
const workflowPath = path.join(__dirname, 'workflows', 'plx-unified-v35-candidate.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'))[0];
const node = (name) => workflow.nodes.find((item) => item.name === name);

assert.equal(workflow.active, false);
assert.equal(workflow.nodes.length, 80);
assert.equal(new Set(workflow.nodes.map((item) => item.id)).size, 80);
assert.equal(new Set(workflow.nodes.map((item) => item.name)).size, 80);
assert.equal(node('WAHA · Receber evento').parameters.path, 'plx-v35-waha-ingress');
assert.equal(node('Receber documento de benchmark').parameters.path, 'plx-v35-process-queue');
assert.equal(node('Fila · Enfileirar documento').parameters.url, 'http://plx-ingress-queue:8090/v1/documents');
assert.equal(node('WhatsApp · Enviar confirmação').disabled, true);
assert.equal(node('WhatsApp · Confirmar arquivo já recebido').disabled, undefined);
assert.equal(node('Enviar fechamento ao grupo').disabled, true);
assert.equal(node('Ler manifesto').parameters.dataTableId.value, '{{N8N_DATA_TABLE_ID}}');
assert.equal(node('Fechar dia às 18h').parameters.rule.interval[0].expression, '0 18 * * *');
assert.equal(workflow.settings.timezone, 'America/Sao_Paulo');

for (const required of [
  'WAHA · Receber evento','Drive · Arquivar original','Fila · Enfileirar documento',
  'Extrair conteúdo no gateway híbrido','Classificar com Nemotron Lightning',
  'Copiar arquivo para pasta final','WhatsApp · Preparar confirmação',
  'Consultar documento pelo SHA-256','Identificar conteúdo já organizado',
  'Conteúdo já foi organizado?','Remover cópia temporária repetida',
  'Registrar reenvio sem duplicar arquivo','WhatsApp · Confirmar arquivo já recebido',
  'Fechar dia às 18h','Consolidar documentos do dia',
]) assert.ok(node(required), `nó obrigatório ausente: ${required}`);

assert.ok(workflow.connections['WAHA · Receber evento']);
assert.ok(workflow.connections['Fila · Montar envelope durável']);
assert.equal(workflow.connections['Documento já processado?'].main[1][0].node, 'Consultar documento pelo SHA-256');
assert.equal(workflow.connections['Conteúdo já foi organizado?'].main[0][0].node, 'Remover cópia temporária repetida');
assert.equal(workflow.connections['Conteúdo já foi organizado?'].main[1][0].node, 'Baixar arquivo de origem');
assert.equal(node('Registrar reenvio sem duplicar arquivo').parameters.columns.value.status, 'DUPLICATE_CONTENT');
assert.equal(node('Registrar reenvio sem duplicar arquivo').parameters.columns.value.review_reason, 'CONTENT_ALREADY_ORGANIZED');
for (const field of ['issuer_name','recipient_name','organized_filename','organized_path','drive_web_url']) {
  assert.ok(node('Gravar resultado final no manifesto').parameters.columns.value[field], `campo ausente no manifesto: ${field}`);
  assert.ok(node('Registrar reenvio sem duplicar arquivo').parameters.columns.value[field], `campo ausente no reenvio: ${field}`);
}
assert.ok(workflow.connections['Registrar métricas do benchmark'].main[0].some((edge) => edge.node === 'Responder benchmark'));
assert.ok(workflow.connections['Registrar métricas do benchmark'].main[0].some((edge) => edge.node === 'WhatsApp · Preparar confirmação'));
assert.ok(workflow.connections['Fechar dia às 18h']);

// Expressions and Code nodes refer to nodes by display name. Renaming a node
// without rewriting these references only fails when that branch executes.
const names = new Set(workflow.nodes.map((item) => item.name));
const missingReferences = [];
const inspectReferences = (value, owner, parameterPath = 'parameters') => {
  if (typeof value === 'string') {
    for (const expression of [/\$\(['"]([^'"]+)['"]\)/g, /\$node\[['"]([^'"]+)['"]\]/g]) {
      let match;
      while ((match = expression.exec(value))) {
        if (!names.has(match[1])) missingReferences.push({ owner, parameterPath, target: match[1] });
      }
    }
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => inspectReferences(item, owner, `${parameterPath}[${index}]`));
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) inspectReferences(item, owner, `${parameterPath}.${key}`);
  }
};
for (const item of workflow.nodes) inspectReferences(item.parameters, item.name);
assert.deepEqual(missingReferences, [], `referências internas quebradas: ${JSON.stringify(missingReferences)}`);

for (const item of workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.code')) {
  assert.doesNotThrow(
    () => new Function('$input', '$', '$json', '$binary', '$node', item.parameters.jsCode),
    `Code node com JavaScript inválido: ${item.name}`,
  );
}

const normalize = node('WAHA · Validar e normalizar');
const runNormalize = (url, overrides = {}) => new Function('$input', normalize.parameters.jsCode)({
  first: () => ({ json: { body: { event: 'message', session: 'contabilidade-lab', payload: {
    from: '{{WHATSAPP_GROUP_ID}}@g.us', id: 'test-message', fromMe: false,
    timestamp: 1791068400, media: { url, mimetype: 'application/pdf', filename: 'teste.pdf' },
    ...overrides,
  } } } }),
})[0].json;
assert.equal(runNormalize('http://waha:3000/api/files/teste.pdf').accepted, true);

// O mesmo arquivo pode ser reenviado em outro dia. Cada mensagem representa
// uma ocorrência operacional distinta e precisa preservar seu próprio
// received_at, mesmo quando o SHA-256 do conteúdo for igual.
const firstReceipt = runNormalize('http://waha:3000/api/files/nfse.pdf', {
  id: '3EB0CA0D4CFD41E4CA40CF',
  timestamp: 1790786822,
});
const secondReceipt = runNormalize('http://waha:3000/api/files/nfse.pdf', {
  id: '3EB0D17A15A40F2CF6A7FE',
  timestamp: 1790943274,
});
assert.notEqual(firstReceipt.idempotency_key, secondReceipt.idempotency_key);
assert.equal(firstReceipt.received_at, '2026-09-30T16:47:02.000Z');
assert.equal(secondReceipt.received_at, '2026-10-02T12:14:34.000Z');
assert.notEqual(firstReceipt.received_at.slice(0, 10), secondReceipt.received_at.slice(0, 10));
assert.equal(runNormalize('http://waha:3000.evil.example/api/files/teste.pdf').reason, 'media_url_not_allowed');
assert.equal(runNormalize('http://attacker@waha:3000/api/files/teste.pdf').reason, 'media_url_not_allowed');
assert.equal(runNormalize('https://waha:3000/api/files/teste.pdf').reason, 'media_url_not_allowed');
assert.equal(runNormalize('http://waha:3000/api/files/teste.pdf', { from: '5511999999999@c.us' }).reason, 'ignored_private_chat');
assert.equal(runNormalize('http://waha:3000/api/files/teste.pdf', { from: '120363000000000000@g.us' }).reason, 'group_not_authorized');
assert.equal(runNormalize('http://waha:3000/api/files/teste.pdf', { fromMe: true }).reason, 'ignored_own_message');
assert.equal(runNormalize('http://waha:3000/api/files/teste.exe', { media: { url: 'http://waha:3000/api/files/teste.exe', mimetype: 'application/x-msdownload', filename: 'teste.exe' } }).reason, 'unsupported_mime');

console.log('PASS candidato unificado V3.5: 80 nós, deduplicação por conteúdo e confirmação governada');
