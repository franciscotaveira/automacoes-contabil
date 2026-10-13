# Runbook de cutover controlado

Este roteiro não autoriza publicação automática. Ele define os gates mínimos
para trocar o consumidor WAHA ou ativar o modo estrito.

## 1. Preparação

- [ ] Confirmar backup verificável do banco, fila e manifesto.
- [ ] Criar credenciais novas no ambiente de destino; não copiar segredos de host comprometido.
- [ ] Revisar `deploy/migrations/003_add_documents_state.sql` e aplicá-la manualmente apenas na janela aprovada.
- [ ] Preencher tenant, operação, grupo, pasta do Drive e policy version com valores do cliente.
- [ ] Manter `FEATURE_FLAG_STRICT_MODE=false` durante o smoke inicial.

## 2. Provar persistência antes do ACK

1. Enviar um evento sintético com `tenant_id`, `group_id` e `message_id` únicos.
2. Confirmar que o manifesto contém o `correlation_id` correspondente.
3. Confirmar que a resposta técnica contém `persisted: true` somente depois do registro.
4. Repetir o mesmo evento e verificar que não surgiu um segundo documento.

Se o manifesto não existir, não habilitar o webhook.

## 3. Reconciliar

1. Exportar o manifesto anonimizado para o formato de `reconciler/fixtures/sample-manifest.json`.
2. Produzir a lista de Drive com `drive_id` e hash pela integração autorizada.
3. Executar o reconciliador em dry-run.
4. Exigir código de saída `0` e `discrepancies_total: 0`.

Qualquer código `2` bloqueia o cutover e exige correção ou revisão humana.

## 4. Política e IA

- [ ] Validar que toda decisão registra `policy_version`, `decision_reason` e `decision_log`.
- [ ] Atualizar a versão da política antes da mudança de regra.
- [ ] Testar CNPJ exato, alias aprovado, conflito de CNPJ e escopo ambíguo.
- [ ] Habilitar `FEATURE_FLAG_STRICT_MODE=true` somente depois de medir o volume enviado para revisão.
- [ ] Confirmar os thresholds `MIN_REINFORCEMENT_CONFIDENCE` e `MIN_LOCAL_OCR_SCORE_FOR_ACCEPT`.

## 5. Cutover WAHA

- [ ] Confirmar um único consumidor para a sessão/grupo.
- [ ] Habilitar o webhook somente após os gates anteriores.
- [ ] Enviar um documento canário sem dados pessoais reais.
- [ ] Verificar fila, manifesto, Drive, painel, reconciliador e confirmação pelo mesmo `correlation_id`.

## 6. Rollback

1. Desabilitar o webhook novo ou restaurar a rota anterior.
2. Manter os registros já persistidos; não apagar documentos durante rollback.
3. Desligar `FEATURE_FLAG_STRICT_MODE` se a regressão estiver na decisão de IA.
4. Restaurar a versão anterior dos workflows e serviços a partir da tag/commit aprovado.
5. Rodar o reconciliador e registrar as divergências antes de reprocessar.
