# PLX ingress queue

Adaptador durável e serial entre a captura do documento e o workflow de
triagem. O SQLite aplica `UNIQUE(idempotency_key)` dentro de uma transação
`BEGIN IMMEDIATE`; por isso requisições simultâneas da mesma mensagem geram um
único job. O worker envia somente um job por vez ao n8n, registra tentativas e
recupera jobs interrompidos após reinicialização.

## Contrato

- `POST /v1/documents`: enfileira o envelope normalizado.
- `GET /v1/jobs/{id}`: consulta o estado.
- `POST /v1/jobs/{id}/retry`: reabre, com auditoria, somente um job em estado
  terminal `failed`; jobs em andamento ou concluídos retornam conflito.
- `GET /health`: saúde e contadores, sem dados documentais.
- autenticação: `X-Internal-Token`.
- estados: `queued`, `processing`, `retry`, `done`, `failed`.

O serviço não recebe o binário: recebe a referência preservada no Drive e os
metadados produzidos pela captura. Assim, um restart não perde o arquivo e uma
retentativa reutiliza a mesma chave.

## Teste

```bash
python -m unittest -v test_queue_service.py
```

## Limite

SQLite é adequado para um único container/volume por cliente. No SaaS ou em
múltiplas réplicas, use Postgres com `UNIQUE(workspace_id,idempotency_key)` e
claim por `FOR UPDATE SKIP LOCKED`, preservando o mesmo contrato HTTP.
