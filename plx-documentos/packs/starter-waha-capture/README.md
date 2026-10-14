# Pack 01 — Starter WAHA Capture

Captura documentos de grupos autorizados, cria uma correlação determinística,
persiste a ocorrência antes do ACK e encaminha o arquivo para leitura e política.

## Entrega

- `../../workflows/document-waha-ingest-v2.json`;
- `../../installer/bootstrap.sh` e `../../installer/smoke.sh`;
- fixtures em `../../fixtures/`;
- runbook em `../../RUNBOOK_CUTOVER.md`.

## Configuração

1. Crie uma sessão WAHA exclusiva para o escritório.
2. Restrinja o webhook aos grupos aprovados.
3. Configure as três credenciais descritas em `../../workflows/README.md`.
4. Execute o smoke antes de publicar o workflow.

## Sugestão comercial

Cobrar implantação pela configuração da sessão, grupo, Drive e homologação,
mais recorrência por grupo ativo. Preço deve considerar volume, SLA, retenção e
necessidade de revisão humana; não usar preço fixo sem medir esses fatores.
