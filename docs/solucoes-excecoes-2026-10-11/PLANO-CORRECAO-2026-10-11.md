# Plano de correção — triagem documental PLX (WAHA → n8n → Drive)

Data: 11/10/2026 · Base: `README.md`, `decisoes.md`, `runbook-validacao-p0.md` e `matriz-aceitacao.csv` desta pasta.

Este plano não cria uma numeração nova. Ele ordena as fases P0-A, P0-B, P0-C e P0-D do README e acrescenta o que falta para cada uma ser executável: arquivo ou nó, teste, gate e o que fica fora.

---

## 0. Regras que valem para todas as fases

1. **O workflow ativo `plxUnifiedV35Draft` (versão `c9353d7a-6b1c-4294-a521-7752737aa7c2`) só muda depois de export, teste com política inativa, matriz aprovada e canário de laboratório.** Toda alteração nasce em `workflows/plx-unified-v35-candidate.json` via `build-unified-v35.cjs`.
2. **A política decide e a IA só sugere.** Sem política, com conflito ou com ambiguidade, o documento vai para retenção restrita por `tenant/grupo/data`. Nunca para uma pasta com nome de cliente.
3. **Não aplicar retry nem aumentar timeout** no `WAHA · Validar e normalizar` antes de concluir o diagnóstico da F1.
4. **Nenhuma pilha nova.** Não adotar o queue mode do n8n, Redis, Temporal nem outro broker nesta rodada.
5. **Rollback cobre três coisas:** política, versão do workflow e efeitos externos (arquivos no Drive e mensagens enviadas). Não apagar arquivo para esconder divergência.
6. **Evidência obrigatória por gate**, no formato "Modelo de evidência de encerramento" do runbook: `run_id`, versão, hash do corpus, contagens e decisão `APROVADO` ou `BLOQUEADO`.

---

## 1. Decisões a fechar antes de codar (bloqueiam F2 em diante)

| # | Decisão | Recomendação | Por quê |
|---|---|---|---|
| D1 | Fila canônica: `plx-ingress-queue` (SQLite) ou `oc-queue` (`job_runtime.py` + `003_notification_outbox.sql`) | **`plx-ingress-queue`** como ledger de ingresso e jobs, **portando** o desenho de outbox da `oc-queue` para dentro dela | A `plx-ingress-queue` já tem a chave de escopo completa, o lease token e 17 testes. Manter duas filas cria dois lugares para reconciliar. |
| D2 | Vocabulário de estados | **Adotar o do README** e aposentar `RECEBIDO/NA_FILA/ARMAZENADO/DUPLICADO` | O painel, a fila e o manifesto precisam falar a mesma língua. `done` não pode significar "arquivado" sem prova. |
| D3 | Contenção imediata na produção enquanto P0-A não sobe | **Decisão do responsável da operação.** Opção mínima: um ajuste isolado no ativo que troca o fallback "nome extraído vira pasta" por retenção restrita, com export prévio | Hoje um documento sem proprietário cadastrado pode criar pasta pelo nome extraído, com risco de LGPD entre clientes. Se a decisão for não mexer, registrar o aceite do risco por escrito. |
| D4 | Limite por tenant | Começar com **1 job em execução por tenant** e **N global = capacidade medida na F1** | Evita que um lote de um cliente segure os demais (E21). |

---

## 2. Fases

### F0 — P0-A em candidato: política, identidade e destino

**Situação:** `policy-resolver.cjs` aprovado em A01–A08 no workflow manual de staging `FCJaC3PHcJLVIJhs` (execução 3500, tabela `plx_p0_politicas_grupo_staging`). Ainda não está ligado ao candidato nem à produção.

**Mudanças no candidato** (nós do v35):

| Nó / arquivo | Defeito atual | Correção |
|---|---|---|
| Nó de resolução de destino | Nome extraído vira pasta quando não há proprietário cadastrado | Chamar `resolveArchivePolicy({policy, ingress, document})`. Sem política, retorna `POLICY_NOT_CONFIGURED` e o documento vai para retenção restrita (E27) |
| Comparação de proprietário | Substring: "Empresa" aceita "Empresa Distinta Ltda" | Usar `matchesOwner` apenas por identidade cadastrada (CNPJ/CPF/alias aprovado). Similaridade vira `REVIEW_REQUIRED` (E28) |
| Validação da política | CNPJ cadastrado sem nome não bloqueia conflito | Conflito de ID bloqueia mesmo sem nome e retorna `IDENTITY_CONFLICT` (E29) |
| Validação da política | `archive_mode` inválido ou nulo vira `received` | `validatePolicy` rejeita a política com erro de configuração rastreável (E30) |
| `Fila · Montar envelope durável` | Empresa fixa no envelope | Envelope carrega `tenant_id`, `group_id`, `policy_id` e `policy_version` resolvidos da política do grupo |
| `Validar classificação e evidências` | Preenche o destinatário com `company_name` | Destinatário vem só da política. Sem destinatário autorizado, não há notificação ao cliente, apenas caso de revisão |
| `Consultar documento pelo SHA-256` | Consulta sem escopo de tenant | Filtrar por `tenant_id` (e escopo autorizado). Mesmo hash em outro tenant não reaproveita link nem pasta (E26) |
| Normalização de CNPJ | Remove letras e quebra o CNPJ alfanumérico | Preservar `[0-9A-Z]`, validar pelo DV oficial e manter os numéricos legados (E35) |
| Manifesto | Não registra direção, proprietário, política nem CNPJ do destinatário | Acrescentar `owner_id`, `direction`, `policy_id`, `policy_version`, `recipient_id`, `reason_codes[]` e `evidence[]` |
| Operação entre duas empresas autorizadas | Escolhe a primeira | Exige regra explícita na política ou vai para revisão (E36) |

**Testes**
- `policy-resolver.test.cjs`: manter A01–A08 e acrescentar regressões para cada linha da tabela acima que ainda não tenha teste.
- `unified-v35.workflow.test.cjs`: provar que o candidato chama o resolver e que nenhum caminho cria pasta de cliente sem `owner_id` resolvido pela política.
- Matriz: E01–E05, E13, E26–E30, E35–E36, com política **inativa** e sessão, grupo e Drive de laboratório.

**Gate F0:** 100% dos casos acima aprovados; zero retorno com pasta final de cliente em caso sem política, conflito ou ambiguidade; evidência registrada.

**Fora de escopo:** migrar pastas antigas criadas por nome. Isso vira um trabalho separado com simulação e manifesto de movimentos.

---

### F1 — Diagnóstico do runner (execuções 3415/3417)

**Sintoma:** `Task request timed out` no `WAHA · Validar e normalizar`, antes do enfileiramento.

**Passos (só medir, sem mudar):**
1. Coletar a configuração efetiva do runner: modo (internal/external), `N8N_RUNNERS_*` (timeout, concorrência, memória) e versão do n8n.
2. Medir, nas últimas execuções desse nó, a distribuição de duração (p50/p95/máx) e o tamanho do payload de entrada. Verificar especificamente se o binário em base64 passa pelo Code node.
3. Cruzar o horário de 3415/3417 com a carga do VPS (CPU, memória, swap) e com as execuções concorrentes.
4. Reproduzir em laboratório com um arquivo do mesmo tamanho e tipo.

**Saída:** uma nota curta com a causa provável e a capacidade medida (jobs simultâneos sustentáveis), que alimenta o N global da D4.

**Hipótese a confirmar, não assumir:** mídia em base64 sendo manipulada dentro do Code node. Se for isso, a correção é tirar o binário do Code node e não aumentar o timeout.

---

### F2 — P0-B: durabilidade e ACK após persistência

**Objetivo:** cada mensagem do WhatsApp vira uma ocorrência persistida antes do ACK e pode ser recuperada depois de qualquer queda.

**Mudanças**
- Rota: WAHA → `plx-ingress-queue` (persiste evento + job em uma transação e só então responde 200) → dispatcher → n8n. O n8n deixa de ser o receptor direto do webhook.
- O evento persistido guarda o necessário para baixar a mídia de novo. Se a mídia do WAHA expirar antes do download, o estado é `SOURCE_UNAVAILABLE` e há alerta. Não pode falhar em silêncio.
- `claim_next(lease_seconds=330.0)` (`queue_service.py:146`): o lease precisa ser maior que a duração máxima medida na F1 mais uma margem. O token de lease é conferido em toda conclusão, falha ou movimento (já existe no laboratório; manter).
- Publicar a `plx-ingress-queue` no VPS **em laboratório**, com o endpoint protegido.

**Testes:** B01–B03 e B07–B09 do runbook (E11, E16, E19–E21, E31–E33). B04–B06 dependem da F3.

**Gate F2:** nenhum ACK órfão, nenhuma perda silenciosa, worker antigo não conclui, e o reinício recupera os jobs.

---

### F3 — P0-C: contrato de resposta, Drive verificado e outbox

**Contrato n8n → fila** (único formato aceito):

```json
{
  "outcome": "ARCHIVE_VERIFIED | REVIEW_REQUIRED | REJECTED_UNSUPPORTED | SOURCE_UNAVAILABLE | RETRY_WAIT",
  "drive_file_id": "…",
  "parent_id": "…",
  "sha256": "…",
  "policy_version": "…",
  "review_reason": "… | null"
}
```

**Mudanças em `queue_service.py`**
- `Dispatcher.dispatch` (l.250) hoje aceita `body.ok is True or body.status == "DUPLICATE"`. Passa a validar o contrato: `outcome` no enum; para `ARCHIVE_VERIFIED`, exige `drive_file_id`, `parent_id` igual ao esperado pela política e `sha256` igual ao da ocorrência. Resposta fora do contrato vira falha com motivo, nunca `done`.
- Duplicado só conta como sucesso se devolver o `drive_file_id` canônico **do mesmo tenant**.
- `mark_done` (l.171) grava `drive_file_id`, `parent_id`, `policy_version` e `outcome`. `ARCHIVE_VERIFIED` fica separado de `done`.
- Schema (l.31/35): substituir o CHECK `queued/processing/retry/done/failed` pelos estados do README, com migração dos registros existentes.

**Drive (no n8n)**
- Sequência: intenção persistida → reserva de ID → upload → verificação por ID (parent, nome, tamanho, escopo) → `ARCHIVE_VERIFIED`, gravado na mesma transação local que a intenção de notificação.
- `idempotency_key` gravada em `appProperties` do arquivo, para reconciliar timeouts ambíguos (E33). Um 409 ou timeout exige conferência antes de repetir.
- Pastas com chave lógica única `tenant + parent_id + chave_do_segmento`, com o Drive ID persistido (E19).

**Outbox de notificação** (portado da `oc-queue/migrations/003_notification_outbox.sql`)
- Nasce só a partir de `ARCHIVE_VERIFIED`. Chave única por ocorrência, tipo e revisão.
- Estados `PENDING → DISPATCHING → SENT | UNKNOWN | FAILED`. `UNKNOWN` não reenvia sem reconciliação (E34).
- Falha de notificação repete só a notificação, sem OCR, IA nem upload (E17).

**Revisão:** casos `OPEN → ASSIGNED → RESOLVED | WAITING_CUSTOMER`, com responsável e prazo vindos da política (E22). Correção pelo WhatsApp só de remetente autorizado e sem aprendizado global (E23).

**Testes:** B04–B06 e B08 do runbook, além de E17, E18, E22–E24 e E34.

**Gate F3:** nenhum `done`/`ARCHIVE_VERIFIED` sem `drive_file_id` verificado; nenhuma confirmação ao cliente sem arquivo verificado; nenhuma duplicação por timeout.

---

### F4 — Justiça entre tenants

- `claim_next` (l.146) hoje faz `ORDER BY id LIMIT 1`. Trocar por: entre os tenants com jobs prontos **e** com `em_execução < limite_tenant`, escolher o tenant cujo job pronto mais antigo é o mais antigo de todos. Respeitar o limite global da F1.
- Teste: lote de 50 jobs do tenant A seguido de 1 do tenant B. B não espera o lote de A terminar (E21).

---

### F5 — Consulta operacional e painel v0 (somente leitura)

- `do_GET` (l.307) hoje só serve `/v1/jobs/{id}`. Acrescentar `GET /v1/jobs?tenant=&group=&status=&since=` com paginação.
- Autenticação obrigatória e escopo por tenant no servidor. Telefone mascarado e nenhum conteúdo de documento na resposta.
- Página v0 com contagem por estado, lista filtrável e detalhe do job (estado, tentativas, motivo, `drive_file_id`, outbox). Sem botões de ação nesta versão.
- Seguir `PLANO-PAINEL-OPERACIONAL.md` no que não conflitar com este plano.

---

### F6 — Canário de laboratório e promoção

1. Executar o roteiro "Canário controlado" do runbook (passos 1–6) depois de F0, F2 e F3 aprovados.
2. Export do ativo (`c9353d7a…`) e `cutover-preflight.cjs`.
3. Promoção com a política **inativa** e depois ativação em **um** grupo autorizado (piloto assistido), seguindo os critérios do runbook.
4. `cutover-postcheck.cjs` e reconciliação diária WhatsApp → evento → fila → Drive → manifesto → outbox.
5. Rollback com `cutover-rollback-check.cjs`, cobrindo política, versão e efeitos externos.

---

### Backlog (depois do piloto)

- **P0-D:** E14 (dado de saúde restrito), E15 (arquivo hostil), E25 (saída de cliente), E26 (testes negativos de isolamento), E37 (ensaio de restauração com RPO/RTO) e E38 (prompt injection). Precisa estar concluído antes de abrir para um segundo cliente.
- **P1:** PDF composto, versões e cancelamento, CPF e identidade ausente (E06–E13, E39–E40).
- **P2:** throughput e formatos complementares.
- Relatório diário de fechamento (E24) e migração de pastas antigas, com simulação.

---

## 3. Ordem e dependências

```
D1–D4 ─┬─> F0 (P0-A candidato) ──────────────┐
       └─> F1 (diagnóstico) ─> F2 (P0-B) ─> F3 (P0-C) ─> F4 ─> F6 (canário → piloto)
                                              └─> F5 (painel v0, em paralelo a F4)
```

- F0 e F1 podem andar em paralelo.
- F6 só começa com F0, F2 e F3 aprovados (regra do runbook).
- O preenchimento de responsável e prazo fica com o dono do projeto:

| Fase | Responsável | Prazo | Gate |
|---|---|---|---|
| D1–D4 | | | Decisões registradas em `decisoes.md` (ADR aceita) |
| F0 | | | Matriz P0-A 100% |
| F1 | | | Nota de causa + capacidade medida |
| F2 | | | B01–B03, B07–B09 |
| F3 | | | B04–B06, B08 + E17/E18/E22–E24/E34 |
| F4 | | | Teste de justiça |
| F5 | | | Página v0 com auth e escopo |
| F6 | | | Canário sem divergência |

---

## 4. Entrega esperada por fase

Para cada gate, devolver:
1. Diff ou commit (candidato, `queue_service.py`, testes).
2. Saída dos testes (contagem aprovada/total).
3. Tabela de evidência no modelo do runbook.
4. O que ficou `BLOQUEADO` e por quê.
5. Confirmação explícita de que o workflow ativo **não** foi alterado (ou, se a D3 foi aprovada, o export e o diff exato aplicado).
