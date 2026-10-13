# PLX Documentos - stack de homologacao no VPS

Esta pasta e a fonte canonica da implantacao isolada da PLX. Ela sobe somente
os componentes necessarios ao percurso documental:

- WAHA dedicado;
- ingresso duravel e idempotente;
- n8n com PostgreSQL dedicado;
- task runner externo;
- gateway de leitura documental;
- backup e verificacao operacional.

Nenhuma porta de aplicacao e publicada na Internet. O editor do n8n fica
restrito a `127.0.0.1`; o webhook do WAHA usa a rede privada Docker.

## Primeiro provisionamento

1. Copie `.env.example` para `.env` e preencha os segredos no VPS.
2. Execute `./scripts/preflight.sh`.
3. Execute `./scripts/deploy.sh`.
4. Abra um tunel SSH para o editor: `ssh -L 5679:127.0.0.1:5679 vps`.
5. Autorize a credencial Google Drive no n8n de homologacao.
6. Inicie a sessao `plx-documentos` no WAHA e leia o QR Code pelo tunel.
7. Execute `./scripts/smoke.sh` antes de apontar qualquer grupo real.

## Migration e cutover

`migrations/003_add_documents_state.sql` define a persistência canônica de
estado e correlação. O deploy não executa esse arquivo. A aplicação deve ocorrer
somente em janela controlada, depois de backup verificado, revisão da migration
e aprovação do operador. O roteiro completo está em `../RUNBOOK_CUTOVER.md`.

O serviço `document-ai-gateway` é construído da fonte canônica em
`../document-reader`; a cópia histórica dentro desta pasta não deve ser usada
para novas alterações.

O envio ao WhatsApp permanece desligado por padrao. O cutover exige um unico
consumidor, documento canario e verificacao de Drive, fila e manifesto.
