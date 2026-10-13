'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./build-templates.cjs');

for (const name of ['document-waha-ingest-v2.json', 'document-daily-close-v2.json']) {
  const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
  assert.equal(workflow.active, false);
  assert.ok(workflow.nodes.length >= 8);
  assert.equal(new Set(workflow.nodes.map((node) => node.id)).size, workflow.nodes.length);
  assert.equal(new Set(workflow.nodes.map((node) => node.name)).size, workflow.nodes.length);
  for (const node of workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(() => new Function('$input', '$', '$json', '$binary', '$env', node.parameters.jsCode));
  }
}

const ingest = require('./document-waha-ingest-v2.json');
const ingestNode = (name) => ingest.nodes.find((node) => node.name === name);
assert.match(ingestNode('Validar escopo e correlação').parameters.jsCode, /MESSAGE_ID_REQUIRED/);
assert.match(ingestNode('Validar escopo e correlação').parameters.jsCode, /correlationId/);
assert.equal(ingest.connections['Persistir RECEIVED antes do ACK'].main[0][0].node, 'Confirmar persistência ao WAHA');
assert.equal(ingestNode('WAHA · Enviar resumo'), undefined);

const daily = require('./document-daily-close-v2.json');
assert.ok(daily.nodes.some((node) => node.name === 'Sheets · Registrar fechamento'));
assert.equal(daily.nodes.find((node) => node.name === 'WAHA · Enviar resumo').disabled, true);

console.log('PASS templates n8n V2 estruturalmente válidos');
