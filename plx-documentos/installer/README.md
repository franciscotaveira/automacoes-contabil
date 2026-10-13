# Instalador controlado

`bootstrap.sh` cria o `.env` quando ausente e interrompe antes de iniciar qualquer serviço. Depois de preencher os segredos, ele valida o Compose, constrói o leitor e roda o smoke. A stack só é iniciada com `START_STACK=true`; workflows só são importados com `IMPORT_WORKFLOWS=true`.

```bash
./scripts/bootstrap.sh
START_STACK=true ./scripts/bootstrap.sh
DOCUMENT_READER_URL=http://127.0.0.1:8080 ./plx-documentos/installer/smoke.sh
```

A importação não configura credenciais nem ativa workflows. Faça essas duas etapas no n8n por cliente, seguindo o runbook de cutover.
