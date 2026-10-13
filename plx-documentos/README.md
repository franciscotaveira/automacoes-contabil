# Automação de documentos contábeis recebidos em grupos do WhatsApp

## Hardening para produção controlada

O ingresso usa `correlation_id` determinístico (`tenant_id + group_id +
message_id`), persiste o manifesto antes do ACK técnico e propaga o identificador
ao subworkflow de análise. O leitor mantém compatibilidade com payloads antigos:
sem `correlation_id`, a resposta continua válida e não inclui metadata adicional.

A máquina de estados canônica está definida em
`deploy/migrations/003_add_documents_state.sql`. A migration é apenas uma
definição versionada e **não deve ser aplicada automaticamente**. O adaptador
atual de `lib/docstore.js` usa memória para testes; PostgreSQL permanece como
etapa explícita de cutover.

Variáveis novas:

- `FEATURE_FLAG_STRICT_MODE=false`: mantém mudanças de decisão desativadas por padrão;
- `MIN_REINFORCEMENT_CONFIDENCE=0.6`: confiança mínima do reforço quando o modo estrito estiver ativo;
- `MIN_LOCAL_OCR_SCORE_FOR_ACCEPT=8`: score mínimo para aceitar OCR local;
- `MAX_BODY_BYTES=26214400`: limite do corpo recebido pelo leitor;
- `UPSTREAM_TIMEOUT_MS=180000`, `MAX_PDF_PAGES=20` e `MAX_PDF_IMAGE_DIMENSION=1800` preservam os limites operacionais existentes.

Testes e validações locais:

```bash
npm ci
npm run lint
npm run test:node
cd plx-documentos/ingress-queue && python -m unittest -v test_queue_service.py
cd ../operations-panel && python -m unittest -v test_panel.py
docker build --no-cache -t plx-document-reader:test plx-documentos/document-reader
```

Reconciliador local, sem acesso ao Drive real:

```bash
node plx-documentos/reconciler/reconcile.js \
  --manifest plx-documentos/reconciler/fixtures/sample-manifest.json \
  --drive-sim plx-documentos/reconciler/fixtures/sample-drive.json \
  --out /tmp/plx-reconciliation.json
```

O reconciliador termina com código `2` quando encontra qualquer divergência.
Consulte [RUNBOOK_CUTOVER.md](RUNBOOK_CUTOVER.md) antes de habilitar um webhook.

> **Validação comercial mais recente (10/10/2026):** [VALIDACAO-COMERCIAL-PLX-2026-10-10.md](evidence/VALIDACAO-COMERCIAL-PLX-2026-10-10.md). O sistema está apto para piloto comercial assistido, com dois gates restantes para operação autônoma.
>
> **Regra para novos fluxos:** [PADRAO-DE-COMPLEXIDADE-E-REDUCAO-DE-NOS.md](PADRAO-DE-COMPLEXIDADE-E-REDUCAO-DE-NOS.md).
>
> **Execução comercial e próximos módulos:** [PLANO-EXECUCAO-COMERCIAL-E-ROADMAP-MODULAR-2026-10-10.md](PLANO-EXECUCAO-COMERCIAL-E-ROADMAP-MODULAR-2026-10-10.md).

> **Estado atual:** consulte primeiro [ARQUITETURA-CANONICA.md](ARQUITETURA-CANONICA.md)
> e o [gate da V3.3](GATE-CONCLUSAO-PLX-V3-2026-10-03.md). Este README preserva
> a evolução inicial e contém limites que foram superados pelo leitor híbrido e
> pelo reprocessamento de 51 documentos em 2026-10-01.

## Candidato isolado V3.3

O workflow `PLX LAB · Triagem documental V3.3 · Sombra governada` foi construído
do zero em pasta separada e permanece inativo. Ele validou NF-e, NFS-e, boleto,
imagem JPEG, comprovante e duplicata sequencial com arquivos reais. Não está
conectado ao WAHA e não substitui os workflows publicados. O gate registra o que
passou e o que ainda precisa ser concluído antes do piloto.

Pacote n8n para um número dedicado do WAHA observar grupos autorizados, arquivar documentos no Google Drive, manter manifesto e deduplicação no próprio n8n e analisar imagens por um adaptador cognitivo substituível.

## Limites do piloto

- responde somente depois que um documento válido foi salvo e organizado;
- não lança documentos em sistema contábil;
- não exclui nem altera o original;
- somente `image/jpeg` e `image/png` seguem para IA nesta primeira versão;
- PDF e XML são arquivados e direcionados para revisão até o parser correspondente ser configurado;
- toda decisão fiscal sensível ou documento de baixa confiança exige revisão humana.

## Workflows

1. `DOCUMENTOS · 00 · Preparar estrutura`: cria Data Tables idempotentes.
2. `DOCUMENTOS · 01 · Capturar grupos WAHA`: recebe webhook, filtra grupo/mídia, deduplica, baixa, calcula SHA-256, arquiva no Drive e enfileira a IA.
3. `DOCUMENTOS · 02 · Analisar com NVIDIA`: usa Nemotron 3 Nano Omni para leitura visual e Nemotron 3 Ultra 550B para estruturação, valida o JSON e separa documento válido de revisão humana.
4. `DOCUMENTOS · 02B · Organizar no Drive e confirmar`: procura ou cria `emitente/AAAA-MM/DD`, renomeia e move o documento, atualiza o manifesto e confirma no grupo com o acumulado do dia.
5. `DOCUMENTOS · 03 · Fechamento diário`: às 18h gera CSV, arquiva no Drive e envia o resumo diário ao grupo.
6. `DOCUMENTOS · 04 · Registrar erros`: persiste falhas técnicas.

Os seis workflows estão visíveis pela conexão MCP oficial do n8n. Na instância local, `01`, `02`, `02B`, `03` e `04` estão publicados para o piloto controlado; `00` permanece como bootstrap manual.

## Estado verificado em 30/09/2026

- conexão MCP oficial do n8n confirmada;
- seis workflows encontrados no projeto;
- descrições operacionais adicionadas aos workflows;
- Data Tables `documentos_contabeis_manifesto` e `documentos_contabeis_erros` criadas;
- bootstrap executado pelo MCP na execução `22`, com status `success`;
- task runners JavaScript e Python externos registrados e funcionais;
- execução sintética `24` concluída com sucesso, descartando grupo não autorizado sem chamada externa;
- grupo `Plx teste` autorizado pelo ID interno do WhatsApp;
- sessão WAHA `contabilidade-lab` conectada em estado `WORKING`;
- webhook WAHA apontado diretamente para o n8n com cabeçalho interno, recebendo somente eventos `message`;
- eventos sintéticos no grupo autorizado responderam `202` e `message_without_media`, sem mensagem de retorno ao WhatsApp;
- credencial WAHA `wahaApiHeaderV1` criada e vinculada ao download de mídia;
- OAuth do Google Drive vinculado e pastas `01 - ORIGINAIS`, `02 - FECHAMENTOS` e `03 - REVISAO HUMANA` criadas;
- credencial NVIDIA vinculada aos dois nós cognitivos;
- chamada direta ao Nemotron 3 Ultra 550B validada com HTTP 200 e resposta `NVIDIA_OK`;
- extrator descontinuado `nemoretriever-parse` substituído por `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`;
- nó descontinuado `Move Binary Data` substituído por `Extract From File`;
- manifesto ampliado com emitente, destinatário, emissão, valores fiscais, caminho final e IDs das pastas;
- subfluxo `02B` publicado e conectado à saída validada da NVIDIA;
- fechamento `03` alterado para 18h e publicado;
- workflows `01`, `02`, `02B`, `03` e `04` publicados;
- testes com dados fixados, sem efeitos externos, concluídos com sucesso: análise `66`, organização `62` e fechamento `65`;
- ensaio externo completo concluído com documento fiscal claramente fictício: ingestão `76`, análise NVIDIA `77` e organização/confirmação `78`, todos com status `success`;
- o primeiro ensaio externo (`74`) revelou perda do binário antes do upload; o fluxo `01` foi corrigido para sincronizar arquivo, SHA-256 e Base64 antes de montar o manifesto;
- arquivo criado no Drive em `01 - ORIGINAIS/TESTE EMITENTE LTDA - 12345678000195/2026-09/30/PLX CONTABILIDADE LTDA - 2026-09-30_08-30 - NF-12345 - TESTE EMITENTE LTDA.png`;
- manifesto atualizado para `ORGANIZED`, com R$ 1.250,50 de valor total, R$ 187,58 de tributos identificados e R$ 1.062,92 de resultado fiscal estimado;
- confirmação e resumo parcial enviados pelo WAHA ao grupo `Plx teste` às 09:31, com retorno de sucesso da API;
- o primeiro teste direto do modelo visual recebeu HTTP 503 por saturação temporária do endpoint gratuito da NVIDIA; não houve erro de credencial nem de modelo.

Portanto, a infraestrutura, o contrato de dados e o percurso externo WAHA → Drive → NVIDIA → organização → confirmação estão validados no laboratório. A próxima etapa é repetir o percurso com uma amostra anonimizada representativa das fotos reais do cliente.

## Próxima validação operacional

1. Enviar ao grupo `Plx teste` uma imagem anonimizada representativa das fotos reais do cliente.
2. Conferir a qualidade da extração em fotos inclinadas, com sombra, baixa resolução e mais de uma página.
3. Confirmar que documento incompleto ou de baixa confiança fica em revisão e não recebe confirmação indevida.
4. Medir o tempo de processamento em pelo menos 10 documentos; o ensaio externo consumiu cerca de 4 minutos na camada NVIDIA gratuita.
5. Executar o fechamento das 18h em um dia de laboratório com múltiplos documentos.

Segredos continuam fora dos JSONs versionados. As credenciais ficam criptografadas no n8n local.

## Atualização V2 — leitura documental híbrida

Foi criado um caminho V2, ainda inativo, para substituir a leitura visual monolítica por um adaptador documental:

- XML: decodificação determinística;
- PDF com texto: extração local com Poppler;
- foto: Nemotron OCR v2;
- PDF escaneado: rasterização local por página e Nemotron OCR v2;
- interpretação dos campos: Nemotron 3.5 Lightning;
- baixa confiança ou campos críticos ausentes: revisão humana.

A chave NVIDIA fica no serviço interno `document-ai-gateway`, sem porta publicada e sem segredo dentro do workflow. O ensaio sintético do n8n (`documentV2SyntheticE2E`) passou nas execuções `434` e `440`. A evidência completa está em `evidence/VALIDACAO-OCR-HIBRIDO-2026-09-30.md`.

O fluxo principal V2 permanece inativo e não foi conectado ao gateway para documentos reais. Essa ligação depende de autorização específica para enviar o conteúdo contábil à API hospedada da NVIDIA.

## Contrato de troca do provedor de IA

O restante da automação depende dos campos de identidade fiscal, destinatário, emissão, número, valor, tributos, confiança e evidências, além dos campos técnicos de auditoria. Para trocar NVIDIA por outro provedor, altere somente o workflow `02` e preserve esse contrato.

## Métrica financeira

- `valor total emitido`: soma do valor total das notas organizadas;
- `tributos identificados`: valor destacado ou soma de componentes explicitamente presentes;
- `resultado fiscal estimado`: valor total menos tributos identificados;
- `lucro líquido real`: não é calculado a partir da nota fiscal, pois exige custos, despesas e demais dados financeiros.

## Fontes e validação local

```bash
node scripts/build-workflows.mjs
node scripts/validate-workflows.mjs
```

Esses comandos validam os cinco templates JSON originais. O organizador `02B` tem como fonte o arquivo `sdk/organizar-documento.ts` e foi criado e validado com o SDK/MCP oficial do n8n. O estado operacional definitivo é o publicado na instância n8n; reconstruir templates locais não altera automaticamente os workflows ativos.
