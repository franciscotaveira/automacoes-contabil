# Adaptadores ERP

Os adaptadores recebem apenas o envelope já autorizado pela política. Eles não
decidem empresa, direção fiscal ou permissão de arquivo.

## Protheus

```js
const { mapDocumentToERPFormat, sendToERP } = require('./protheus-adapter');
const result = await sendToERP(mapDocumentToERPFormat(document));
```

Variáveis: `PROTHEUS_BASE_URL` e `PROTHEUS_API_TOKEN`. O endpoint de exemplo é
`POST /documents`; ajuste o mapeamento para o contrato REST específico do cliente.

## Conta Azul

Variáveis: `CONTAAZUL_DOCUMENT_ENDPOINT` e `CONTAAZUL_ACCESS_TOKEN`. O endpoint
é configurável porque escopos e contratos variam por produto e conta. Homologue
o payload no sandbox do cliente antes de habilitar escrita.

Ambos enviam `correlation_id` como chave idempotente. Tokens ficam apenas no
ambiente do servidor, com permissão mínima e rotação periódica.
