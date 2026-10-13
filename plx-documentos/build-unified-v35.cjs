'use strict';

const fs = require('node:fs');
const path = require('node:path');

const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'))[0];
// Fixtures are sanitized workflow definitions. Production runtime exports,
// including operational identifiers and execution evidence, never belong here.
const base = read('fixtures/workflow-base-v34.json');
const active = read('fixtures/workflow-active-v35.json');
const daily = read('workflows/plx-daily-close-v35-candidate.json');

const workflow = structuredClone(base);
workflow.id = 'plxUnifiedV35Draft';
workflow.name = 'PLX LAB · Processo documental unificado V3.5 · Candidato';
workflow.description = 'Candidato único: captura WAHA, original no Drive, fila durável, triagem NVIDIA, organização, confirmação e fechamento diário. Permanece inativo até o cutover controlado.';
workflow.active = false;
workflow.isArchived = false;
workflow.settings = {
  ...workflow.settings,
  timezone: 'America/Sao_Paulo',
  executionTimeout: 600,
  saveDataSuccessExecution: 'all',
  saveDataErrorExecution: 'all',
  errorWorkflow: 'documentErrorsV1',
  availableInMCP: true,
};
for (const key of ['updatedAt','createdAt','versionId','activeVersionId','versionCounter','triggerCount','shared','versionMetadata']) delete workflow[key];

const byName = (source, name) => {
  const found = source.nodes.find((node) => node.name === name);
  if (!found) throw new Error(`NODE_NOT_FOUND:${name}`);
  return structuredClone(found);
};
const rename = (node, name, id, position) => {
  node.name = name;
  node.id = id;
  node.position = position;
  delete node.disabled;
  return node;
};

// The internal processing webhook is unique to this candidate. The queue calls it
// only after the orchestrator has persisted the original file.
const processingWebhook = workflow.nodes.find((node) => node.name === 'Receber documento de benchmark');
processingWebhook.parameters.path = 'plx-v35-process-queue';

const receive = rename(byName(active, 'Receber evento WAHA'), 'WAHA · Receber evento', 'v35-ingress-webhook', [0,-900]);
receive.parameters.path = 'plx-v35-waha-ingress';
const normalize = rename(byName(active, 'Validar evento WAHA'), 'WAHA · Validar e normalizar', 'v35-ingress-normalize', [240,-900]);
normalize.parameters.jsCode = normalize.parameters.jsCode.replace(
  "let mediaUrlAllowed = false;\ntry { const u = new URL(String(mediaUrl)); mediaUrlAllowed = u.protocol === 'http:' && u.host === 'waha:3000' && !u.username && !u.password; } catch (e) { mediaUrlAllowed = false; }",
  "const mediaUrlText = String(mediaUrl);\nconst authorityMatch = /^([a-z][a-z0-9+.-]*):\\/\\/([^\\/?#]+)(?:[\\/?#]|$)/i.exec(mediaUrlText);\nconst mediaUrlAllowed = Boolean(authorityMatch && authorityMatch[1].toLowerCase() === 'http' && authorityMatch[2].toLowerCase() === 'waha:3000');",
);
if (normalize.parameters.jsCode.includes('new URL(')) throw new Error('WAHA_URL_VALIDATOR_NOT_REWRITTEN');
normalize.parameters.jsCode = normalize.parameters.jsCode
  .replace(
    "const isGroup = String(groupId).endsWith('@g.us');",
    "const isGroup = String(groupId).endsWith('@g.us');\nconst hasMessageId = Boolean(String(messageId).trim());\nconst tenantId = String(body.tenant_id ?? 'plx').trim();\nconst correlationId = hasMessageId ? [tenantId, groupId, String(messageId)].join(':') : '';",
  )
  .replace(
    'const accepted = isMessageEvent && isGroup',
    'const accepted = hasMessageId && isMessageEvent && isGroup',
  )
  .replace(
    "if (!isMessageEvent) reason = 'ignored_event';",
    "if (!hasMessageId) reason = 'missing_message_id';\nelse if (!isMessageEvent) reason = 'ignored_event';",
  )
  .replace(
    'accepted, reason, event_name: eventName, session:',
    'accepted, reason, event_name: eventName, tenant_id: tenantId, correlation_id: correlationId, session:',
  );
const acknowledge = rename(byName(active, 'Confirmar recebimento técnico'), 'WAHA · Confirmar recebimento técnico', 'v35-ingress-ack', [480,-1020]);
const accepted = rename(byName(active, 'Documento autorizado?'), 'WAHA · Documento autorizado?', 'v35-ingress-if', [720,-900]);
const ignored = rename(byName(active, 'Evento ignorado sem resposta'), 'WAHA · Evento ignorado', 'v35-ingress-ignored', [960,-700]);
const download = rename(byName(active, 'Baixar mídia do WAHA'), 'WAHA · Baixar mídia', 'v35-ingress-download', [960,-980]);
const upload = rename(byName(active, 'Arquivar original no Google Drive'), 'Drive · Arquivar original', 'v35-ingress-upload', [1220,-1080]);
upload.parameters.name = '={{ $("WAHA · Validar e normalizar").first().json.original_filename }}';
upload.parameters.folderId = {
  __rl: true, mode: 'id', value: '{{GOOGLE_DRIVE_INBOX_FOLDER_ID}}',
  cachedResultName: 'PLX - LAB NOVA ARQUITETURA - 2026-10-02',
};
const hash = rename(byName(active, 'Calcular SHA-256'), 'Documento · Calcular SHA-256', 'v35-ingress-hash', [1220,-860]);
const merge = rename(byName(active, 'Unir arquivo e hash'), 'Documento · Unir arquivo e hash', 'v35-ingress-merge', [1460,-980]);

const envelope = {
  id: 'v35-ingress-envelope', name: 'Fila · Montar envelope durável', type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [1700,-980], parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `const src = $('WAHA · Validar e normalizar').first().json;
const merged = $input.first().json;
const driveId = String(merged.id || merged.drive_file_id || '');
if (!driveId) throw new Error('SOURCE_DRIVE_FILE_ID_MISSING');
return [{ json: {
  tenant_id: src.tenant_id,
  correlation_id: src.correlation_id,
  source_file_id: driveId,
  source_filename: src.original_filename,
  mime_type: src.mime_type,
  group_id: src.group_id,
  message_id: src.message_id,
  sender_id: src.sender_id,
  sha256: String(merged.sha256 || ''),
  received_at: src.received_at,
  company_name: 'Giacomelli Transportes',
  company_legal_name: 'Gilson Antonio Giacomelli Transportes Ltda',
  company_cnpj: '09336455000157',
  idempotency_key: src.idempotency_key
} }];` },
};
const enqueue = {
  id: 'v35-ingress-enqueue', name: 'Fila · Enfileirar documento', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5,
  position: [1940,-980], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
  parameters: {
    method: 'POST', url: 'http://plx-ingress-queue:8090/v1/documents', authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth', sendBody: true, contentType: 'raw', rawContentType: 'application/json',
    body: '={{ JSON.stringify($json) }}', options: { timeout: 30000 },
  },
  credentials: { httpHeaderAuth: { id: 'labInternalHeaderV1', name: 'Laboratório · credencial interna' } },
  notes: 'No cutover, o token desta credencial deve ser igual a INTERNAL_TOKEN da fila.',
};
const queued = { id:'v35-ingress-queued', name:'Fila · Documento persistido', type:'n8n-nodes-base.noOp', typeVersion:1, position:[2180,-980], parameters:{} };
const ingressNote = { id:'v35-ingress-note', name:'Entrada WAHA e fila', type:'n8n-nodes-base.stickyNote', typeVersion:1, position:[0,-1240], parameters:{ content:'## Entrada WAHA → original → fila durável\nResponde 202 rapidamente, preserva o original no Drive e enfileira apenas a referência. A fila serializa os documentos e chama o webhook interno de processamento.', width:1150, height:220, color:5 } };

workflow.nodes.push(receive, normalize, acknowledge, accepted, ignored, download, upload, hash, merge, envelope, enqueue, queued, ingressNote);
Object.assign(workflow.connections, {
  [receive.name]: { main: [[{ node: normalize.name, type:'main', index:0 }]] },
  [normalize.name]: { main: [[{ node: acknowledge.name, type:'main', index:0 }]] },
  [acknowledge.name]: { main: [[{ node: accepted.name, type:'main', index:0 }]] },
  [accepted.name]: { main: [
    [{ node: download.name, type:'main', index:0 }],
    [{ node: ignored.name, type:'main', index:0 }],
  ] },
  [download.name]: { main: [[
    { node: upload.name, type:'main', index:0 },
    { node: hash.name, type:'main', index:0 },
  ]] },
  [upload.name]: { main: [[{ node: merge.name, type:'main', index:0 }]] },
  [hash.name]: { main: [[{ node: merge.name, type:'main', index:1 }]] },
  [merge.name]: { main: [[{ node: envelope.name, type:'main', index:0 }]] },
  [envelope.name]: { main: [[{ node: enqueue.name, type:'main', index:0 }]] },
  [enqueue.name]: { main: [[{ node: queued.name, type:'main', index:0 }]] },
});

// A retransmissão do mesmo binário em outra mensagem é uma nova ocorrência de
// recebimento, mas não deve repetir OCR, classificação ou armazenamento final.
// O message_id continua sendo a chave da ocorrência; o SHA-256 identifica o
// documento físico já organizado.
const messageDuplicateIf = workflow.nodes.find((node) => node.name === 'Documento já processado?');
const downloadSource = workflow.nodes.find((node) => node.name === 'Baixar arquivo de origem');
const manifestWrite = workflow.nodes.find((node) => node.name === 'Gravar resultado final no manifesto');
const existingConfirmation = daily.nodes.find((node) => node.name === 'Enviar fechamento ao grupo');
if (!messageDuplicateIf || !downloadSource || !manifestWrite || !existingConfirmation) {
  throw new Error('CONTENT_DEDUP_DEPENDENCY_MISSING');
}
Object.assign(manifestWrite.parameters.columns.value, {
  correlation_id:"={{ $('Concluir benchmark').item.json.correlation_id || $('Validar entrada e iniciar cronômetro').item.json.correlation_id || '' }}",
  issuer_name:"={{ $('Concluir benchmark').item.json.issuer_name || $('Concluir benchmark').item.json.issuer_name_canonical || '' }}",
  recipient_name:"={{ $('Concluir benchmark').item.json.recipient_name || '' }}",
  organized_filename:"={{ $('Concluir benchmark').item.json.organized_filename || '' }}",
  organized_path:"={{ $('Concluir benchmark').item.json.organized_path || $('Concluir benchmark').item.json.drive_path || '' }}",
  drive_web_url:"={{ $('Concluir benchmark').item.json.drive_web_url || '' }}",
});

const processingStart = workflow.nodes.find((node) => node.name === 'Validar entrada e iniciar cronômetro');
processingStart.parameters.jsCode = processingStart.parameters.jsCode
  .replace(
    "const idempotencyKey = buildIdempotencyKey(body);",
    "const idempotencyKey = buildIdempotencyKey(body);\nconst tenantId = String(body.tenant_id ?? 'plx').trim();\nconst correlationId = String(body.correlation_id ?? (body.group_id && body.message_id ? [tenantId, body.group_id, body.message_id].join(':') : '')).trim();",
  )
  .replace(
    "if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');",
    "if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');\nif (!correlationId) throw new Error('CORRELATION_ID_REQUIRED');",
  )
  .replace(
    'benchmark_id:',
    'tenant_id: tenantId,\n  correlation_id: correlationId,\n  benchmark_id:',
  );

const statusTable = structuredClone(manifestWrite.parameters.dataTableId);
const statusReceived = {
  id:'v35-status-received', name:'Status · RECEIVED', type:'n8n-nodes-base.dataTable', typeVersion:1.1,
  position:[420,-900], parameters:{ resource:'row', operation:'insert', dataTableId:statusTable,
    columns:{ mappingMode:'defineBelow', value:{ correlation_id:"={{ $('WAHA · Validar e normalizar').item.json.correlation_id }}", tenant_id:"={{ $('WAHA · Validar e normalizar').item.json.tenant_id }}", group_id:"={{ $('WAHA · Validar e normalizar').item.json.group_id }}", message_id:"={{ $('WAHA · Validar e normalizar').item.json.message_id }}", status:'RECEIVED', received_at:"={{ $('WAHA · Validar e normalizar').item.json.received_at }}" }, matchingColumns:[], schema:[] } },
};
const statusExtracted = {
  id:'v35-status-extracted', name:'Status · EXTRACTED', type:'n8n-nodes-base.dataTable', typeVersion:1.1,
  position:[2100,520], parameters:{ resource:'row', operation:'update', dataTableId:statusTable,
    filters:{ conditions:[{ keyName:'correlation_id', condition:'eq', keyValue:"={{ $('Validar entrada e iniciar cronômetro').item.json.correlation_id }}" }] },
    columns:{ mappingMode:'defineBelow', value:{ status:'EXTRACTED' }, matchingColumns:[], schema:[] } },
};
const statusArchived = {
  id:'v35-status-archived', name:'Status · ARCHIVED', type:'n8n-nodes-base.dataTable', typeVersion:1.1,
  position:[900,1040], parameters:{ resource:'row', operation:'update', dataTableId:statusTable,
    filters:{ conditions:[{ keyName:'correlation_id', condition:'eq', keyValue:"={{ $('Concluir benchmark').item.json.correlation_id }}" }] },
    columns:{ mappingMode:'defineBelow', value:{ status:"={{ $('Concluir benchmark').item.json.status || 'ARCHIVED' }}" }, matchingColumns:[], schema:[] } },
};
workflow.nodes.push(statusReceived, statusExtracted, statusArchived);
workflow.connections[normalize.name] = { main: [[{ node:statusReceived.name, type:'main', index:0 }]] };
workflow.connections[statusReceived.name] = { main: [[{ node:acknowledge.name, type:'main', index:0 }]] };
workflow.connections['Extrair conteúdo no gateway híbrido'].main[0].push({ node:statusExtracted.name, type:'main', index:0 });
workflow.connections[manifestWrite.name].main[0].push({ node:statusArchived.name, type:'main', index:0 });
const contentLookup = {
  id:'v35-content-lookup', name:'Consultar documento pelo SHA-256', type:'n8n-nodes-base.dataTable', typeVersion:1.1,
  position:[1120,80], parameters:{
    operation:'get', dataTableId:structuredClone(manifestWrite.parameters.dataTableId), matchType:'allConditions',
    filters:{ conditions:[{ keyName:'sha256', keyValue:"={{ $('Validar entrada e iniciar cronômetro').item.json.sha256 }}" }] },
    returnAll:true,
  },
};
const contentDecision = {
  id:'v35-content-decision', name:'Identificar conteúdo já organizado', type:'n8n-nodes-base.code', typeVersion:2,
  position:[1340,80], parameters:{ jsCode:`const base = $('Bloquear documento duplicado').first().json;
const sha = String(base.sha256 || '').trim().toLowerCase();
const rows = $input.all().map((item) => item.json);
const canonicalRecipient = (value) => String(value || '')
  .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ').trim().toUpperCase();
const recipient = canonicalRecipient(base.recipient_name || base.archive_owner_name);
// A mesma hash pode existir para empresas diferentes no mesmo grupo contábil.
// Sem destinatário confirmado, falhamos fechados: não reaproveitamos um arquivo
// de outra empresa e o fluxo normal encaminha o caso para revisão.
const existing = sha && recipient ? rows.find((row) =>
  String(row.sha256 || '').trim().toLowerCase() === sha &&
  String(row.group_id || '').trim() === String(base.group_id || '').trim() &&
  canonicalRecipient(row.recipient_name) === recipient &&
  ['ORGANIZED','ORGANIZED_ATTENTION'].includes(String(row.status || '').toUpperCase()) &&
  String(row.drive_file_id || '').trim()
) : null;
return [{ json: { ...base, content_duplicate: Boolean(existing), content_duplicate_record: existing || null,
  content_dedup_scope: recipient ? 'GROUP_AND_RECIPIENT' : 'RECIPIENT_NOT_EVIDENCED' } }];` },
};
const contentIf = {
  id:'v35-content-if', name:'Conteúdo já foi organizado?', type:'n8n-nodes-base.if', typeVersion:2.3,
  position:[1560,80], parameters:{ conditions:{ options:{ caseSensitive:true, leftValue:'', typeValidation:'strict', version:2 },
    conditions:[{ leftValue:'={{ $json.content_duplicate }}', rightValue:true, operator:{ type:'boolean', operation:'true', singleValue:true } }], combinator:'and' }, options:{} },
};
const deleteDuplicateSource = {
  id:'v35-content-delete-source', name:'Remover cópia temporária repetida', type:'n8n-nodes-base.googleDrive', typeVersion:3,
  position:[1780,-40], parameters:{ resource:'file', operation:'delete', fileId:{ __rl:true, mode:'id', value:"={{ $('Identificar conteúdo já organizado').item.json.source_file_id }}" }, options:{} },
  credentials:structuredClone(downloadSource.credentials), retryOnFail:true, maxTries:2, waitBetweenTries:1000,
  onError:'continueRegularOutput', notes:'Remove somente a cópia recém-arquivada na caixa de entrada. O arquivo final já organizado permanece intacto.',
};
const duplicateReceipt = {
  id:'v35-content-receipt', name:'Registrar reenvio sem duplicar arquivo', type:'n8n-nodes-base.dataTable', typeVersion:1.1,
  position:[2000,-40], parameters:{ dataTableId:structuredClone(manifestWrite.parameters.dataTableId), columns:{ mappingMode:'defineBelow', value:{
    idempotency_key:"={{ $('Identificar conteúdo já organizado').item.json.idempotency_key }}",
    message_id:"={{ $('Identificar conteúdo já organizado').item.json.message_id }}",
    sha256:"={{ $('Identificar conteúdo já organizado').item.json.sha256 }}",
    group_id:"={{ $('Identificar conteúdo já organizado').item.json.group_id }}",
    sender_id:"={{ $('Identificar conteúdo já organizado').item.json.sender_id }}",
    source_file_id:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.source_file_id || $('Identificar conteúdo já organizado').item.json.content_duplicate_record.drive_file_id }}",
    original_filename:"={{ $('Identificar conteúdo já organizado').item.json.source_filename }}",
    mime_type:"={{ $('Identificar conteúdo já organizado').item.json.mime_type }}",
    status:'DUPLICATE_CONTENT',
    document_type:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.document_type || '' }}",
    department:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.department || '' }}",
    issuer_cnpj:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.issuer_cnpj || '' }}",
    issuer_name_raw:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.issuer_name_raw || '' }}",
    issuer_name_canonical:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.issuer_name_canonical || '' }}",
    issuer_name:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.issuer_name || $('Identificar conteúdo já organizado').item.json.content_duplicate_record.issuer_name_canonical || '' }}",
    recipient_name:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.recipient_name || '' }}",
    identity_status:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.identity_status || '' }}",
    reference_date:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.reference_date || '' }}",
    document_number:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.document_number || '' }}",
    confidence:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.confidence || 0 }}",
    review_required:false,
    review_reason:'CONTENT_ALREADY_ORGANIZED',
    drive_file_id:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.drive_file_id }}",
    drive_path:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.drive_path }}",
    organized_filename:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.organized_filename || $('Identificar conteúdo já organizado').item.json.content_duplicate_record.original_filename || '' }}",
    organized_path:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.organized_path || $('Identificar conteúdo já organizado').item.json.content_duplicate_record.drive_path || '' }}",
    drive_web_url:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.drive_web_url || '' }}",
    attempt_count:1,
    last_error:'',
    received_at:"={{ $('Identificar conteúdo já organizado').item.json.received_at }}",
    organized_at:"={{ $('Identificar conteúdo já organizado').item.json.content_duplicate_record.organized_at || $now.toISO() }}",
    updated_at:'={{ $now.toISO() }}',
  } }, options:{} },
};
const duplicateConfirmation = {
  id:'v35-content-confirm-text', name:'Preparar confirmação de arquivo já recebido', type:'n8n-nodes-base.code', typeVersion:2,
  position:[2220,-40], parameters:{ jsCode:`const current = $('Identificar conteúdo já organizado').first().json;
const existing = current.content_duplicate_record || {};
const previous = existing.received_at ? new Intl.DateTimeFormat('pt-BR', { timeZone:'America/Sao_Paulo', dateStyle:'short', timeStyle:'short' }).format(new Date(existing.received_at)) : 'data não informada';
return [{ json: {
  group_id: current.group_id,
  text: '♻️ Arquivo já recebido e organizado anteriormente.\\n' +
    'Não foi criada uma nova cópia.\\n' +
    'Arquivo: ' + current.source_filename + '\\n' +
    'Recebimento anterior: ' + previous + '\\n' +
    'Local: ' + (existing.drive_path || 'arquivo já registrado no Drive')
} }];` },
};
const duplicateSend = structuredClone(existingConfirmation);
duplicateSend.id = 'v35-content-confirm-send';
duplicateSend.name = 'WhatsApp · Confirmar arquivo já recebido';
duplicateSend.position = [2440,-40];
delete duplicateSend.disabled;
duplicateSend.notes = 'Confirma exclusivamente reenvios idênticos; não envia conteúdo do documento.';
duplicateSend.parameters.body = "={{ JSON.stringify({ session: 'contabilidade-lab', chatId: $json.group_id, text: $json.text }) }}";
duplicateSend.onError = 'continueRegularOutput';
const duplicateResponse = {
  id:'v35-content-response', name:'Responder conteúdo já organizado', type:'n8n-nodes-base.respondToWebhook', typeVersion:1.5,
  position:[2660,-40], parameters:{ respondWith:'json', responseBody:"={{ { ok:true, status:'DUPLICATE_CONTENT', duplicate_content:true, idempotency_key:$('Identificar conteúdo já organizado').item.json.idempotency_key, received_at:$('Identificar conteúdo já organizado').item.json.received_at, existing:{ received_at:$('Identificar conteúdo já organizado').item.json.content_duplicate_record.received_at || '', drive_file_id:$('Identificar conteúdo já organizado').item.json.content_duplicate_record.drive_file_id || '', drive_path:$('Identificar conteúdo já organizado').item.json.content_duplicate_record.drive_path || '' } } }}", options:{ responseCode:200 } },
};
workflow.nodes.push(contentLookup, contentDecision, contentIf, deleteDuplicateSource, duplicateReceipt, duplicateConfirmation, duplicateSend, duplicateResponse);
workflow.connections[messageDuplicateIf.name].main[1] = [{ node:contentLookup.name, type:'main', index:0 }];
workflow.connections[contentLookup.name] = { main:[[{ node:contentDecision.name, type:'main', index:0 }]] };
workflow.connections[contentDecision.name] = { main:[[{ node:contentIf.name, type:'main', index:0 }]] };
workflow.connections[contentIf.name] = { main:[
  [{ node:deleteDuplicateSource.name, type:'main', index:0 }],
  [{ node:downloadSource.name, type:'main', index:0 }],
] };
workflow.connections[deleteDuplicateSource.name] = { main:[[{ node:duplicateReceipt.name, type:'main', index:0 }]] };
workflow.connections[duplicateReceipt.name] = { main:[[{ node:duplicateConfirmation.name, type:'main', index:0 }]] };
workflow.connections[duplicateConfirmation.name] = { main:[[{ node:duplicateSend.name, type:'main', index:0 }]] };
workflow.connections[duplicateSend.name] = { main:[[{ node:duplicateResponse.name, type:'main', index:0 }]] };

// Confirmation is a non-blocking branch. The queue receives the processing
// response even if WhatsApp is unavailable; notification errors remain in n8n.
const confirmCode = {
  id:'v35-confirm-code', name:'WhatsApp · Preparar confirmação', type:'n8n-nodes-base.code', typeVersion:2,
  position:[900,780], parameters:{ mode:'runOnceForAllItems', language:'javaScript', jsCode:`const doc = $('Concluir benchmark').first().json;
const labels = { fiscal:'Fiscal', contabil:'Contábil', pessoal:'Pessoal', revisar:'Revisar' };
const reasonLabels = {
  MODEL_OUTPUT_INVALID_JSON: 'a leitura da IA não retornou dados válidos',
  DOCUMENT_EXTRACTION_EMPTY: 'não foi possível ler o conteúdo do arquivo',
  OCR_LOW_CONFIDENCE: 'a imagem está pouco legível',
  LOW_CONFIDENCE: 'a classificação precisa de conferência',
  REFERENCE_DATE_FALLBACK_TO_RECEIVED: 'a data do documento não foi identificada; foi usada a data de recebimento',
  REFERENCE_DATE_NOT_EVIDENCED: 'a data do documento não foi identificada',
  FISCAL_ACCESS_KEY_INVALID: 'a chave fiscal está ausente ou inválida',
  FISCAL_ACCESS_KEY_NOT_EVIDENCED: 'a chave fiscal não foi localizada',
  ISSUER_NOT_EVIDENCED: 'o emitente ou beneficiário não foi identificado',
  ISSUER_CNPJ_NOT_EVIDENCED: 'o CNPJ do emitente não foi identificado',
  ISSUER_CNPJ_INVALID: 'o CNPJ identificado é inválido',
  ISSUER_NAME_NOT_EVIDENCED: 'o nome do emitente não foi identificado',
  UNKNOWN_OR_UNMAPPED_DOCUMENT_TYPE: 'o tipo do documento não foi identificado'
};
const reasons = String(doc.review_reason || '').split('|').filter(Boolean).map((reason) => reasonLabels[reason] || reason);
const attention = doc.review_required ? '\\n⚠️ Precisa de atenção: ' + (reasons.join('; ') || 'conferência humana solicitada') : '';
return [{ json: {
  group_id: doc.group_id,
  message_id: doc.message_id,
  text: '✅ Documento salvo e organizado.\\n' +
    'Tipo: ' + doc.document_type + '\\n' +
    'Departamento: ' + (labels[doc.department] || doc.department) + '\\n' +
    'Arquivo: ' + doc.organized_filename + attention
} }];` },
};
const confirmSend = structuredClone(daily.nodes.find((node) => node.name === 'Enviar fechamento ao grupo'));
confirmSend.id = 'v35-confirm-send'; confirmSend.name = 'WhatsApp · Enviar confirmação'; confirmSend.position = [1140,780];
confirmSend.parameters.body = "={{ JSON.stringify({ session: 'contabilidade-lab', chatId: $json.group_id, text: $json.text }) }}";
confirmSend.disabled = true;
confirmSend.notes = 'Habilitar somente no cutover. Falha de notificação não pode desfazer a organização do documento.';
confirmSend.onError = 'continueRegularOutput';
const confirmDone = { id:'v35-confirm-done', name:'WhatsApp · Confirmação concluída', type:'n8n-nodes-base.noOp', typeVersion:1, position:[1380,780], parameters:{} };
workflow.nodes.push(confirmCode, confirmSend, confirmDone);
const metricsLinks = workflow.connections['Registrar métricas do benchmark'].main[0];
metricsLinks.push({ node: confirmCode.name, type:'main', index:0 });
workflow.connections[confirmCode.name] = { main: [[{ node: confirmSend.name, type:'main', index:0 }]] };
workflow.connections[confirmSend.name] = { main: [[{ node: confirmDone.name, type:'main', index:0 }]] };

// Add the validated daily branch to the same canvas. Prefix IDs to guarantee
// uniqueness while preserving node names used by expressions.
for (const original of daily.nodes) {
  const node = structuredClone(original);
  node.id = `v35-daily-${node.id}`;
  node.position = [node.position[0], node.position[1] + 1100];
  if (node.name === 'Enviar fechamento ao grupo') {
    node.disabled = true;
    node.notes = 'Habilitar junto com o Schedule Trigger somente no cutover.';
  }
  workflow.nodes.push(node);
}
for (const [name, connection] of Object.entries(daily.connections)) workflow.connections[name] = structuredClone(connection);

// Keep the processing branch around y=0, ingress above, report below.
workflow.nodes.forEach((node) => {
  if (!String(node.id).startsWith('v35-') && Array.isArray(node.position)) node.position = [node.position[0], node.position[1]];
});

const ids = workflow.nodes.map((node) => node.id);
const names = workflow.nodes.map((node) => node.name);
if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_NODE_ID');
if (new Set(names).size !== names.length) throw new Error('DUPLICATE_NODE_NAME');

const output = path.join(__dirname, 'workflows', 'plx-unified-v35-candidate.json');
fs.writeFileSync(output, JSON.stringify([workflow], null, 2));
console.log(JSON.stringify({ output, id:workflow.id, nodes:workflow.nodes.length, active:workflow.active }));
