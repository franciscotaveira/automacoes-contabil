import { readFileSync, writeFileSync } from 'node:fs';

const required = ['PLX_ALLOWED_GROUP_ID', 'PLX_DRIVE_ROOT_FOLDER_ID', 'WAHA_SESSION'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name}_MISSING`);
}

const bootstrapDir = process.env.BOOTSTRAP_DIR || '/bootstrap';
let text = readFileSync(`${bootstrapDir}/workflows/plx-unified-v35-candidate.json`, 'utf8');
const replacements = new Map([
  ['{{WHATSAPP_GROUP_ID}}@g.us', process.env.PLX_ALLOWED_GROUP_ID],
  ['{{GOOGLE_DRIVE_INBOX_FOLDER_ID}}', process.env.PLX_DRIVE_ROOT_FOLDER_ID],
  ['{{N8N_DATA_TABLE_ID}}', process.env.PLX_MANIFEST_TABLE_ID || '{{N8N_DATA_TABLE_ID}}'],
  ['dpYTL4WQMOWrpc0H', process.env.PLX_ISSUERS_TABLE_ID || 'dpYTL4WQMOWrpc0H'],
  ['IVpafEYuvb0zue1l', process.env.PLX_BENCHMARK_TABLE_ID || 'IVpafEYuvb0zue1l'],
  ['x28epy954tCGyrFD', process.env.PLX_GOOGLE_CREDENTIAL_ID || 'x28epy954tCGyrFD'],
  ["session: 'contabilidade-lab'", `session: '${process.env.WAHA_SESSION.replaceAll("'", '')}'`],
  ['PLX LAB · Processo documental unificado V3.5 · Candidato', 'PLX · Processo documental unificado V3.5'],
]);
for (const [before, after] of replacements) text = text.replaceAll(before, after);

const parsed = JSON.parse(text);
const workflow = Array.isArray(parsed) ? parsed[0] : parsed;
workflow.active = false;
workflow.description = 'Homologacao VPS PLX. Publicar somente apos credencial Drive, Data Tables, WAHA e smoke ponta a ponta.';
delete workflow.settings?.errorWorkflow;
for (const node of workflow.nodes || []) {
  if (['WhatsApp · Confirmar arquivo já recebido', 'WhatsApp · Enviar confirmação', 'Enviar fechamento ao grupo'].includes(node.name)) {
    node.disabled = true;
  }
}
writeFileSync('/tmp/plx-unified-v35.json', JSON.stringify([workflow]), { mode: 0o600 });
