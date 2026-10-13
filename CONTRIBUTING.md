# Contribuindo

Nunca envie credenciais, tokens, sessões WAHA, documentos de clientes, exports
de produção ou arquivos `.env` ao Git. Segredos pertencem exclusivamente a
`plx-documentos/deploy/.env` no ambiente autorizado; esse arquivo permanece
ignorado. Exemplos versionados devem conter somente placeholders.

Antes de abrir um pull request:

```bash
npm ci
npm run lint
npm run test:node
cd plx-documentos/ingress-queue && python -m unittest -v test_queue_service.py
cd ../operations-panel && python -m unittest -v test_panel.py
docker build --no-cache -t plx-document-reader:test plx-documentos/document-reader
```
