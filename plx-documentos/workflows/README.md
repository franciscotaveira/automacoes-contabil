# Templates n8n

Todos os workflows são distribuídos inativos. Importe o JSON, substitua os
valores `CONFIGURE_*`, selecione as credenciais no editor e só então publique.

## Pack 01 — Captura WAHA V2

Arquivo: `document-waha-ingest-v2.json`.

Credenciais necessárias:

- Header Auth para o webhook WAHA;
- Header Auth para a API administrativa do WAHA;
- OAuth2 do Google Drive.

Variáveis do n8n:

- `DOCUMENT_READER_URL`, somente rede interna;
- `POLICY_RESOLVER_URL`, somente rede interna.

Data Table `documentos_contabeis_manifesto`:

| Campo | Tipo | Regra |
|---|---|---|
| `correlation_id` | string | único e obrigatório |
| `idempotency_key` | string | único e obrigatório |
| `tenant_id` | string | obrigatório |
| `group_id` | string | obrigatório |
| `message_id` | string | obrigatório |
| `status` | string | estado canônico |
| `received_at` | datetime/string | obrigatório |
| `review_required` | boolean | default `false` |
| `review_reason` | string | sem conteúdo integral do documento |
| `drive_file_id` | string | referência, nunca credencial |

O template persiste `RECEIVED` antes de responder `202`. A política é resolvida
por um serviço central; uma decisão sem autorização segue para revisão.

## Pack 02 — Fechamento diário V2

Arquivo: `document-daily-close-v2.json`.

Requer a Data Table acima, uma pasta de relatórios, uma planilha com aba
`Fechamentos` e a credencial WAHA. O envio ao grupo começa desabilitado.

## Importação

```bash
n8n import:workflow --input=plx-documentos/workflows/document-waha-ingest-v2.json
n8n import:workflow --input=plx-documentos/workflows/document-daily-close-v2.json
```

Use `node plx-documentos/workflows/build-templates.cjs` para regenerar os dois
arquivos e `node --test plx-documentos/workflows/templates.test.cjs` para
validar estrutura, referências e JavaScript dos Code nodes.
