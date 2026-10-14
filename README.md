# Automações Contábil

Base canônica versionada para a automação de triagem documental: WhatsApp/WAHA, n8n, processamento de documentos, Google Drive e cockpit operacional.

## O que este repositório guarda

- Workflows n8n importáveis;
- Código do serviço de fila, leitor documental e painel operacional;
- Infraestrutura declarativa, modelos de política e documentação de implantação;
- Testes de regressão dos fluxos V3.5.

## O que nunca entra no Git

Credenciais, chaves de API, sessões WAHA, bancos de dados, documentos de clientes, imagens de QR Code, exports de produção e evidências contendo dados pessoais. Esses materiais exigem backup criptografado fora do Git, com acesso restrito.

## Recuperação em novo VPS

1. Crie o novo servidor e aplique as atualizações de segurança antes de instalar a stack.
2. Clone este repositório e siga `plx-documentos/deploy/README.md`.
3. Crie novas credenciais e novas sessões WAHA; não reutilize segredos do servidor comprometido.
4. Restaure somente dados do backup externo após verificação de integridade e revisão de segurança.
5. Importe os workflows em `plx-documentos/workflows/` e execute os testes de regressão antes de ativá-los.

O repositório é a fonte de código e configuração reproduzível. O backup operacional de dados é uma trilha separada.

## Desenvolvimento e validação

```bash
npm ci
npm run lint
npm run test:node
npm run security:scan
(cd plx-documentos/ingress-queue && python -m unittest -v test_queue_service.py)
docker build -t plx-document-reader:test plx-documentos/document-reader
node plx-documentos/reconciler/reconcile.js \
  --manifest plx-documentos/reconciler/fixtures/sample-manifest.json \
  --driveSim plx-documentos/reconciler/fixtures/sample-drive.json \
  --out /tmp/plx-reconciliation.json
```

Os templates e serviços formam um kit modular para entregas customizadas; este
repositório não pressupõe um SaaS hospedado. Antes de ativar um grupo real,
siga `plx-documentos/RUNBOOK_CUTOVER.md`: persistência antes do ACK, tenant
canário, reconciliador sem divergências, smoke e rollback definido.
