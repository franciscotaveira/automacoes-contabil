'use strict';

const fs = require('node:fs');
const path = require('node:path');

const output = (name, workflow) => fs.writeFileSync(path.join(__dirname, name), `${JSON.stringify(workflow, null, 2)}\n`);
const edge = (node, index = 0) => ({ node, type: 'main', index });

const ingest = {
  id: 'documentWahaIngestV2',
  name: 'DOCUMENTOS · Pack 01 · Captura WAHA V2',
  description: 'Template inativo: persiste a ocorrência, extrai, resolve política e encaminha para Drive ou revisão.',
  active: false,
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' },
  nodes: [
    { id: 'webhook', name: 'WAHA · Receber documento', type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [0, 240], parameters: { httpMethod: 'POST', path: 'document-waha-ingest-v2', authentication: 'headerAuth', responseMode: 'responseNode', options: {} }, credentials: { httpHeaderAuth: { id: 'CONFIGURE_WAHA_WEBHOOK_AUTH_ID', name: 'CONFIGURE · WAHA webhook' } } },
    { id: 'validate', name: 'Validar escopo e correlação', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 240], parameters: { jsCode: `const body = $input.first().json.body ?? $input.first().json;
const message = body.payload?.payload ?? body.payload ?? body;
const tenantId = String(body.tenant_id ?? 'CONFIGURE_TENANT_ID').trim();
const operationId = String(body.operation_id ?? 'CONFIGURE_OPERATION_ID').trim();
const groupId = String(message.from ?? message.chatId ?? '').trim();
const messageId = String(message.id ?? message.key?.id ?? '').trim();
const media = message.media ?? {};
if (!tenantId || tenantId.startsWith('CONFIGURE_')) throw new Error('TENANT_ID_REQUIRED');
if (!operationId || operationId.startsWith('CONFIGURE_')) throw new Error('OPERATION_ID_REQUIRED');
if (!groupId.endsWith('@g.us')) throw new Error('AUTHORIZED_GROUP_REQUIRED');
if (!messageId) throw new Error('MESSAGE_ID_REQUIRED');
const correlationId = [tenantId, groupId, messageId].join(':');
return [{ json: { tenant_id: tenantId, operation_id: operationId, session_id: String(body.session ?? ''),
  group_id: groupId, message_id: messageId, correlation_id: correlationId, idempotency_key: correlationId,
  media_url: String(media.url ?? message.mediaUrl ?? ''), mime_type: String(media.mimetype ?? message.mimeType ?? ''),
  original_filename: String(media.filename ?? message.filename ?? ('documento-' + messageId)),
  received_at: new Date().toISOString(), state: 'RECEIVED' } }];` } },
    { id: 'persist-received', name: 'Persistir RECEIVED antes do ACK', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [480, 240], parameters: { resource: 'row', operation: 'insert', dataTableId: { __rl: true, mode: 'name', value: 'documentos_contabeis_manifesto' }, columns: { mappingMode: 'defineBelow', value: { correlation_id: '={{ $json.correlation_id }}', idempotency_key: '={{ $json.idempotency_key }}', tenant_id: '={{ $json.tenant_id }}', group_id: '={{ $json.group_id }}', message_id: '={{ $json.message_id }}', status: 'RECEIVED', received_at: '={{ $json.received_at }}' }, matchingColumns: [], schema: [] } } },
    { id: 'ack', name: 'Confirmar persistência ao WAHA', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [720, 100], parameters: { respondWith: 'json', responseBody: '={{ { accepted:true, persisted:true, correlation_id:$json.correlation_id } }}', options: { responseCode: 202 } } },
    { id: 'download', name: 'WAHA · Baixar mídia', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [720, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, parameters: { method: 'GET', url: '={{ $json.media_url }}', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: { timeout: 60000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } } }, credentials: { httpHeaderAuth: { id: 'CONFIGURE_WAHA_API_AUTH_ID', name: 'CONFIGURE · WAHA API' } } },
    { id: 'base64', name: 'Preparar payload do reader', type: 'n8n-nodes-base.code', typeVersion: 2, position: [960, 300], parameters: { jsCode: `const meta = $('Validar escopo e correlação').first().json;
const binary = $input.first().binary?.data;
if (!binary?.data) throw new Error('DOCUMENT_BINARY_REQUIRED');
return [{ json: { ...meta, document_base64: 'data:' + (binary.mimeType || meta.mime_type) + ';base64,' + binary.data,
  mime_type: binary.mimeType || meta.mime_type, filename: binary.fileName || meta.original_filename }, binary: { data: binary } }];` } },
    { id: 'extract', name: 'Reader · Extrair documento', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [1200, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, parameters: { method: 'POST', url: '={{ $env.DOCUMENT_READER_URL + "/v1/document/extract" }}', sendBody: true, contentType: 'raw', rawContentType: 'application/json', body: '={{ JSON.stringify($json) }}', options: { timeout: 180000 } } },
    { id: 'wait', name: 'Aguardar consistência antes da política', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [1440, 300], parameters: { amount: 2, unit: 'seconds' } },
    { id: 'policy', name: 'Policy · Resolver autorização', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [1680, 300], retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, parameters: { method: 'POST', url: '={{ $env.POLICY_RESOLVER_URL + "/v1/policy/resolve" }}', sendBody: true, contentType: 'raw', rawContentType: 'application/json', body: '={{ JSON.stringify({ ingress:$("Validar escopo e correlação").first().json, document:$json, correlation_id:$("Validar escopo e correlação").first().json.correlation_id }) }}', options: { timeout: 30000 } } },
    { id: 'authorized', name: 'Arquivo autorizado?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [1920, 300], parameters: { conditions: { options: { typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: '={{ $json.archive_authorized }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
    { id: 'drive', name: 'Drive · Arquivar documento autorizado', type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: [2160, 180], retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, parameters: { authentication: 'oAuth2', resource: 'file', operation: 'upload', inputDataFieldName: 'data', name: '={{ $("Preparar payload do reader").first().json.filename }}', driveId: { __rl: true, mode: 'list', value: 'My Drive' }, folderId: { __rl: true, mode: 'id', value: 'CONFIGURE_DRIVE_ROOT_FOLDER_ID' }, options: {} }, credentials: { googleDriveOAuth2Api: { id: 'CONFIGURE_GOOGLE_DRIVE_CREDENTIAL_ID', name: 'CONFIGURE · Google Drive' } } },
    { id: 'review', name: 'Registrar REVIEW_REQUIRED', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [2160, 420], parameters: { resource: 'row', operation: 'update', dataTableId: { __rl: true, mode: 'name', value: 'documentos_contabeis_manifesto' }, filters: { conditions: [{ keyName: 'correlation_id', condition: 'eq', keyValue: '={{ $("Validar escopo e correlação").first().json.correlation_id }}' }] }, columns: { mappingMode: 'defineBelow', value: { status: 'REVIEW_REQUIRED', review_required: true, review_reason: '={{ $json.decision_reason ?? "POLICY_REVIEW_REQUIRED" }}' }, matchingColumns: [], schema: [] } } },
    { id: 'archived', name: 'Registrar ARCHIVED', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [2400, 180], parameters: { resource: 'row', operation: 'update', dataTableId: { __rl: true, mode: 'name', value: 'documentos_contabeis_manifesto' }, filters: { conditions: [{ keyName: 'correlation_id', condition: 'eq', keyValue: '={{ $("Validar escopo e correlação").first().json.correlation_id }}' }] }, columns: { mappingMode: 'defineBelow', value: { status: 'ARCHIVED', drive_file_id: '={{ $json.id ?? "" }}' }, matchingColumns: [], schema: [] } } },
    { id: 'note', name: 'README · Credenciais e tabelas', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -80], parameters: { content: '## Pack 01 · Captura WAHA V2\nCredenciais: header do webhook, WAHA API e Google Drive. Env: DOCUMENT_READER_URL e POLICY_RESOLVER_URL.\nData Table documentos_contabeis_manifesto: correlation_id (único), idempotency_key, tenant_id, group_id, message_id, status, received_at, review_required, review_reason, drive_file_id.', width: 1180, height: 220, color: 5 } },
  ],
  connections: {
    'WAHA · Receber documento': { main: [[edge('Validar escopo e correlação')]] },
    'Validar escopo e correlação': { main: [[edge('Persistir RECEIVED antes do ACK')]] },
    'Persistir RECEIVED antes do ACK': { main: [[edge('Confirmar persistência ao WAHA'), edge('WAHA · Baixar mídia')]] },
    'WAHA · Baixar mídia': { main: [[edge('Preparar payload do reader')]] },
    'Preparar payload do reader': { main: [[edge('Reader · Extrair documento')]] },
    'Reader · Extrair documento': { main: [[edge('Aguardar consistência antes da política')]] },
    'Aguardar consistência antes da política': { main: [[edge('Policy · Resolver autorização')]] },
    'Policy · Resolver autorização': { main: [[edge('Arquivo autorizado?')]] },
    'Arquivo autorizado?': { main: [[edge('Drive · Arquivar documento autorizado')], [edge('Registrar REVIEW_REQUIRED')]] },
    'Drive · Arquivar documento autorizado': { main: [[edge('Registrar ARCHIVED')]] },
  },
};

const daily = {
  id: 'documentDailyCloseV2', name: 'DOCUMENTOS · Pack 02 · Fechamento diário V2', active: false,
  description: 'Exporta manifesto diário em CSV, registra uma linha no Sheets e prepara resumo para o grupo.',
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' },
  nodes: [
    { id: 'schedule', name: 'Fechar dia às 18h', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 240], parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 18 * * *' }] } } },
    { id: 'read', name: 'Ler manifesto diário', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [240, 240], parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'name', value: 'documentos_contabeis_manifesto' }, returnAll: true, filters: { conditions: [] } } },
    { id: 'summary', name: 'Consolidar por status e categoria', type: 'n8n-nodes-base.code', typeVersion: 2, position: [480, 240], parameters: { jsCode: `const rows = $input.all().map((item) => item.json);
const date = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
const today = rows.filter((row) => String(row.received_at || '').slice(0,10) === date);
const byStatus = {}; const byType = {};
for (const row of today) { byStatus[row.status || 'UNKNOWN'] = (byStatus[row.status || 'UNKNOWN'] || 0) + 1; byType[row.document_type || 'outro'] = (byType[row.document_type || 'outro'] || 0) + 1; }
const review = today.filter((row) => Boolean(row.review_required)).length;
return today.length ? today.map((row) => ({ json:{ ...row, report_date:date, total_day:today.length, review_total:review, status_summary:JSON.stringify(byStatus), category_summary:JSON.stringify(byType) } })) : [{ json:{ report_date:date, total_day:0, review_total:0, status_summary:'{}', category_summary:'{}', status:'NO_DOCUMENTS' } }];` } },
    { id: 'csv', name: 'Gerar CSV auditável', type: 'n8n-nodes-base.convertToFile', typeVersion: 1.1, position: [720, 120], parameters: { operation: 'csv', binaryPropertyName: 'data', options: { delimiter: ';', headerRow: true, fileName: '={{ "fechamento-" + $json.report_date + ".csv" }}' } } },
    { id: 'drive', name: 'Drive · Arquivar CSV', type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: [960, 120], parameters: { authentication: 'oAuth2', resource: 'file', operation: 'upload', inputDataFieldName: 'data', name: '={{ "fechamento-" + $("Consolidar por status e categoria").first().json.report_date + ".csv" }}', driveId: { __rl: true, mode: 'list', value: 'My Drive' }, folderId: { __rl: true, mode: 'id', value: 'CONFIGURE_DRIVE_REPORTS_FOLDER_ID' }, options: {} }, credentials: { googleDriveOAuth2Api: { id: 'CONFIGURE_GOOGLE_DRIVE_CREDENTIAL_ID', name: 'CONFIGURE · Google Drive' } } },
    { id: 'sheets', name: 'Sheets · Registrar fechamento', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.6, position: [720, 360], parameters: { operation: 'append', documentId: { __rl: true, mode: 'id', value: 'CONFIGURE_SHEET_ID' }, sheetName: { __rl: true, mode: 'name', value: 'Fechamentos' }, columns: { mappingMode: 'defineBelow', value: { data: '={{ $json.report_date }}', total: '={{ $json.total_day }}', revisoes: '={{ $json.review_total }}', status: '={{ $json.status_summary }}', categorias: '={{ $json.category_summary }}' }, matchingColumns: [], schema: [] }, options: {} }, credentials: { googleSheetsOAuth2Api: { id: 'CONFIGURE_GOOGLE_SHEETS_CREDENTIAL_ID', name: 'CONFIGURE · Google Sheets' } } },
    { id: 'message', name: 'Preparar resumo do grupo', type: 'n8n-nodes-base.code', typeVersion: 2, position: [960, 360], parameters: { jsCode: `const row = $('Consolidar por status e categoria').first().json;
return [{ json:{ chatId:'CONFIGURE_GROUP_ID@g.us', text:'Fechamento ' + row.report_date + ': ' + row.total_day + ' documento(s), ' + row.review_total + ' em revisão. Categorias: ' + row.category_summary } }];` } },
    { id: 'send', name: 'WAHA · Enviar resumo', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: [1200, 360], disabled: true, parameters: { method: 'POST', url: '={{ $env.WAHA_BASE_URL + "/api/sendText" }}', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, contentType: 'raw', rawContentType: 'application/json', body: '={{ JSON.stringify({ session:$env.WAHA_SESSION, chatId:$json.chatId, text:$json.text }) }}', options: { timeout: 30000 } }, credentials: { httpHeaderAuth: { id: 'CONFIGURE_WAHA_API_AUTH_ID', name: 'CONFIGURE · WAHA API' } }, notes: 'Permanece desabilitado até o cutover e validação do grupo.' },
    { id: 'note', name: 'README · Fechamento V2', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -80], parameters: { content: '## Fechamento diário V2\nRequer Data Table documentos_contabeis_manifesto, pasta de relatórios, planilha Fechamentos e credencial WAHA. O envio ao grupo começa desabilitado.', width: 980, height: 200, color: 5 } },
  ],
  connections: {
    'Fechar dia às 18h': { main: [[edge('Ler manifesto diário')]] },
    'Ler manifesto diário': { main: [[edge('Consolidar por status e categoria')]] },
    'Consolidar por status e categoria': { main: [[edge('Gerar CSV auditável'), edge('Sheets · Registrar fechamento')]] },
    'Gerar CSV auditável': { main: [[edge('Drive · Arquivar CSV')]] },
    'Sheets · Registrar fechamento': { main: [[edge('Preparar resumo do grupo')]] },
    'Preparar resumo do grupo': { main: [[edge('WAHA · Enviar resumo')]] },
  },
};

output('document-waha-ingest-v2.json', ingest);
output('document-daily-close-v2.json', daily);

module.exports = { ingest, daily };
